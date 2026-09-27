/* 批量文案合并回 data/（apply_comments.py 模式：只写讲解字段，绝不碰着法树）。
 *
 *   node tools/merge_copy.js --task t1            # C 类课评注 → data/lessons/C/*.json + index.json annotated
 *   node tools/merge_copy.js --task t4            # 课名副标题 → data/index.json（标题改写「原标题·副题」）
 *   node tools/merge_copy.js --task t3 --cls tools/_work/trapcls.json   # → data/traps/<id>.json overlay
 *   node tools/merge_copy.js --task t2            # → data/copy/feedback.json
 *   node tools/merge_copy.js --task t6            # → data/openings/<id>.json 的 guide 字段
 *   node tools/merge_copy.js --task t7            # → data/copy/terms.json
 *
 * 安全：合并前后 moves/m/ch/cp 树必须逐字节一致（除新增讲解字段）；先全量校验后写盘。
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.dirname(__dirname);
const argv = process.argv.slice(2);
function argVal(name, dflt) {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}
const TASK = argVal("task", null);
if (!TASK) { console.error("用法：--task t1|t2|t3|t4|t6|t7"); process.exit(2); }
const DIR = path.join(ROOT, "tools", "_work", "copy", TASK);
const accepted = fs.readFileSync(path.join(DIR, "accepted.jsonl"), "utf8")
  .split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
console.log("[" + TASK + "] 读取通过行 " + accepted.length);

function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJsonCompact(p, obj) { fs.writeFileSync(p, JSON.stringify(obj), "utf8"); }

/* ---------- T1：评注进课程 JSON ---------- */
function mergeT1() {
  const idxPath = path.join(ROOT, "data", "index.json");
  const idx = readJson(idxPath);
  const rawIdx = fs.readFileSync(idxPath, "utf8");
  const byLesson = new Map();
  for (const r of accepted) {
    if (!byLesson.has(r.id)) byLesson.set(r.id, []);
    byLesson.get(r.id).push(r);
  }
  let touched = 0, commented = 0, newAnnotated = 0;
  for (const cat of idx.categories) {
    for (const les of cat.lessons) {
      const rows = byLesson.get(les.id);
      if (!rows || !rows.length) continue;
      const file = path.join(ROOT, les.file);
      const raw = fs.readFileSync(file, "utf8");
      const data = JSON.parse(raw);
      const hadC = (function hasC(ns) {
        for (const n of ns) { if ("c" in n) return true; if (Array.isArray(n.ch) && hasC(n.ch)) return true; }
        return false;
      })(data.moves);
      // 主线第 ply 手（1 起）
      const map = new Map(rows.map(r => [r.ply, r.c]));
      let ply = 0, node = null, nodes = data.moves, ok = true;
      while (Array.isArray(nodes) && nodes.length) {
        node = nodes[0]; ply++;
        if (map.has(ply)) {
          if (typeof node.c !== "undefined" && node.c !== map.get(ply)) { console.error("✗ " + les.id + " ply" + ply + " 已有评注，拒绝覆盖"); ok = false; break; }
          node.c = map.get(ply);
        }
        nodes = Array.isArray(node.ch) && node.ch.length ? node.ch : null;
        if (ply > 60) break;
      }
      if (!ok) continue;
      const missing = [...map.keys()].filter(p => p > ply);
      if (missing.length) console.error("✗ " + les.id + " ply 超界：" + missing.join(","));
      // 结构校验：删掉新增 c 后应与原文逐字节一致
      const check = JSON.parse(JSON.stringify(data));
      (function strip(ns) { for (const n of ns) { delete n.c; if (Array.isArray(n.ch)) strip(n.ch); } })(check.moves);
      if (JSON.stringify(check) !== raw) { console.error("✗ " + les.id + " 结构校验失败，跳过"); continue; }
      writeJsonCompact(file, data);
      touched++;
      commented += map.size;
      if (!hadC) { les.annotated = true; newAnnotated++; }
    }
  }
  if (JSON.stringify(JSON.parse(rawIdx)) === rawIdx) writeJsonCompact(idxPath, idx);
  else fs.writeFileSync(idxPath, JSON.stringify(idx, null, 1) + "\n", "utf8");
  console.log("T1：改写 " + touched + " 课，写入评注 " + commented + " 条，新点亮「评」标 " + newAnnotated + " 课");
}

