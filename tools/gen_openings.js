/* 开局谱引擎生成器（Node + fairy-stockfish WASM）。
 *
 *   node tools/gen_openings.js            # 生成全部体系
 *   node tools/gen_openings.js --only cp-pfm
 *   node tools/gen_openings.js --ms 800   # 每步搜索时长
 *
 * 分工原则（重要）：
 *   着法（m）—— 全部来自引擎：种子=体系定式骨架（开局的「名字」，引擎逐着验伤），
 *               此后主线=MultiPV 首选，变着=≤45 分的次选，脱谱着=亏 80-350 分的候选。
 *   讲解文字 —— dev 的 why/punish 为引擎实况桩文（分差/正着/惩罚线均来自引擎），
 *               可由人工/LLM 再润色（不得改着法）；节点评注 c 留空待补。
 *               最后 python tools/build_openings.py 补全 cn 并重建 index。
 *
 * 一致性原则（重要）：同一节点的「谱着 ch」与「脱谱 dev」必须出自同一次 MultiPV 搜索，
 * 否则两次评估抖动会把谱着当脱谱（曾把平炮兑车当脱谱着）。
 *
 * 树约定（与 js/opening.js 一致）：
 *   ch[0] 主线续着，ch[1..] 变着（同一分岔点的兄弟）；节点路径 id = 下标路径 "0/2/1"。
 *   节点 dev[] = 该节点之后对方的脱谱着；根 dev = 先手方第一手前的脱谱着。
 *
 * 输出：
 *   data/openings/<id>.json      谱骨架（cn 由 build_openings.py 自动补全）
 *   tools/_eng/<id>.eng.json     每节点引擎上下文（cp/主线/脱谱分差），供润色讲解
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.dirname(__dirname);
const OUT_DIR = path.join(ROOT, "data", "openings");
const ENG_DIR = path.join(ROOT, "tools", "_eng");

const argv = process.argv.slice(2);
function argVal(name, dflt) {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
const ONLY = argVal("only", null);
const MS = Number(argVal("ms", "700"));
const SEED_MS = Number(argVal("seedms", "500"));

/* ---------- 规则 + 记谱（js/rules.js, js/notation.js） ---------- */
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "rules.js"), "utf8"), sandbox, { filename: "rules.js" });
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "notation.js"), "utf8"), sandbox, { filename: "notation.js" });
const X = sandbox.window.Xiangqi;
const Notation = sandbox.window.Notation;

/* ---------- 体系配置：种子=定式骨架（体系的定义），其后引擎展开 ----------
 * 种子坐标对应的经典记谱见各行注释。 */
