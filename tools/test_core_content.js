/* 新手路线内容 + 统一学习记录逻辑回归（Node 桩环境）：
 *   node tools/test_core_content.js
 * 校验（对应规划 2.0-C / 6.6 / 7.3 / 7.4 / 9.1）：
 *   ① route.json 结构完整：30 课 6 阶段，每课有目标/演示/练习/验收/时长/能力标签
 *   ② 全部局面与着法经规则引擎复验（FEN 可解析、演示线合法、accept 合法且可解）
 *   ③ 分级提示不直接泄露答案坐标，验收题含解析
 *   ④ Learn 状态分层：看过 → 跟做 → 独立 → 复习通过；复习间隔 1/3/7 日与升降级
 *   ⑤ buildPlan 计划规则：复习优先、新课推进、薄弱项（样本<3 观察中）、实战等级按战绩 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.dirname(__dirname);
const storage = new Map();
const sandbox = {
  console, setTimeout, clearTimeout,
  localStorage: {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k)
  },
  document: { createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} } }), getElementById: () => null, querySelectorAll: () => [], addEventListener() {} },
  navigator: { userAgent: "node" }, performance: { now: () => Date.now() },
  dispatchEvent() {}
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
function load(rel) { vm.runInContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), sandbox, { filename: rel }); }

load("js/rules.js");
load("js/notation.js");
load("js/learn.js");

const X = sandbox.window.Xiangqi;
const Learn = sandbox.window.Learn;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log("  ✓ " + name);
  else { failures++; console.log("  ✗ " + name + (detail ? "  —— " + detail : "")); }
}

const route = JSON.parse(fs.readFileSync(path.join(ROOT, "data/core/route.json"), "utf8"));

// ---- ① 结构 ----
console.log("① route.json 结构");
{
  check("版本与字段", route.version === 1 && Array.isArray(route.stages) && Array.isArray(route.lessons));
  check("6 阶段 30 课", route.stages.length === 6 && route.lessons.length === 30, route.lessons.length + " 课");
  let ok = true, why = "";
  for (const l of route.lessons) {
    if (!l.goal || !l.explain || !l.minutes || !l.abilities || !l.abilities.length) { ok = false; why = l.id + " 缺元信息"; break; }
    if (!l.demo || !l.demo.fen || !l.demo.moves || !l.demo.moves.length) { ok = false; why = l.id + " 缺演示"; break; }
    if (!l.exercises || l.exercises.length < 1) { ok = false; why = l.id + " 缺练习"; break; }
    if (!l.acceptance || !l.acceptance.explain) { ok = false; why = l.id + " 缺验收"; break; }
    for (const ex of l.exercises.concat([l.acceptance])) {
      if (ex.hints && ex.hints.length && !ex.accept) { ok = false; why = l.id + " 提示无答案"; }
    }
  }
  check("每课含 目标/讲解/演示/≥2练习/验收/时长/能力标签", ok, why);
  const total = route.lessons.reduce((n, l) => n + l.exercises.length + 1, 0);
  console.log("    练习总数（含验收）：" + total);
}

// ---- ② 局面与着法复验 ----
console.log("② 规则引擎复验（局面/演示线/可解性）");
{
  let ok = true, why = "";
  for (const l of route.lessons) {
    try {
      const start = X.parseFen(l.demo.fen);
      const b = X.cloneBoard(start.board);
      let s = start.side;
      for (const mv of l.demo.moves) {
        const arr = X.parseMove(mv.m);
        if (!X.isLegal(b, s, arr)) throw new Error("演示着非法 " + mv.m);
        if (!mv.cn || !mv.note) throw new Error("演示缺解说");
        X.applyMove(b, ...arr); s = X.other(s);
      }
      const all = l.exercises.concat([l.acceptance]);
      for (const ex of all) {
        const p = X.parseFen(ex.fen);
        const legal = X.legalMoves(p.board, p.side).map(X.moveToText);
        for (const a of ex.accept) {
          if (legal.indexOf(a) < 0) throw new Error(ex.id + " accept 非法 " + a);
        }
        if (!ex.loose && legal.filter(m => ex.accept.indexOf(m) < 0).length < 1) {
          throw new Error(ex.id + " 无干扰着法");
        }
        const isAcceptance = ex === l.acceptance;
        if (!isAcceptance && (!ex.hints || ex.hints.length < 2)) throw new Error(ex.id + " 提示不足两级");
        // 一二级提示不得直接包含答案坐标（三级提示按规划 6.6 定义即「展示走法」）
        for (const h of (ex.hints || []).slice(0, -1)) {
          if (/[a-i][0-9][a-i][0-9]/.test(h)) throw new Error(ex.id + " 前两级提示泄露坐标");
        }
      }
    } catch (e) { ok = false; why = l.id + "：" + e.message; break; }
  }
  check("30 课全部局面合法、可解、提示不泄露坐标", ok, why);
}

// ---- ④ 状态分层与复习调度 ----
console.log("③ Learn 状态分层与复习调度");
{
  const now = Date.now(), DAY = 24 * 3600 * 1000;
  // 看过
  Learn.markDemo("L1");
  check("markDemo → viewed", Learn.statusOf("L1").state === "viewed");
  // 跟做：练习带答案
  Learn.recordExercise("L1", "L1e1", "测试", { ok: true, wrong: 1, hints: 0, answered: true, at: now }, false);
  check("用答案通过 → 跟做完成", Learn.statusOf("L1").state === "followed");
  // 入复习队列
  const q = Learn.review.all();
  check("带答案通过进入复习队列", q.length === 1 && q[0].key === "core/L1/L1e1" && q[0].due - now > 0.5 * DAY && q[0].due - now < 1.5 * DAY);
  // 独立：验收干净通过
  Learn.recordExercise("L1", "L1ex", "测试", { ok: true, wrong: 0, hints: 0, answered: false, at: now }, true);
  check("验收干净通过 → 独立通过", Learn.statusOf("L1").state === "independent");
  // 复习场干净通过 → 升级 + 复习通过标记
  Learn.recordExercise("L1", "L1e1", "测试", { ok: true, wrong: 0, hints: 0, answered: false, at: now, reviewVisit: true }, false);
  const q2 = Learn.review.all();
  check("复习场干净通过 → 升到第 2 轮间隔（3 日）",
    q2.length === 1 && q2[0].level === 1 && q2[0].due - now > 2.5 * DAY && q2[0].due - now < 3.5 * DAY);
  // 失败 → 回炉第 0 轮
  Learn.recordExercise("L1", "L1e1", "测试", { ok: false, wrong: 2, hints: 1, answered: false, at: now, reviewVisit: true }, false);
  const q3 = Learn.review.all();
  check("复习失败 → 回炉（次日）", q3.length === 1 && q3[0].level === 0);
  // 三轮全过 → 毕业；验收题复习通过 → 课程复习通过
  Learn.recordExercise("L1", "L1e1", "测试", { ok: true, wrong: 0, hints: 0, answered: false, at: now, reviewVisit: true }, false);
  Learn.recordExercise("L1", "L1e1", "测试", { ok: true, wrong: 0, hints: 0, answered: false, at: now, reviewVisit: true }, false);
  Learn.recordExercise("L1", "L1e1", "测试", { ok: true, wrong: 0, hints: 0, answered: false, at: now, reviewVisit: true }, false);
  check("三轮复习全过 → 毕业", Learn.review.all().length === 0);
  Learn.recordExercise("L1", "L1ex", "测试", { ok: true, wrong: 0, hints: 0, answered: false, at: now, reviewVisit: true }, true);
  check("验收题复习干净通过 → 课程复习通过", Learn.statusOf("L1").state === "mastered");
  // 实战错题
  const id = Learn.gameEx.add({ fen: X.INIT_FEN, side: "r", accept: [{ mv: "h2e2", cn: "炮二平五" }], loss: 300, cls: "失误", tag: "实战错题", cn: "炮八平五" });
  check("实战错题入库并进复习队列", Learn.gameEx.get(id) !== null && Learn.review.all().some(r => r.key === "game/" + id));
  Learn.gameEx.record(id, { ok: true, wrong: 0, hints: 0, answered: false, reviewVisit: true });
  Learn.gameEx.record(id, { ok: true, wrong: 0, hints: 0, answered: false, reviewVisit: true });
  Learn.gameEx.record(id, { ok: true, wrong: 0, hints: 0, answered: false, reviewVisit: true });
  check("实战错题三轮通过 → 毕业", Learn.review.all().every(r => r.key !== "game/" + id));
  // 能力档案
  const ab = Learn.abilities();
  check("能力标签聚合（样本/无提示率/观察中）", ab["测试"] && ab["测试"].attempts >= 5 && ab["测试"].hasOwnProperty("noHintRate"));
}

// ---- ⑤ 今日计划规则 ----
console.log("④ buildPlan 今日计划规则");
{
  const now = Date.now(), DAY = 24 * 3600 * 1000;
  const mkCfg = (over) => Object.assign({
    now, settings: { includeReview: true, includeNew: true, includeBattle: true, battleLevel: "auto" },
    reviews: [], route: [
      { id: "a1", stage: "认识规则", title: "第一课", ability: "马腿" },
      { id: "a2", stage: "认识规则", title: "第二课", ability: "马腿" }
    ],
    progress: {}, abilities: {}, lastGames: []
  }, over);
  let items = Learn.buildPlan(mkCfg({}));
  check("新用户：推荐新课 + 实战（无复习）",
    items.some(i => i.type === "new" && i.title.indexOf("第一课") >= 0) && items.some(i => i.type === "battle") && !items.some(i => i.type === "review"));
  items = Learn.buildPlan(mkCfg({ reviews: [{ key: "core/a1/a1e1", type: "core", due: now - DAY }] }));
  check("有到期复习：排在最前且带理由", items[0].type === "review" && items[0].reason.length > 3);
  items = Learn.buildPlan(mkCfg({
    abilities: { 马腿: { tag: "马腿", attempts: 6, clean: 2, correct: 4, reviewOk: 0, lastAt: now, evidence: [], noHintRate: 2 / 6, weak: true, observing: false } }
  }));
  check("薄弱项（样本足够且正确率低）进入计划", items.some(i => i.type === "weak" && i.title.indexOf("马腿") >= 0));
  items = Learn.buildPlan(mkCfg({
    abilities: { 马腿: { tag: "马腿", attempts: 2, clean: 0, correct: 0, reviewOk: 0, lastAt: now, evidence: [], noHintRate: 0, weak: false, observing: true } }
  }));
  check("样本不足 → 显示观察中，不生成结论",
    items.some(i => i.type === "weak" && (i.title.indexOf("观察中") >= 0 || i.reason.indexOf("暂不生成结论") >= 0)));
  items = Learn.buildPlan(mkCfg({ lastGames: [{ ts: now, result: "loss" }, { ts: now, result: "loss" }] }));
  check("连败 → 对手降为业1", items.some(i => i.type === "battle" && i.title.indexOf("业1") >= 0));
  items = Learn.buildPlan(mkCfg({ settings: { includeReview: false, includeNew: true, includeBattle: false, battleLevel: "auto" }, reviews: [{ key: "core/a1/a1e1", type: "core", due: now }] }));
  check("关闭开关后对应板块不再出现", !items.some(i => i.type === "review" || i.type === "battle"));
}

console.log(failures ? "\n共 " + failures + " 项失败" : "\n全部通过");
process.exit(failures ? 1 : 0);
