/* 棋谱导入容错语料回归（Node 桩环境）：
 *   node tools/test_import_corpus.js
 * 语料 data/copy/import_corpus.json = {version, cases:[{id,name,text,expect}]}
 *   expect:{moves:N} → parseGameText 无 error 且恰好 N 手
 *   expect:{error:true} → parseGameText 返回 error
 * 语料由批量文案流水线生成（gen_copy_tasks --task t5 → 模型填 text → check_copy → merge_copy），
 * 暴露解析 bug 时修 parseGameText 后本测试防回归。 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.dirname(__dirname);

const storage = new Map();
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  localStorage: {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k)
  },
  document: { createElement: () => ({ style: {} }), getElementById: () => null, querySelectorAll: () => [], addEventListener() {} },
  navigator: { userAgent: "node" },
  performance: { now: () => Date.now() }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), sandbox, { filename: rel });
}
load("js/diag.js");
load("js/rules.js");
load("js/notation.js");
sandbox.window.Sound = { play() {} };
sandbox.window.Feedback = { pick: () => "", fmt: s => s, load: () => Promise.resolve() };
load("js/games.js");
const Games = sandbox.window.Games;

const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "copy", "import_corpus.json"), "utf8"));
let pass = 0;
const failed = [];
for (const c of corpus.cases) {
  let r = null, threw = null;
  try { r = Games._parseGameText(c.text); } catch (e) { threw = e; }
  if (threw) { failed.push(c.id + " " + c.name + "：解析抛异常 " + threw.message); continue; }
  if (c.expect.error) {
    if (r.error) pass++;
    else failed.push(c.id + " " + c.name + "：期望报错，实际成功解析出 " + r.moves.length + " 手");
  } else if (r.error) {
    failed.push(c.id + " " + c.name + "：期望 " + c.expect.moves + " 手，实际报错「" + r.error + "」");
  } else if (r.moves.length !== c.expect.moves) {
    failed.push(c.id + " " + c.name + "：期望 " + c.expect.moves + " 手，实际 " + r.moves.length + " 手");
  } else pass++;
}

console.log("导入语料回归：" + corpus.cases.length + " 例，通过 " + pass + "，失败 " + failed.length);
for (const f of failed.slice(0, 15)) console.log("  ✗ " + f);
if (failed.length > 15) console.log("  …（其余 " + (failed.length - 15) + " 条略）");
process.exit(failed.length ? 1 : 0);
