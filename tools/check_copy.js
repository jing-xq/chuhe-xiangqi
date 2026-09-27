/* 批量文案机器判卷（低成本模型批量工作规划.md §4 验收规则）。
 *
 *   node tools/check_copy.js --task t1            # 校验 tools/_work/copy/t1/out-*.jsonl
 *   node tools/check_copy.js --task t1 --retry    # 顺带产出 retry.jsonl（未通过行的输入）
 *
 * 产物：accepted.jsonl（全部通过行）/ rejected.jsonl（行 + 拒绝原因）/ 控制台统计。
 * 原则：验收不过的行整行丢弃重生成，不人工修；着法合法性由规则引擎判定。
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
const DIR = path.join(ROOT, "tools", "_work", "copy", TASK || "x");
if (!TASK) { console.error("用法：--task t1|t2|t3|t4|t6|t7 [--retry]"); process.exit(2); }

/* ---- 规则引擎（T1 合法着全集用） ---- */
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "rules.js"), "utf8"), sandbox, { filename: "rules.js" });
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "notation.js"), "utf8"), sandbox, { filename: "notation.js" });
const X = sandbox.window.Xiangqi;
const Notation = sandbox.window.Notation;

/* ---------- 通用工具 ---------- */
const len = s => [...s].length;
const RE_COORD = /[a-i][0-9][a-i][0-9]/i;
const RE_MOVE = /[前后中]?[车马炮兵卒帅将相象仕士][一二三四五六七八九0-9]?[进退平][一二三四五六七八九0-9]/g;
const RE_ASCII = /[A-Za-z]/;
const TONE_BLOCK = ["笨", "蠢", "傻", "垃圾", "废物", "鄙视", "嘲讽"];
const RE_CJK = /^[\u4e00-\u9fff0-9，。、；：？！·—…（）「」『』""'']+$/;

function charsetOk(s) { return RE_CJK.test(s); }
function toneOk(s) {
  if (TONE_BLOCK.some(w => s.includes(w))) return false;
  return !s.replace(/烂熟/g, "").includes("烂");   // 「烂熟于心」为褒义
}
function moveMentions(s) { return s.match(RE_MOVE) || []; }
function digitRuns(s) { return s.match(/[0-9]+/g) || []; }

/* 某局面下全部合法着的中文记法集合（带缓存） */
const legalCache = new Map();
function legalCnSet(fen) {
  if (legalCache.has(fen)) return legalCache.get(fen);
  const pos = X.parseFen(fen);
  const set = new Set();
  for (const mv of X.legalMoves(pos.board, pos.side)) set.add(Notation.chinese(pos.board, pos.side, mv));
  legalCache.set(fen, set);
  return set;
}

