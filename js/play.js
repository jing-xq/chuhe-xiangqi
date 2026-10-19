/* 人机对战视图。
 * Play.mount(container)  Play.show() / Play.hide()
 * 八档难度：学前(随机合法着) 业1~大师(MultiPV 候选按名次概率选着 + 随机漏着注入) 特大(最优着)
 * 支持执红/执黑、悔棋、认输、求和；终局自动存谱。
 * 状态机核心（难度档/开局库/走子/终局/悔棋/重放）在 js/duel-core.js，与 spar.js 共用；
 * 本文件只保留视图层与对弈流程接线。 */
(function () {
  "use strict";

  const X = window.Xiangqi;
  const D = window.DuelCore;
  const LEVELS = D.LEVELS;

  let board = null;
  let els = {};
  let st = null;

  function newState() {
    return Object.assign(D.newGame(), {
      mySide: "r",
      level: 2,
      status: "idle",       // idle | playing | finished
      thinking: false,
      browsing: null,       // 查看历史时的步数索引
      result: null
    });
  }

  function mount(container) {
    container.innerHTML = `
      <div class="play-options">
        <label>我执 <select id="pl-side">
          <option value="r">红（先手）</option>
          <option value="b">黑（后手）</option>
        </select></label>
        <label>对手 <select id="pl-level">
          ${LEVELS.map((l, i) => `<option value="${i}" ${i === 3 ? "selected" : ""}>${l.name}${l.elo ? `（≈${l.elo}）` : ""}</option>`).join("")}
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
    els.resign.onclick = () => { if (st && st.status === "playing") finish("loss", "认输"); };
    els.draw.onclick = () => { if (st && st.status === "playing") finish("draw", "协议和棋"); };
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
    // 历史战绩（胜负一律经 Games.userResult 推导，兼容新旧存档字段）
    let w = 0, l = 0, d = 0;
    for (const g of (window.Games ? Games.all() : [])) {
      if (g.levelName !== lvl.name) continue;
      const ur = Games.userResult ? Games.userResult(g) : g.result;
      if (ur === "win") w++; else if (ur === "loss") l++; else if (ur === "draw") d++;
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
    const node = D.applyMove(st, mv);
    if (node.mate || node.gaveCheck || node.chk) Sound.play("check");
    else if (node.captured) Sound.play("capture");
    else Sound.play("move");
  }

  function checkEnd() {
    const e = D.endOf(st);
    if (e) {
      const result = e.winner === "draw" ? "draw" : e.winner === st.mySide ? "win" : "loss";
      finish(result, e.reason);
      return true;
    }
    refresh();
    return false;
  }

  function finish(result, reason) {
    st.status = "finished";
    st.result = { result, reason };
    Sound.play(result === "win" ? "check" : result === "draw" ? "draw" : "illegal");
    // result 统一为用户视角；winner 为红黑视角（存档与统计的字段约定见 games.js）
    const winner = result === "draw" ? "draw" : result === "win" ? st.mySide : X.other(st.mySide);
    const who = result === "draw" ? "和棋" : result === "win" ? "你赢了！" : "你输了";
    if (st.moves.length === 0) {
      els.status.textContent = who + "（" + reason + "）。";
    } else {
      els.status.textContent = who + "（" + reason + "）已保存到棋谱库。";
      Games.add({
        ts: Date.now(),
        level: st.level,
        levelName: LEVELS[st.level].name,
        mySide: st.mySide,
        winner, result, reason,
        moves: st.moves.map(m => ({ m: m.m, cn: m.cn }))
      });
    }
    refresh();
  }

  async function engineTurn() {
    // 会话快照：思考期间「开始对弈」会把 st 换成新局，旧回调凭 st !== s 全部失效，
    // 绝不能把旧局面的应着落到新局上（历史 bug：只查 status 挡不住重开）
    const s = st;
    if (!s || s.status !== "playing") return;
    s.thinking = true;
    els.status.textContent = "电脑思考中…";
    refresh();
    try {
      const lvl = LEVELS[s.level];
      const fen = X.boardToFen(s.board, s.side);
      const legal = D.legalTexts(s);
      let mvText = null;
      if (lvl.pick === "randomLegal") {
        mvText = legal[Math.floor(Math.random() * legal.length)];
        await new Promise(r => setTimeout(r, 350));   // 模拟思考节奏
      } else {
        mvText = D.bookMove(lvl, s.moves.map(m => m.m).join(" "), legal);
        if (!mvText) {
          const cands = await Engine.candidates(fen, lvl.time, lvl.pv || 4, Engine.PRIORITY.PLAY);
          if (!cands.length) throw new Error("no candidates");
          mvText = D.pickMove(cands, lvl, legal);
        }
      }
      if (st !== s || s.status !== "playing") return;   // 期间重开/终局/切走：丢弃这手
      applyMove(X.parseMove(mvText));
      updateEval(s);
      if (!checkEnd()) {
        els.status.textContent = "轮到你走棋。";
      }
    } catch (e) {
      if (st === s) els.status.textContent = "引擎出错：" + e.message;
    }
    if (st !== s) return;
    s.thinking = false;
    refresh();
  }

  function undo() {
    if (!st || st.status !== "playing" || st.thinking || !st.moves.length) return;
    Sound.play("click");
    // 撤掉电脑的一手和自己的一手（若最后一手是电脑的）
    D.undoPlies(st, st.moves[st.moves.length - 1].side !== st.mySide ? 2 : 1);
    refresh();
  }

  function updateEval(s) {
    if (!Engine.ready) return;
    const fen = X.boardToFen(s.board, s.side);
    Engine.evalCp(fen, 250, Engine.PRIORITY.AMBIENT).then(cp => {
      // 评分落地前可能已重开/终局：旧局的评分不刷新到新局的形势条
      if (cp === null || st !== s) return;
      const mine = s.side === s.mySide ? cp : -cp;   // 我方视角
      const pct = Math.max(4, Math.min(96, 50 + mine / 12));
      els.evalfill.style.width = pct + "%";
      els.evalfill.style.background = mine >= 0 ? "#d4a03c" : "#666";
      els.evaltext.textContent = (mine >= 0 ? "优 " : "劣 ") + Math.abs(mine) + "分";
    });
  }

  function refresh() {
    if (!board) return;
    const view = D.boardAt(st, st.browsing);
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
  /* 私教/调试取当前局面 FEN（LEVELS/BOOK/选着策略已移至 js/duel-core.js） */
  window.PlayDebug = {
    get fen() { return st && st.board ? X.boardToFen(st.board, st.side) : null; },
    get state() { return st; },
    get levels() { return LEVELS; }
  };
})();
