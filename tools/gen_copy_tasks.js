/* 批量文案任务包生成器（低成本模型批量工作规划.md §6）。
 *
 *   node tools/gen_copy_tasks.js --task t1 [--limit 20] [--chunk 150] [--out tools/_work/copy]
 *   node tools/gen_copy_tasks.js --task t3 --cls tools/_work/trapcls.json
 *   node tools/gen_copy_tasks.js --task t4 | t2 | t6 | t7
 *
 * 产物：tools/_work/copy/<task>/chunk-NNN.jsonl + manifest.json
 * 铁律：着法/局面/评分只来自规则引擎与 _eng 缓存，本脚本不生成、不修改任何着法；
 *       模型产出只允许进讲解字段，由 check_copy.js 机器判卷。
 *
 * 各任务输入行（全部机器算好，模型只做中文表达）：
 *   t1 {"id","ply","cn","prevCn","fen","intent","title"}   C类主线前12手+分岔点评注
 *   t2 {"key","count","maxLen","desc"}                      反馈语料规格行
 *   t3 {"id","cls","trapCn","victimCn","fall","declineCn","loss","title"} 飞刀三段文案
 *   t4 {"id","title","category","pieces","firstMovesCn"}    课名副标题
 *   t6 {"id","name","level","redOpening","blackDefense","intro","mainlineCn","cps"} 开局指南
 *   t7 {"term"}                                             术语卡（词表固定）
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.dirname(__dirname);
const argv = process.argv.slice(2);
function argVal(name, dflt) {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}
const TASK = argVal("task", null);
if (!TASK) { console.error("用法：--task t1|t2|t3|t4|t5|t6|t7"); process.exit(2); }
const LIMIT = Number(argVal("limit", "0")) || Infinity;
const CHUNK = Number(argVal("chunk", "150"));
const OUT_DIR = path.join(ROOT, argVal("out", "tools/_work/copy"), TASK);

/* ---- 规则引擎 + 记谱 + 意图标注（Node 桩环境） ---- */
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "rules.js"), "utf8"), sandbox, { filename: "rules.js" });
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "notation.js"), "utf8"), sandbox, { filename: "notation.js" });
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "spar.js"), "utf8"), sandbox, { filename: "spar.js" });
const X = sandbox.window.Xiangqi;
const Notation = sandbox.window.Notation;
const SparDebug = sandbox.window.SparDebug;

const idx = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "index.json"), "utf8"));
const PIECE_CN = { r: "车", n: "马", c: "炮", b: "象", a: "士", p: "卒", k: "将" };
function pieceName(pt, side) {
  if (pt === "k") return side === "r" ? "帅" : "将";
  if (pt === "a") return side === "r" ? "仕" : "士";
  if (pt === "b") return side === "r" ? "相" : "象";
  if (pt === "p") return side === "r" ? "兵" : "卒";
  return PIECE_CN[pt] || "子";
}
function trimIntent(it) {
  if (!it || !it.kind) return null;
  const out = { kind: it.kind, side: it.side === "r" ? "红" : "黑", piece: pieceName(it.piece, it.side) };
  if (it.capture) out.capture = it.capture.name;
  if (it.attack) out.attack = it.attack.name;
  if (it.rescueName) out.rescue = it.rescueName;
  if (it.escape) out.escape = true;
  if (it.developed) out.developed = true;
  if (it.check) out.check = true;
  return out;
}

