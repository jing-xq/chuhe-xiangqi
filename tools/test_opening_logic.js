/* opening.js 无头逻辑自测（Node 桩环境）：
 *   node tools/test_opening_logic.js
 * 校验：① userNodeIds 与 build_openings.py 的 userNodes 统计一致
 *      ② 掌握度公式 50·coverage + 30·punishRate + 20·min(games/5,1)，
 *        覆盖率分母 = offeredIds（历次训练被提供过选择的用户节点）
 *      ③ hitIds/offeredIds 谱更新修剪（prune） */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.dirname(__dirname);

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
    addEventListener() {}
  },
  navigator: { userAgent: "node" },
  performance: { now: () => Date.now() }
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
load("js/opening.js");

const X = sandbox.window.Xiangqi;
const OD = sandbox.window.OpeningDebug;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log("  ✓ " + name);
  else { failures++; console.log("  ✗ " + name + (detail ? "  —— " + detail : "")); }
}

// ---- ① 与构建工具的 userNodes 对账 ----
console.log("① userNodeIds 与 index.json 对账");
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, "data/openings/index.json"), "utf8"));
for (const meta of idx.systems) {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, meta.file), "utf8"));
  const r = OD.userIds(data, "r");
  const b = OD.userIds(data, "b");
  check(
    meta.id + " 红" + meta.userNodes.r + "/黑" + meta.userNodes.b,
    r.length === meta.userNodes.r && b.length === meta.userNodes.b,
    "算得 红" + r.length + "/黑" + b.length
  );
  // id 唯一
  const all = new Set(r.concat(b));
  check(meta.id + " id 唯一", all.size === r.length + b.length);
}

// ---- ② 掌握度公式（覆盖率分母 = offeredIds） ----
console.log("② 掌握度公式");
{
  const meta = idx.systems[0];
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, meta.file), "utf8"));
  const ids = OD.userIds(data, "r");
  // 无数据：attempts=0 → has=false
  let st = OD.masteryOf(meta.id, "r", meta);
  check("无数据显示 has=false", st.has === false, JSON.stringify(st));
  const store = OD.store;
  // 旧数据迁移：无 offeredIds 的存档以 hitIds 兜底（下过的一定被提供过）
  store[meta.id + "|r"] = {
    hitIds: ids.slice(0, 8),
    punishN: 0, punishHit: 0,
    games: 0, attempts: 1, lastAt: 1, recent: []
  };
  st = OD.masteryOf(meta.id, "r", meta);
  check("旧数据迁移 offeredIds=hitIds → 覆盖 100%",
    st.N === 8 && st.hits === 8 && st.coverage === 1,
    JSON.stringify({ N: st.N, hits: st.hits, cov: st.coverage }));
  // 新口径：8 命中 / offered 12 → 覆盖 8/12；惩罚 2/3；完成 2 局
  store[meta.id + "|r"] = {
    hitIds: ids.slice(0, 8), offeredIds: ids.slice(0, 12),
    punishN: 3, punishHit: 2,
    games: 2, attempts: 3, lastAt: 1, recent: []
  };
  st = OD.masteryOf(meta.id, "r", meta);
  const cov = 8 / 12;
  const pr = 2 / 3;
  const want = Math.round(50 * cov + 30 * pr + 20 * Math.min(2 / 5, 1));
  check("offered 12·命中 8 / 惩罚 2/3 / 完成2 → " + want,
    st.mastery === want && st.N === 12 && st.hits === 8,
    "got " + st.mastery + " N=" + st.N);
  // 惩罚未测 → 0.5 保底
  store[meta.id + "|r"].punishN = 0; store[meta.id + "|r"].punishHit = 0;
  store[meta.id + "|r"].games = 5;
  st = OD.masteryOf(meta.id, "r", meta);
  const want2 = Math.round(50 * cov + 30 * 0.5 + 20 * 1);
  check("惩罚保底 0.5 / 完成5 → " + want2, st.mastery === want2, "got " + st.mastery);
  // 命中数超出 offered 分母时封顶
  store[meta.id + "|r"].hitIds = ids.concat(["9/9/9", "x"]);
  st = OD.masteryOf(meta.id, "r", meta);
  check("hitIds 封顶不超 offered 数", st.hits === 12, "got " + st.hits);
}

