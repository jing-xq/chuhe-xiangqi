/* 对弈状态机核心（P1-1 去重）：play.js 人机对弈与 spar.js 私教陪练此前各持一份
 * 复制改写的状态机（LEVELS/BOOK/走子/终局/悔棋/重放/按档选着），改一处漏一处。
 * 本文件抽出两人共用的纯状态机：无 DOM、无引擎、无音效——副作用由调用方视图层处理。
 * tools/calibrate_levels.js 引擎自弈标定亦复用本文件（LEVELS / 选着策略唯一出处，
 * 标定结果写回 LEVELS 的 elo 字段与注释）。
 * 全局对象：DuelCore
 *   DuelCore.LEVELS / BOOK / START_FEN
 *   DuelCore.newGame() -> {board, side, moves:[], rep:[]}        纯状态片段（视图层再扩展字段）
 *   DuelCore.applyMove(st, mv) -> node                            走子并推进 rep；node 含 m/cn/side/chk/captured/mate
 *   DuelCore.endOf(st) -> null | {winner:"r"|"b"|"draw", reason}  终局判定（重复局面/将死/困毙）
 *   DuelCore.undoPlies(st, n)                                     弹掉 n 手并从头重放（rep 一并重建）
 *   DuelCore.boardAt(st, ply|null) -> {board, side, lastMove}     浏览历史局面（null=最新）
 *   DuelCore.legalTexts(st) -> [着法文本]                          当前局面全部合法着
 *   DuelCore.bookMove(lvl, bookKey, legalTexts) -> 着法|null       开局库按档概率选着（运行时校验合法性）
 *   DuelCore.pickMove(cands, lvl, legalTexts) -> 着法              名次概率选着 + 随机漏着注入 */
