/* 脱谱教学着挖掘探针（增量，不动现有谱结构）。
 *
 *   node tools/probe_dev.js <sysId> [--ms 700] [--out tools/_work/probe_<id>.json]
 *
 * 对指定体系主线深度 <14 且未挂 dev 的每个节点，复用 gen_openings.js 的引擎加载
 * 与搜索逻辑做一次 MultiPV=5 搜索，按「第 3 名以后、亏正着 80–350 分、不与该节点
 * 任何 ch 谱着重复」挑出脱谱候选，并对候选着再搜一次惩罚线（与 gen_openings 的
 * pickDev 同源同规则）。只输出报告 JSON，不写 data/openings。
 *
 * 一致性：dev 分差与正着参照全部取自同一次搜索（gen_openings.js 文件头原则）。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.dirname(__dirname);
const OUT_DIR = path.join(ROOT, "data", "openings");
const WORK_DIR = path.join(ROOT, "tools", "_work");

const argv = process.argv.slice(2);
const SYS = argv[0];
function argVal(name, dflt) {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
const MS = Number(argVal("ms", "700"));
const OUT = argVal("out", path.join(WORK_DIR, "probe_" + SYS + ".json"));
const MAX_DEPTH = 13;   // 新规则：ply < 14 才挂 dev（节点深度 0..13）

/* ---------- 规则 + 记谱（与 gen_openings.js 相同方式加载） ---------- */
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "rules.js"), "utf8"), sandbox, { filename: "rules.js" });
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "notation.js"), "utf8"), sandbox, { filename: "notation.js" });
const X = sandbox.window.Xiangqi;
const Notation = sandbox.window.Notation;

/* ---------- 引擎封装（与 gen_openings.js 相同） ---------- */
let sf = null;
let pendingLines = [];
let cur = null;

function toInternal(mv) {
  const m = /^([a-i])(10|[0-9])([a-i])(10|[0-9])$/.exec(mv || "");
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
    } catch (e) { console.warn("NNUE 加载失败，用经典评估：" + e.message); }
  }
  sf.postMessage("isready");
  await waitReady("readyok");
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
        cur.infos.set(k, { mv: moves[0] || null, line: moves, cp, depth });
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
      cands.unshift({ mv: best, line: [best], cp: cands.length ? cands[0].cp : 0, depth: 0 });
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
    cur = { infos: new Map(), res: cands => res(cands.filter(c => ok.has(c.mv))) };
    sf.postMessage("stop");
    setTimeout(() => {
      sf.postMessage("setoption name MultiPV value " + (multipv || 5));
      sf.postMessage("position fen " + fen);
      sf.postMessage("go movetime " + ms);
    }, 60);
  });
}

function applyTo(board, side, mvText) {
  const b = board.map(row => row.slice());
  X.applyMove(b, ...X.parseMove(mvText));
  return { board: b, side: X.other(side) };
}

function pvToCn(board, side, line, maxPlies) {
  const b = board.map(r => r.slice());
  let s = side;
  const out = [];
  for (const mvText of (line || []).slice(0, maxPlies || 4)) {
    let mv;
    try { mv = X.parseMove(mvText); } catch (e) { break; }
    if (!X.isLegal(b, s, mv)) break;
    out.push(Notation.chinese(b, s, mv));
    X.applyMove(b, mv[0], mv[1], mv[2], mv[3]);
    s = X.other(s);
  }
  return out.join(" → ");
}

/* ---------- 主流程 ---------- */
(async () => {
  if (!SYS) { console.error("用法: node tools/probe_dev.js <sysId>"); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(path.join(OUT_DIR, SYS + ".json"), "utf8"));
  const pos0 = X.parseFen(data.fen || X.INIT_FEN);
  await initEngine();

  const report = { sys: SYS, ms: MS, nodes: [] };

  async function probe(node, path, board, side, depth) {
    // 走到 node 着法之后 = deviator 待走的局面
    const mv = X.parseMove(node.m);
    if (!X.isLegal(board, side, mv)) {
      report.nodes.push({ path, error: "谱着非法 " + node.m });
      return;
    }
    const nb = applyTo(board, side, node.m);

    if (depth <= MAX_DEPTH && !(node.dev && node.dev.length)) {
      const fen = X.boardToFen(nb.board, nb.side);
      const cands = await search(fen, MS, 5);
      const chMoves = (node.ch || []).map(c => c.m);
      const exclude = new Set(chMoves);
      const bookMv = chMoves[0] || null;
      const bookC = bookMv ? cands.find(c => c.mv === bookMv) : null;
      const entry = {
        path, depth, fen,
        nodeCn: node.cn || Notation.chinese(board, side, mv),
        bookMv, bookCn: bookC ? Notation.chinese(nb.board, nb.side, X.parseMove(bookMv)) : null,
        ch: chMoves.slice(),
        cands: cands.map((c, i) => ({
          rank: i + 1, mv: c.mv, cp: Math.round(c.cp),
          cn: Notation.chinese(nb.board, nb.side, X.parseMove(c.mv)),
          lineCn: pvToCn(nb.board, nb.side, c.line, 5)
        }))
      };
      if (!bookMv) {
        entry.skip = "无 ch（主线尽头）";
      } else if (!bookC) {
        entry.skip = "正着不在 MultiPV5 内，分差不可靠";
      } else {
        const bookCp = bookC.cp;
        entry.bookCp = Math.round(bookCp);
        const hits = [];
        cands.forEach((c, i) => {
          if (i < 2) return;                       // 第 3 名以后
          if (exclude.has(c.mv)) return;
          const fall = bookCp - c.cp;
          if (fall >= 80 && fall <= 350) hits.push({ rank: i + 1, mv: c.mv, cn: entry.cands[i].cn, fall: Math.round(fall), lineCn: entry.cands[i].lineCn });
        });
        entry.hits = hits;
        if (hits.length) {
          const h = hits[0];   // 与 pickDev 一致：最温和的明确可罚着
          const afterDev = applyTo(nb.board, nb.side, h.mv);
          const pc = await search(X.boardToFen(afterDev.board, afterDev.side), Math.max(400, MS - 200), 3);
          entry.pick = {
            rank: h.rank, mv: h.mv, cn: h.cn, fall: h.fall,
            refLineCn: pvToCn(nb.board, nb.side, bookC.line, 3),
            devLineCn: h.lineCn,
            punishCn: pc.length ? pvToCn(afterDev.board, afterDev.side, pc[0].line, 4) : ""
          };
        }
      }
      report.nodes.push(entry);
    }

    // 只沿主线 ch[0] 下探（与 gen_openings 一致：dev 只挂主线节点，不挂变着子树）
    if (node.ch && node.ch.length) {
      await probe(node.ch[0], path + "/0", nb.board, nb.side, depth + 1);
    }
  }

  for (let i = 0; i < (data.moves || []).length; i++) {
    await probe(data.moves[i], String(i), pos0.board, pos0.side, 0);
  }

  fs.mkdirSync(WORK_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1) + "\n", "utf8");
  const nHit = report.nodes.filter(n => n.pick).length;
  console.log(SYS + "：探测 " + report.nodes.length + " 节点，" + nHit + " 个可用脱谱点 → " + OUT);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