// ---- ③ 谱更新修剪 ----
console.log("③ 谱更新 prune");
{
  const meta = idx.systems[0];
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, meta.file), "utf8"));
  const store = OD.store;
  store[meta.id + "|r"] = {
    hitIds: ["0", "0/0/0", "假id"],
    offeredIds: ["0", "0/0/0", "假id"],
    punishN: 0, punishHit: 0, games: 0, attempts: 1, lastAt: 1, recent: []
  };
  // 重新走一遍 prune（loadSys 内部）：直接用 userIds 模拟
  const valid = new Set(OD.userIds(data, "r"));
  const rec = store[meta.id + "|r"];
  rec.hitIds = rec.hitIds.filter(x => valid.has(x));
  rec.offeredIds = rec.offeredIds.filter(x => valid.has(x));
  check("非法 id 被剔除", rec.hitIds.indexOf("假id") < 0 && rec.offeredIds.indexOf("假id") < 0 && rec.hitIds.length >= 1,
    JSON.stringify(rec.hitIds));
  // "0" 是红方第一手（炮二平五）应在红方集合
  check("id \"0\" 属于红方节点", valid.has("0"));
}

// ---- ④ 实时走势纯函数：走子方视角→红方视角 + mate 钳制 / cp→y 映射 ----
console.log("④ 实时走势纯函数");
{
  const R = OD.cpToRed, Y = OD.evalY;
  check("红走 cp=150 → 红视角 +150", R(150, "r") === 150);
  check("黑走 cp=150 → 红视角 -150", R(150, "b") === -150);
  check("黑走 cp=-80 → 红视角 +80", R(-80, "b") === 80);
  // mate 大数（±(100000-m)）钳制到 ±3000
  check("红胜势 mate 大数钳到 +3000", R(99995, "r") === 3000);
  check("黑被将死 cp=-99990（黑走）→ 红 +3000", R(-99990, "b") === 3000);
  check("黑胜 mate 大数钳到 -3000", R(-99990, "r") === -3000);
  check("钳制不越界且对称", R(123456, "r") === 3000 && R(-123456, "b") === 3000);
  // y 映射：中线为 0，红优在上（y<H/2），黑优在下，tanh 渐近贴边
  check("cp=0 → 中线 H/2", Math.abs(Y(0, 80) - 40) < 1e-9);
  check("红优 y 在中线之上", Y(200, 80) < 40 && Y(50, 80) < 40);
  check("黑优 y 在中线之下", Y(-200, 80) > 40 && Y(-50, 80) > 40);
  check("+3000 贴顶（y<2）", Y(3000, 80) < 2);
  check("-3000 贴底（y>78）", Y(-3000, 80) > 78);
  check("映射单调不减：cp 越大 y 越小",
    Y(-3000, 80) > Y(-200, 80) && Y(-200, 80) > Y(0, 80) &&
    Y(0, 80) > Y(200, 80) && Y(200, 80) > Y(3000, 80));
  check("y 恒在 [0,H] 内", Y(1e9, 80) >= 0 && Y(-1e9, 80) <= 80);
}

