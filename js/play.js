/* 人机对战视图。
 * Play.mount(container)  Play.show() / Play.hide()
 * 八档难度：学前(随机合法着) 业1~大师(MultiPV 候选按名次概率选着 + 随机漏着注入) 特大(最优着)
 * 支持执红/执黑、悔棋、认输、求和；终局自动存谱。 */
(function () {
  "use strict";

  const X = window.Xiangqi;

  /* 职业分段难度：
   * time = 引擎思考时间(ms)；pv = MultiPV 候选数；
   * ranks = 选到第 1..pv 名的相对概率（名次越靠后越是缓手/错着，低级别更容易选到）；
   * rand = 每手走出"业余随手棋"的概率（从全部合法着里随机，可能送子、漏看将军）。
   * 只有让低级别真的犯错，难度才区分得开——只在前几名好棋之间加噪声等于没降棋力。 */
  const LEVELS = [
    { name: "学前", time: 0,    pick: "randomLegal", desc: "刚学会规则的棋友水平，走子没有章法——适合人生第一盘" },
    { name: "业1",  time: 250,  pv: 8, ranks: [12, 12, 12, 12, 12, 12, 12, 12], rand: 0.18, book: 0.5, desc: "知道规则，但经常丢子、漏看将军，一步大亏很常见" },
    { name: "业3",  time: 300,  pv: 8, ranks: [38, 22, 14, 9, 6, 4, 3, 4],      rand: 0.07, book: 0.75, desc: "社区初级水平：大子看不住会送，偶尔走出随手棋" },
    { name: "业5",  time: 450,  pv: 8, ranks: [52, 25, 11, 5, 3, 2, 1, 1],      rand: 0.025, book: 0.9, desc: "业余中坚：开局熟练，中局偶有方向性错误，偶尔丢子" },
    { name: "业7",  time: 600,  pv: 6, ranks: [68, 20, 8, 2, 1, 1],             rand: 0.01, desc: "业余高手：攻防有章法，抓机会能力很强" },
    { name: "业9",  time: 800,  pv: 5, ranks: [82, 12, 4, 1, 1],                rand: 0, desc: "准专业水平：计算精准，盘面破绽很少" },
    { name: "大师", time: 1200, pv: 4, ranks: [94, 5, 1, 0],                    rand: 0, desc: "职业大师：几乎不走坏棋，先求稳再求胜" },
    { name: "特大", time: 1800, pick: "best", desc: "特级大师全力模式，象棋的天花板" }
  ];

  /* 开局库（坐标着法，运行时校验合法性）：让低难度对手的开局有真人味道。
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

  function bookMove(lvl) {
    if (!lvl.book || Math.random() > lvl.book) return null;
    const list = BOOK[st.moves.map(m => m.m).join(" ")];
    if (!list) return null;
    const legal = X.legalMoves(st.board, st.side).map(mv => X.moveToText(mv));
    const ok = list.filter(mv => legal.indexOf(mv) >= 0);
    return ok.length ? ok[Math.floor(Math.random() * ok.length)] : null;
  }

  let board = null;
  let els = {};
  let st = null;

  function newState() {
    const { board: b, side } = X.parseFen("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1");
    return {
      board: b, side,
      moves: [],            // [{m, cn, side, chk}]
      rep: [{ key: X.boardToFen(b, side), check: false, side: null }],   // 重复局面判定历史
      mySide: "r",
      level: 2,
      status: "idle",       // idle | playing | finished
      thinking: false,
      browsing: null,       // 查看历史时的步数索引
      result: null
    };
  }

  function mount(container) {
    container.innerHTML = `
      <div class="play-options">
        <label>我执 <select id="pl-side">
          <option value="r">红（先手）</option>
          <option value="b">黑（后手）</option>
        </select></label>
        <label>对手 <select id="pl-level">
          ${LEVELS.map((l, i) => `<option value="${i}" ${i === 3 ? "selected" : ""}>${l.name}</option>`).join("")}
        </select></label>
        <button id="pl-start" class="primary">开始对弈</button>
        <button id="pl-eval-toggle" title="折叠/展开形势条">形势条 ▾</button>
        <span id="pl-engine-note" class="dim"></span>
      </div>
      <div id="pl-level-desc" class="pl-desc"></div>
      <div class="play-main">
        <div class="play-board-col">
          <canvas id="pl-board"></canvas>
          <div class="evalbar" id="pl-evalbar"><div id="pl-evalfill"></div><span id="pl-evaltext"></span></div>
          <div id="pl-status" class="pl-status">点击「开始对弈」与电脑下一盘。</div>
        </div>
        <div class="play-side">
          <div id="pl-moves" class="movelist"></div>
          <div class="play-btns">
            <button id="pl-undo">悔棋</button>
            <button id="pl-resign">认输</button>
            <button id="pl-draw">求和</button>
            <button id="pl-flip">⇅ 翻转</button>
            <button id="pl-tolatest" class="hidden">回到最新</button>
          </div>
        </div>
      </div>`;
    els = {
      side: container.querySelector("#pl-side"),
      level: container.querySelector("#pl-level"),
      start: container.querySelector("#pl-start"),
      note: container.querySelector("#pl-engine-note"),
      status: container.querySelector("#pl-status"),
      moves: container.querySelector("#pl-moves"),
      undo: container.querySelector("#pl-undo"),
      resign: container.querySelector("#pl-resign"),
      draw: container.querySelector("#pl-draw"),
      flip: container.querySelector("#pl-flip"),
      tolatest: container.querySelector("#pl-tolatest"),
      evalbar: container.querySelector("#pl-evalbar"),
      evalToggle: container.querySelector("#pl-eval-toggle"),
      evalfill: container.querySelector("#pl-evalfill"),
      evaltext: container.querySelector("#pl-evaltext"),
      desc: container.querySelector("#pl-level-desc")
    };
    board = Board.create(container.querySelector("#pl-board"), {
      onMove: onHumanMove,
      onIllegal: () => Sound.play("illegal")
    });
    els.start.onclick = startGame;
    els.undo.onclick = undo;
    els.resign.onclick = () => finish(st.mySide === "r" ? "loss" : "win", "认输");
    els.draw.onclick = () => finish("draw", "协议和棋");
    els.flip.onclick = () => board.flip();
    els.tolatest.onclick = () => { st.browsing = null; refresh(); };
    els.level.onchange = updateLevelInfo;
    // 形势条折叠记忆
    if (localStorage.getItem("xq-evalbar-collapsed") === "1") {
      els.evalbar.classList.add("hidden");
      els.evalToggle.textContent = "形势条 ▸";
    }
    els.evalToggle.onclick = () => {
      const hidden = els.evalbar.classList.toggle("hidden");
      els.evalToggle.textContent = hidden ? "形势条 ▸" : "形势条 ▾";
      localStorage.setItem("xq-evalbar-collapsed", hidden ? "1" : "0");
    };
    st = newState();
    updateLevelInfo();
    refresh();
  }

  function updateLevelInfo() {
    const lvl = LEVELS[Number(els.level.value)];
    // 历史战绩
    let w = 0, l = 0, d = 0;
    for (const g of (window.Games ? Games.all() : [])) {
      if (g.levelName === lvl.name) {
        if (g.result === "win") w++; else if (g.result === "loss") l++; else d++;
      }
    }
    const record = (w + l + d) ? `你对该对手战绩：${w}胜${d}和${l}负` : "与该对手尚未交手";
    els.desc.textContent = "🎯 " + lvl.desc + "　·　" + record;
  }

  function startGame() {
    Sound.play("click");
    st = newState();
    st.mySide = els.side.value;
    st.level = Number(els.level.value);
    st.status = "playing";
    refresh();
    if (st.side !== st.mySide) engineTurn();
  }

  function onHumanMove(f0, r0, f1, r1) {
    if (!st || st.status !== "playing" || st.thinking) return;
    if (st.side !== st.mySide) return;
    const mv = [f0, r0, f1, r1];
    if (!X.isLegal(st.board, st.side, mv)) { Sound.play("illegal"); return; }
    applyMove(mv);
    if (!checkEnd()) engineTurn();
  }

  function applyMove(mv) {
    const cn = Notation.chinese(st.board, st.side, mv);
    const mover = st.side;
    const captured = X.applyMove(st.board, ...mv);
    const gaveCheck = X.isCheck(st.board, X.other(st.side));
    const mate = X.isCheckmate(st.board, X.other(st.side));
    st.moves.push({ m: X.moveToText(mv), cn, side: mover, chk: gaveCheck });
    if (mate) Sound.play("check");
    else if (gaveCheck) Sound.play("check");
    else if (captured) Sound.play("capture");
    else Sound.play("move");
    st.side = X.other(st.side);
    st.rep.push({ key: X.boardToFen(st.board, st.side), check: gaveCheck, side: mover });
    st.browsing = null;
  }

  function checkEnd() {
    // 三次重复局面：长将方判负，否则判和（含双方长将、长捉按和处理）
    const rep = X.repetitionResult(st.rep);
    if (rep) {
      if (rep.result === "draw") finish("draw", "三次重复局面，不变作和");
      else finish(rep.side === st.mySide ? "loss" : "win", (rep.side === "r" ? "红方" : "黑方") + "长将判负");
      return true;
    }
    const legal = X.legalMoves(st.board, st.side);
    if (legal.length > 0) { refresh(); return false; }
    const loser = st.side;
    if (X.isCheck(st.board, st.side)) {
      finish(loser === st.mySide ? "loss" : "win", loser === "r" ? "红方被将死" : "黑方被将死");
    } else {
      finish(loser === st.mySide ? "loss" : "win", "困毙（无子可动）判负");
    }
    return true;
  }

  function finish(result, reason) {
    st.status = "finished";
    st.result = { result, reason };
    Sound.play(result === "win" ? "check" : result === "draw" ? "draw" : "illegal");
    const who = result === "draw" ? "和棋" : (result === "win") === (st.mySide === "r") ? "你赢了！" : "你输了";
    if (st.moves.length === 0) {
      els.status.textContent = who + "（" + reason + "）。";
    } else {
      els.status.textContent = who + "（" + reason + "）已保存到棋谱库。";
      Games.add({
        ts: Date.now(),
        level: st.level,
        levelName: LEVELS[st.level].name,
        mySide: st.mySide,
        result, reason,
        moves: st.moves.map(m => ({ m: m.m, cn: m.cn }))
      });
    }
    refresh();
  }

  async function engineTurn() {
    if (st.status !== "playing") return;
    st.thinking = true;
    els.status.textContent = "电脑思考中…";
    refresh();
    try {
      const lvl = LEVELS[st.level];
      const fen = X.boardToFen(st.board, st.side);
      let mvText = null;
      if (lvl.pick === "randomLegal") {
        const legal = X.legalMoves(st.board, st.side);
        mvText = X.moveToText(legal[Math.floor(Math.random() * legal.length)]);
        await new Promise(r => setTimeout(r, 350));   // 模拟思考节奏
      } else {
        mvText = bookMove(lvl);
        if (!mvText) {
          const cands = await Engine.candidates(fen, lvl.time, lvl.pv || 4);
          if (!cands.length) throw new Error("no candidates");
          mvText = pickMove(cands, lvl);
        }
      }
      const mv = X.parseMove(mvText);
      if (st.status !== "playing") return;
      applyMove(mv);
      updateEval();
      if (!checkEnd()) {
        els.status.textContent = "轮到你走棋。";
      }
    } catch (e) {
      els.status.textContent = "引擎出错：" + e.message;
    }
    st.thinking = false;
    refresh();
  }

  function pickMove(cands, lvl) {
    if (lvl.pick === "best") return cands[0].mv;
    // 漏着注入：低级别每手有一定概率走出完全随机的随手棋（送子、漏看将军都可能）
    if (lvl.rand && st && st.board && Math.random() < lvl.rand) {
      const legal = X.legalMoves(st.board, st.side);
      return X.moveToText(legal[Math.floor(Math.random() * legal.length)]);
    }
    // 按名次概率从引擎候选中选：低级别更容易落到第 3~8 名的缓手/错着上
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

  function undo() {
    if (!st || st.status !== "playing" || st.thinking || !st.moves.length) return;
    Sound.play("click");
    // 撤掉电脑的一手和自己的一手（若最后一手是电脑的）
    let pop = (st.moves[st.moves.length - 1].side !== st.mySide) ? 2 : 1;
    while (pop-- > 0 && st.moves.length) st.moves.pop();
    replayFromMoves();
    st.browsing = null;
    refresh();
  }

  function replayFromMoves() {
    const { board: b, side } = X.parseFen("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1");
    st.board = b;
    st.side = side;
    st.rep = [{ key: X.boardToFen(b, side), check: false, side: null }];
    for (const node of st.moves) {
      const mover = st.side;
      X.applyMove(st.board, ...X.parseMove(node.m));
      st.side = X.other(st.side);
      st.rep.push({ key: X.boardToFen(st.board, st.side), check: !!node.chk, side: mover });
    }
  }

  function updateEval() {
    if (!Engine.ready) return;
    const fen = X.boardToFen(st.board, st.side);
    Engine.evalCp(fen, 250).then(cp => {
      if (cp === null || !st) return;
      const mine = st.side === st.mySide ? cp : -cp;   // 我方视角
      const pct = Math.max(4, Math.min(96, 50 + mine / 12));
      els.evalfill.style.width = pct + "%";
      els.evalfill.style.background = mine >= 0 ? "#d4a03c" : "#666";
      els.evaltext.textContent = (mine >= 0 ? "优 " : "劣 ") + Math.abs(mine) + "分";
    });
  }

  function refresh() {
    if (!board) return;
    const view = boardStateForView();
    board.update({
      board: view.board, turn: view.side,
      lastMove: view.lastMove, interactive: st.status === "playing" && !st.thinking && view.side === st.mySide && st.browsing === null
    });
    renderMoves();
    els.undo.disabled = st.status !== "playing" || st.thinking || !st.moves.length;
    els.resign.disabled = st.status !== "playing";
    els.draw.disabled = st.status !== "playing";
    els.tolatest.classList.toggle("hidden", st.browsing === null);
    if (st.status === "playing" && !st.thinking && st.browsing === null) {
      els.status.textContent = st.moves.length === 0 && st.side !== st.mySide
        ? "电脑先行。"
        : "轮到你走棋。";
    }
  }

  function boardStateForView() {
    if (st.browsing === null) {
      const last = st.moves.length ? X.parseMove(st.moves[st.moves.length - 1].m) : null;
      return { board: st.board, side: st.side, lastMove: last };
    }
    const { board: b, side } = X.parseFen("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1");
    let s = side;
    let last = null;
    for (let i = 0; i < st.browsing; i++) {
      last = X.parseMove(st.moves[i].m);
      X.applyMove(b, ...last);
      s = X.other(s);
    }
    return { board: b, side: s, lastMove: last };
  }

  function renderMoves() {
    const box = els.moves;
    box.innerHTML = "";
    st.moves.forEach((node, i) => {
      if (node.side === "r") {
        const num = document.createElement("span");
        num.className = "mvnum";
        num.textContent = (Math.floor(i / 2) + 1) + ".";
        box.appendChild(num);
      }
      const span = document.createElement("span");
      span.className = "mv" + (st.browsing === i + 1 ? " cur" : "");
      span.textContent = node.cn;
      span.onclick = () => { st.browsing = i + 1; refresh(); };
      box.appendChild(span);
    });
    const cur = box.querySelector(".cur");
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }

  window.Play = {
    mount,
    show() {
      refresh();
      updateLevelInfo();
      els.note.textContent = Engine.ready ? "" : "（引擎不可用：仅学前档可玩）";
    },
    hide() {}
  };
  /* 私教/调试取当前局面 FEN */
  window.PlayDebug = {
    get fen() { return st && st.board ? X.boardToFen(st.board, st.side) : null; },
    get state() { return st; },
    get pickMove() { return pickMove; },
    get levels() { return LEVELS; },
    get book() { return BOOK; }
  };
})();