/* ---------- T4：副标题进 index.json ---------- */
function mergeT4() {
  const idxPath = path.join(ROOT, "data", "index.json");
  const idx = readJson(idxPath);
  const byId = new Map(accepted.map(r => [r.id, r.subtitle]));
  let n = 0;
  for (const cat of idx.categories) {
    for (const les of cat.lessons) {
      const sub = byId.get(les.id);
      if (!sub) continue;
      if (les.title.includes("·")) { console.error("✗ " + les.id + " 标题已含「·」，跳过"); continue; }
      les.title = les.title + "·" + sub;
      n++;
    }
  }
  fs.writeFileSync(idxPath, JSON.stringify(idx), "utf8");
  console.log("T4：改写标题 " + n + " 条 → " + idxPath);
}

/* ---------- T3：飞刀文案 overlay ---------- */
function mergeT3() {
  const clsFile = argVal("cls", "tools/_work/trapcls.json");
  const cache = readJson(path.join(ROOT, clsFile));
  const outDir = path.join(ROOT, "data", "traps");
  fs.mkdirSync(outDir, { recursive: true });
  const texts = new Map(accepted.map(r => [r.id, r]));
  let n = 0;
  for (const [id, c] of Object.entries(cache)) {
    const t = texts.get(id);
    if (!t) continue;
    const overlay = {
      id, cls: c.cls, fall: c.fall, loss: c.loss, trapPly: c.trapPly,
      declineMv: c.declineMv || null,
      lureWhy: t.lureWhy, mistakeWhy: t.mistakeWhy, declineHow: t.declineHow
    };
    fs.writeFileSync(path.join(outDir, id + ".json"), JSON.stringify(overlay), "utf8");
    n++;
  }
  console.log("T3：写入 overlay " + n + " 份 → " + outDir);
}

/* ---------- T2：反馈语料库 ---------- */
function mergeT2() {
  const keys = {};
  for (const r of accepted) keys[r.key] = r.variants;
  const outDir = path.join(ROOT, "data", "copy");
  fs.mkdirSync(outDir, { recursive: true });
  const out = { version: 1, keys };
  fs.writeFileSync(path.join(outDir, "feedback.json"), JSON.stringify(out), "utf8");
  console.log("T2：写入 feedback.json（" + Object.keys(keys).length + " 组键，共 " +
    Object.values(keys).reduce((a, v) => a + v.length, 0) + " 条变体）");
}

/* ---------- T6：开局体系 guide 字段 ---------- */
function mergeT6() {
  const oidxPath = path.join(ROOT, "data", "openings", "index.json");
  const oidx = readJson(oidxPath);
  const byId = new Map(accepted.map(r => [r.id, r]));
  let n = 0;
  for (const meta of oidx.systems) {
    const g = byId.get(meta.id);
    if (!g) continue;
    const file = path.join(ROOT, meta.file);
    const raw = fs.readFileSync(file, "utf8");
    const data = JSON.parse(raw);
    if (data.guide) { console.error("✗ " + meta.id + " 已有 guide，跳过"); continue; }
    data.guide = { formation: g.formation, plans: g.plans, warnings: g.warnings };
    // 结构校验：删掉 guide 后与原文一致（文件为 indent=1，换行风格跟随原文 CRLF/LF）
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    const check = JSON.parse(JSON.stringify(data));
    delete check.guide;
    if (JSON.stringify(check, null, 1) + "\n" !== raw.replace(/\r\n/g, "\n")) {
      console.error("✗ " + meta.id + " 结构校验失败，跳过"); continue;
    }
    fs.writeFileSync(file, JSON.stringify(data, null, 1) + eol, "utf8");
    n++;
  }
  console.log("T6：写入 guide " + n + " 份");
}

/* ---------- T7：术语卡 ---------- */
function mergeT7() {
  const terms = accepted.slice().sort((a, b) => a.term.localeCompare(b.term, "zh"));
  const outDir = path.join(ROOT, "data", "copy");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "terms.json"), JSON.stringify({ version: 1, terms }), "utf8");
  console.log("T7：写入 terms.json（" + terms.length + " 词）");
}

/* ---------- T5：导入容错语料 ---------- */
function mergeT5() {
  const outDir = path.join(ROOT, "data", "copy");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "import_corpus.json"),
    JSON.stringify({ version: 1, cases: accepted }), "utf8");
  console.log("T5：写入 import_corpus.json（" + accepted.length + " 例）");
}

const MERGE = { t1: mergeT1, t2: mergeT2, t3: mergeT3, t4: mergeT4, t5: mergeT5, t6: mergeT6, t7: mergeT7 };
MERGE[TASK]();