/* ---------- 各任务判卷 ---------- */
/* 返回 null（通过）或拒绝原因字符串。row=输出行，inp=任务包输入行 */
const VALID = {
  t1(row, inp, seen) {
    if (JSON.stringify(Object.keys(row).sort()) !== '["c","id","ply"]') return "键必须恰为 id/ply/c";
    const c = row.c;
    if (typeof c !== "string") return "c 非字符串";
    if (len(c) < 8 || len(c) > 50) return "长度须 8~50（实际 " + len(c) + "）";
    if (!charsetOk(c)) return "含非中文字符（字母/符号/emoji）";
    if (RE_COORD.test(c)) return "含坐标记法";
    if (!toneOk(c)) return "语气违规";
    for (const mv of moveMentions(c)) {
      if (!legalCnSet(inp.fen).has(mv)) return "提到不合法着法「" + mv + "」";
    }
    const k = inp.intent && inp.intent.kind;
    if ((k === "freeCapture" || k === "trade" || k === "sac") && !/吃|兑|换/.test(c)) return "吃/兑子意图未提吃兑换";
    if (k === "check" && !/将/.test(c)) return "将军意图未提将";
    const key = row.id + "|" + row.ply;
    if (seen.text.has(c)) return "评注全文重复";
    seen.text.add(c);
    if (seen.task.has(key)) return "同任务重复行";
    seen.task.add(key);
    return null;
  },

  t2(row, inp, seen) {
    if (JSON.stringify(Object.keys(row).sort()) !== '["key","variants"]') return "键必须恰为 key/variants";
    if (row.key !== inp.key) return "key 与任务包不符";
    if (!Array.isArray(row.variants)) return "variants 非数组";
    const want = inp.count;
    if (row.variants.length < want) return "变体不足 " + want + "（实际 " + row.variants.length + "）";
    const set = new Set();
    for (const v of row.variants) {
      if (typeof v !== "string") return "变体含非字符串";
      const n = len(v);
      if (n < 8 || n > inp.maxLen) return "变体长度越界（8~" + inp.maxLen + "）：" + v;
      if (/[0-9]/.test(v)) return "含具体数字（应使用占位符）：" + v;
      const ph = v.match(/\{[^{}]*\}/g) || [];
      for (const p of ph) if (!/^\{[a-z]+\}$/.test(p)) return "非法占位符 " + p;
      const bare = v.replace(/\{[a-z]+\}/g, "");
      if (RE_ASCII.test(bare)) return "含字母：" + v;
      if (RE_COORD.test(v)) return "含坐标记法";
      if (!toneOk(v)) return "语气违规：" + v;
      if (set.has(v)) return "数组内重复";
      set.add(v);
    }
    if (seen.keys && seen.keys.has(row.key)) return "key 重复行";
    return null;
  },

  t3(row, inp, seen) {
    if (JSON.stringify(Object.keys(row).sort()) !== '["declineHow","lureWhy","mistakeWhy"]') return "键必须恰为 lureWhy/mistakeWhy/declineHow";
    for (const f of ["lureWhy", "mistakeWhy", "declineHow"]) {
      const v = row[f];
      if (typeof v !== "string") return f + " 非字符串";
      if (len(v) < 8 || len(v) > 60) return f + " 长度须 8~60（实际 " + len(v) + "）";
      if (!charsetOk(v)) return f + " 含非中文字符";
      if (RE_COORD.test(v)) return f + " 含坐标记法";
      if (!toneOk(v)) return f + " 语气违规";
      const allowed = new Set([String(inp.fall), String(inp.loss)]);
      for (const d of digitRuns(v)) if (!allowed.has(d)) return f + " 出现输入之外的数字 " + d + "（不许自己算数）";
      const cns = [inp.trapCn, inp.victimCn, inp.declineCn].filter(Boolean);
      for (const mv of moveMentions(v)) if (!cns.includes(mv)) return f + " 提到输入集合之外的着法「" + mv + "」";
    }
    if (!row.lureWhy.includes(String(inp.fall))) return "lureWhy 未原样含 fall=" + inp.fall;
    if (!row.declineHow.includes(String(inp.loss))) return "declineHow 未原样含 loss=" + inp.loss;
    if (inp.cls === "骗招" && !/风险|亏/.test(row.declineHow)) return "骗招的 declineHow 须含风险/亏";
    if (inp.cls === "飞刀" && row.declineHow.includes("风险")) return "飞刀的 declineHow 禁止出现风险";
    if (seen.ids && seen.ids.has(row.id)) return "id 重复行";
    return null;
  },

  t4(row, inp, seen) {
    if (JSON.stringify(Object.keys(row).sort()) !== '["id","subtitle"]') return "键必须恰为 id/subtitle";
    if (row.id !== inp.id) return "id 与任务包不符";
    const s = row.subtitle;
    if (typeof s !== "string") return "subtitle 非字符串";
    if (len(s) < 2 || len(s) > 16) return "长度须 2~16（实际 " + len(s) + "）";
    if (RE_ASCII.test(s)) return "含字母";
    if (/[0-9]/.test(s)) return "含数字";
    if (/课|No|№|第.{1,3}(课|局|讲)/.test(s)) return "含编号字样";
    if (!charsetOk(s)) return "含非常用字符";
    if (RE_COORD.test(s)) return "含坐标记法";
    if (!(inp.pieces || []).some(p => s.includes(p))) return "未含任何主班子名（" + (inp.pieces || []).join("") + "）";
    for (const mv of moveMentions(s)) {
      if (!(inp.firstMovesCn || []).includes(mv)) return "提到主线之外的着法「" + mv + "」";
    }
    if (seen.subs && seen.subs.has(s)) return "同类内副题重复";
    seen.subs.add(s);
    return null;
  },

  t6(row, inp, seen) {
    if (JSON.stringify(Object.keys(row).sort()) !== '["formation","id","plans","warnings"]') return "键必须恰为 id/formation/plans/warnings";
    if (row.id !== inp.id) return "id 与任务包不符";
    const piecesInMain = new Set((inp.mainlineCn || []).join("").match(/[车马炮兵卒帅将相象仕士]/g) || []);
    const mainSet = new Set(inp.mainlineCn || []);
    const checkArr = (name, lo, hi, minL, maxL) => {
      if (!Array.isArray(row[name])) return name + " 非数组";
      if (row[name].length < lo || row[name].length > hi) return name + " 条数须 " + lo + "~" + hi + "（实际 " + row[name].length + "）";
      for (const s of row[name]) {
        if (typeof s !== "string") return name + " 含非字符串";
        if (len(s) < minL || len(s) > maxL) return name + " 每条长度须 " + minL + "~" + maxL;
        if (/[0-9]/.test(s)) return name + " 含数字（cp 由前端显示）";
        if (RE_ASCII.test(s)) return name + " 含字母";
        if (RE_COORD.test(s)) return name + " 含坐标记法";
        if (!toneOk(s)) return name + " 语气违规";
        for (const ch of s.match(/[车马炮兵卒帅将相象仕士]/g) || []) {
          if (!piecesInMain.has(ch)) return name + " 提到主线未出现的子「" + ch + "」";
        }
        for (const mv of moveMentions(s)) if (!mainSet.has(mv)) return name + " 提到主线之外的着法「" + mv + "」";
      }
      return null;
    };
    return checkArr("formation", 3, 5, 6, 40) || checkArr("plans", 2, 3, 6, 40) || checkArr("warnings", 2, 2, 6, 40);
  },

  t7(row, inp, seen) {
    if (JSON.stringify(Object.keys(row).sort()) !== '["def","motto","term"]') return "键必须恰为 term/def/motto";
    if (row.term !== inp.term) return "term 与词表不符：" + row.term;
    if (typeof row.def !== "string" || typeof row.motto !== "string") return "def/motto 须为字符串";
    if (len(row.def) < 8 || len(row.def) > 60) return "def 长度须 8~60（实际 " + len(row.def) + "）";
    if (len(row.motto) < 4 || len(row.motto) > 16) return "motto 长度须 4~16（实际 " + len(row.motto) + "）";
    for (const f of ["def", "motto"]) {
      if (/[0-9A-Za-z]/.test(row[f])) return f + " 含字母/数字";
      if (RE_COORD.test(row[f])) return f + " 含坐标记法";
      if (!toneOk(row[f])) return f + " 语气违规";
    }
    if (seen.terms && seen.terms.has(row.term)) return "term 重复行";
    return null;
  },

  t5(row, inp, seen) {
    if (JSON.stringify(Object.keys(row).sort()) !== '["expect","id","name","text"]') return "键必须恰为 id/name/text/expect";
    if (row.id !== inp.id) return "id 与任务包不符";
    if (typeof row.name !== "string" || len(row.name) < 2 || len(row.name) > 24) return "name 须 2~24 字";
    if (typeof row.text !== "string" || !row.text.trim()) return "text 为空";
    if (JSON.stringify(row.expect) !== JSON.stringify(inp.expect)) return "expect 与规格不符（须原样照抄）";
    if (inp.kind !== "error" && !/[车马炮兵卒帅将相象仕士]/.test(row.text)) return "text 里没有任何着法";
    if (seen.ids && seen.ids.has(row.id)) return "id 重复行";
    return null;
  }
};