(function () {
  "use strict";

  const X = window.Xiangqi;
  const START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";

  /* 职业分段难度（八档，play/spar/标定共用）：
   * time = 引擎思考时间(ms)；pv = MultiPV 候选数；
   * ranks = 选到第 1..pv 名的相对概率（名次越靠后越是缓手/错着，低级别更容易选到）；
   * rand = 每手走出"业余随手棋"的概率（从全部合法着里随机，可能送子、漏看将军）；
   * elo = 引擎自弈标定的相对棋力估计（2026-10-02，--games 4 --cap 120，相邻档对打
   *        logistic 链推、特大锚定 2200 的相对刻度——绝对值不代表真实人机棋力差；
   *        大师/特大 4 局全和属同档噪声，细化重跑 node tools/calibrate_levels.js --games 12，
   *        完整报告 tools/_work/calib_report.json）。
   * 只有让低级别真的犯错，难度才区分得开——只在前几名好棋之间加噪声等于没降棋力。 */
  const LEVELS = [
    { name: "学前", time: 0,    pick: "randomLegal", elo: 190, desc: "刚学会规则的棋友水平，走子没有章法——适合人生第一盘" },
    { name: "业1",  time: 250,  pv: 8, ranks: [12, 12, 12, 12, 12, 12, 12, 12], rand: 0.18, book: 0.5, elo: 570, desc: "知道规则，但经常丢子、漏看将军，一步大亏很常见" },
    { name: "业3",  time: 300,  pv: 8, ranks: [38, 22, 14, 9, 6, 4, 3, 4],      rand: 0.07, book: 0.75, elo: 950, desc: "社区初级水平：大子看不住会送，偶尔走出随手棋" },
    { name: "业5",  time: 450,  pv: 8, ranks: [52, 25, 11, 5, 3, 2, 1, 1],      rand: 0.025, book: 0.9, elo: 1340, desc: "业余中坚：开局熟练，中局偶有方向性错误，偶尔丢子" },
    { name: "业7",  time: 600,  pv: 6, ranks: [68, 20, 8, 2, 1, 1],             rand: 0.01, elo: 1720, desc: "业余高手：攻防有章法，抓机会能力很强" },
    { name: "业9",  time: 800,  pv: 5, ranks: [82, 12, 4, 1, 1],                rand: 0, elo: 1960, desc: "准专业水平：计算精准，盘面破绽很少" },
    { name: "大师", time: 1200, pv: 4, ranks: [94, 5, 1, 0],                    rand: 0, elo: 2200, desc: "职业大师：几乎不走坏棋，先求稳再求胜" },
    { name: "特大", time: 1800, pick: "best", elo: 2200, desc: "特级大师全力模式，象棋的天花板" }
  ];

  /* 对手开局库（坐标着法，运行时校验合法性）：让低难度对手的开局有真人味道。
   * key = 当前着法序列（空格分隔），value = 可选应着。 */
  const BOOK = {
    "": ["h2e2", "c3c4", "g0e2", "b0c2"],
    "h2e2": ["h9g7", "b9c7", "h7e7", "g6g5"],
    "h2e2 h9g7": ["b0c2", "h0g2"],
    "h2e2 h9g7 b0c2": ["g6g5", "b9c7"],
    "h2e2 h9g7 b0c2 g6g5": ["a0b0", "c3c4"],
    "h2e2 h9g7 b0c2 g6g5 a0b0": ["b9c7", "c9e7"],
    "h2e2 h9g7 b0c2 g6g5 a0b0 b9c7": ["c3c4", "h0g2"],
    "h2e2 h9g7 b0c2 g6g5 c3c4": ["b9c7", "g9e7"],
    "h2e2 b9c7": ["b0c2", "h0g2"],
    "h2e2 b9c7 b0c2": ["g6g5", "c6c5"],
    "h2e2 h7e7": ["b0c2", "h0g2"],
    "h2e2 h7e7 b0c2": ["h9g7", "b9c7"],
    "h2e2 g6g5": ["b0c2", "h0g2"],
    "c3c4": ["h7e7", "g6g5", "h9g7"],
    "c3c4 h7e7": ["b0c2", "h0g2"],
    "c3c4 g6g5": ["b0c2", "g0e2"],
    "g0e2": ["h9g7", "b9c7", "c6c5"],
    "g0e2 h9g7": ["b0c2", "h0g2"],
    "b0c2": ["g6g5", "h9g7"],
    "b0c2 g6g5": ["h0g2", "g0e2"]
  };

  function newGame() {
    const { board, side } = X.parseFen(START_FEN);
    return {
      board, side,
      moves: [],            // [{m, cn, side, chk}]
      rep: [{ key: X.boardToFen(board, side), check: false, side: null }]   // 重复局面判定历史
    };
  }

  /* 走子：推进 board/side/moves/rep；返回该手节点（附加 captured/mate 供调用方配音效） */
  function applyMove(st, mv) {
    const cn = Notation.chinese(st.board, st.side, mv);
    const mover = st.side;
    const captured = X.applyMove(st.board, mv[0], mv[1], mv[2], mv[3]);
    const gaveCheck = X.isCheck(st.board, X.other(st.side));
    const mate = X.isCheckmate(st.board, X.other(st.side));
    const node = { m: X.moveToText(mv), cn, side: mover, chk: gaveCheck, captured, mate };
    st.moves.push(node);
    st.side = X.other(st.side);
    st.rep.push({ key: X.boardToFen(st.board, st.side), check: gaveCheck, side: mover });
    st.browsing = null;
    return node;
  }

  /* 终局判定（纯规则，不带用户视角）：null=继续；
   * 三次重复局面长将方判负（双方长将/长捉按和）；无子可动=将死或困毙判负 */
  function endOf(st) {
    const rep = X.repetitionResult(st.rep);
    if (rep) {
      if (rep.result === "draw") return { winner: "draw", reason: "三次重复局面，不变作和" };
      return { winner: X.other(rep.side), reason: (rep.side === "r" ? "红方" : "黑方") + "长将判负" };
    }
    if (X.legalMoves(st.board, st.side).length > 0) return null;
    const loser = st.side;
    if (X.isCheck(st.board, st.side)) {
      return { winner: X.other(loser), reason: loser === "r" ? "红方被将死" : "黑方被将死" };
    }
    return { winner: X.other(loser), reason: "困毙（无子可动）判负" };
  }

  /* 弹掉 n 手并按剩余着法序列从头重放（board/side/rep 一并重建） */
  function undoPlies(st, n) {
    while (n-- > 0 && st.moves.length) st.moves.pop();
    const { board, side } = X.parseFen(START_FEN);
    st.board = board;
    st.side = side;
    st.rep = [{ key: X.boardToFen(board, side), check: false, side: null }];
    for (const node of st.moves) {
      const mover = st.side;
      X.applyMove(st.board, ...X.parseMove(node.m));
      st.side = X.other(st.side);
      st.rep.push({ key: X.boardToFen(st.board, st.side), check: !!node.chk, side: mover });
    }
    st.browsing = null;
  }

  /* 浏览历史：ply=null 最新局面；否则重放到第 ply 手后 */
  function boardAt(st, ply) {
    if (ply === null || ply === undefined) {
      const last = st.moves.length ? X.parseMove(st.moves[st.moves.length - 1].m) : null;
      return { board: st.board, side: st.side, lastMove: last };
    }
    const { board, side } = X.parseFen(START_FEN);
    let s = side, last = null;
    for (let i = 0; i < ply; i++) {
      last = X.parseMove(st.moves[i].m);
      X.applyMove(board, ...last);
      s = X.other(s);
    }
    return { board, side: s, lastMove: last };
  }

  function legalTexts(st) {
    return X.legalMoves(st.board, st.side).map(mv => X.moveToText(mv));
  }

  /* 开局库按档选着（lvl.book 概率命中且着法仍合法才用，否则交回引擎） */
  function bookMove(lvl, bookKey, legal) {
    if (!lvl.book || Math.random() > lvl.book) return null;
    const list = BOOK[bookKey];
    if (!list) return null;
    const ok = list.filter(mv => legal.indexOf(mv) >= 0);
    return ok.length ? ok[Math.floor(Math.random() * ok.length)] : null;
  }

  /* 按档选着：特大=最优；低级别按名次概率落到缓手/错着，另有 rand 概率直接随机（送子、漏看将军都可能） */
  function pickMove(cands, lvl, legal) {
    if (lvl.pick === "best") return cands[0].mv;
    if (lvl.rand && legal && legal.length && Math.random() < lvl.rand) {
      return legal[Math.floor(Math.random() * legal.length)];
    }
    const n = Math.min(cands.length, lvl.ranks.length);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += lvl.ranks[i];
    let r = Math.random() * sum;
    for (let i = 0; i < n; i++) {
      r -= lvl.ranks[i];
      if (r <= 0) return cands[i].mv;
    }
    return cands[0].mv;
  }

  window.DuelCore = {
    START_FEN, LEVELS, BOOK,
    newGame, applyMove, endOf, undoPlies, boardAt,
    legalTexts, bookMove, pickMove
  };
})();