/* ---------- T1：C 类主线前 12 手 + 分岔点 ---------- */
function genT1() {
  const cat = idx.categories.find(c => c.id === "C");
  const out = [];
  for (const les of cat.lessons) {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, les.file), "utf8"));
    if (!Array.isArray(data.moves) || !data.moves.length) continue;
    const start = X.parseFen(data.fen);
    let board = X.cloneBoard(start.board), side = start.side, ply = 0, prevCn = "";
    let nodes = data.moves;
    while (Array.isArray(nodes) && nodes.length) {
      const n = nodes[0];
      ply++;
      const isBranch = Array.isArray(n.ch) && n.ch.length > 1;
      if (ply <= 12 || isBranch) {
        out.push({
          id: les.id, ply, cn: n.cn, prevCn,
          fen: X.boardToFen(board, side),
          intent: trimIntent(SparDebug.moveIntent(board, side, n.m)),
          title: les.title
        });
      }
      if (Array.isArray(n.ch) && n.ch.length) {
        X.applyMove(board, ...X.parseMove(n.m));
        side = X.other(side);
        prevCn = n.cn;
        nodes = n.ch;
      } else break;
      if (ply > 40) break;
    }
  }
  return out.slice(0, LIMIT);
}

/* ---------- T2：反馈语料规格行 ---------- */
function genT2() {
  const spec = [
    { key: "ok", count: 20, maxLen: 30, desc: "入门课/练习里学员走对了正着时的即时鼓励反馈（下棋教学场景，不是考试）" },
    { key: "retry", count: 20, maxLen: 30, desc: "学员走的着法合法但不是本任务正着，请他再想想（可配合提示按钮）" },
    { key: "wrongPiece", count: 20, maxLen: 30, desc: "任务要求走指定的某个棋子（如「请走马」），学员却动了别的棋子。可用占位符 {who}（任务要求的棋子名，前端会填「帅/仕/相/马/车/炮/兵」），必须用占位符指代该棋子，不要写死具体子名", placeholder: "{who}" },
    { key: "done", count: 20, maxLen: 30, desc: "学员把本课/本局的正着全部走完时的完成祝贺" },
    { key: "reviewPass", count: 20, maxLen: 30, desc: "隔天复习题全部答对时的通过祝贺（记忆巩固场景）" },
    { key: "illegal:horseleg", count: 20, maxLen: 30, desc: "马要跳的方向被「蹩了马腿」（直行第一格有子），这句要顺带讲一句马腿规则" },
    { key: "illegal:eye", count: 20, maxLen: 30, desc: "象/相走田字时田字中心有子「塞了象眼」，这句要顺带讲一句象眼规则" },
    { key: "illegal:screen", count: 20, maxLen: 30, desc: "炮想吃的子中间没有恰好一个「炮架」（或直线被挡），这句要顺带讲一句炮架规则" },
    { key: "illegal:face", count: 20, maxLen: 30, desc: "走完后将帅会照面（同一直线中间无子），这句要顺带讲一句照面规则" },
    { key: "illegal:generic", count: 20, maxLen: 30, desc: "走法违反了该棋子的基本走法规则（不含上面四种具体情形）" },
    { key: "plan:reasonNew", count: 8, maxLen: 40, desc: "今日计划里推荐新课的理由。可用占位符 {idx}（第几课）、{stage}（阶段名）、{title}（课名），不要出现具体数字", placeholder: "{idx}|{stage}|{title}" },
    { key: "plan:reasonReview", count: 8, maxLen: 40, desc: "今日计划里安排复习的理由。可用占位符 {days}（隔了几天）、{title}，不要出现具体数字", placeholder: "{days}|{title}" },
    { key: "plan:reasonWeak", count: 8, maxLen: 40, desc: "今日计划里安排薄弱项练习的理由。可用占位符 {pct}（正确率百分数）、{tag}（能力名），不要出现具体数字", placeholder: "{pct}|{tag}" },
    { key: "plan:reasonBattle", count: 8, maxLen: 40, desc: "今日计划里安排实战对局的理由。可用占位符 {n}（最近盘数）、{wins}（胜场数）、{level}（对手等级），不要出现具体数字", placeholder: "{n}|{wins}|{level}" }
  ];
  return spec.slice(0, LIMIT);
}

