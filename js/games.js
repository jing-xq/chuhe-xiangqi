/* 棋谱库：对局保存/列表/查看器（含分析入口）。
 * Games.add(record) / Games.all() / Games.get(id) / Games.remove(id) / Games.saveAnalysis(id, data)
 * Games.mount(container)  Games.show() / hide() */
(function () {
  "use strict";

  const X = window.Xiangqi;
  const KEY = "xq-games-v1";
  let data = [];
  try { data = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { data = []; }

  function persist() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {} }

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

  /* 解析棋谱文本 → { moves:[{m,cn}], result, fen, error }
   * 支持首行（或任意处）带 FEN 的残局摆谱：以该局面为起点解析后续着法。 */
  function parseGameText(text) {
    // 头部信息（【键 值】或 键:值），结果判定
    let result = "unknown";
    const head = /【\s*结果\s*[:：]?\s*([^】]+)】/.exec(text) || /结果\s*[:：]\s*(\S+)/.exec(text);
    if (head) {
      const h = head[1];
      if (/红胜|红先胜/.test(h)) result = "win";
      else if (/黑胜/.test(h)) result = "loss";
      else if (/和|平/.test(h)) result = "draw";
    }
    if (/红胜|红先胜/.test(text.slice(0, 400)) && result === "unknown") result = "win";
    else if (/黑胜/.test(text.slice(0, 400)) && result === "unknown") result = "loss";

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
    let body = text
      .replace(/【[^】]*】/g, " ")
      .replace(/\{[^}]*\}/g, " ")
      .replace(/（[^（）]*）/g, " ")
      .replace(/\([^()]*\)/g, " ")
      .replace(/红先胜|黑先胜|红胜|黑胜|和棋|和局/g, " ")
      .replace(/\d+\s*[.、．:：]/g, " ");
    const tokens = body.split(/[\s,，;；]+/).filter(Boolean);

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
    return { moves, result, fen };
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
    const id = api.add({
      ts: Date.now(), level: -1, levelName: "导入棋谱",
      mySide: sideSel && sideSel.value ? sideSel.value : "r",
      result: r.result, reason: r.error ? "部分导入" : "外部导入", imported: true,
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
      const resText = g.result === "win" ? "胜" : g.result === "loss" ? "负" : g.result === "draw" ? "和" : "谱";
      item.innerHTML =
        "<b>" + d.toLocaleString() + "</b>" +
        "<span class='gm-res " + g.result + "'>" + resText + "</span>" +
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
      const resText = a.game.result === "win" ? "胜" : a.game.result === "loss" ? "负" : a.game.result === "draw" ? "和" : "谱";
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
      " · " + (a.game.result === "win" ? "红胜" : a.game.result === "loss" ? "黑胜" : a.game.result === "draw" ? "和棋" : "结果不详");
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
    const resText = cur.result === "win" ? "红胜" : cur.result === "loss" ? "黑胜" : cur.result === "draw" ? "和棋" : "结果不详";
    els.info.textContent = d.toLocaleString() + " · " + (cur.levelName || "") + " · " +
      (cur.imported ? "外部导入" : (cur.mySide === "r" ? "执红" : "执黑")) + " · " + resText +
      (cur.reason ? "（" + cur.reason + "）" : "");
    els.prog.textContent = "";
    renderMoves();
    renderAnalysis();
    renderList();
    refreshBoard();
  }

  function positionAt(idx) {
    const INIT = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
    const { board: b, side } = X.parseFen(cur.fen || INIT);
    let s = side;
    for (let i = 0; i < idx; i++) {
      X.applyMove(b, ...X.parseMove(cur.moves[i].m));
      s = X.other(s);
    }
    return { board: b, side: s };
  }

  function refreshBoard() {
    const idx = viewIdx === null ? cur.moves.length : viewIdx;
    const { board: b, side } = positionAt(idx);
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

  async function runAnalysis() {
    if (analyzing || !cur) return;
    if (!Engine.ready) { els.prog.textContent = "引擎不可用，无法分析。"; return; }
    analyzing = true;
    els.analyze.disabled = true;
    const n = cur.moves.length;
    const perMove = new Array(n).fill(null);
    const curve = [];   // 红方视角 cp，n+1 个点
    let cancelled = false;
    els.prog.innerHTML = "<button id='gm-cancel'>取消分析</button> <span id='gm-progtext'></span>";
    els.prog.querySelector("#gm-cancel").onclick = () => { cancelled = true; };
    try {
      for (let i = 0; i <= n; i++) {
        if (cancelled) break;
        const { board: b, side } = positionAt(i);
        const cp = await Engine.evalCp(X.boardToFen(b, side), 220);
        if (cp === null) throw new Error("引擎未返回评分");
        curve.push(side === "r" ? cp : -cp);
        const t = els.prog.querySelector("#gm-progtext");
        if (t) t.textContent = "分析中 " + i + "/" + n;
      }
      // 计算每手损益
      for (let i = 0; i < n; i++) {
        const before = cpForMover(curve[i], cur.moves[i].side === "r" ? "r" : "b");      // 走子方视角（走前）
        const after = cpForMover(curve[i + 1], cur.moves[i].side === "r" ? "r" : "b");   // 走子方视角（走后）
        const loss = Math.max(0, before - after);
        perMove[i] = { loss: Math.round(loss), cls: classify(loss) };
      }
      if (!cancelled) {
        if (cur._ann) Annotated.saveAnalysis(cur._ann.id, { curve: curve.map(Math.round), perMove });
        else api.saveAnalysis(cur.id, { curve: curve.map(Math.round), perMove });
        renderAnalysis();
        renderMoves();
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

  function renderAnalysis() {
    const a = cur && cur.analysis;
    els.mistakes.innerHTML = "";
    drawCurve(a ? a.curve : null);
    if (!a) return;
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
      els.mistakes.appendChild(row);
    }
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
      "  结果：" + (cur.result === "win" ? "胜" : cur.result === "loss" ? "负" : "和") + "（" + (cur.reason || "") + "）", ""];
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
    mount,
    show() { renderList(); },
    hide() {},
    step: d => stepView(d)
  });
})();
