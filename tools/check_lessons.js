/* 课树全量合法性遍历 + 中文记谱一致性校验（无头，Node 桩环境）。
 *
 *   node tools/check_lessons.js                 # 只查不动：非法着法 / cn 与规则引擎推导不一致 / 空课
 *   node tools/check_lessons.js --fix-cn        # 把与 Notation.chinese 推导不一致的 cn 改写为推导值
 *   node tools/check_lessons.js --only C        # 只查一个分类
 *
 * 校验项（逐节点）：
 *   ① m 可解析（4 字符坐标着法）
 *   ② 源格确有本行棋方棋子
 *   ③ 走法经 Xiangqi.isLegal 合法（含自将/照面过滤）
 *   ④ cn === Notation.chinese(board, side, mv)（源数据曾把将帅「平X路」误写成「进/退+路数」）
 *
 * 退出码：发现非法着法（数据损坏级）→ 1；仅 cn 不一致 → 0（--fix-cn 可修）。
 * 输出供批量文案流水线（低成本模型批量工作规划.md）的合并回归使用。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.dirname(__dirname);
const argv = process.argv.slice(2);
const FIX_CN = argv.includes("--fix-cn");
const ONLY = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;

/* ---- 浏览器桩：rules.js / notation.js ---- */
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "rules.js"), "utf8"), sandbox, { filename: "rules.js" });
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "notation.js"), "utf8"), sandbox, { filename: "notation.js" });
const X = sandbox.window.Xiangqi;
const Notation = sandbox.window.Notation;

const idx = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "index.json"), "utf8"));

let nodeTotal = 0, illegalTotal = 0, cnMismatchTotal = 0, fixedFiles = 0, fixedNodes = 0;
const illegalSamples = [], emptyLessons = [], mismatchByPiece = {};
const perCat = {};

for (const cat of idx.categories) {
  if (ONLY && cat.id !== ONLY) continue;
  const stat = { lessons: 0, nodes: 0, illegal: 0, cnMismatch: 0 };
  for (const les of cat.lessons) {
    const file = path.join(ROOT, les.file);
    const raw = fs.readFileSync(file, "utf8");
    const data = JSON.parse(raw);
    stat.lessons++;
    if (!Array.isArray(data.moves) || !data.moves.length) { emptyLessons.push(cat.id + "/" + les.id); continue; }
    let changed = false;
    const start = X.parseFen(data.fen);

    const walk = (nodes, parentBoard, parentSide) => {
      for (const n of nodes) {
        stat.nodes++; nodeTotal++;
        const board = X.cloneBoard(parentBoard);
        const side = parentSide;
        let mv = null;
        try { mv = X.parseMove(n.m); } catch (e) { /* ① */ }
        const piece = mv ? board[mv[1]][mv[0]] : null;
        if (!piece) {                       // ①② 损坏
          stat.illegal++; illegalTotal++;
          if (illegalSamples.length < 20) illegalSamples.push(cat.id + " " + les.id + " " + n.m + "（源格无子/不可解析）");
          continue;
        }
        if (!X.isLegal(board, side, mv)) {  // ③
          stat.illegal++; illegalTotal++;
          if (illegalSamples.length < 20) illegalSamples.push(cat.id + " " + les.id + " " + n.m);
        }
        const want = Notation.chinese(board, side, mv);   // ④
        if (n.cn !== want) {
          stat.cnMismatch++; cnMismatchTotal++;
          const pt = piece.toLowerCase();
          mismatchByPiece[pt] = (mismatchByPiece[pt] || 0) + 1;
          if (FIX_CN) { n.cn = want; changed = true; fixedNodes++; }
        }
        if (Array.isArray(n.ch) && n.ch.length) {
          X.applyMove(board, ...mv);
          walk(n.ch, board, X.other(side));
        }
      }
    };
    walk(data.moves, start.board, start.side);

    // index 的 plies 定义 = 树内节点总数（build_lessons.py 口径，与主线长度无关）
    let nodeCount = 0;
    (function count(ns) { for (const n of ns) { nodeCount++; if (Array.isArray(n.ch)) count(n.ch); } })(data.moves);
    if (nodeCount !== les.plies) {
      if (illegalSamples.length < 20) illegalSamples.push(cat.id + " " + les.id + " index.plies=" + les.plies + " 实际节点 " + nodeCount);
    }

    if (FIX_CN && changed) {
      const out = JSON.stringify(data);   // 课程文件为单行紧凑格式
      if (JSON.parse(out) && out !== raw) { fs.writeFileSync(file, out, "utf8"); fixedFiles++; }
    }
  }
  perCat[cat.id] = stat;
}

console.log("课树全量遍历：节点 " + nodeTotal);
for (const [cid, s] of Object.entries(perCat)) {
  console.log("  " + cid + "  课 " + s.lessons + "  节点 " + s.nodes +
    (s.illegal || s.cnMismatch ? "  非法 " + s.illegal + "  cn不一致 " + s.cnMismatch : ""));
}
if (emptyLessons.length) console.log("空课（无 moves，不视为错误）：" + emptyLessons.join(" "));
if (Object.keys(mismatchByPiece).length) console.log("cn 不一致按兵种：" + JSON.stringify(mismatchByPiece));
if (illegalSamples.length) { console.log("问题样本（前 20）："); illegalSamples.forEach(s => console.log("  " + s)); }
if (FIX_CN) console.log("--fix-cn：改写 cn " + fixedNodes + " 条，涉及 " + fixedFiles + " 个文件");
if (illegalTotal > 0) { console.log("发现非法着法（数据损坏级）"); process.exit(1); }
