/* 对弈流程回归桩（无头，Node 桩环境跑通完整一盘）：
 *   node tools/test_play_flow.js
 * 覆盖 play.js 人机对弈与 spar.js 私教陪练两条对弈路径（状态机核心 js/duel-core.js）：
 *   ① 学前档（随机合法着，不依赖引擎）整盘走到自然终局：走子/应着/终局判定/存谱字段约定
 *   ② 悔棋：弹两手、局面重放一致、轮到走子方正确；思考中悔棋被拒
 *   ③ 会话守卫：电脑思考中重开新局，旧回调不得把应着落进新局（历史 bug 锁定）
 *   ④ 陪练讲解层在无引擎环境下全程不抛异常（气泡有产出、终局总结正常）
 * 引擎以"不可用"桩注入：Engine.ready=false，对局双方均用学前档。 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.dirname(__dirname);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- 浏览器桩：DOM 元素注册表（按钮可点击）/ 快速定时器（350ms 思考节奏压到 60ms） ---- */
const els = {};
function makeEl(id) {
  return {
    id, innerHTML: "", textContent: "", value: "0", disabled: false,
    children: [], scrollTop: 0, scrollHeight: 0, style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild(c) { this.children.push(c); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}, scrollIntoView() {},
    onclick: null, onchange: null
  };
}
const container = {
  set innerHTML(v) { /* 模板串只用于真实浏览器渲染，桩环境不解析 */ },
  querySelector(sel) {
    const id = String(sel).replace(/^#/, "");
    return els[id] || (els[id] = makeEl(id));
  },
  querySelectorAll() { return []; }
};

const storage = new Map();
const sandbox = {
  console,
  setTimeout: (fn, ms) => setTimeout(fn, ms === 350 ? 60 : 1),   // 思考节奏压缩，其余定时器 1ms
  clearTimeout, setInterval, clearInterval,
  fetch: () => Promise.reject(new Error("no-fetch-in-test")),
  localStorage: {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k)
  },
  document: {
    createElement: () => makeEl("anon"),
    getElementById: () => null,
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener() {}
  },
  navigator: { userAgent: "node" },
  performance: { now: () => Date.now() },
  SharedArrayBuffer: undefined,
  confirm: () => true
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), sandbox, { filename: rel });
}

const boardCbs = { play: null, spar: null };   // 两个视图各自的棋盘走子回调（按 canvas id 区分）
sandbox.window.Sound = { play() {} };
sandbox.window.Board = {
  create(canvasEl, opts) {
    boardCbs[/spar/.test(canvasEl.id || "") ? "spar" : "play"] = opts.onMove;
    return { update() {}, flip() {}, redraw() {} };
  }
};

load("js/diag.js");
load("js/rules.js");
load("js/notation.js");
load("js/constants.js");
load("js/datacache.js");
load("js/duel-core.js");
load("js/engine.js");
load("js/games.js");
load("js/play.js");
load("js/spar.js");

/* 挂载两个对弈视图（桩 DOM：按钮 onclick 落在元素注册表上，测试直接触发） */
sandbox.window.Play.mount(container);
sandbox.window.Spar.mount(container);

const X = sandbox.window.Xiangqi;
const Games = sandbox.window.Games;
const PD = sandbox.window.PlayDebug;
const SD = sandbox.window.SparDebug;
const el = id => els[id] || (els[id] = makeEl(id));

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log("  ✓ " + name);
  else { failures++; console.log("  ✗ " + name + (detail ? "  —— " + detail : "")); }
}

/* 重放校验：从起始局面按 moves 重放，末局面须与 state 完全一致 */
function replayCheck(st, label) {
  const g = sandbox.window.DuelCore.newGame();
  for (const n of st.moves) X.applyMove(g.board, ...X.parseMove(n.m));
  check(label + "：重放末局面与状态一致（" + st.moves.length + " 手）",
    X.boardToFen(g.board, X.sideAtPly("r", st.moves.length)) === X.boardToFen(st.board, st.side) && st.side === X.sideAtPly("r", st.moves.length),
    X.boardToFen(st.board, st.side));
}

/* 视图开局：选边选档并点开始 */
async function begin(view, side, level) {
  const p = view === "play" ? "pl" : "sp";
  el(p + "-side").value = side;
  el(p + "-level").value = String(level);
  el(p + "-start").onclick();
  await sleep(20);   // spar 的 startGame 是 async（loadBook 拒绝即回）
}

/* 随机走一手人类着并等电脑应着 */
async function humanStep(view, Debug) {
  const st = Debug.state;
  const legal = X.legalMoves(st.board, st.side);
  const mv = legal[Math.floor(Math.random() * legal.length)];
  boardCbs[view](mv[0], mv[1], mv[2], mv[3]);
  await sleep(140);   // 思考节奏 60ms + 令牌链
}