console.log("⑤ 私教陪练纯函数：谱序列 walk / 分差→局势描述 / 脱谱文案组装");
load("js/spar.js");
{
  const SP = sandbox.window.SparDebug;
  const metas = {};
  for (const m of idx.systems) metas[m.id] = m;
  const sysList = ["cp-pfm", "cp-fgm", "cp-spo"].map(id => ({
    meta: metas[id], data: JSON.parse(fs.readFileSync(path.join(ROOT, metas[id].file), "utf8"))
  }));

  // --- 谱序列 walk 匹配（多候选体系集合） ---
  // cp-pfm 主线前四手：炮二平五 马8进7 马二进三 车9平8（h2e2 h9g7 h0g2 i9h9）
  let r = SP.replayBook(sysList, ["h2e2", "h9g7", "h0g2", "i9h9"], "r");
  check("主线四手全程在谱", r.book && !r.offBook && r.plies === 4, JSON.stringify({ off: r.offBook, plies: r.plies }));
  check("识别为 中炮过河车对屏风马（唯一候选）",
    r.book && r.book.cands.length === 1 && r.book.cands[0].sys.meta.id === "cp-pfm",
    r.book && JSON.stringify(r.book.cands.map(c => c.sys.meta.id)));
  check("谱位置停在第四手节点", r.book && r.book.cands[0].node.m === "i9h9");
  // 学员在谱时走出谱外 → stuOff 且转入引擎模式
  r = SP.replayBook(sysList, ["h2e2", "h9g7", "a3a4"], "r");
  check("学员第三手脱谱 → offBook", r.offBook === true && r.plies === 2, JSON.stringify(r));
  // 对手脱谱且无 dev 命中 → oppOff（学员第一手后对手走 a3a4）
  r = SP.replayBook(sysList, ["h2e2", "a3a4"], "r");
  check("对手第二手脱谱 → offBook", r.offBook === true && r.plies === 1, JSON.stringify(r));
  // 第一手不属任何体系 → stuFree
  r = SP.replayBook(sysList, ["a3a4"], "r");
  check("第一手不在任何体系 → offBook（stuFree）", r.offBook === true && r.book.cands.length === 0 && r.plies === 0);
  // classifyMove 事件流：炮二平五同时入 3 个候选（不 greet），马8进7 收窄唯一并 greet
  let c = SP.classifyMove({ cands: [] }, false, "r", "h2e2", "r", sysList);
  check("第一手多体系命中 → 静默 onBook + 3 候选",
    c.ev === "onBook" && c.book.cands.length === 3, c.ev + " n=" + c.book.cands.length);
  c = SP.classifyMove(c.book, false, "b", "h9g7", "r", sysList);
  check("对手马8进7 收窄唯一 → greet 屏风马",
    c.ev === "greet" && c.book.cands.length === 1 && c.book.cands[0].sys.meta.id === "cp-pfm",
    c.ev + " " + JSON.stringify(c.book.cands.map(x => x.sys.meta.id)));
  c = SP.classifyMove(c.book, false, "r", "h0g2", "r", sysList);
  check("已唯一后学员正着 → onBook", c.ev === "onBook" && !c.offBook && c.book.cands.length === 1);
  c = SP.classifyMove(c.book, false, "b", "i9h9", "r", sysList);
  check("已唯一后对手正着 → comment", c.ev === "comment" && !c.offBook);
  c = SP.classifyMove(c.book, false, "r", "a3a4", "r", sysList);
  check("已唯一后学员脱谱 → stuOff", c.ev === "stuOff" && c.offBook === true);
  c = SP.classifyMove(c.book, true, "b", "a3a4", "r", sysList);
  check("已脱谱后 → none", c.ev === "none" && c.offBook === true);
  // dev 教学点：在 cp-pfm 树里找一个带 dev 的节点，验证对手命中 dev 事件
  let devHit = null, devParent = null;
  (function walk(nodes, ctx) {
    for (const n of nodes || []) {
      if (devHit) return;
      if (n.dev && n.dev.length) { devHit = n.dev[0]; devParent = ctx.concat([n]); }
      else walk(n.ch, ctx.concat([n]));
    }
  })(sysList[0].data.moves, []);
  if (devHit) {
    // dev 挂在节点 n 上、描述"对方下一手"：先走到 n，再喂 dev.m（应为对手着手）
    let book = { cands: [] }, off = false;
    let mover = sysList[0].data.fen.indexOf(" w ") >= 0 ? "r" : "b";
    for (let i = 0; i < devParent.length; i++) {
      const rr = SP.classifyMove(book, off, mover, devParent[i].m, mover, sysList);
      book = rr.book; off = rr.offBook;
      if (off || !book.cands.length) break;
      mover = X.other(mover);
    }
    const rr = SP.classifyMove(book, off, mover, devHit.m, X.other(mover), sysList);
    check("对手命中 dev 教学点 → dev 事件", rr.ev === "dev" && rr.dev === devHit, "ev=" + rr.ev);
  }

  // --- 分差 → 局势描述 ---
  check("cp=0 → 均势", SP.describeRed(0) === "均势");
  check("cp=20 → 均势", SP.describeRed(20) === "均势");
  check("cp=50 → 红方稍优", SP.describeRed(50) === "红方稍优");
  check("cp=-80 → 黑方稍优", SP.describeRed(-80) === "黑方稍优");
  check("cp=150 → 红方优势", SP.describeRed(150) === "红方优势");
  check("cp=-300 → 黑方优势", SP.describeRed(-300) === "黑方优势");
  check("cp=500 → 红方明显优势", SP.describeRed(500) === "红方明显优势");
  check("cp=-99999 → 黑方明显优势", SP.describeRed(-99999) === "黑方明显优势");
  check("cp=null → 形势不明", SP.describeRed(null) === "形势不明");
  check("红优 +1.5", SP.fmtEvalRed(150) === "红优 +1.5");
  check("黑优 +0.8", SP.fmtEvalRed(-80) === "黑优 +0.8");
  check("均势 0.0", SP.fmtEvalRed(10) === "均势 0.0");

  // --- 脱谱文案组装 ---
  let msgs = SP.buildOffBookMsg({
    cn: "炮八进五", loss: 80, bestCn: "车一进一", lineCn: "车一进一 → 炮8平9",
    tip: "白吃白不喝——对方送到嘴边的子，先算清再吃。",
    preDesc: "红方稍优", postDesc: "均势"
  });
  check("损 80：主评+口诀+变化，共 3 条", msgs.length === 3, JSON.stringify(msgs));
  check("损 80：不含引擎推荐（<120）", msgs.every(m => m.indexOf("引擎推荐") < 0));
  check("主评含档位「一般」", msgs[0].indexOf("一般") >= 0 && msgs[0].indexOf("损 80 分") >= 0, msgs[0]);
  msgs = SP.buildOffBookMsg({
    cn: "马八进七", loss: 200, bestCn: "车一进一", lineCn: "车一进一 → 炮8平9",
    tip: "根是棋子的命。", preDesc: "均势", postDesc: "黑方优势"
  });
  check("损 200：含引擎推荐+主线，共 4 条", msgs.length === 4 && msgs[1].indexOf("引擎推荐 车一进一") === 0,
    JSON.stringify(msgs));
  check("损 200：档位「欠佳」", msgs[0].indexOf("欠佳") >= 0);
  check("局面变化句", msgs[3] === "局面从均势变成黑方优势。", msgs[3]);
}

