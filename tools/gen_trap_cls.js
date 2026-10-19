/* 飞刀/骗招离线分类器：调用 js/trapcls-core.js 的同一 classifyOne 实现（P0-3 去重，
 * 不再镜像算法），经 tools/engdrv.js 公共驱动直驱 fairy-stockfish。
 * 产出 tools/_work/trapcls.json，供 T3 文案任务包使用。
 *
 *   node tools/gen_trap_cls.js [--ms 400]
 *
 * 注意：运行时 traps.js 用浏览器内引擎短时搜索（300ms），这里默认 400ms 重算，
 * 结果以本文件为准写入 data/traps/ overlay（前端 overlay 优先于 localStorage 缓存，数字自洽）。 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.dirname(__dirname);
const argv = process.argv.slice(2);
function argVal(name, dflt) {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
const MS = Number(argVal("ms", "400"));

/* ---- 分类核心（与浏览器同一份 trapcls-core.js） ---- */
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "rules.js"), "utf8"), sandbox, { filename: "rules.js" });
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "notation.js"), "utf8"), sandbox, { filename: "notation.js" });
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "trapcls-core.js"), "utf8"), sandbox, { filename: "trapcls-core.js" });
const TrapCls = sandbox.TrapCls;

/* ---- 引擎驱动（tools/engdrv.js，gen_openings/calibrate 同源） ---- */
const eng = require("./engdrv.js");

async function main() {
  await eng.initEngine();
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "index.json"), "utf8"));
  const cat = idx.categories.find(c => c.id === "I");
  const out = {};
  for (const les of cat.lessons) {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, les.file), "utf8"));
    try {
      out[les.id] = await TrapCls.classifyOne(data, (fen, ms, mpv) => eng.search(fen, ms, mpv), { ms: MS });
    } catch (e) {
      out[les.id] = { cls: "未知", loss: null, fall: null, trapPly: null };
      console.warn(les.id + " 分类失败：" + e.message);
    }
    console.log(les.id + " " + les.title + " → " + JSON.stringify(out[les.id]));
    fs.writeFileSync(path.join(ROOT, "tools", "_work", "trapcls.json"), JSON.stringify(out, null, 1), "utf8");
  }
  const okN = Object.values(out).filter(c => c.trapPly).length;
  console.log("完成：检出陷阱点 " + okN + "/" + cat.lessons.length + " 局");
}

main().catch(e => { console.error(e); process.exit(1); });