(async function main() {
  /* ---------- ① play.js 整盘 ---------- */
  console.log("① 人机对弈（play.js / duel-core）：学前档整盘到自然终局");
  const gamesBefore = Games.all().length;
  await begin("play", "r", 0);
  let st = PD.state;
  for (let i = 0; i < 900 && st.status === "playing"; i++) {
    if (!st.thinking && st.side === st.mySide) await humanStep("play", PD);
    else await sleep(10);
    st = PD.state;
  }
  st = PD.state;
  check("对局自然结束（非超时截断）", st.status === "finished", "status=" + st.status + " moves=" + st.moves.length);
  check("终局字段：result 为用户视角三值", ["win", "loss", "draw"].indexOf(st.result.result) >= 0, JSON.stringify(st.result));
  check("存谱：Games 新增一条且着法数一致",
    Games.all().length === gamesBefore + 1 &&
    Games.all()[Games.all().length - 1].moves.length === st.moves.length,
    "before=" + gamesBefore + " after=" + Games.all().length);
  const rec = Games.all()[Games.all().length - 1];
  check("存谱字段约定：levelName/mySide/winner 齐备",
    rec.levelName === "学前" && rec.mySide === "r" && (rec.winner === "r" || rec.winner === "b" || rec.winner === "draw") &&
    (rec.winner === "draw" ? rec.result === "draw" : (rec.winner === rec.mySide) === (rec.result === "win")),
    JSON.stringify({ levelName: rec.levelName, mySide: rec.mySide, winner: rec.winner, result: rec.result }));
  check("用户视角胜负经 userResult 推导一致", Games.userResult(rec) === rec.result);
  replayCheck(st, "① play");
  check("全部着法中文记谱非空", st.moves.every(n => n.cn && n.cn.length));

  /* ---------- ② play.js 悔棋 ---------- */
  console.log("② 悔棋：弹两手重放一致；思考中悔棋被拒");
  await begin("play", "r", 0);
  await humanStep("play", PD); await humanStep("play", PD);   // 红黑红黑四手
  st = PD.state;
  if (st.moves.length < 4) { await humanStep("play", PD); st = PD.state; }
  const before4 = st.moves.length;
  const fenBefore = X.boardToFen(st.board, st.side);
  el("pl-undo").onclick();
  st = PD.state;
  check("悔棋弹掉两手（" + before4 + "→" + st.moves.length + "）", before4 - st.moves.length === 2 && st.side === st.mySide,
    "moves=" + st.moves.length + " side=" + st.side);
  replayCheck(st, "② 悔棋后");
  check("悔棋后可续弈（重新走一手不报错）", (() => { return true; })());
  await humanStep("play", PD);
  check("悔棋后续弈正常推进", PD.state.moves.length > 0 && PD.state.status === "playing");

  /* ---------- ③ 会话守卫：思考中重开 ---------- */
  console.log("③ 会话守卫：电脑思考中重开，旧应着不得落进新局");
  await begin("play", "b", 0);          // 电脑执红先行，思考窗口 60ms
  check("电脑先行已进入思考", PD.state.thinking === true);
  await begin("play", "r", 0);          // 思考未结束立刻重开（执红）
  await sleep(200);
  st = PD.state;
  check("重开后无旧局应着混入（moves=0 且仍红先）", st.moves.length === 0 && st.side === "r" && st.status === "playing",
    "moves=" + st.moves.length + " side=" + st.side);
  // 思考中悔棋被拒
  await begin("play", "b", 0);
  const mvCount = PD.state.moves.length;
  el("pl-undo").onclick();
  check("思考中悔棋被拒（着法数不变）", PD.state.moves.length === mvCount);

  /* ---------- ④ spar.js 整盘（无引擎，讲解层降级不抛异常） ---------- */
  console.log("④ 私教陪练（spar.js）：无引擎环境整盘 + 讲解层产出");
  const diagBefore = sandbox.window.Diag.last(50).length;
  const gamesBefore2 = Games.all().length;
  await begin("spar", "r", 0);
  st = SD.state;
  for (let i = 0; i < 900 && st.status === "playing"; i++) {
    if (!st.thinking && st.side === st.mySide) await humanStep("spar", SD);
    else await sleep(10);
    st = SD.state;
  }
  st = SD.state;
  check("陪练对局自然结束", st.status === "finished", "status=" + st.status + " moves=" + st.moves.length);
  check("陪练存谱新增一条", Games.all().length === gamesBefore2 + 1);
  check("讲解气泡有产出（无引擎降级仍说话）", el("spar-chat").children.length > 0, "bubbles=" + el("spar-chat").children.length);
  check("陪练全程无静默异常记入 Diag", sandbox.window.Diag.last(50).length === diagBefore,
    sandbox.window.Diag.dump().split("\n").slice(-3).join(" | "));
  replayCheck(st, "④ spar");
  // spar 会话守卫（token 机制）
  await begin("spar", "b", 0);
  await begin("spar", "r", 0);
  await sleep(200);
  check("陪练重开后无旧局应着混入", SD.state.moves.length === 0 && SD.state.side === "r" && SD.state.status === "playing",
    "moves=" + SD.state.moves.length + " side=" + SD.state.side);

  console.log(failures ? "\n共 " + failures + " 项失败" : "\n全部通过");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error("测试执行出错：", e); process.exit(1); });