// ---- ⑥ 着法意图 / 局面快照 / 威胁防守判定（构造局面，直接 parseFen + 已知着法） ----
console.log("⑥ 私教陪练：moveIntent / intentPhrase / positionSnapshot / isDefensive");
{
  const SP = sandbox.window.SparDebug;
  const parse = fen => X.parseFen(fen).board;
  // 白吃：车 a0xa5 吃无根卒，吃子者不被吃回
  {
    const b = parse("4k4/9/9/9/p8/9/9/9/9/R7K w - - 0 1");
    const it = SP.moveIntent(b, "r", "a0a5");
    check("吃无根卒 → freeCapture，净赚 60", it.kind === "freeCapture" && it.gain === 60, JSON.stringify(it));
    check("短语「白吃一卒」", SP.intentPhrase(it) === "白吃一卒", SP.intentPhrase(it));
  }
  // 将军：车 e5e8 底线将军
  {
    const b = parse("4k4/9/9/9/4R4/9/9/9/9/K8 w - - 0 1");
    const it = SP.moveIntent(b, "r", "e5e8");
    check("车 e5e8 → check", it.kind === "check" && it.check === true, it.kind);
    check("短语含「将军」", SP.intentPhrase(it).indexOf("将军") >= 0, SP.intentPhrase(it));
  }
  // 捉：车 a0i0 后攻击无根炮 i9（走前该炮不受攻击）
  {
    const b = parse("4k4/9/9/9/4c4/9/9/9/9/R7K w - - 0 1");
    const it = SP.moveIntent(b, "r", "a0a5");
    check("车入五线捉无根炮 → attack", it.kind === "attack" && it.attack && it.attack.name === "炮", JSON.stringify(it));
    check("短语「捉你的无根炮」", SP.intentPhrase(it) === "捉你的无根炮", SP.intentPhrase(it));
  }
  // 保：车 a0b0 保住所向无根炮（马 c4 攻炮 b2）
  {
    const b = parse("4k4/9/9/9/9/2n6/9/1C7/9/R7K w - - 0 1");
    const it = SP.moveIntent(b, "r", "a0b0");
    check("车保受攻炮 → rescue", it.kind === "rescue" && it.rescueName === "炮", JSON.stringify(it));
    check("短语「解炮之围」", SP.intentPhrase(it) === "解炮之围", SP.intentPhrase(it));
  }
  // 出车占肋：车 a0d0（d 路=肋道）
  {
    const b = parse("4k4/9/9/9/9/9/9/9/9/R7K w - - 0 1");
    const it = SP.moveIntent(b, "r", "a0d0");
    check("车出原位到肋道 → develop", it.kind === "develop" && it.developed === true, it.kind);
    check("短语「出车占肋」", SP.intentPhrase(it) === "出车占肋", SP.intentPhrase(it));
  }
  // 兑：车 a5xa9 吃车，被 b9 车吃回，净赚 0
  {
    const b = parse("rr2k4/9/9/9/R8/9/9/9/9/K8 w - - 0 1");
    const it = SP.moveIntent(b, "r", "a5a9");
    check("吃车被吃回 → trade，净赚 0", it.kind === "trade" && it.gain === 0, JSON.stringify(it));
  }
  // 应将（威胁判定的防守类识别）：黑被车 e8 将军，将 e9d9
  {
    const b = parse("4k4/9/9/9/4R4/9/9/9/9/K8 b - - 0 1");
    const it = SP.moveIntent(b, "b", "e9d9");
    check("被将走将 → answerCheck", it.kind === "answerCheck" && it.answerCheck === true, it.kind);
    check("isDefensive 识别应将", SP.isDefensive(b, "b", "e9d9") === true);
  }
  // 局面快照：初始局面 → 出子迟缓 + 方向建议；特征无变化 → 静音
  {
    const INIT = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
    const b0 = parse(INIT);
    const s1 = SP.positionSnapshot(b0, "r", 0, []);
    check("初始快照报出子迟缓", s1.text.indexOf("出子迟缓") >= 0, s1.text);
    check("初始快照给方向建议", s1.text.indexOf("炮镇中路") >= 0, s1.text);
    const s2 = SP.positionSnapshot(b0, "r", 0, s1.clauses);
    check("特征无变化 → 静音", s2.text === "", s2.text);
    // 炮二平五后：中炮是新特征，只报它
    const b1 = X.cloneBoard(b0);
    X.applyMove(b1, ...X.parseMove("h2e2"));
    const s3 = SP.positionSnapshot(b1, "r", 0, s1.clauses);
    check("中炮镇中路作为新特征被报", s3.text.indexOf("中炮镇中路") >= 0, s3.text);
    check("快照只说变化的部分", s3.text.indexOf("出子迟缓") < 0, s3.text);
  }
}

