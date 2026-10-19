/* Node 直驱 fairy-stockfish 的公共封装（gen_trap_cls.js / calibrate_levels.js 共用，
 * 不再各自复制一份驱动）。
 *   const eng = require("./engdrv.js");
 *   await eng.initEngine();                        // NNUE 存在则自动加载
 *   const cands = await eng.search(fen, ms, pv);   // [{mv, cp, depth}] 按 cp 降序、
 *                                                  // 已过滤为该局面合法着（内部坐标 a-i/0-9）
 * 引擎坐标输出 rank 1-10，这里已换算为内部 0-9。 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.dirname(__dirname);

/* 规则引擎（着法合法性过滤用） */
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "rules.js"), "utf8"), sandbox, { filename: "rules.js" });
const X = sandbox.window.Xiangqi;

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
  return true;
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

module.exports = { initEngine, search };
