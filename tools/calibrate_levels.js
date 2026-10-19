/* 八档难度引擎自弈标定（P0-2）：
 *   node tools/calibrate_levels.js [--games 4] [--cap 120]
 *
 * 方法：相邻档两两对打（0v1 … 6v7）外加 0v7 书挡校验，双方红黑各半；
 * 选着策略与运行时完全同源（js/duel-core.js 的 LEVELS/bookMove/pickMove——
 * 本工具即是对 duel-core 的真机浸泡测试）。对局上限 --cap 手，未分胜负时
 * 引擎 300ms 评估裁决（|红方视角|≥150 判胜负，否则和棋）。
 * 输出：每对比分 + 按 logistic 链推的各档 Elo 估计（特大锚定 2200 的相对刻度），
 * 报告写 tools/_work/calib_report.json；人工把结果回填 duel-core.js LEVELS 的 elo 字段。
 * 局数越多越稳：细调建议 --games 12；快速验证 --games 2。 */
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
const GAMES = Number(argVal("games", "4"));    // 每对局数（红黑各半）
const CAP = Number(argVal("cap", "120"));      // 单局手数上限，超出裁决

/* 规则 + 对弈核心（与浏览器同一份） */
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "rules.js"), "utf8"), sandbox, { filename: "rules.js" });
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "notation.js"), "utf8"), sandbox, { filename: "notation.js" });
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "duel-core.js"), "utf8"), sandbox, { filename: "duel-core.js" });
const X = sandbox.window.Xiangqi;
const D = sandbox.window.DuelCore;
const LEVELS = D.LEVELS;

const eng = require("./engdrv.js");

/* 一局：redIdx 执红、blackIdx 执黑，返回 {winner:"r"|"b"|"draw", reason, plies} */
async function playGame(redIdx, blackIdx) {
  const st = D.newGame();
  const lvlOf = side => LEVELS[side === "r" ? redIdx : blackIdx];
  for (let ply = 0; ply < CAP; ply++) {
    const lvl = lvlOf(st.side);
    const legal = D.legalTexts(st);
    let mvText = null;
    if (lvl.pick === "randomLegal") {
      mvText = legal[Math.floor(Math.random() * legal.length)];
    } else {
      mvText = D.bookMove(lvl, st.moves.map(m => m.m).join(" "), legal);
      if (!mvText) {
        const fen = X.boardToFen(st.board, st.side);
        let cands = await eng.search(fen, lvl.time, lvl.pv || 4);
        if (!cands.length) cands = await eng.search(fen, lvl.time * 2, lvl.pv || 4);
        if (!cands.length) return { winner: "draw", reason: "no-candidates", plies: ply };
        mvText = D.pickMove(cands, lvl, legal);
      }
    }
    D.applyMove(st, X.parseMove(mvText));
    const e = D.endOf(st);
    if (e) return { winner: e.winner, reason: e.reason, plies: ply + 1 };
  }
  // 裁决：300ms 评估，|红方视角| ≥150 判胜，否则和
  const fen = X.boardToFen(st.board, st.side);
  const cands = await eng.search(fen, 300, 1);
  const red = st.side === "r" ? (cands[0] ? cands[0].cp : 0) : -(cands[0] ? cands[0].cp : 0);
  return {
    winner: red >= 150 ? "r" : red <= -150 ? "b" : "draw",
    reason: "adjudicated(" + Math.round(red) + ")",
    plies: CAP
  };
}

/* 一对多局（lj 为高档）：红黑各半，返回 {hi: 高档得分(胜1和0.5), n, results:[]} */
async function playPair(li, lj) {
  let hiScore = 0;
  const results = [];
  for (let g = 0; g < GAMES; g++) {
    const highIsRed = g % 2 === 0;                 // 红黑各半；首局高档执红
    const r = highIsRed ? playGame(lj, li) : playGame(li, lj);
    const rr = await r;
    hiScore += rr.winner === "draw" ? 0.5 : (rr.winner === "r") === highIsRed ? 1 : 0;
    results.push(rr);
    process.stdout.write("  " + LEVELS[li].name + "v" + LEVELS[lj].name +
      " #" + (g + 1) + " " + rr.winner + " (" + rr.plies + "手 " + rr.reason + ")\n");
  }
  return { hi: hiScore, n: GAMES, results };
}

(async function main() {
  console.log("八档难度自弈标定：相邻 7 对 + 0v7 书挡，每对 " + GAMES + " 局，单局上限 " + CAP + " 手");
  await eng.initEngine();

  const pairs = [];
  for (let i = 0; i < LEVELS.length - 1; i++) pairs.push([i, i + 1]);
  pairs.push([0, LEVELS.length - 1]);

  const report = { date: new Date().toISOString(), gamesPerPair: GAMES, cap: CAP, pairs: {} };
  const adjScore = {};   // "i-j" -> hi score
  for (const [li, lj] of pairs) {
    console.log("对打：" + LEVELS[li].name + "(" + li + ") vs " + LEVELS[lj].name + "(" + lj + ")");
    const r = await playPair(li, lj);
    adjScore[li + "-" + lj] = r.hi;
    report.pairs[li + "-" + lj] = r;
  }

  /* Elo 链：特大锚 2200（相对刻度）；d_k = 400·log10(s/(1-s))，s 经 +0.5 平滑防全胜发散 */
  const elo = new Array(LEVELS.length);
  elo[LEVELS.length - 1] = 2200;
  for (let i = LEVELS.length - 2; i >= 0; i--) {
    const s = (adjScore[i + "-" + (i + 1)] + 0.5) / (GAMES + 1);
    const d = 400 * Math.log10(s / (1 - s));
    elo[i] = Math.round(elo[i + 1] - d);
  }
  report.elo = elo;

  console.log("\n===== 标定结果 =====");
  let mono = true;
  for (let i = 0; i < LEVELS.length; i++) {
    const s = adjScore[i + "-" + (i + 1)];
    console.log("  " + i + " " + LEVELS[i].name + "  ≈Elo " + elo[i] +
      (i < LEVELS.length - 1 ? "   （对上一档 " + LEVELS[i + 1].name + "：" + s + "/" + GAMES + "）" : "   （锚定）"));
    if (i > 0 && elo[i] <= elo[i - 1]) mono = false;
  }
  const b07 = adjScore["0-" + (LEVELS.length - 1)];
  console.log("  书挡校验：学前 vs 特大 高档得分 " + b07 + "/" + GAMES);
  console.log(mono ? "  单调性：八档 Elo 严格递增 ✓" : "  单调性：存在倒挂 ✗（需调参重标）");
  report.monotonic = mono;

  const outDir = path.join(ROOT, "tools", "_work");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "calib_report.json"), JSON.stringify(report, null, 1), "utf8");
  console.log("报告已写 tools/_work/calib_report.json");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