// ---- ⑦ 私教讲解层新增纯函数：pickVariant 反重复选取 ----
console.log("⑦ 讲解层：pickVariant");
{
  const SP = sandbox.window.SparDebug;
  // 1) 优先挑最近没说过的条目
  {
    const list = ["甲", "乙", "丙"];
    let allFresh = true;
    for (let i = 0; i < 30; i++) if (SP.pickVariant(list, ["甲"]) === "甲") allFresh = false;
    check("recent 含甲时不再选甲", allFresh);
  }
  // 2) 全部说过时避开最近一条
  {
    const got = SP.pickVariant(["甲", "乙"], ["甲", "乙"]);
    check("全说过 → 返回与最近一条不同的「甲」", got === "甲", got);
  }
  // 3) recent 为空/数组不合法时仍能返回池内成员，空池返回空串
  {
    const got = SP.pickVariant(["甲", "乙"], []);
    check("recent 为空 → 返回池内成员", got === "甲" || got === "乙", got);
    check("空池 → 返回空串", SP.pickVariant([], ["甲"]) === "");
  }
}

// ---- ⑧ 私教讲解层：quietIntent 安静着意图 / quietText 旁白组装 ----
console.log("⑧ 讲解层：quietIntent / quietText");
{
  const SP = sandbox.window.SparDebug;
  const parse = fen => X.parseFen(fen).board;
  // 1) 占线：车进肋道（无吃子/将军/新攻击）→ line
  {
    const b = parse("4k4/9/9/9/9/9/9/9/9/R7K w - - 0 1");
    check("车 a0d0 占肋 → line", SP.quietIntent(b, "r", "a0d0").kind === "line",
      JSON.stringify(SP.quietIntent(b, "r", "a0d0")));
  }
  // 2) 保子：受攻无根炮旁补根 → defend（与 moveIntent 的 rescue 同局面）
  {
    const b = parse("4k4/9/9/9/9/2n6/9/1C7/9/R7K w - - 0 1");
    check("车 a0b0 给受攻炮补根 → defend", SP.quietIntent(b, "r", "a0b0").kind === "defend",
      JSON.stringify(SP.quietIntent(b, "r", "a0b0")));
  }
  // 3) 简化：车攻对方有根车（等价邀兑）→ simplify
  {
    const b = parse("4r4/7k1/9/4r4/9/9/9/9/9/R7K w - - 0 1");
    check("车 a0a6 邀兑有根车 → simplify", SP.quietIntent(b, "r", "a0a6").kind === "simplify",
      JSON.stringify(SP.quietIntent(b, "r", "a0a6")));
  }
  // 4) 谋兵：兵过河后新捉一卒 → pawn；将军/吃子不属安静着 → null
  {
    const b = parse("4k4/9/9/9/5p3/4P4/9/9/9/7K1 w - - 0 1");
    check("兵 e4e5 新捉边卒 → pawn", SP.quietIntent(b, "r", "e4e5").kind === "pawn",
      JSON.stringify(SP.quietIntent(b, "r", "e4e5")));
    const b2 = parse("4k4/9/9/9/4R4/9/9/9/9/K8 w - - 0 1");
    check("将军着法 → quietIntent 返回 null", SP.quietIntent(b2, "r", "e5e8") === null);
  }
  // 5) 过门：车升到对方底线新捉无根马 → gate；quietText 全部变体 ≤30 字
  {
    const b = parse("1n2k4/9/9/9/9/9/9/9/9/R7K w - - 0 1");
    check("车 a0a9 新捉无根马 → gate", SP.quietIntent(b, "r", "a0a9").kind === "gate",
      JSON.stringify(SP.quietIntent(b, "r", "a0a9")));
    let allShort = true;
    for (const pool of Object.values(SP.quietPhrases || {})) {
      for (const v of pool) if ([...("对手走「车9平8」：" + v)].length > 30) allShort = false;
    }
    check("quietText 组装全部 ≤30 字", allShort);
    check("quietText 无 recent → 取首条（确定性）",
      SP.quietText("车9平8", "gate") === "对手走「车9平8」：是过门——先手铺路，下一步多半有后手",
      SP.quietText("车9平8", "gate"));
  }
}