/* ---------- T3：飞刀三段文案（输入来自离线引擎分类 trapcls.json） ---------- */
function genT3() {
  const clsFile = argVal("cls", "tools/_work/trapcls.json");
  const cache = JSON.parse(fs.readFileSync(path.join(ROOT, clsFile), "utf8"));
  const cat = idx.categories.find(c => c.id === "I");
  const out = [];
  for (const les of cat.lessons) {
    const c = cache[les.id];
    if (!c || !c.trapPly || c.cls === "未知") continue;
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, les.file), "utf8"));
    const line = [];
    let nodes = data.moves || [];
    while (nodes.length && line.length < 60) { line.push(nodes[0]); nodes = nodes[0].ch || []; }
    if (line.length < c.trapPly + 1) continue;
    const trapCn = line[c.trapPly - 1].cn;
    const victimCn = line[c.trapPly].cn;
    // declineMv 的中文记法：在对方上当位置（trapPly 之后的局面）按行棋方推导
    const pos = X.parseFen(data.fen);
    let board = X.cloneBoard(pos.board), side = pos.side;
    for (let k = 0; k < c.trapPly; k++) { X.applyMove(board, ...X.parseMove(line[k].m)); side = X.other(side); }
    const declineCn = c.declineMv ? Notation.chinese(board, side, X.parseMove(c.declineMv)) : "";
    out.push({
      id: les.id, cls: c.cls, trapCn, victimCn,
      fall: c.fall, declineCn, loss: c.loss, title: les.title
    });
  }
  return out.slice(0, LIMIT);
}

/* ---------- T4：C 类课名语义化副标题 ---------- */
const PIECE_CHARS = /[车马炮兵卒帅将相象仕士]/g;
function genT4() {
  const cat = idx.categories.find(c => c.id === "C");
  const out = [];
  for (const les of cat.lessons) {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, les.file), "utf8"));
    const firstMovesCn = [];
    const pieces = [];
    let nodes = data.moves;
    let ply = 0;
    while (Array.isArray(nodes) && nodes.length && ply < 12) {
      const n = nodes[0];
      ply++;
      firstMovesCn.push(n.cn);
      for (const ch of n.cn.match(PIECE_CHARS) || []) if (!pieces.includes(ch)) pieces.push(ch);
      nodes = Array.isArray(n.ch) && n.ch.length ? n.ch : null;
    }
    out.push({ id: les.id, title: les.title, category: "C", pieces, firstMovesCn });
  }
  return out.slice(0, LIMIT);
}

/* ---------- T6：开局体系阵型指南 ---------- */
function genT6() {
  const oidx = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "openings", "index.json"), "utf8"));
  const out = [];
  for (const meta of oidx.systems) {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, meta.file), "utf8"));
    const eng = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "_eng", meta.id + ".eng.json"), "utf8"));
    // 主线 20 手中文 + 对应节点 cp（走子方视角，来自 _eng 缓存）
    const mainlineCn = [], cps = [];
    const pathId = [];
    let nodes = data.moves;
    while (Array.isArray(nodes) && nodes.length && mainlineCn.length < 20) {
      const n = nodes[0];
      pathId.push(nodes.indexOf(n));
      mainlineCn.push(n.cn);
      const e = eng[pathId.join("/")];
      cps.push(e && typeof e.cp === "number" ? e.cp : null);
      nodes = Array.isArray(n.ch) && n.ch.length ? n.ch : null;
    }
    out.push({
      id: meta.id, name: meta.name, level: meta.level,
      redOpening: meta.redOpening, blackDefense: meta.blackDefense,
      intro: data.intro || "", mainlineCn, cps
    });
  }
  return out.slice(0, LIMIT);
}

/* ---------- T7：新手术语卡（词表由我方固定） ---------- */
const TERMS = [
  "马腿", "象眼", "炮架", "将帅照面", "九宫", "河界", "巡河", "肋道", "中路", "底线",
  "边路", "卒林线", "下二路", "宫顶线", "上士", "落士", "补士", "背士", "花士象", "单缺士",
  "单缺象", "过河兵", "老兵", "高兵", "低兵", "底兵", "宫心", "将军", "应将", "将死",
  "困毙", "绝杀", "双将", "闷宫", "长将", "先手", "后手", "失先", "抢先手", "弃子",
  "兑子", "根", "无根子", "捉子", "保子", "窝心马", "屏风马", "反宫马", "卧槽马", "挂角马",
  "钓鱼马", "八角马", "马后炮", "重炮", "空头炮", "沉底炮", "铁门栓", "白脸将", "三子归边", "连环马"
];
function genT7() {
  const clean = TERMS.map(t => t.trim()).filter(t => !t.includes(" "));   // 防手误
  const uniq = [...new Set(clean)];
  return uniq.map(term => ({ term })).slice(0, LIMIT);
}

