/* 飞刀/骗招离线分类器：镜像 js/traps.js classifyOne 的算法，用 Node 直驱 fairy-stockfish
 * （gen_openings.js 同款驱动）。产出 tools/_work/trapcls.json，供 T3 文案任务包使用。
 *
 *   node tools/gen_trap_cls.js [--ms 400]
 *
 * 注意：运行时 classifyOne 用的是浏览器内引擎短时搜索（300ms），这里用固定时长重算，
 * 结果以本文件为准写入 data/traps/ overlay（前端 overlay 优先于 localStorage 缓存，数字自洽）。
 */
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

/* ---- 规则 + 记谱 ---- */
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "rules.js"), "utf8"), sandbox, { filename: "rules.js" });
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "notation.js"), "utf8"), sandbox, { filename: "notation.js" });
const X = sandbox.window.Xiangqi;

/* ---- 引擎驱动（gen_openings.js 同款） ---- */
let sf = null, cur = null;
const pendingLines = [];
function toInternal(t) {
  const m = /^([a-i])(10|[1-9])([a-i])(10|[1-9])$/.exec(t);
  if (!m) return null;
  return m[1] + (Number(m[2]) - 1) + m[3] + (Number(m[4]) - 1);
}
async function initEngine() {
  const Stockfish = require(path.join(ROOT, "engine", "stockfish.js"));
  const wasmBinary = fs.readFileSync(path.join(ROOT, "engine", "stockfish.wasm"));
  sf = await Stockfish({ wasmBinary });
  sf.addMessageListener(onLine);
  const waitReady = p => new Promise(res => pendingLines.push({ prefix: p, res }));
  sf.postMessage("uci");
  await waitReady("uciok");
  sf.postMessage("setoption name UCI_Variant value xiangqi");
  sf.postMessage("setoption name Ponder value false");
  const nnue = path.join(ROOT, "engine", "nnue", "xiangqi.nnue");
  if (fs.existsSync(nnue)) {
    try {
      sf.FS.writeFile("/xiangqi.nnue", new Uint8Array(fs.readFileSync(nnue)));
      sf.postMessage("setoption name EvalFile value /xiangqi.nnue");
    } catch (e) { console.warn("NNUE 加载失败：" + e.message); }
  }
  sf.postMessage("isready");
  await waitReady("readyok");
  console.log("引擎就绪");
}
function onLine(line) {
  for (let i = pendingLines.length - 1; i >= 0; i--) {
    if (line.indexOf(pendingLines[i].prefix) === 0) {
      const w = pendingLines[i];
      pendingLines.splice(i, 1);
      w.res(line);
      return;
    }
  }
  if (!cur) return;
  if (line.startsWith("info ") && line.indexOf(" multipv ") >= 0) {
    const depthM = /depth (\d+)/.exec(line);
    const pvM = / multipv (\d+)/.exec(line);
    const cpM = /score cp (-?\d+)/.exec(line);
    const mateM = /score mate (-?\d+)/.exec(line);
    const mvM = / pv ((?:[a-i](?:10|[0-9])[a-i](?:10|[0-9])(?: [a-i](?:10|[0-9])[a-i](?:10|[0-9]))*))/.exec(line);
    if (pvM && mvM) {
      const k = Number(pvM[1]);
      const depth = depthM ? Number(depthM[1]) : 0;
      const prev = cur.infos.get(k);
      if (!prev || depth >= prev.depth) {
        let cp;
        if (mateM) cp = (Number(mateM[1]) > 0 ? 1 : -1) * (100000 - Math.abs(Number(mateM[1])));
        else cp = cpM ? Number(cpM[1]) : 0;
        const moves = mvM[1].split(" ").map(toInternal).filter(Boolean);
        cur.infos.set(k, { mv: moves[0] || null, cp, depth });
        if (depth > cur.maxDepth) cur.maxDepth = depth;
      }
    }
    return;
  }
  if (line.startsWith("bestmove")) {
    const c = cur;
    cur = null;
    const m = /bestmove ([a-i](?:10|[0-9])[a-i](?:10|[0-9]))/.exec(line);
    const best = m ? toInternal(m[1]) : null;
    const cands = Array.from(c.infos.values()).filter(x => x.mv).sort((a, b) => b.cp - a.cp);
    if (best && !cands.some(x => x.mv === best)) {
      cands.unshift({ mv: best, cp: cands.length ? cands[0].cp : 0, depth: c.maxDepth });
    }
    c.res(cands);
  }
}
function legalSet(fen) {
  const pos = X.parseFen(fen);
  const set = new Set();
  for (const mv of X.legalMoves(pos.board, pos.side)) set.add(X.moveToText(mv));
  return set;
}
function search(fen, ms, multipv) {
  return new Promise(res => {
    const ok = legalSet(fen);
    cur = { infos: new Map(), maxDepth: 0, res: cands => res(cands.filter(c => ok.has(c.mv))) };
    sf.postMessage("stop");
    setTimeout(() => {
      sf.postMessage("setoption name MultiPV value " + (multipv || 1));
      sf.postMessage("position fen " + fen);
      sf.postMessage("go movetime " + ms);
    }, 50);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- 镜像 traps.js classifyOne ---- */
async function classifyOne(data) {
  const line = [];
  let nodes = data.moves || [];
  while (nodes.length && line.length < 22) { line.push(nodes[0]); nodes = nodes[0].ch || []; }
  if (line.length < 4) return { cls: "未知", loss: null, fall: null, trapPly: null };

  function posAt(i) {
    const { board, side } = X.parseFen(data.fen);
    let s = side;
    for (let j = 0; j < i; j++) { X.applyMove(board, ...X.parseMove(line[j].m)); s = X.other(s); }
    return { board, side: s };
  }

  for (let j = 1; j + 1 < line.length && j <= 21; j++) {
    const p1 = posAt(j);
    const fen1 = X.boardToFen(p1.board, p1.side);
    let cands = await search(fen1, MS, 4);
    if (!cands.length) { await sleep(300); cands = await search(fen1, MS * 2, 4); }
    if (!cands.length) break;
    const actual = cands.find(c => c.mv === line[j].m);
    let oppValue;
    if (actual) oppValue = actual.cp;
    else {
      const b2 = X.cloneBoard(p1.board);
      X.applyMove(b2, ...X.parseMove(line[j].m));
      const e = await search(X.boardToFen(b2, X.other(p1.side)), MS, 1);
      if (!e.length) break;
      oppValue = -e[0].cp;
    }
    const fall = cands[0].cp - oppValue;
    if (fall < 150) continue;

    const p0 = posAt(j - 1);
    const cands0 = await search(X.boardToFen(p0.board, p0.side), MS, 4);
    if (!cands0.length) break;
    const b3 = X.cloneBoard(p1.board);
    X.applyMove(b3, ...X.parseMove(cands[0].mv));
    const decline = await search(X.boardToFen(b3, X.other(p1.side)), MS, 1);
    if (!decline.length) break;
    const loss = Math.max(0, cands0[0].cp - decline[0].cp);   // decline[0].cp：陷阱方视角
    const cls = loss < 60 ? "飞刀" : loss > 150 ? "骗招" : "险招";
    return { cls, loss: Math.round(loss), fall: Math.round(fall), trapPly: j, declineMv: cands[0].mv };
  }
  return { cls: "未知", loss: null, fall: null, trapPly: null };
}

async function main() {
  await initEngine();
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "index.json"), "utf8"));
  const cat = idx.categories.find(c => c.id === "I");
  const out = {};
  for (const les of cat.lessons) {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, les.file), "utf8"));
    try {
      out[les.id] = await classifyOne(data);
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
