/* 稳定性批次回归测试（Node 桩环境，无头运行）：
 *   node tools/test_stability.js
 * 对应《项目评估与版本迭代规划》9.2 节的十条优先回归用例：
 *   1. 车课加载失败（FEN 列数错误）          → 入门课全部 FEN 可解析
 *   2. 马课没有目标棋子的合法解              → 每节动手课按题意可完成
 *   3. 指定棋子任务接受了其他棋子的着法      → judge 校验 who
 *   4. 黑方认输却计胜                        → winner/userResult 字段约定与迁移
 *   5. 红方损分视角反向                      → computeLosses 按 FEN 推导行棋方
 *   6. 重置后旧应手仍然落入                  → Quiz 定时器在 load/reset 时取消
 *   7. 思考中重新开局污染新局                → play.js 会话守卫（浏览器验收，此处验桩导出）
 *   8. 陪练切页后卡住                        → spar.js show() 恢复策略（浏览器验收，此处验桩导出）
 *   9. 三个引擎请求竞争                      → 引擎调度器串行化、优先级、取消、暂停
 *  10. 私教初始快照被后续回放改写            → replay 每帧棋盘与该帧 FEN 一致 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.dirname(__dirname);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- 浏览器桩 ----
const storage = new Map();
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  localStorage: {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k)
  },
  document: {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, addEventListener() {} }),
    getElementById: () => null,
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener() {}
  },
  navigator: { userAgent: "node" },
  performance: { now: () => Date.now() },
  SharedArrayBuffer: undefined   // 引擎 init 不在此测试
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function load(rel) {
  const p = path.join(ROOT, rel);
  vm.runInContext(fs.readFileSync(p, "utf8"), sandbox, { filename: rel });
}

load("js/diag.js");
load("js/rules.js");
load("js/notation.js");
load("js/constants.js");
load("js/trapcls-core.js");
load("js/duel-core.js");
load("js/engine.js");
sandbox.window.Sound = { play() {} };   // quiz/guide 依赖
load("js/quiz.js");
load("js/games.js");
load("js/annotated.js");
load("js/coachbrain.js");
load("js/guide.js");
load("js/play.js");
load("js/spar.js");

const X = sandbox.window.Xiangqi;
const Guide = sandbox.window.Guide;
const Quiz = sandbox.window.Quiz;
const Games = sandbox.window.Games;
const CoachBrain = sandbox.window.CoachBrain;
const Engine = sandbox.window.Engine;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log("  ✓ " + name);
  else { failures++; console.log("  ✗ " + name + (detail ? "  —— " + detail : "")); }
}
const INIT = X.INIT_FEN;

(async function main() {
  // ---- 用例 1/2：入门课局面与可完成性 ----
  console.log("① 入门课数据：FEN 可解析、任务按题意可完成");
  {
    const steps = Guide._steps;
    const judge = Guide._judge;
    let allParsed = true, bad = "";
    const trySteps = [];
    steps.forEach((s, i) => {
      try {
        const { board, side } = X.parseFen(s.fen);
        if (s.mode === "try") trySteps.push({ i, s, board, side });
      } catch (e) { allParsed = false; bad = i + "." + s.t + "：" + e.message; }
    });
    check("全部 " + steps.length + " 步 FEN 可解析（含旧版列数错误的车课）", allParsed, bad);
    check("动手课均定义了任务棋子 who 与成功条件 accept",
      trySteps.every(t => t.s.who && t.s.accept), JSON.stringify(trySteps.filter(t => !t.s.who || !t.s.accept).map(t => t.i)));

    // 每节动手课都存在至少一个被判为正确的着法（按题意可完成）
    let allSolvable = true, unsolvable = "";
    for (const { i, s, board, side } of trySteps) {
      const legal = X.legalMoves(board, side);
      const ok = legal.some(mv => judge(s, board, side, mv).ok);
      if (!ok) { allSolvable = false; unsolvable = (i + 1) + "." + s.t; }
    }
    check("每节动手课存在可验证的正确解", allSolvable, unsolvable);

    // 指定着集合（accept 数组）里的每一手都合法且被判对
    let arrOk = true;
    for (const { s, board, side } of trySteps) {
      if (!Array.isArray(s.accept)) continue;
      for (const t of s.accept) {
        const mv = X.parseMove(t);
        if (!judge(s, board, side, mv).ok) arrOk = false;
      }
    }
    check("指定任务着的答案集全部有效", arrOk);

    // --- 用例 2 回归：马课红马有合法着，且别马腿方向确实走不了 ---
    const horse = trySteps.find(t => t.s.t.indexOf("马") === 0);
    {
      const knightMoves = X.legalMoves(horse.board, horse.side).filter(mv => horse.board[mv[1]][mv[0]] === "N");
      check("马课红马存在合法着法（旧局面为 0）", knightMoves.length >= 1, "合法马着=" + knightMoves.length);
      // a0→b2（马腿方向）违法，a0→c1 合法
      check("马课别马腿方向 a0→b2 被规则拒绝", !X.isLegal(horse.board, "r", [0, 0, 1, 2]));
      check("马课非别腿方向 a0→c1 合法且判对",
        X.isLegal(horse.board, "r", [0, 0, 2, 1]) && judge(horse.s, horse.board, "r", [0, 0, 2, 1]).ok);
      // 兵课回归：旧局面红兵无合法着
      const pawn = trySteps.find(t => t.s.t.indexOf("兵") === 0);
      const pawnMoves = X.legalMoves(pawn.board, pawn.side).filter(mv => pawn.board[mv[1]][mv[0]] === "P");
      check("兵课红兵存在合法着法（旧局面为 0）且 c0c1 判对",
        pawnMoves.length >= 1 && judge(pawn.s, pawn.board, "r", [2, 0, 2, 1]).ok);
      // 照面课回归：帅上走一格必须被拒绝（教学演示点）
      const face = trySteps.find(t => t.s.t.indexOf("照面") >= 0);
      check("照面课帅 e0→e1 被规则拒绝", !X.isLegal(face.board, "r", [4, 0, 4, 1]));
    }
  }

  // ---- 用例 3：指定棋子任务不能走其他棋子通关 ----
  console.log("② 指定棋子任务判定（who 校验）");
  {
    const judge = Guide._judge;
    const steps = Guide._steps;
    const advisor = steps.find(s => s.t === "仕 / 士");
    const { board, side } = X.parseFen(advisor.fen);
    // 动帅（合法但非任务棋子）不得通关
    const kingMove = X.legalMoves(board, side).find(mv => board[mv[1]][mv[0]] === "K");
    check("仕课动帅被拒绝（reason=piece）",
      !!kingMove && !judge(advisor, board, side, kingMove).ok && judge(advisor, board, side, kingMove).reason === "piece");
    const advMove = X.legalMoves(board, side).find(mv => board[mv[1]][mv[0]] === "A");
    check("仕课走仕判对", !!advMove && judge(advisor, board, side, advMove).ok);
    // 吃子课：不吃子的车着合法但不得通关
    const rookStep = steps.find(s => s.t === "车");
    const rb = X.parseFen(rookStep.fen);
    const rookQuiet = X.legalMoves(rb.board, rb.side).find(mv => rb.board[mv[1]][mv[0]] === "R" && rb.board[mv[3]][mv[2]] === null);
    const v = judge(rookStep, rb.board, rb.side, rookQuiet);
    check("车课不吃子的车着合法但不判对（reason=target）",
      X.isLegal(rb.board, rb.side, rookQuiet) && !v.ok && v.reason === "target");
    // 炮课：唯一的吃子着 = 炮吃马（不是吃将），且必须隔炮架
    const cannonStep = steps.find(s => s.t === "炮 与 炮架");
    const cb = X.parseFen(cannonStep.fen);
    const caps = X.legalMoves(cb.board, cb.side).filter(mv => cb.board[mv[3]][mv[2]] !== null);
    check("炮课仅有一个吃子着，为炮 e1×e9 吃马（旧局面可吃黑将）",
      caps.length === 1 && caps[0][0] === 4 && caps[0][1] === 1 && caps[0][2] === 4 && caps[0][3] === 9 &&
      cb.board[9][4] === "n", JSON.stringify(caps));
  }

  // ---- 用例 4：黑方认输却计胜（胜负字段约定与旧数据迁移） ----
  console.log("③ 胜负字段：winner/mySide 约定 + 旧存档按来源迁移");
  {
    // 新存档：执黑认输（用户输）→ winner=b, result=loss → 用户负
    check("新存档 执黑认输 → winner=r, result=loss → 用户负", Games.userResult({ mySide: "b", winner: "r", result: "loss" }) === "loss");
    // 新存档：执黑打赢（用户胜）→ result=win → 用户胜
    check("新存档 执黑 result=win → 用户胜", Games.userResult({ mySide: "b", winner: "b", result: "win" }) === "win");
    // 旧对弈存档（用户视角）：执黑 result=win 含义是用户胜，不得翻转
    check("旧对弈存档 执黑 result=win（用户视角）→ 仍判用户胜",
      Games.normWinner({ mySide: "b", result: "win" }) === "b" &&
      Games.userResult({ mySide: "b", result: "win" }) === "win");
    // 旧对弈存档：执红 result=loss → 用户负
    check("旧对弈存档 执红 result=loss → 仍判用户负",
      Games.normWinner({ mySide: "r", result: "loss" }) === "b" &&
      Games.userResult({ mySide: "r", result: "loss" }) === "loss");
    // 旧导入存档（红方视角）：result=win 含义是红胜；执黑导入 → 用户负
    check("旧导入存档 result=win=红胜，执黑导入 → 用户负",
      Games.normWinner({ imported: true, mySide: "b", result: "win" }) === "r" &&
      Games.userResult({ imported: true, mySide: "b", result: "win" }) === "loss");
    check("旧导入存档 result=win=红胜，执红导入 → 用户胜",
      Games.userResult({ imported: true, mySide: "r", result: "win" }) === "win");
    // 和棋 / 未知
    check("和棋判和", Games.userResult({ mySide: "r", result: "draw", winner: "draw" }) === "draw");
    check("字段缺失判 unknown", Games.userResult({ mySide: "r" }) === "unknown");
    // parseGameText：头部结果按红黑视角返回 winner
    const parsed = Games._parseGameText("h2e2 h9g7\n【结果 黑胜】");
    check("导入解析【结果 黑胜】→ winner=b，着法 2 手", parsed.winner === "b" && parsed.moves.length === 2,
      JSON.stringify({ w: parsed.winner, n: parsed.moves.length }));
  }

  // ---- 用例 5：红方损分视角反向（按 FEN 推导行棋方） ----
  console.log("④ 逐手损分：行棋方由 FEN 推导，红黑/黑先一致");
  {
    const losses = Games._computeLosses;
    // 文档复现：红方局面 +100 → -400，红方走，损 500（旧实现读不到 side 记 0）
    const r1 = losses([100, -400], "r");
    check("红先 +100→-400（红走）损 500", r1[0].loss === 500, JSON.stringify(r1));
    // 黑方走：红视角 +100→+200，黑损 100
    const r2 = losses([100, 200], "b");
    check("黑先 +100→+200（黑走）黑损 100", r2.length === 1 && r2[0].loss === 100, JSON.stringify(r2));
    // 多手交错：红先，curve 红[0, -50, -50, 300]；第1手红 0→-50 损50；第2手黑 +50→+50 损0；第3手红 +50→+300 损0
    const r3 = losses([0, -50, -50, 300], "r");
    check("三手序列损分 [50,0,0]", r3[0].loss === 50 && r3[1].loss === 0 && r3[2].loss === 0, JSON.stringify(r3));
    // 黑先残局：startSide=b 时第 0/2 手是黑方、第 1 手是红方
    const r4 = losses([0, 100, -100, -100], "b");
    // ply0 黑：红视角0→100 ⇒ 黑损100；ply1 红：100→-100 ⇒ 红损200；ply2 黑：-100→-100 损0
    check("黑先序列损分 [100,200,0]", r4[0].loss === 100 && r4[1].loss === 200 && r4[2].loss === 0, JSON.stringify(r4));
    // sideAtPly / cpToRed 基础
    check("sideAtPly 奇偶推导", X.sideAtPly("r", 0) === "r" && X.sideAtPly("r", 1) === "b" && X.sideAtPly("b", 3) === "r");
    check("cpToRed 走子方→红方", X.cpToRed(80, "r") === 80 && X.cpToRed(80, "b") === -80);
  }

  // ---- 用例 6：练习重置后旧自动应手不得写入新一轮 ----
  console.log("⑤ 练习定时器：重置后旧应手作废");
  {
    const lesson = { fen: INIT, moves: [{ m: "h2e2", cn: "炮二平五", ch: [{ m: "h9g7", cn: "马8进7" }] }] };
    let doneCnt = 0;
    const q = Quiz.create({ onDone: () => doneCnt++ });
    q.load(lesson);
    const [f0, r0, f1, r1] = X.parseMove("h2e2");
    check("正着被接受，进入等待应手", q.tryMove(f0, r0, f1, r1) === true && q.turn === "waiting");
    q.reset();   // 立即重置（450ms 应手还在路上）
    await sleep(600);
    check("重置后 450ms 旧应手未写入新一轮", q.boardState().turn === "student" &&
      (function () { const st = q.boardState(); return st.board[9][7] === "n"; })(),
      "turn=" + q.boardState().turn);
    check("旧应手不触发 onDone", doneCnt === 0);
    // 正常流程不受影响：走对 → 450ms 后棋谱应手 → 无后续即完成
    const q2 = Quiz.create({ onDone: () => doneCnt++ });
    q2.load(lesson);
    q2.tryMove(f0, r0, f1, r1);
    await sleep(600);
    check("正常流程 450ms 后应手落地并完成", q2.turn === "done" && doneCnt === 1, "turn=" + q2.turn);
  }

  // ---- 用例 9：三个引擎请求竞争（调度器） ----
  console.log("⑥ 引擎调度：串行化、优先级、取消、后台暂停");
  {
    Engine._test.reset();
    Engine._test.setReady(true);
    let pending = [];
    Engine._test.setRawSearch((fen, mt, pv) => new Promise(res => pending.push({ fen, res })));

    const done = [];
    const t1 = Engine._test.submit("批1", 10, 1, Engine.PRIORITY.BACKGROUND)
      .then(r => done.push(["批1", r.via]));
    // 批1 立即开跑（队列空）；随后插入三个并发请求
    const t2 = Engine._test.submit("应着", 10, 1, Engine.PRIORITY.PLAY).then(r => done.push(["应着", r.via]));
    const t3 = Engine._test.submit("提示", 10, 1, Engine.PRIORITY.USER).then(r => done.push(["提示", r.via]));
    const t4 = Engine._test.submit("形势", 10, 1, Engine.PRIORITY.AMBIENT).then(r => done.push(["形势", r.via]));
    await sleep(0);
    check("同一时刻只有一个搜索在执行（不互相 clobber）", Engine._test.busy === true && pending.length === 1);
    check("其余请求在队列中等待", Engine._test.queue.length === 3, JSON.stringify(Engine._test.queue));
    pending[0].res({ best: "h2e2", cands: [{ mv: "h2e2", cp: 30 }], via: "bestmove" });
    await sleep(0);
    await sleep(0);
    check("批1 完成后最高优先级（对局应着）先执行",
      pending.length === 2 && pending[1].fen === "应着", JSON.stringify(pending.map(p => p.fen)));
    pending[1].res({ best: "b0c2", cands: [{ mv: "b0c2", cp: 10 }], via: "bestmove" });
    await sleep(0); await sleep(0);
    check("其次执行用户提示（80 > 形势 40）", pending.length === 3 && pending[2].fen === "提示",
      JSON.stringify(pending.map(p => p.fen)));
    pending[2].res({ best: null, cands: [], via: "timeout" });
    await sleep(0); await sleep(0);
    pending[3].res({ best: null, cands: [], via: "timeout" });
    await Promise.all([t1, t2, t3, t4]);
    check("全部请求按序完成，无 clobbered 状态", done.length === 4 && done.every(d => d[1] !== "clobbered"),
      JSON.stringify(done));

    // 取消：排队任务立即以 cancelled 结算（先占住执行位，让目标任务留在队列里）
    pending = [];
    Engine._test.setRawSearch((fen, mt, pv) => new Promise(res => pending.push({ fen, res })));
    let cancelVia = null;
    const tBlock = Engine._test.submit("占位", 10, 1, Engine.PRIORITY.USER);
    const t5 = Engine._test.submit("会取消的", 10, 1, Engine.PRIORITY.REVIEW)
      .then(r => { cancelVia = r.via; });
    await sleep(0);
    const n = Engine.cancel(t => t.fen === "会取消的");
    await sleep(0);   // 取消结算走微任务，等一拍再断言
    check("排队任务可取消且状态为 cancelled", n === 1 && cancelVia === "cancelled");
    check("已取消的任务不会再被执行", pending.every(p => p.fen !== "会取消的"), JSON.stringify(pending.map(p => p.fen)));
    pending[0].res({ best: null, cands: [], via: "timeout" });
    await Promise.all([tBlock, t5]);

    // 后台暂停：暂停时 BACKGROUND 不执行，前台不受影响
    Engine._test.reset();
    Engine._test.setReady(true);
    Engine.setBackgroundPaused(true);
    pending = [];
    Engine._test.setRawSearch((fen, mt, pv) => new Promise(res => pending.push({ fen, res })));
    let bgRan = false, userRan = false;
    const t7 = Engine._test.submit("后台", 10, 1, Engine.PRIORITY.BACKGROUND)
      .then(() => { bgRan = true; });
    await sleep(0);
    check("暂停时后台批处理不执行", !bgRan && !Engine._test.busy && Engine._test.queue.length === 1,
      JSON.stringify(Engine._test.queue));
    const t8 = Engine._test.submit("前台", 10, 1, Engine.PRIORITY.USER)
      .then(() => { userRan = true; });
    await sleep(0);
    check("暂停只挡后台，前台照常执行", !userRan && Engine._test.busy && pending.length === 1 && pending[0].fen === "前台",
      JSON.stringify(pending.map(p => p.fen)));
    pending[0].res({ best: null, cands: [], via: "timeout" });
    await sleep(0); await sleep(0);
    check("前台完成后后台仍被挡住", !bgRan && Engine._test.queue.length === 1);
    Engine.setBackgroundPaused(false);
    await sleep(0);
    check("恢复后后台批处理继续执行", Engine._test.busy && pending.length === 2 && pending[1].fen === "后台",
      JSON.stringify(pending.map(p => p.fen)));
    pending[1].res({ best: null, cands: [], via: "timeout" });
    await Promise.all([t7, t8]);
    check("后台与前台任务最终都完成", bgRan && userRan);
    Engine._test.reset();
  }

  // ---- 用例 10：私教初始快照被回放改写 ----
  console.log("⑦ coachbrain 回放：每帧棋盘与该帧 FEN 一致（快照独立）");
  {
    const states = CoachBrain._replay([{ m: "h2e2" }, { m: "h9g7" }], null);
    check("回放共 3 帧", states.length === 3);
    let consistent = true;
    for (const st of states) {
      if (X.boardToFen(st.board, st.side) !== st.fen) consistent = false;
    }
    check("每帧 board 与该帧 fen 一致（旧实现首帧被改写）", consistent,
      JSON.stringify(states.map(s => s.fen)));
    const fresh = X.parseFen(INIT).board;
    check("首帧棋盘保持初始局面未被后续回放改写",
      JSON.stringify(states[0].board) === JSON.stringify(fresh));
    check("第二帧为中炮后局面", states[1].fen !== INIT, states[1].fen);
    // 残局摆谱起点（game.fen）同样正确
    const mid = "3k5/9/9/9/3p5/9/9/9/9/3RK4 w - - 0 1";
    const s2 = CoachBrain._replay([{ m: "d0d5" }], mid);
    check("带起始 FEN 的回放帧一致", X.boardToFen(s2[1].board, s2[1].side) === s2[1].fen);
  }

  // ---- 7/8 桩导出（完整流程属浏览器验收，见规划 5.3） ----
  console.log("⑧ 对弈/陪练会话守卫桩导出");
  {
    check("PlayDebug 可用（会话守卫在浏览器流程验收）", !!sandbox.window.PlayDebug);
    check("SparDebug 可用（show() 恢复策略在浏览器流程验收）", !!sandbox.window.SparDebug);
  }

  // ---- 用例 11：飞刀/骗招分类核心（trapcls-core 纯函数，运行时与离线分类器共用） ----
  console.log("⑩ TrapCls 分类核心：假搜索桩覆盖上当判定与三档分类");
  {
    const TrapCls = sandbox.window.TrapCls;
    const wait0 = () => Promise.resolve();   // 注入立即返回，测试不真等 300ms
    // 基础局：4 手主线（INIT 起，源格均有子；applyMove 不校验合法性，够纯函数推演即可）。
    // 课程数据的主线是嵌套链 moves[0].ch[0].ch[…]，与 data/lessons 实际格式一致。
    const node4 = { m: "b9c9", cn: "马2进3" };
    const node3 = { m: "e2e6", cn: "炮五进四", ch: [node4] };
    const node2 = { m: "h9g9", cn: "马8进7", ch: [node3] };
    const moves = [{ m: "h2e2", cn: "炮二平五", ch: [node2] }];
    const data = { fen: INIT, moves };

    // 短线 <4 手直接未知
    const r0 = await TrapCls.classifyOne({ fen: INIT, moves: [{ m: "h2e2", cn: "炮二平五", ch: [node2] }] }, async () => [], { wait: wait0 });
    check("短线 <4 手 → 未知", r0.cls === "未知" && r0.trapPly === null, JSON.stringify(r0));

    // j=1：首选 e3e4（cp 0）、实际着 h9g9（cp -200）→ fall=200 上当；
    // cands0 首选 cp 0；识破线评估 -400 → loss=400 > 150 → 骗招
    let searched = [];
    const r1 = await TrapCls.classifyOne(data, (fen, ms, mpv) => {
      searched.push({ ms, mpv });
      if (mpv === 4) return Promise.resolve([{ mv: "e3e4", cp: 0 }, { mv: "h9g9", cp: -200 }]);
      return Promise.resolve([{ mv: "h9g9", cp: -400 }]);
    }, { wait: wait0 });
    check("上当点 fall=200 → trapPly=1", r1.trapPly === 1 && r1.fall === 200, JSON.stringify(r1));
    check("loss=400 → 骗招", r1.cls === "骗招" && r1.loss === 400, JSON.stringify(r1));
    check("搜索时长默认 300、MultiPV 4/1 两路都走到",
      searched.every(s => s.ms === 300) && searched.some(s => s.mpv === 4) && searched.some(s => s.mpv === 1),
      JSON.stringify(searched));

    // 首选即实际着 → fall=0 不算上当 → 未知
    const r2 = await TrapCls.classifyOne(data, () => Promise.resolve([{ mv: "h9g9", cp: -10 }]), { wait: wait0 });
    check("无上当（fall<150）→ 未知", r2.cls === "未知" && r2.trapPly === null, JSON.stringify(r2));

    // 搜索返回空：重试一次（时长 ×2）仍空 → 未知
    const calls = [];
    const r3 = await TrapCls.classifyOne(data, (fen, ms) => { calls.push(ms); return Promise.resolve([]); }, { wait: wait0 });
    check("候选为空（含 2 倍时长重试）→ 未知", r3.cls === "未知" && calls.length === 2 && calls[1] === calls[0] * 2, JSON.stringify(calls));

    // 识破线 -100 → loss=100 → 险招；自定义 ms 透传
    let msSeen = 0;
    const r4 = await TrapCls.classifyOne(data, (fen, ms, mpv) => {
      msSeen = ms;
      return Promise.resolve(mpv === 4 ? [{ mv: "e3e4", cp: 0 }, { mv: "h9g9", cp: -200 }] : [{ mv: "h9g9", cp: -100 }]);
    }, { ms: 400, wait: wait0 });
    check("loss=100 → 险招，ms 参数生效", r4.cls === "险招" && r4.loss === 100 && msSeen === 400, JSON.stringify(r4));

    // 识破线 0 → loss=0 → 飞刀
    const r5 = await TrapCls.classifyOne(data, (fen, ms, mpv) =>
      Promise.resolve(mpv === 4 ? [{ mv: "e3e4", cp: 0 }, { mv: "h9g9", cp: -200 }] : [{ mv: "h9g9", cp: 0 }]), { wait: wait0 });
    check("loss=0 → 飞刀", r5.cls === "飞刀" && r5.loss === 0, JSON.stringify(r5));
  }

  // ---- 用例 12：引擎长搜切片（P1-3）：长 PLAY 拆 600ms 片，片间让位前台请求 ----
  console.log("⑪ 长搜切片：PLAY 1800ms 拆片 + USER 插队最多等一片");
  {
    Engine._test.reset();
    Engine._test.setReady(true);
    const calls = [];   // 每次 rawSearch 的 {mt, pv}
    Engine._test.setRawSearch((fen, mt, pv) => new Promise(res => {
      calls.push({ mt, pv });
      setTimeout(() => res({ best: "h2e2", cands: [{ mv: "h2e2", cp: 5, line: ["h2e2"] }], via: "stub" }), 25);
    }));
    // 场景 A：PLAY 1800ms 在搜，5ms 后 USER 100ms 排队 → PLAY 走完第 1 片就让位
    const t0 = Date.now();
    const playA = Engine._test.submit("fenA", 1800, 4, Engine.PRIORITY.PLAY);
    await sleep(5);
    const userA = Engine._test.submit("fenB", 100, 1, Engine.PRIORITY.USER);
    const [rPlay, rUser] = await Promise.all([playA, userA]);
    check("让位场景：两任务都拿到结果", rPlay.best === "h2e2" && rUser.best === "h2e2");
    check("PLAY 让位后 USER 无需等满三片（<150ms 完成）", Date.now() - t0 < 150, (Date.now() - t0) + "ms");
    const aPlay = calls.slice(0, calls.findIndex(c => c.mt === 100));
    check("PLAY 被切成 600ms 片且提前让位（片数 1~2，非整 3 片）",
      aPlay.length >= 1 && aPlay.length <= 2 && aPlay.every(c => c.mt === 600),
      JSON.stringify(calls.map(c => c.mt)));
    check("USER 在让位后立即执行（下一笔即 100ms 任务）", calls[aPlay.length] && calls[aPlay.length].mt === 100,
      JSON.stringify(calls.map(c => c.mt)));
    // 场景 B：无更高优先级排队时，长搜走满全部片
    calls.length = 0;
    const playB = Engine._test.submit("fenC", 1800, 4, Engine.PRIORITY.PLAY);
    await playB;
    check("无人插队 → 走满 3 片 600ms", calls.length === 3 && calls.every(c => c.mt === 600),
      JSON.stringify(calls.map(c => c.mt)));
    // 场景 C：短任务不切片（行为与切片前一致）
    calls.length = 0;
    await Engine._test.submit("fenD", 400, 1, Engine.PRIORITY.USER);
    check("≤900ms 短任务单次搜索不切片", calls.length === 1 && calls[0].mt === 400, JSON.stringify(calls));
    // 场景 D：BACKGROUND 排队不触发让位（PLAY 仍走满片）
    calls.length = 0;
    const playD = Engine._test.submit("fenE", 1200, 4, Engine.PRIORITY.PLAY);
    await sleep(5);
    Engine._test.submit("fenF", 300, 1, Engine.PRIORITY.BACKGROUND);
    await playD;
    check("仅 BACKGROUND 在等 → PLAY 不让位走满 2 片",
      calls.filter(c => c.mt === 600).length === 2, JSON.stringify(calls.map(c => c.mt)));
    Engine._test.reset();
  }

  // ---- 存量正式测试与数据校验另行运行：node tools/test_opening_logic.js / python -B tools/build_openings.py --check ----

})().then(() => {
  console.log(failures ? "\n共 " + failures + " 项失败" : "\n全部通过");
  process.exit(failures ? 1 : 0);
}).catch(e => { console.error("测试执行出错：", e); process.exit(1); });