/* ---------- 主流程 ---------- */
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8"));
const inputs = new Map();   // join key → 输入行
for (const cf of manifest.chunks) {
  for (const line of fs.readFileSync(path.join(DIR, cf), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    inputs.set(joinKey(TASK, r), r);
  }
}

const seen = { text: new Set(), task: new Set(), subs: new Set(), ids: new Set(), terms: new Set(), keys: new Set() };
const accepted = [], rejected = [], retryInputs = [];
let nOut = 0;

const outFiles = fs.readdirSync(DIR).filter(f => /^out-.*\.jsonl$/.test(f)).sort();
if (!outFiles.length) { console.error("无 out-*.jsonl（先让生成方产出）"); process.exit(2); }
for (const of of outFiles) {
  for (const line of fs.readFileSync(path.join(DIR, of), "utf8").split("\n")) {
    if (!line.trim()) continue;
    nOut++;
    let row = null;
    try { row = JSON.parse(line); } catch (e) { rejected.push({ line: line.slice(0, 120), reason: "JSON 不可解析" }); continue; }
    const inp = inputs.get(joinKey(TASK, row));
    if (!inp) { rejected.push({ line: line.slice(0, 120), reason: "找不到对应任务包输入行" }); continue; }
    const err = VALID[TASK](row, inp, seen);
    if (err) rejected.push({ line: line.slice(0, 160), reason: err });
    else { accepted.push(row); retryInputs.push(inp); }
  }
}

fs.writeFileSync(path.join(DIR, "accepted.jsonl"), accepted.map(r => JSON.stringify(r)).join("\n") + (accepted.length ? "\n" : ""), "utf8");
fs.writeFileSync(path.join(DIR, "rejected.jsonl"), rejected.map(r => JSON.stringify(r)).join("\n") + (rejected.length ? "\n" : ""), "utf8");
if (argv.includes("--retry")) {
  const done = new Set(accepted.map(r => joinKey(TASK, r)));
  const missing = [...inputs.values()].filter(inp => !done.has(joinKey(TASK, inp)));
  fs.writeFileSync(path.join(DIR, "retry.jsonl"), missing.map(r => JSON.stringify(r)).join("\n") + (missing.length ? "\n" : ""), "utf8");
  console.log("retry.jsonl：未覆盖输入 " + missing.length + " 行");
}

console.log("[" + TASK + "] 输出 " + nOut + " 行：通过 " + accepted.length + "，拒绝 " + rejected.length + "（合格率 " +
  (nOut ? (100 * accepted.length / nOut).toFixed(1) : 0) + "%）");
const byReason = {};
for (const r of rejected) byReason[r.reason] = (byReason[r.reason] || 0) + 1;
for (const [k, v] of Object.entries(byReason).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log("  ✗ " + v + " × " + k);
if (rejected.length) console.log("拒绝明细见 " + path.join(DIR, "rejected.jsonl"));

function joinKey(task, r) {
  switch (task) {
    case "t1": return r.id + "|" + r.ply;
    case "t2": return r.key;
    default: return r.id !== undefined ? String(r.id) : r.term;
  }
}
