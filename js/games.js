/* 棋谱库：对局保存/列表/查看器（含分析入口）。
 * Games.add(record) / Games.all() / Games.get(id) / Games.remove(id) / Games.saveAnalysis(id, data)
 * Games.mount(container)  Games.show() / hide() */
(function () {
  "use strict";

  const X = window.Xiangqi;
  const KEY = "xq-games-v1";
  let data = [];
  try { data = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { data = []; }

  function persist() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { Diag.storageFail("games.persist", e); } }

  /* ---------- 胜负字段约定（见规划文档 3.3） ----------
   * 新存档一律写 winner（"r"|"b"|"draw"）+ mySide + reason；用户胜负由 winner 与 mySide 推导，
   * result（"win"|"loss"|"draw"|"unknown"，用户视角）继续保留以兼容旧读取方。
   * 旧存档迁移：result 曾有两种含义——对弈/陪练存档为用户视角；
   * 导入棋谱（imported:true）为红方视角（win=红胜）。按来源推导，不无条件翻转。 */
  function normWinner(g) {
    if (g.winner === "r" || g.winner === "b" || g.winner === "draw") return g.winner;
    if (g.result === "draw") return "draw";
    if (g.imported) {
      if (g.result === "win") return "r";
      if (g.result === "loss") return "b";
    } else {
      if (g.result === "win") return g.mySide === "b" ? "b" : "r";
      if (g.result === "loss") return g.mySide === "b" ? "r" : "b";
    }
    return "unknown";
  }
  function userResult(g) {
    const w = normWinner(g);
    if (w === "draw") return "draw";
    if (w === "unknown" || !g.mySide) return "unknown";
    return w === g.mySide ? "win" : "loss";
  }
  function winnerText(g) {
    const w = normWinner(g);
    return w === "r" ? "红胜" : w === "b" ? "黑胜" : w === "draw" ? "和棋" : "结果不详";
  }
  const api = {
    add(rec) {
      rec.id = "g" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
      rec.analysis = null;
      data.unshift(rec);
      persist();
      return rec.id;
    },
    all() { return data.slice(); },
    get(id) { return data.find(g => g.id === id) || null; },
    remove(id) { data = data.filter(g => g.id !== id); persist(); },
    saveAnalysis(id, analysis) {
      const g = data.find(x => x.id === id);
      if (g) { g.analysis = analysis; persist(); }
    }
  };

  /* ---------- 查看器 ---------- */
  let els = {}, cur = null, viewIdx = null, board = null;

  function mount(container) {
    container0 = container;
    container.innerHTML = `
      <div class="games-wrap">
        <div class="games-list">
          <div class="gm-tabs">
            <button data-t="games" class="tab active">对局记录</button>
            <button data-t="annotated" class="tab">已讲解 <span id="gm-ann-count" class="badge hidden"></span></button>
          </div>
          <div class="gm-list-bar">
            <button id="gm-import-btn" class="primary">📥 导入棋谱</button>
          </div>
          <div id="gm-import" class="gm-import hidden">
            <textarea id="gm-import-text" placeholder="粘贴棋谱文本（中文记谱如 炮二平五 炮8平5，或坐标如 h2e2 b7e7），也可选择文件。支持带 FEN 的残局摆谱：首行写 FEN，其后写着法"></textarea>
            <div class="gm-import-btns">
              <input type="file" id="gm-import-file" accept=".txt,.pgn,.pfc,.log,.csv,.xml">
              <select id="gm-import-side" title="这盘棋你执哪方（私教点评以你的视角分析）">
                <option value="r">我执红</option>
                <option value="b">我执黑</option>
                <option value="">仅棋谱</option>
              </select>
              <button id="gm-import-go">解析并导入</button>
            </div>
            <div id="gm-import-err" class="dim" style="font-size:12px"></div>
          </div>
          <div id="gm-list"></div>
        </div>
        <div class="games-detail">
          <div id="gm-empty" class="dim" style="padding:30px">暂无棋谱。到「对弈」页下一盘，终局后会自动保存到这里。</div>
          <div id="gm-view" class="hidden">
            <div class="gm-bar">
              <span id="gm-info"></span>
              <button id="gm-analyze" class="primary">分析本局</button>
              <button id="gm-flip">⇅ 翻转</button>
              <button id="gm-export">导出文本</button>
              <button id="gm-del">删除</button>
            </div>
            <div class="gm-main">
              <div class="gm-board-col">
                <canvas id="gm-board"></canvas>
                <div class="gm-stepbar">
                  <button id="gm-step-prev" title="上一步 (←)">◀ 上一步</button>
                  <button id="gm-step-next" title="下一步 (→)">下一步 ▶</button>
                </div>
                <div class="gm-left-bottom">
                  <canvas id="gm-radar" class="hidden"></canvas>
                  <div id="gm-moves" class="movelist"></div>
                </div>
                <canvas id="gm-curve" height="90"></canvas>
                <div id="gm-mistakes" class="gm-mistakes"></div>
              </div>
              <div class="gm-right" id="gm-right">
                <div id="gm-review" class="gm-review hidden"></div>
              </div>
            </div>
            <div id="gm-prog" class="dim"></div>
          </div>
        </div>
      </div>`;
    els = {
      list: container.querySelector("#gm-list"),
      empty: container.querySelector("#gm-empty"),
      view: container.querySelector("#gm-view"),
      info: container.querySelector("#gm-info"),
      analyze: container.querySelector("#gm-analyze"),
      stepPrev: container.querySelector("#gm-step-prev"),
      stepNext: container.querySelector("#gm-step-next"),
      flip: container.querySelector("#gm-flip"),
      export: container.querySelector("#gm-export"),
      del: container.querySelector("#gm-del"),
      curve: container.querySelector("#gm-curve"),
      radar: container.querySelector("#gm-radar"),
      review: container.querySelector("#gm-review"),
      mistakes: container.querySelector("#gm-mistakes"),
      moves: container.querySelector("#gm-moves"),
      prog: container.querySelector("#gm-prog"),
      rightCol: container.querySelector("#gm-right")
    };
    board = Board.create(container.querySelector("#gm-board"), { onMove: () => {} });
    els.analyze.onclick = () => runAnalysis();
    els.stepPrev.onclick = () => stepView(-1);
    els.stepNext.onclick = () => stepView(1);
    els.flip.onclick = () => board.flip();
    els.export.onclick = exportText;
    els.del.onclick = () => {
      if (!cur) return;
      const label = cur._ann ? "这盘讲解棋谱" : "这盘棋谱";
      if (confirm("删除" + label + "？")) {
        if (cur._ann) Annotated.remove(cur._ann.id); else api.remove(cur.id);
        cur = null;
        renderList();
        els.view.classList.add("hidden");
        els.empty.classList.remove("hidden");
      }
    };
    // 标签页
    container.querySelectorAll(".gm-tabs .tab").forEach(b => {
      b.onclick = () => {
        listTab = b.dataset.t;
        container.querySelectorAll(".gm-tabs .tab").forEach(x => x.classList.toggle("active", x === b));
        cur = null;
        els.view.classList.add("hidden");
        els.empty.classList.remove("hidden");
        renderList();
      };
    });
    container.querySelector("#gm-import-btn").onclick = () => {
      container.querySelector("#gm-import").classList.toggle("hidden");
    };
    container.querySelector("#gm-import-go").onclick = doImport;
    container.querySelector("#gm-import-file").onchange = e => {
      const f = e.target.files[0];
      if (!f) return;
      readFileSmart(f).then(text => {
        container.querySelector("#gm-import-text").value = text;
        container.querySelector("#gm-import-err").textContent = "已读取文件：" + f.name + "（" + Math.round(f.size / 1024) + "KB），点「解析并导入」。";
      });
    };
    renderList();
  }

  /* ---------- 棋谱导入 ---------- */
  function readFileSmart(file) {
    return file.arrayBuffer().then(buf => {
      try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
      catch (e) { return new TextDecoder("gbk").decode(buf); }   // 国产软件导出的棋谱常是 GBK
    });
  }

  const CN_NUM = { "一": "1", "二": "2", "三": "3", "四": "4", "五": "5", "六": "6", "七": "7", "八": "8", "九": "9" };
  function normToken(s) {
    return String(s)
      .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/[Ａ-Ｚａ-ｚ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/[一二三四五六七八九]/g, ch => CN_NUM[ch])
      .replace(/[車俥]/g, "车").replace(/[馬傌]/g, "马").replace(/砲/g, "炮")
      .replace(/帥/g, "帅").replace(/將/g, "将").replace(/卒/g, "兵")
      .replace(/[!?！？,，.。;；、·\s]/g, "");
  }

  /* 解析棋谱文本 → { moves:[{m,cn}], winner, fen, error }
   * winner 为红黑视角（"r"|"b"|"draw"|"unknown"）；存档时再按 mySide 折算成用户视角。
   * 支持首行（或任意处）带 FEN 的残局摆谱：以该局面为起点解析后续着法。 */
  function parseGameText(text) {
    // 头部信息（【键 值】或 键:值），结果判定
    let winner = "unknown";
    const head = /【\s*结果\s*[:：]?\s*([^】]+)】/.exec(text) || /结果\s*[:：]\s*(\S+)/.exec(text);
    if (head) {
      const h = head[1];
      if (/红胜|红先胜/.test(h)) winner = "r";
      else if (/黑胜/.test(h)) winner = "b";
      else if (/和|平/.test(h)) winner = "draw";
    }
    if (/红胜|红先胜/.test(text.slice(0, 400)) && winner === "unknown") winner = "r";
    else if (/黑胜/.test(text.slice(0, 400)) && winner === "unknown") winner = "b";

    // 提取 FEN（残局摆谱起点），无则用标准开局
    const INIT = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
    let fen = INIT;
    const fenM = /([1-9a-zA-Z]+(?:\/[1-9a-zA-Z]+){9})\s+([wb])(?:\s+-){2}\s*\d+\s*\d+/.exec(text);
    if (fenM) {
      try {
        X.parseFen(fenM[1] + " " + fenM[2] + " - - 0 1");
        fen = fenM[1] + " " + fenM[2] + " - - 0 1";
        text = text.replace(fenM[0], " ");
      } catch (e) { /* 非法 FEN 按普通文本处理 */ }
    }

    // 去掉括号注释、头部行、结果词、回合号
    // 回合号剥参数量上要求前面是行首/空白，否则会吃掉着法末位数字（如「士6进5、和棋」的 5、）
    let body = text
      .replace(/【[^】]*】/g, " ")
      .replace(/\{[^}]*\}/g, " ")
      .replace(/（[^（）]*）/g, " ")
      .replace(/\([^()]*\)/g, " ")
      .replace(/红先胜|黑先胜|红胜|黑胜|和棋|和局/g, " ")
      .replace(/(^|\s)(\d+\s*[.、．:：])/g, "$1 ");
    const tokens = body.split(/[\s,，;；。、！？!?.]+/).filter(Boolean);

    const parsed = X.parseFen(fen);
    let board = parsed.board, side = parsed.side;
    const moves = [];

    for (let idx = 0; idx < tokens.length; idx++) {
      let tk = tokens[idx];
      if (/^(红胜|黑胜|和棋|和局|红先胜|黑先胜)$/.test(tk)) break;
      let mv = null;
      const coord = /^([a-i])([0-9])([a-i])([0-9])$/i.exec(tk);
      if (coord) {
        mv = [coord[1].toLowerCase().charCodeAt(0) - 97, Number(coord[2]),
              coord[3].toLowerCase().charCodeAt(0) - 97, Number(coord[4])];
        if (!X.isLegal(board, side, mv)) mv = null;
      }
      if (!mv) {
        const want = normToken(tk);
        if (!want) continue;
        const legal = X.legalMoves(board, side);
        const matched = legal.filter(m => normToken(Notation.chinese(board, side, m)) === want);
        if (matched.length === 1) mv = matched[0];
        else if (matched.length > 1) {
          return { error: "第 " + (moves.length + 1) + " 手「" + tk + "」有多个匹配着法，无法确定", moves, fen };
        }
      }
      if (!mv) {
        if (moves.length === 0 && idx < 3) continue;   // 开头几个非着法 token 宽容跳过
        return { error: "第 " + (moves.length + 1) + " 手无法识别：「" + tk + "」", moves, fen };
      }
      const cn = Notation.chinese(board, side, mv);
      moves.push({ m: X.moveToText(mv), cn });
      X.applyMove(board, ...mv);
      side = X.other(side);
    }
    if (!moves.length && fen === INIT) return { error: "没有解析到任何着法，请检查格式", moves, fen };
    return { moves, winner, fen };
  }

  function doImport() {
    const ta = document.getElementById("gm-import-text");
    const err = document.getElementById("gm-import-err");
    const text = ta.value.trim();
    if (!text) { err.textContent = "请先粘贴棋谱文本或选择文件。"; return; }
    const r = parseGameText(text);
    if (r.error && !r.moves.length) { err.textContent = "❌ " + r.error; return; }
    if (r.error) err.textContent = "⚠️ " + r.error + "（已导入前 " + r.moves.length + " 手）";
    else err.textContent = "";
    const sideSel = document.getElementById("gm-import-side");
    const mySide = sideSel && sideSel.value ? sideSel.value : "r";
    // winner（红黑视角）→ result（用户视角）：两种字段都落库，读取方统一走 Games.userResult
    const result = r.winner === "draw" ? "draw"
      : r.winner === "unknown" ? "unknown"
      : (r.winner === mySide ? "win" : "loss");
    const id = api.add({
      ts: Date.now(), level: -1, levelName: "导入棋谱",
      mySide,
      winner: r.winner, result, reason: r.error ? "部分导入" : "外部导入", imported: true,
      fen: r.fen !== "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1" ? r.fen : undefined,
      moves: r.moves
    });
    ta.value = "";
    renderList();
    openGame(id);
  }

  /* ---------- 查看器 ---------- */
  let container0 = null;
  let listTab = "games";   // games | annotated

  function scoreBadge(score) {
    if (score === null || score === undefined) return "<span class='gm-score s-na'>—</span>";
    const cls = score >= 80 ? "s-high" : score >= 60 ? "s-mid" : score >= 40 ? "s-low" : "s-bad";
    return "<span class='gm-score " + cls + "'>" + score + "</span>";
  }
  function escapeHtml2(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  }

  function renderList() {
    // 已讲解徽标计数
    const annCount = window.Annotated ? Annotated.all().length : 0;
    const badge = container0.querySelector("#gm-ann-count");
    if (badge) {
      badge.textContent = annCount;
      badge.classList.toggle("hidden", !annCount);
    }
    els.list.innerHTML = "";
    if (listTab === "annotated") { renderAnnotatedList(); return; }
    const gs = api.all();
    if (!gs.length) {
      els.list.innerHTML = "<div class='dim' style='padding:14px'>暂无对局记录<br>去「人机对弈」下一盘，或点上方「导入棋谱」</div>";
      els.empty.classList.remove("hidden");
      els.view.classList.add("hidden");
      return;
    }
    els.empty.classList.add("hidden");
    for (const g of gs) {
      const d = new Date(g.ts);
      const item = document.createElement("div");
      item.className = "gm-item" + (cur && cur.id === g.id && !cur._ann ? " active" : "");
      const ur = userResult(g);
      const resText = ur === "win" ? "胜" : ur === "loss" ? "负" : ur === "draw" ? "和" : "谱";
      item.innerHTML =
        "<b>" + d.toLocaleString() + "</b>" +
        "<span class='gm-res " + ur + "'>" + resText + "</span>" +
        "<span class='dim'>" + (g.levelName || "") + " · " + (g.imported ? "外部导入" : (g.mySide === "r" ? "执红" : "执黑")) + " · " + g.moves.length + "着" +
        (g.analysis ? " · 已分析" : "") + "</span>";
      item.onclick = () => openGame(g.id);
      els.list.appendChild(item);
    }
  }

  function renderAnnotatedList() {
    const gs = window.Annotated ? Annotated.all() : [];
    if (!gs.length) {
      els.list.innerHTML = "<div class='dim' style='padding:14px'>暂无已讲解棋谱<br>在「🤖 象棋私教」里点评一盘棋，然后点「💾 存入」</div>";
      els.empty.classList.remove("hidden");
      els.view.classList.add("hidden");
      return;
    }
    els.empty.classList.add("hidden");
    for (const a of gs) {
      const d = new Date(a.ts);
      const item = document.createElement("div");
      item.className = "gm-item gm-ann-item" + (cur && cur._ann && cur._ann.id === a.id ? " active" : "");
      const ur = userResult(a.game);
      const resText = ur === "win" ? "胜" : ur === "loss" ? "负" : ur === "draw" ? "和" : "谱";
      item.innerHTML =
        scoreBadge(a.score) +
        "<div class='gm-ann-main'><b>" + escapeHtml2(a.name) + "</b>" +
        "<span class='dim'>" + d.toLocaleDateString() + " · " + resText + " · " + a.game.moves.length + "着</span></div>";
      item.onclick = () => openAnnotated(a.id);
      els.list.appendChild(item);
    }
  }

  function openAnnotated(id) {
    const a = Annotated.get(id);
    if (!a) return;
    cur = {
      id: a.id, ts: a.ts, moves: a.game.moves,
      result: a.game.result, mySide: a.game.mySide,
      levelName: a.game.levelName, reason: a.game.reason,
      fen: a.game.fen || null,
      analysis: a.game.analysis || null,
      _ann: a
    };
    viewIdx = null;
    els.view.classList.remove("hidden");
    els.info.textContent = "「" + a.name + "」 · 私教评分 " + (a.score === null ? "—" : a.score) +
      " · " + winnerText(a.game);
    els.prog.textContent = "";
    renderMoves();
    renderAnalysis();
    renderList();
    refreshBoard();
  }

  function openGame(id) {
    cur = api.get(id);
    viewIdx = null;
    els.view.classList.remove("hidden");
    const d = new Date(cur.ts);
    els.info.textContent = d.toLocaleString() + " · " + (cur.levelName || "") + " · " +
      (cur.imported ? "外部导入" : (cur.mySide === "r" ? "执红" : "执黑")) + " · " + winnerText(cur) +
      (cur.reason ? "（" + cur.reason + "）" : "");
    els.prog.textContent = "";
    renderMoves();
    renderAnalysis();
    renderList();
    refreshBoard();
  }

  /* 重放到第 idx 手后的局面。game 参数显式传入（不读全局 cur）：
   * 分析期间用户可能打开另一盘棋，回放必须锁定分析开始时的那盘。 */
  function positionAt(game, idx) {
    const INIT = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
    const { board: b, side } = X.parseFen(game.fen || INIT);
    let s = side;
    for (let i = 0; i < idx; i++) {
      X.applyMove(b, ...X.parseMove(game.moves[i].m));
      s = X.other(s);
    }
    return { board: b, side: s };
  }

  function refreshBoard() {
    const idx = viewIdx === null ? cur.moves.length : viewIdx;
    const { board: b, side } = positionAt(cur, idx);
    const last = idx > 0 ? X.parseMove(cur.moves[idx - 1].m) : null;
    board.update({ board: b, turn: side, lastMove: last, interactive: false });
    els.moves.querySelectorAll(".mv").forEach((el, i) => el.classList.toggle("cur", viewIdx === i + 1));
    els.stepPrev.disabled = idx <= 0;
    els.stepNext.disabled = viewIdx === null;
    drawCurve(cur.analysis ? cur.analysis.curve : null);
    // 已讲解棋谱：六维雷达图（左下角）+ 私教讲解（占满右列）
    if (cur._ann) {
      els.radar.classList.remove("hidden");
      els.rightCol.classList.remove("hidden");
      els.review.classList.remove("hidden");
      Annotated.drawRadar(els.radar, cur._ann.dims);
      const reviewText = (cur._ann.review || "").replace(/```json\s*[\s\S]*?```/g, "").trim();
      els.review.innerHTML = "<h4>📖 私教讲解</h4>" + window.renderMarkdown(reviewText);
    } else {
      els.radar.classList.add("hidden");
      els.rightCol.classList.add("hidden");
      els.review.classList.add("hidden");
    }
  }

  /* 上一步/下一步：viewIdx=null 表示在最新局面 */
  function stepView(d) {
    if (!cur) return;
    Sound.play("click");
    let idx = viewIdx === null ? cur.moves.length : viewIdx;
    idx = Math.max(0, Math.min(cur.moves.length, idx + d));
    viewIdx = idx >= cur.moves.length ? null : idx;
    refreshBoard();
  }

  function renderMoves() {
    const box = els.moves;
    box.innerHTML = "";
    cur.moves.forEach((node, i) => {
      if (i % 2 === 0) {
        const num = document.createElement("span");
        num.className = "mvnum";
        num.textContent = (i / 2 + 1) + ".";
        box.appendChild(num);
      }
      const span = document.createElement("span");
      span.className = "mv" + (cur.analysis && cur.analysis.perMove[i] && cur.analysis.perMove[i].loss >= 120 ? " badmove" : "");
      span.textContent = node.cn;
      span.title = cur.analysis && cur.analysis.perMove[i] ? "损 " + cur.analysis.perMove[i].loss + " 分" : "";
      span.onclick = () => { viewIdx = i + 1; refreshBoard(); };
      box.appendChild(span);
    });
  }

  /* ---------- 分析 ---------- */
  let analyzing = false;

  /* 逐手损分（纯函数，导出供回归测试）。
   * curve：红方视角评分序列（n+1 个点）；startSide：起始局面行棋方。
   * 行棋方一律按起始 FEN + 步数推导——存档 moves 通常只有 {m,cn} 没有 side
   * （历史 bug：读不到 side 就全按黑方算，红方损分为 0），黑先残局也由此正确。 */
  function computeLosses(curve, startSide) {
    const perMove = [];
    for (let i = 0; i < curve.length - 1; i++) {
      const mover = X.sideAtPly(startSide, i);
      const before = cpForMover(curve[i], mover);
      const after = cpForMover(curve[i + 1], mover);
      const loss = Math.max(0, before - after);
      perMove.push({ loss: Math.round(loss), cls: classify(loss) });
    }
    return perMove;
  }

  async function runAnalysis() {
    if (analyzing || !cur) return;
    if (!Engine.ready) { els.prog.textContent = "引擎不可用，无法分析。"; return; }
    analyzing = true;
    els.analyze.disabled = true;
    // 锁定要分析的对象：期间打开别的棋谱不影响本次分析，结果也存回这一盘
    const game = cur;
    const startSide = X.parseFen(game.fen || "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1").side;
    const n = game.moves.length;
    const curve = [];   // 红方视角 cp，n+1 个点
    let cancelled = false;
    els.prog.innerHTML = "<button id='gm-cancel'>取消分析</button> <span id='gm-progtext'></span>";
    els.prog.querySelector("#gm-cancel").onclick = () => { cancelled = true; };
    try {
      for (let i = 0; i <= n; i++) {
        if (cancelled) break;
        const { board: b, side } = positionAt(game, i);
        const cp = await Engine.evalCp(X.boardToFen(b, side), 220, Engine.PRIORITY.REVIEW);
        if (cp === null) throw new Error("引擎未返回评分");
        curve.push(side === "r" ? cp : -cp);
        const t = els.prog.querySelector("#gm-progtext");
        if (t) t.textContent = "分析中 " + i + "/" + n;
      }
      // 计算每手损益（行棋方按 FEN 推导，红黑/黑先一致）
      const perMove = computeLosses(curve, startSide);
      if (!cancelled) {
        if (game._ann) Annotated.saveAnalysis(game._ann.id, { curve: curve.map(Math.round), perMove });
        else api.saveAnalysis(game.id, { curve: curve.map(Math.round), perMove });
        if (cur === game) {
          renderAnalysis();
          renderMoves();
        }
        renderList();
      }
      els.prog.textContent = cancelled ? "已取消。" : "分析完成。";
    } catch (e) {
      els.prog.textContent = "分析失败：" + e.message;
    }
    analyzing = false;
    els.analyze.disabled = false;
  }

  /* curve[i] 是红方视角；转成某方视角 */
  function cpForMover(redCp, side) { return side === "r" ? redCp : -redCp; }

  function classify(loss) {
    if (loss < 40) return "正常";
    if (loss < 120) return "一般";
    if (loss < 250) return "欠佳";
    if (loss < 500) return "失误";
    return "漏着";
  }

  /* 短复盘（6.7）：默认只突出三件事——一个亮点、一个关键错误、一题再练 */
  function shortReviewHtml() {
    const a = cur && cur.analysis;
    if (!a || !a.perMove || !a.perMove.length) return "";
    const myMoves = a.perMove;
    let streak = 0, best = 0;
    myMoves.forEach(p => { if (p.loss < 40) { streak++; if (streak > best) best = streak; } else streak = 0; });
    let worstI = -1, worst = 0;
    myMoves.forEach((p, i) => { if (p.loss > worst) { worst = p.loss; worstI = i; } });
    const winner = normWinner(cur);
    const good = best >= 4 ? "最长连续 " + best + " 手与引擎正着一致" : winner === "r" || winner === "b" ? (winner === (cur.mySide || "r") ? "赢下了这盘" : "全局没有大崩盘") : "完成了一盘完整对局";
    const lessonByPly = worstI < 12 ? ["s5l1", "开局出子"] : worstI < 30 ? ["s3l1", "看住无根子"] : ["s6l2", "残局常识"];
    let html = "<div class='gm-short'><h4>📋 短复盘（三件事）</h4><ul>" +
      "<li>👍 做得好：" + good + "。</li>";
    if (worstI >= 0 && worst >= 120) {
      html += "<li>⚠️ 最该修的一手：第 " + (Math.floor(worstI / 2) + 1) + " 回合「" + cur.moves[worstI].cn + "」（" + myMoves[worstI].cls + "，损 " + worst + " 分）。" +
        "<button class='gm-mini' data-drill='" + worstI + "'>↪ 跳到局面</button>" +
        "<button class='gm-mini' data-ge='" + worstI + "'>＋ 错题本</button></li>";
    } else {
      html += "<li>👍 没有明显亏着，保持。</li>";
    }
    html += "<li>🎯 再练一题：<button class='gm-mini' data-core='" + lessonByPly[0] + "'>" + lessonByPly[1] + "</button>（新手路线对应课）</li></ul></div>";
    return html;
  }

  function renderAnalysis() {
    const a = cur && cur.analysis;
    els.mistakes.innerHTML = "";
    const short = shortReviewHtml();
    els.mistakes.innerHTML = short;
    drawCurve(a ? a.curve : null);
    if (!a) return;
    els.mistakes.querySelectorAll("[data-drill]").forEach(b => b.onclick = () => { viewIdx = Number(b.dataset.drill) + 1; refreshBoard(); });
    els.mistakes.querySelectorAll("[data-core]").forEach(b => b.onclick = () => {
      if (window.Core) { window.App.showSub("core"); Core.gotoLesson(b.dataset.core); }
    });
    els.mistakes.querySelectorAll("[data-ge]").forEach(b => b.onclick = () => addToMistakeBook(Number(b.dataset.ge)));
    const bad = [];
    a.perMove.forEach((p, i) => { if (p.loss >= 120) bad.push({ i, ...p }); });
    if (!bad.length) {
      els.mistakes.innerHTML = "<div class='dim'>全局发挥稳定，没有明显失误 👍</div>";
      return;
    }
    const head = document.createElement("div");
    head.className = "dim";
    head.style.margin = "4px 0";
    head.textContent = "问题着法（点击跳转）：";
    els.mistakes.appendChild(head);
    for (const b of bad) {
      const row = document.createElement("button");
      row.className = "gm-mistake " + (b.loss >= 500 ? "big" : b.loss >= 250 ? "mid" : "sml");
      row.textContent = (Math.floor(b.i / 2) + 1) + (b.i % 2 ? "…黑" : ".红") + " " + cur.moves[b.i].cn +
        "（" + b.cls + "，损" + b.loss + "分）";
      row.onclick = () => { viewIdx = b.i + 1; refreshBoard(); };
      row.title = "点击跳转局面";
      els.mistakes.appendChild(row);
      const add = document.createElement("button");
      add.className = "gm-mini";
      add.textContent = "＋错题本";
      add.title = "生成练习：走出当时的最佳着（需引擎）";
      add.onclick = () => addToMistakeBook(b.i);
      els.mistakes.appendChild(add);
    }
  }

  /* 从问题着生成实战错题：复核局面 → 引擎给最佳着 → 入复习队列（7.5 流程精简版） */
  async function addToMistakeBook(i) {
    if (!window.Learn) return;
    if (!Engine.ready) { els.prog.textContent = "引擎不可用，暂时无法生成错题练习。"; return; }
    const move = cur.moves[i];
    const p = positionAt(cur, i);   // 问题着走之前的局面
    const fen = X.boardToFen(p.board, p.side);
    els.prog.textContent = "正在复核局面…";
    const cands = await Engine.candidates(fen, 800, 4, Engine.PRIORITY.USER);
    if (!cands || !cands.length) { els.prog.textContent = "引擎未能复核该局面，已跳过。"; return; }
    const best = cands[0];
    if (best.mv === move.m) { els.prog.textContent = "复核后这手其实是可行着，不必入库。"; return; }
    if (best.cp <= -800) { els.prog.textContent = "该局面已大败，更适合作为复盘材料，未生成题目。"; return; }
    const loss = Math.round(Math.max(0, best.cp - (cands.find(c => c.mv === move.m) || { cp: best.cp - (cur.analysis && cur.analysis.perMove[i] ? cur.analysis.perMove[i].loss : 200) }).cp));
    // 多解等价（7.5）：与最优分差 ≤30cp 的候选一并接受
    const accept = cands.filter(c => best.cp - c.cp <= 30).slice(0, 3)
      .map(c => ({ mv: c.mv, cn: safeCnLocal(p.board, p.side, c.mv) }));
    Learn.gameEx.add({
      fen, side: p.side, accept,
      loss: loss || (cur.analysis && cur.analysis.perMove[i] ? cur.analysis.perMove[i].loss : 0),
      cls: cur.analysis && cur.analysis.perMove[i] ? cur.analysis.perMove[i].cls : "失误",
      tag: "实战错题", gameId: cur.id, ply: i + 1, cn: move.cn,
      reason: "复盘：第 " + (Math.floor(i / 2) + 1) + " 回合「" + move.cn + "」，更好的是「" + accept[0].cn + "」。"
    });
    els.prog.textContent = "✅ 已加入错题本（做训练 → 错题复习 可练习）。";
  }

  function safeCnLocal(board, side, mvText) {
    try {
      const mv = X.parseMove(mvText);
      if (X.isLegal(board, side, mv)) return Notation.chinese(board, side, mv);
    } catch (e) { Diag.warn("games.safeCnLocal", e); }
    return mvText;
  }

  function drawCurve(curve) {
    const cv = els.curve;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 400;
    cv.width = w * dpr; cv.height = 90 * dpr;
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, 90);
    ctx.fillStyle = "#23252b";
    ctx.fillRect(0, 0, w, 90);
    // 零轴
    ctx.strokeStyle = "#555";
    ctx.beginPath(); ctx.moveTo(0, 45); ctx.lineTo(w, 45); ctx.stroke();
    if (!curve || curve.length < 2) {
      ctx.fillStyle = "#777"; ctx.font = "12px sans-serif";
      ctx.fillText(curve ? "" : "分析后显示形势曲线", 10, 50);
      return;
    }
    const clamp = v => Math.max(-800, Math.min(800, v));
    ctx.strokeStyle = "#d4a03c";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    curve.forEach((cp, i) => {
      const x = (i / (curve.length - 1)) * (w - 4) + 2;
      const y = 45 - (clamp(cp) / 800) * 40;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    // 当前查看位置标记
    if (viewIdx !== null) {
      const x = (viewIdx / (curve.length - 1)) * (w - 4) + 2;
      ctx.strokeStyle = "#5aa864";
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 90); ctx.stroke();
    }
    ctx.fillStyle = "#888"; ctx.font = "10px sans-serif";
    ctx.fillText("优（红）", 4, 12);
    ctx.fillText("优（黑）", 4, 86);
  }

  function exportText() {
    if (!cur) return;
    const d = new Date(cur.ts);
    let lines = ["【象棋教学对局】 " + d.toLocaleString(),
      "难度：" + (cur.levelName || "-") + "  我执：" + (cur.mySide === "r" ? "红" : "黑") +
      "  结果：" + winnerText(cur) + "（" + (cur.reason || "") + "）", ""];
    const row = [];
    cur.moves.forEach((m, i) => {
      if (i % 2 === 0) row.push((i / 2 + 1) + "." + m.cn);
      else row[row.length - 1] += " " + m.cn;
    });
    lines = lines.concat(row);
    navigator.clipboard.writeText(lines.join("\n")).then(
      () => { els.prog.textContent = "已复制到剪贴板。"; },
      () => { els.prog.textContent = lines.join("\n"); }
    );
  }

  window.Games = Object.assign(api, {
    normWinner, userResult, winnerText, _computeLosses: computeLosses, _parseGameText: parseGameText,
    mount,
    show() { renderList(); },
    hide() {},
    step: d => stepView(d)
  });
})();