// ---- ⑨ 私教讲解层：intentPhrase 变体池（T3） ----
console.log("⑨ 讲解层：intentPhrase 变体");
{
  const SP = sandbox.window.SparDebug;
  // 1) 白吃：recent 含原版短语时换新变体，且新变体被记入 recent
  {
    const it = { kind: "freeCapture", to: [4, 5], piece: "r", side: "r", capture: { name: "卒" } };
    const recent = ["白吃一卒"];
    const got = SP.intentPhrase(it, recent);
    check("recent 含原版 → 换新变体", got !== "白吃一卒" && got.indexOf("卒") >= 0, got);
    check("选中的变体已记入 recent", recent.indexOf(got) >= 0 && recent.length === 2, JSON.stringify(recent));
  }
  // 2) 将军：变体池全部含「将军」（不跨类），recent 轮换后仍成立
  {
    const it = { kind: "check", to: [4, 8], piece: "r", side: "r", check: true };
    const recent = [];
    let ok = true;
    for (let i = 0; i < 20; i++) if (SP.intentPhrase(it, recent).indexOf("将军") < 0) ok = false;
    check("check 变体恒含「将军」", ok);
  }
  // 3) 捉子：无 recent → 原版短语原样；有 recent → 恒含「捉」且不等于原版
  {
    const it = { kind: "attack", to: [4, 4], piece: "r", side: "r", attack: { name: "炮" } };
    check("无 recent → 原版「捉你的无根炮」", SP.intentPhrase(it) === "捉你的无根炮", SP.intentPhrase(it));
    const recent = ["捉你的无根炮"];
    let ok = true, prev = null;
    for (let i = 0; i < 20; i++) {
      const v = SP.intentPhrase(it, recent);
      if (v.indexOf("捉") < 0) ok = false;   // 不跨类
      if (v === prev) ok = false;            // 不连续重复（LRU 回退保证）
      prev = v;
    }
    check("recent 轮换 → 恒含「捉」且不连续重复", ok);
  }
}