const SYSTEMS = [
  {
    id: "cp-pfm", name: "中炮过河车对屏风马", redOpening: "当头炮", blackDefense: "屏风马",
    level: "入门", endPly: 20,
    intro: "红方当头炮过河车压迫黑方左马，黑方双正马（屏风马）稳固应对——最经典的攻防体系，学稳它就能应付大多数中炮局。",
    // 炮二平五 马8进7 马二进三 车9平8 车一平二 卒7进1 车二进六 马2进3
    seed: ["h2e2", "h9g7", "h0g2", "i9h9", "i0h0", "g6g5", "h0h6", "b9c7"],
  },
  {
    id: "cp-fgm", name: "中炮对反宫马", redOpening: "当头炮", blackDefense: "反宫马",
    level: "入门", endPly: 20,
    intro: "黑方双马夹炮（仕角炮）构成反宫马，弹性防御伺机反击。红方按中炮出子原则稳步推进，黑方阵型紧凑不轻易露破绽。",
    // 炮二平五 马2进3 马二进三 炮8平6 车一平二 马8进7
    seed: ["h2e2", "b9c7", "h0g2", "h7f7", "i0h0", "h9g7"],
  },
  {
    id: "cp-spo", name: "顺炮直车对横车", redOpening: "当头炮", blackDefense: "顺炮",
    level: "进阶", endPly: 20,
    intro: "双方同架中炮对攻，红出直车、黑起横车争肋道。刀刃上的平衡：一着不慎立刻失先，练的是中炮局的对攻节奏。",
    // 炮二平五 炮8平5 马二进三 马8进7 车一平二 车9进1
    seed: ["h2e2", "h7e7", "h0g2", "h9g7", "i0h0", "i9i8"],
  },
  {
    id: "xz-zdc", name: "仙人指路对卒底炮", redOpening: "仙人指路", blackDefense: "卒底炮",
    level: "入门", endPly: 20,
    intro: "红先挺七兵试探应手，黑以卒底炮（炮2平3）瞄准红七路反击。柔性开局转成尖锐对抗的关键路口，应着必须熟。",
    // 兵七进一 炮2平3 炮二平五 象3进5 马二进三
    seed: ["c3c4", "b7c7", "h2e2", "c9e7", "h0g2"],
  },
  {
    id: "xz-dbj", name: "仙人指路对兵局", redOpening: "仙人指路", blackDefense: "对兵局",
    level: "入门", endPly: 20,
    intro: "黑方针锋相对挺卒对兵，局面平稳、较量内功。红方稳步出子布阵，黑方对等展开——练的是不冒进的布阵能力。",
    // 兵七进一 卒7进1 炮二平五 马8进7 马二进三
    seed: ["c3c4", "g6g5", "h2e2", "h9g7", "h0g2"],
  },
  {
    id: "fx-zp", name: "飞相局对中炮", redOpening: "飞相局", blackDefense: "中炮",
    level: "入门", endPly: 20,
    intro: "红先飞相立足防守再徐图进取，黑方架中炮争取主动。稳健型布局的代表：先把阵型走厚，再谈反击。",
    // 相三进五 炮8平5 马二进三 马8进7 车一平二
    seed: ["g0e2", "h7e7", "h0g2", "h9g7", "i0h0"],
  },
  {
    id: "qm-zp", name: "起马局对中炮", redOpening: "起马局", blackDefense: "中炮",
    level: "进阶", endPly: 20,
    intro: "红方先跳正马保留阵型选择权，黑方当机立断架中炮。红方以柔克刚，黑方力求直接——应法选择多，理解原则比死记更重要。",
    // 马二进三 炮8平5 兵三进一 马8进7
    seed: ["h0g2", "h7e7", "g3g4", "h9g7"],
  },
  {
    id: "gg-zp", name: "过宫炮对中炮", redOpening: "过宫炮", blackDefense: "中炮",
    level: "进阶", endPly: 20,
    intro: "红方炮二平六集中子力于一翼（过宫炮），黑方中炮正面还击。冷门但实用：对手不熟就容易出错，熟了才能惩罚你的阵型弱点。",
    // 炮二平六 炮8平5 马二进三 马8进7 兵七进一
    seed: ["h2d2", "h7e7", "h0g2", "h9g7", "c3c4"],
  },
];

/* ---------- 引擎封装（fairy-stockfish WASM，单实例串行） ---------- */
let sf = null;
let pendingLines = [];
let cur = null;   // { res, infos: Map, maxDepth }

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
  console.log("引擎就绪（NNUE " + (fs.existsSync(nnue) ? "已加载" : "缺省") + "）");
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
    const cands = Array.from(c.infos.values())
      .filter(x => x.mv)
      .sort((a, b) => b.cp - a.cp);
    if (best && !cands.some(x => x.mv === best)) {
      cands.unshift({ mv: best, line: [best], cp: cands.length ? cands[0].cp : 0, depth: c.maxDepth });
    }
    c.res(cands);
  }
}

/* 残留 info 行可能串台，用规则引擎过滤本局面合法着 */
function legalSet(fen) {
  const pos = X.parseFen(fen);
  const set = new Set();
  for (const mv of X.legalMoves(pos.board, pos.side)) set.add(X.moveToText(mv));
  return set;
}