/* ---------- 切块落盘 ---------- */
function writeChunks(task, rows) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const chunks = [];
  for (let i = 0; i * CHUNK < rows.length; i++) {
    const part = rows.slice(i * CHUNK, (i + 1) * CHUNK);
    const file = "chunk-" + String(i).padStart(3, "0") + ".jsonl";
    fs.writeFileSync(path.join(OUT_DIR, file), part.map(r => JSON.stringify(r)).join("\n") + "\n", "utf8");
    chunks.push(file);
  }
  const manifest = { task, count: rows.length, chunkSize: CHUNK, chunks, generatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 1), "utf8");
  console.log(TASK + "：共 " + rows.length + " 行 → " + chunks.length + " 个任务包（" + OUT_DIR + "）");
}

/* ---------- T5：棋谱导入容错测试语料（规格固定，模型只把文本写「脏」） ----------
 * 种子 = 开局谱主线（引擎校验过的合法着法），期望值由本脚本算好；
 * 模型按 op 把种子着法写成各种真实棋谱格式，产出 {id,name,text,expect}。
 * op 清单：
 *   plain / header / round-dot / round-dun / round-full / round-bracket /
 *   cn-punct / blank-lines / result-win / result-draw / result-mid /
 *   upper-coord / coord / fullwidth / mixed / truncate-k /
 *   err-garbage / err-illegal / err-nonmove                                    */
function genT5() {
  const oidx = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "openings", "index.json"), "utf8"));
  const seeds = [];
  for (const meta of oidx.systems) {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, meta.file), "utf8"));
    const cn = [], coord = [];
    let nodes = data.moves;
    while (Array.isArray(nodes) && nodes.length && cn.length < 20) {
      cn.push(nodes[0].cn);
      coord.push(nodes[0].m);
      nodes = Array.isArray(nodes[0].ch) && nodes[0].ch.length ? nodes[0].ch : null;
    }
    seeds.push({ sys: meta.id, cn, coord });
  }
  const out = [];
  let n = 0;
  const push = (seed, op, kind, expectMoves) => {
    n++;
    out.push({
      id: "T5-" + String(n).padStart(3, "0"), seed: seed.sys, op, kind,
      movesCn: seed.cn, movesCoord: seed.coord,
      expect: kind === "error" ? { error: true } : { moves: expectMoves === undefined ? seed.cn.length : expectMoves }
    });
  };
  const TRUNC = [4, 7, 11, 16];
  for (const seed of seeds) {
    push(seed, "plain");
    push(seed, "header");
    push(seed, "round-dot");
    push(seed, "round-dun");
    push(seed, "round-full");
    push(seed, "round-bracket");
    push(seed, "cn-punct");
    push(seed, "blank-lines");
    push(seed, "result-win");
    push(seed, "result-draw");
    push(seed, "result-mid");
    push(seed, "upper-coord");
    push(seed, "coord");
    push(seed, "fullwidth");
    push(seed, "mixed");
    for (const k of TRUNC) push(seed, "truncate", "moves", k);
    push(seed, "err-garbage", "error");
    push(seed, "err-illegal", "error");
    push(seed, "err-nonmove", "error");
  }
  return out.slice(0, LIMIT);
}

const GENS = { t1: genT1, t2: genT2, t3: genT3, t4: genT4, t5: genT5, t6: genT6, t7: genT7 };
if (!GENS[TASK]) { console.error("未知任务：" + TASK); process.exit(2); }
writeChunks(TASK, GENS[TASK]());