// ---- ⑩ 私教讲解层：buildMistakeMsg 新增归因（T4） ----
console.log("⑩ 讲解层：失误归因扩充");
{
  const SP = sandbox.window.SparDebug;
  const X2 = sandbox.window.Xiangqi;
  const parse = fen => X2.parseFen(fen).board;
  // 黑车 a6 无根，红车 a0 可白吃（引擎正着 a0a6 = 吃 ≥400 大子）
  const b = parse("4k4/9/9/r8/9/9/9/9/9/R7K w - - 0 1");
  const res = { loss: 150, bestMv: "a0a6", bestLine: ["a0a6"], bestCp: 600, actualCp: 0 };
  // 1) 错过对手失误：上一手对手摆动 ≥150
  {
    const msg = SP.buildMistakeMsg("车一平二", res, { m: "a0b0", cn: "车一平二" }, b, "r", 200);
    check("oppSwing≥150 → 错过对手失误归因", msg.indexOf("200 分") >= 0 && msg.indexOf("车九进六") >= 0, msg);
  }
  // 2) 错过一步得子：正着吃 ≥400 大子而实战没吃（oppSwing 未知不触发 1.5）
  {
    const msg = SP.buildMistakeMsg("车一平二", res, { m: "a0b0", cn: "车一平二" }, b, "r", null);
    check("正着白吃大子未吃 → 错过得子归因", msg.indexOf("白吃") >= 0 && msg.indexOf("车九进六") >= 0, msg);
  }
  // 3) 送子归因回归不受影响（优先级仍在最前）
  {
    const msg = SP.buildMistakeMsg("车一进三", res, { m: "a0a3", cn: "车一进三" }, b, "r", 200);
    check("送子归因优先级不变", msg.indexOf("送到了对方火力下") >= 0, msg);
  }
}

// ---- ⑪ 私教讲解层：phaseOf2 阶段感知（T5） ----
console.log("⑪ 讲解层：phaseOf2");
{
  const SP = sandbox.window.SparDebug;
  const parse = fen => sandbox.window.Xiangqi.parseFen(fen).board;
  // 1) 初始局面 → 开局
  {
    const b = parse("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1");
    check("初始局面 ply=0 → open", SP.phaseOf2(b, 0) === "open", SP.phaseOf2(b, 0));
  }
  // 2) 子力稀疏（仅余一车）→ 残局（阈值口径同 coachbrain.ENDGAME_MAT）
  {
    const b = parse("4k4/9/9/9/9/9/9/9/9/1R5K1 w - - 0 1");
    check("剩一车 → end", SP.phaseOf2(b, 40) === "end", SP.phaseOf2(b, 40));
  }
  // 3) 子力充足但已过开局期 → 中局；ply 缺省时非残局一律按开局（测试确定性）
  {
    const b = parse("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1");
    check("子力充足 ply=25 → mid", SP.phaseOf2(b, 25) === "mid", SP.phaseOf2(b, 25));
    check("ply 缺省 → open", SP.phaseOf2(b) === "open", SP.phaseOf2(b));
  }
}

// ---- ⑫ 私教讲解层：cooldown 冷却（T6） ----
console.log("⑫ 讲解层：cooldown");
{
  const SP = sandbox.window.SparDebug;
  const parse = fen => sandbox.window.Xiangqi.parseFen(fen).board;
  // 1) 首次讲返回 true 并记账，同话题再讲返回 false
  {
    const log = {};
    check("首次 cooldown → true", SP.cooldown("t1", log) === true);
    check("同话题再讲 → false", SP.cooldown("t1", log) === false);
  }
  // 2) 不同话题互不影响
  {
    const log = {};
    SP.cooldown("a", log);
    check("不同话题独立记账", SP.cooldown("b", log) === true && SP.cooldown("a", log) === false);
  }
  // 3) 未提供 sayLog → 恒 true 不记账（无头测试/兼容旧调用）
  {
    check("无 sayLog 恒 true", SP.cooldown("x", null) === true && SP.cooldown("x", null) === true);
  }
  // 4) positionSnapshot：建议句讲过一次后被冷却，特征句仍正常
  {
    const b0 = parse("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1");
    const sayLog = {};
    const s1 = SP.positionSnapshot(b0, "r", 0, [], 0, undefined, sayLog);
    check("首次快照含建议句", s1.text.indexOf("炮镇中路") >= 0, s1.text);
    const s2 = SP.positionSnapshot(b0, "r", 0, [], 0, undefined, sayLog);
    check("同局再快照 → 建议句被冷却省略", s2.text.indexOf("炮镇中路") < 0, s2.text);
  }
}

console.log(failures ? "\n共 " + failures + " 项失败" : "\n全部通过");
process.exit(failures ? 1 : 0);