function search(fen, ms, multipv) {
  return new Promise(res => {
    const ok = legalSet(fen);
    cur = {
      infos: new Map(), maxDepth: 0,
      res: cands => res(cands.filter(c => ok.has(c.mv)))
    };
    sf.postMessage("stop");
    setTimeout(() => {
      sf.postMessage("setoption name MultiPV value " + (multipv || 5));
      sf.postMessage("position fen " + fen);
      sf.postMessage("go movetime " + ms);
    }, 60);
  });
}

/* ---------- 工具 ---------- */
function applyTo(board, side, mvText) {
  const b = board.map(row => row.slice());
  X.applyMove(b, ...X.parseMove(mvText));
  return { board: b, side: X.other(side) };
}

/* 引擎主线 → 中文着法序列 */
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

function countNodes(ns) {
  let n = 0;
  (ns || []).forEach(x => { n += 1 + countNodes(x.ch); });
  return n;
}

function cleanIds(ns) {
  (ns || []).forEach(n => { delete n._id; cleanIds(n.ch); });
}

/* 安全网：dev 不得与同节点任何谱着分支相同（搜索抖动兜底） */
function stripDevCollide(ns) {
  let dropped = 0;
  for (const n of ns || []) {
    if (n.dev && n.dev.length) {
      const excl = new Set((n.ch || []).map(c => c.m));
      const keep = n.dev.filter(d => !excl.has(d.m));
      dropped += n.dev.length - keep.length;
      if (keep.length) n.dev = keep; else delete n.dev;
    }
    dropped += stripDevCollide(n.ch);
  }
  return dropped;
}

/* ---------- 树构建 ----------
 * parentArr = 当前分岔点的孩子数组（主线节点永远先 push → 下标 0 → id 以 /0 结尾）。
 * 变着作为兄弟后 push → 下标 1 → id 以 /1 结尾，与 opening.js bookIdFor 对齐。
 * 上一节点的 dev 在下一轮搜索后才落笔，保证与 ch 同源。 */
async function buildSystem(cfg) {
  const fen0 = cfg.fen || X.INIT_FEN;
  const pos0 = X.parseFen(fen0);
  const eng = {};
  const warn = [];
  let devBudget = 4;   // 每体系最多 4 个教学脱谱着（与 data 现行密度一致）

  /* 脱谱候选：只取 MultiPV 第 3 名以后、亏 [fallMin,350] 分者——
   * 第 2 名多半只是同级正变（如平炮兑车、调整移序），当「脱谱」教是误人子弟。
   * 分差与「正着」一律以本谱着（bookMv/bookCp）为参照——种子段谱着未必是引擎首选，
   * 写「正着本是引擎X」会跟谱面自相矛盾。
   * exclude = 本节点谱着集合；返回 null 或 {entry, meta}。 */
  async function pickDev(cands, boardAt, sideAt, exclude, fallMin, bookMv, bookCp) {
    if (!cands || cands.length < 3) return null;
    let hit = null;
    for (const c of cands.slice(2)) {
      const fall = bookCp - c.cp;
      if (exclude.has(c.mv)) continue;
      if (fall >= fallMin && fall <= 350) { hit = { c, fall }; break; }   // 最温和的「明确可罚」着
    }
    if (!hit) return null;
    const inC = cands.find(c => c.mv === bookMv);
    const refCn = inC ? pvToCn(boardAt, sideAt, inC.line, 3) : pvToCn(boardAt, sideAt, [bookMv], 1);
    const afterDev = applyTo(boardAt, sideAt, hit.c.mv);
    const pc = await search(X.boardToFen(afterDev.board, afterDev.side), Math.max(400, MS - 200), 3);
    const punishCn = pc.length ? pvToCn(afterDev.board, afterDev.side, pc[0].line, 4) : "";
    const sev = hit.fall < 60 ? "接近等价的小变着" : hit.fall <= 150 ? "明显亏损" : "严重亏损";
    return {
      entry: {
        m: hit.c.mv,
        why: "脱谱着：比正着差约 " + Math.round(hit.fall) + " 分（" + sev + "）" +
          (refCn ? "；正着本是 " + refCn + "。" : "。"),
        punish: "惩罚思路：不跟对方节奏走，" +
          (punishCn ? "按 " + punishCn + " 展开" : "尽快出子占据要道") + "，利用对方失先扩大优势。"
      },
      meta: {
        note: "脱谱", fall: Math.round(hit.fall), best: cands[0].mv, book: bookMv,
        refLine: inC ? inC.line.slice(0, 5) : [bookMv], devLine: hit.c.line.slice(0, 5), refCn, punishCn
      }
    };
  }

  const rootMoves = [];
  let parentArr = rootMoves, parentId = "";   // 种子链的挂点（首节点 id "0"）
  let pending = null;   // { node, id } 上一节点，dev 待下一轮同源搜索后挂
  let branchBudget = 2;
  let lastBranchPly = -99;

  for (let ply = 0; ply < cfg.endPly; ply++) {
    const board = curBoard, side = curSide;
    const fen = X.boardToFen(board, side);
    const forced = ply < cfg.seed.length ? cfg.seed[ply] : null;
    const cands = await search(fen, forced ? SEED_MS : MS, 5);
    if (!cands.length) { warn.push({ ply: ply + 1, note: "引擎无候选，截断主线" }); break; }

    /* 本手谱着 */
    let mv, actualCp, bestCp, loss, note;
    if (forced) {
      mv = forced;
      const actual = cands.find(c => c.mv === forced);
      actualCp = actual ? actual.cp : null;
      if (actualCp === null) {
        const nb = applyTo(board, side, forced);
        const e2 = await search(X.boardToFen(nb.board, nb.side), 250, 1);
        actualCp = e2.length ? -e2[0].cp : 0;
      }
      bestCp = cands.length ? cands[0].cp : actualCp;
      loss = Math.max(0, bestCp - actualCp);
      note = "种子";
      if (loss > 80) {
        warn.push({
          ply: ply + 1, mv, loss: Math.round(loss),
          best: cands.length ? cands[0].mv : null,
          note: "种子着亏 " + Math.round(loss) + " 分（引擎首选 " + (cands[0] ? cands[0].mv : "?") + "）"
        });
      }
    } else {
      mv = cands[0].mv;
      actualCp = bestCp = cands[0].cp;
      loss = 0;
      note = "主线";
    }

    const id = parentId ? parentId + "/0" : String(parentArr.length);
    const node = { m: mv, ch: [], _id: id };
    eng[id] = {
      note, cp: Math.round(actualCp), bestCp: Math.round(bestCp), loss: Math.round(loss),
      best: cands[0] ? cands[0].mv : null,
      line: cands[0] ? cands[0].line.slice(0, 5) : null
    };
    parentArr.push(node);

    /* 变着：≤45 分次选，与主线同层（兄弟），间隔 ≥3 ply，最多 2 个（仅引擎段） */
    let variantMv = null;
    if (!forced && branchBudget > 0 && ply - lastBranchPly >= 3) {
      const alt = cands[1];
      if (alt && alt.mv !== mv && cands[0].cp - alt.cp <= 45) {
        const bid = parentId ? parentId + "/1" : String(parentArr.length);
        const bnode = { m: alt.mv, ch: [], _id: bid };
        eng[bid] = {
          note: "变着", cp: alt.cp, bestCp: cands[0].cp, loss: Math.round(cands[0].cp - alt.cp),
          best: mv, line: alt.line.slice(0, 5)
        };
        parentArr.push(bnode);
        variantMv = alt.mv;
        // 变着延伸：双方引擎首选，5 ply
        let bb = applyTo(board, side, alt.mv), cur2 = bnode, pid = bid;
        for (let d = 0; d < 5; d++) {
          const c2 = await search(X.boardToFen(bb.board, bb.side), Math.max(350, MS - 200), 3);
          if (!c2.length) break;
          const nid = pid + "/0";
          const nn = { m: c2[0].mv, ch: [], _id: nid };
          eng[nid] = { note: "变着延伸", cp: c2[0].cp, best: c2[0].mv };
          cur2.ch.push(nn);
          bb = applyTo(bb.board, bb.side, c2[0].mv);
          cur2 = nn; pid = nid;
        }
        branchBudget--;
        lastBranchPly = ply;
      }
    }

    /* 关闭上一节点的 dev：与本手谱着/变着同源，天然不撞 ch。
     * 参照着=本手谱着（pending 的 ch[0]），分差对它计算。 */
    if (pending) {
      const excl = new Set([mv, variantMv].filter(Boolean));
      const dv = await pickDev(cands, board, side, excl, 80, mv, actualCp);
      if (dv) {
        pending.node.dev = [dv.entry];
        eng[pending.id + ".dev0"] = dv.meta;
        devBudget--;
      }
      pending = null;
    }

    /* 根脱谱不自动生成：引擎分不出「主流另路开局」与「脱谱」
     * （把仙人指路/当头炮标成首着脱谱是误人子弟）。运行时 pickDeviation 用引擎候选兜底。 */

    const nb = applyTo(board, side, mv);
    curBoard = nb.board; curSide = nb.side;
    parentArr = node.ch; parentId = id;
    if (devBudget > 0 && ply < 14) pending = { node, id };
  }

  const dropped = stripDevCollide(rootMoves);
  if (dropped) warn.push({ ply: 0, note: "安全网剔除撞车 dev " + dropped + " 条" });
  cleanIds(rootMoves);

  const data = {
    id: cfg.id, name: cfg.name,
    redOpening: cfg.redOpening, blackDefense: cfg.blackDefense,
    fen: fen0, mainlineEndPly: cfg.endPly,
    intro: cfg.intro, level: cfg.level,
    moves: rootMoves,
  };
  return { data, eng, warn };
}

/* ---------- 主流程 ---------- */
let curBoard = null, curSide = null;

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(ENG_DIR, { recursive: true });
  await initEngine();

  const list = SYSTEMS.filter(s => !ONLY || s.id === ONLY);
  const allWarn = [];
  for (const cfg of list) {
    const pos0 = X.parseFen(cfg.fen || X.INIT_FEN);
    curBoard = pos0.board; curSide = pos0.side;
    process.stdout.write("生成 " + cfg.id + " … ");
    const t0 = Date.now();
    const { data, eng, warn } = await buildSystem(cfg);
    fs.writeFileSync(path.join(OUT_DIR, cfg.id + ".json"), JSON.stringify(data, null, 1) + "\n", "utf8");
    fs.writeFileSync(path.join(ENG_DIR, cfg.id + ".eng.json"), JSON.stringify(eng, null, 1) + "\n", "utf8");
    console.log("ok，" + countNodes(data.moves) + " 节点，" + Math.round((Date.now() - t0) / 1000) + "s" +
      (warn.length ? "，⚠ " + warn.length + " 条警告" : ""));
    for (const w of warn) console.log("   ⚠ ply " + w.ply + " " + (w.mv || "") + " " + w.note);
    allWarn.push(...warn.map(w => Object.assign({ id: cfg.id }, w)));
  }
  if (allWarn.length) {
    fs.writeFileSync(path.join(ENG_DIR, "_warnings.json"), JSON.stringify(allWarn, null, 1) + "\n", "utf8");
    console.log("\n共 " + allWarn.length + " 条警告 → tools/_eng/_warnings.json");
  }
  console.log("完成。下一步：python tools/build_openings.py（补 cn + 重建 index）");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
