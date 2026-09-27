/* 开局训练视图：体系掌握度仪表盘 + 谱线浏览 + 实战模拟训练 + 小结。
 * Opening.mount(container) / show() / hide()
 *
 * 训练状态机：in_book（跟谱）→ punish（对手脱谱，考惩罚）→ free（自由中局）→ debrief
 * in_book 走到谱树叶子：主线 mainlineEndPly 尽头 → book_end；变着末梢 → 直接转 free
 * 掌握度 = 50%·谱着覆盖率 + 30%·惩罚命中率 + 20%·完成局数（体系 × 红/黑 独立记账）
 * 覆盖率分母 = 历次训练中被提供过走子选择的用户节点（offeredIds），非全树节点数
 * 引擎不可用时降级为背谱模式：对手走主线 ch[0]，用户非谱着就地纠正，谱线浏览始终可用。
 * 实时走势：每手棋落地后 fire-and-forget evalCp 采点（红方视角，mate 大数钳制 ±3000），
 * 按 ply 槽位存 ses.evalHist 去乱序，内联 SVG 渲染（红优在上、中线为 0）。 */
(function () {
  "use strict";

  const X = window.Xiangqi;
  const KEY = "xq-openings-v1";
  const RATE_KEY = "xq-openings-devrate";
  const INIT_FEN = (X.INIT_FEN) || "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";

  /* ---------- 掌握度存储 ---------- */
  const store = {
    data: {},
    load() {
      try { this.data = JSON.parse(localStorage.getItem(KEY) || "{}"); }
      catch (e) { this.data = {}; }
    },
    save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) {} },
    get(id, side) {
      const k = id + "|" + side;
      if (!this.data[k]) {
        this.data[k] = { hitIds: [], offeredIds: [], punishN: 0, punishHit: 0, games: 0, attempts: 0, lastAt: 0, recent: [] };
      }
      const r = this.data[k];
      // 旧数据迁移：无 offeredIds 时以 hitIds 兜底（下过的一定被提供过）
      if (!Array.isArray(r.offeredIds)) r.offeredIds = (r.hitIds || []).slice();
      return r;
    },
    addHit(id, side, nodeId) {
      const r = this.get(id, side);
      if (r.hitIds.indexOf(nodeId) < 0) r.hitIds.push(nodeId);
      r.lastAt = Date.now();
      this.save();
    },
    addOffered(id, side, nodeIds) {
      const r = this.get(id, side);
      let changed = false;
      for (const n of nodeIds) {
        if (r.offeredIds.indexOf(n) < 0) { r.offeredIds.push(n); changed = true; }
      }
      if (changed) this.save();
    },
    addPunish(id, side, hit) {
      const r = this.get(id, side);
      r.punishN++;
      if (hit) r.punishHit++;
      this.save();
    },
    addGame(id, side) { this.get(id, side).games++; this.save(); },
    bumpAttempt(id, side) {
      const r = this.get(id, side);
      r.attempts++;
      r.lastAt = Date.now();
    },
    pushRecent(id, side, item) {
      const r = this.get(id, side);
      r.recent.push(item);
      if (r.recent.length > 10) r.recent.shift();
    },
    /* 谱更新容错：hitIds/offeredIds 与现树求交修剪 */
    prune(id, side, validSet) {
      const r = this.get(id, side);
      r.hitIds = r.hitIds.filter(x => validSet.has(x));
      r.offeredIds = r.offeredIds.filter(x => validSet.has(x));
    }
  };
  store.load();

  /* ---------- 谱树工具 ---------- */
  /* 用户节点路径 id：DFS 序号路径 "0/2/1"；返回 side 方行棋的全部节点 id */
  function userNodeIds(data, side) {
    const start = (X.parseFen(data.fen || INIT_FEN)).side;
    const out = [];
    (function walk(moves, mover, prefix) {
      (moves || []).forEach((n, i) => {
        const id = prefix ? prefix + "/" + i : "" + i;
        if (mover === side) out.push(id);
        walk(n.ch, X.other(mover), id);
      });
    })(data.moves, start, "");
    return out;
  }

  function pruneStore(id, data) {
    for (const side of ["r", "b"]) {
      store.prune(id, side, new Set(userNodeIds(data, side)));
    }
    store.save();
  }

  /* 掌握度现算 */
  function sideStats(sysId, side, meta) {
    const rec = store.get(sysId, side);
    const data = sysCache[sysId];
    let valid = null;
    if (data) valid = new Set(userNodeIds(data, side));
    let hits = rec.hitIds.length;
    if (valid) hits = rec.hitIds.filter(x => valid.has(x)).length;
    // 分母：历次训练中被提供过走子选择的用户节点（与现树求交）
    let N = rec.offeredIds.length;
    if (valid) N = rec.offeredIds.filter(x => valid.has(x)).length;
    hits = Math.min(hits, N);
    const coverage = N ? hits / N : 0;
    const punishRate = rec.punishN === 0 ? 0.5 : rec.punishHit / rec.punishN;
    const mastery = Math.round(50 * coverage + 30 * punishRate + 20 * Math.min(rec.games / 5, 1));
    const stale = !!(rec.rev && sysRev[sysId] && rec.rev !== sysRev[sysId]);
    return { N, hits, coverage, punishRate, mastery, has: rec.attempts > 0, stale, rec };
  }

  /* ---------- 小工具 ---------- */
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function scoreBadge(score, has) {
    if (!has) return "<span class='gm-score s-na'>—</span>";
    const cls = score >= 80 ? "s-high" : score >= 60 ? "s-mid" : score >= 40 ? "s-low" : "s-bad";
    return "<span class='gm-score " + cls + "'>" + score + "</span>";
  }

  /* 引擎主线（内部坐标文本）→ 中文着法序列（本地版，不动 coachbrain.js） */
  function pvToCn(board, side, line, maxPlies) {
    if (!line || !line.length) return "";
    const b = X.cloneBoard(board);
    let s = side;
    const out = [];
    const limit = Math.min(maxPlies || 4, line.length);
    for (let i = 0; i < limit; i++) {
      let mv;
      try { mv = X.parseMove(line[i]); } catch (e) { break; }
      try { if (!X.isLegal(b, s, mv)) break; } catch (e) { break; }
      out.push(Notation.chinese(b, s, mv));
      X.applyMove(b, mv[0], mv[1], mv[2], mv[3]);
      s = X.other(s);
    }
    return out.join(" → ") + (line.length > limit ? " ……" : "");
  }

  function offLabel(loss) {
    return loss < 40 ? "等价脱谱" : loss < 120 ? "小偏离" : loss < 250 ? "脱谱欠佳" : loss < 500 ? "脱谱失误" : "脱谱漏着";
  }
  function punishLabel(loss) {
    return loss < 40 ? "命中·精确" : loss < 120 ? "命中·严厉" : loss < 250 ? "惩罚乏力" : loss < 500 ? "错过惩罚" : "反被惩罚";
  }
  function freeLabel(loss) {
    return loss < 40 ? "正常" : loss < 120 ? "一般" : loss < 250 ? "欠佳" : loss < 500 ? "失误" : "漏着";
  }
  function sevOf(fall) {
    if (fall == null) return null;
    return fall < 60 ? "温和" : fall <= 150 ? "明显" : "严重";
  }
  function sevBadge(fall) {
    const s = sevOf(fall);
    if (!s) return "";
    const cls = s === "温和" ? "tk tk-a" : s === "明显" ? "tk tk-c" : "tk tk-b";
    return "<span class='" + cls + "'>脱谱·" + s + "</span>";
  }
  function fmtDate(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    return (d.getMonth() + 1) + "/" + d.getDate();
  }

  /* ---------- 实时走势纯函数 ---------- */
  /* mate 大数（±100000-m）钳制到 ±EVAL_CLAMP，避免图表爆掉 */
  const EVAL_CLAMP = 3000;
  function clampCp(cp) {
    if (cp > EVAL_CLAMP) return EVAL_CLAMP;
    if (cp < -EVAL_CLAMP) return -EVAL_CLAMP;
    return cp;
  }
  /* 走子方视角 cp → 红方视角（走子方是黑则取负），同时钳制 */
  function cpToRed(cp, moverSide) {
    return clampCp(moverSide === "r" ? cp : -cp);
  }
  /* 红方视角 cp → SVG y 坐标：红优在上（y→0），黑优在下（y→H），tanh 非线性压缩 */
  function evalY(cp, H) {
    return (H / 2) * (1 - Math.tanh(cp / 400));
  }

  /* ---------- 全局状态 ---------- */
  let els = {};
  let boardDetail = null, boardTrain = null;
  let indexData = null;
  const sysCache = {};          // id -> 谱 json
  let curSys = null;            // 当前体系 meta（index 条目）
  let curData = null;           // 当前体系谱 json
  let player = null;            // 详情谱线浏览
  let detailTab = "moves";
  let curSub = "dash";          // dash | detail | train | debrief
  let ses = null;               // 训练会话
  let uiToken = 0;              // 会话令牌：防跨会话的僵尸异步回调
  let devRate = 0.35;           // 对手脱谱概率

  /* ---------- 挂载 ---------- */
  function mount(container) {
    container.innerHTML = `
      <div class="op-wrap">
        <div id="op-dash">
          <div class="op-top">
            <span class="op-top-title">🗺️ 开局训练</span>
            <span id="op-dash-note" class="dim"></span>
          </div>
          <div id="op-grid" class="op-grid"></div>
        </div>

        <div id="op-detail" class="hidden">
          <div class="op-top">
            <button id="op-back">← 返回</button>
            <span id="op-title" class="op-top-title"></span>
            <span id="op-level" class="tk tk-c"></span>
            <label class="dim">脱谱频率
              <select id="op-devrate">
                <option value="0.2">少</option>
                <option value="0.35">中</option>
                <option value="0.55">多</option>
              </select></label>
            <button id="op-train-r" class="primary">▶ 训练执红</button>
            <button id="op-train-b" class="primary">▶ 训练执黑</button>
          </div>
          <div id="op-intro" class="pl-desc"></div>
          <div id="op-guide" class="pl-desc hidden"></div>
          <div class="op-detail-main">
            <div class="op-board-col">
              <canvas id="op-board"></canvas>
              <div class="board-buttons">
                <button id="op-b-start" title="回到开局">⏮</button>
                <button id="op-b-prev" title="上一步">◀</button>
                <button id="op-b-auto" title="自动播放">▶</button>
                <button id="op-b-next" title="下一步">▶|</button>
                <button id="op-b-end" title="走到末尾">⏭</button>
                <button id="op-b-flip" title="翻转棋盘">⇅</button>
              </div>
            </div>
            <div class="op-side-col">
              <div id="op-var" class="var-panel"></div>
              <div class="tabs">
                <button id="op-tab-moves" class="tab active">着法</button>
                <button id="op-tab-comment" class="tab">评注</button>
              </div>
              <div id="op-movelist" class="movelist"></div>
              <div id="op-comment" class="comment hidden"></div>
            </div>
          </div>
        </div>

        <div id="op-train" class="hidden">
          <div class="op-top">
            <button id="op-t-end">✕ 结束</button>
            <span id="op-t-title" class="op-top-title"></span>
            <span id="op-t-phase" class="tk tk-x"></span>
            <span id="op-t-note" class="dim"></span>
          </div>
          <div class="play-main">
            <div class="play-board-col">
              <canvas id="op-tboard"></canvas>
              <div id="op-t-status" class="op-status"></div>
              <div id="op-t-chart" class="op-chart"></div>
            </div>
            <div class="play-side">
              <div id="op-t-events" class="op-events"></div>
              <div id="op-t-moves" class="movelist"></div>
              <div class="play-btns">
                <button id="op-t-hint">💡 提示</button>
                <button id="op-t-answer">看答案</button>
                <button id="op-t-flip">⇅ 翻转</button>
              </div>
            </div>
          </div>
        </div>

        <div id="op-debrief" class="hidden">
          <div class="op-top">
            <button id="op-d-back">← 返回体系</button>
            <span id="op-d-title" class="op-top-title"></span>
            <span id="op-d-verdict"></span>
          </div>
          <div id="op-d-body" class="op-debrief-body"></div>
          <div class="quiz-buttons" style="margin-top:10px">
            <button id="op-d-again" class="primary">↻ 再练一局</button>
            <button id="op-d-dash">返回仪表盘</button>
          </div>
        </div>
      </div>`;

    els = {
      dash: container.querySelector("#op-dash"),
      grid: container.querySelector("#op-grid"),
      dashNote: container.querySelector("#op-dash-note"),
      detail: container.querySelector("#op-detail"),
      back: container.querySelector("#op-back"),
      title: container.querySelector("#op-title"),
      level: container.querySelector("#op-level"),
      intro: container.querySelector("#op-intro"),
      guide: container.querySelector("#op-guide"),
      devrate: container.querySelector("#op-devrate"),
      trainR: container.querySelector("#op-train-r"),
      trainB: container.querySelector("#op-train-b"),
      bStart: container.querySelector("#op-b-start"),
      bPrev: container.querySelector("#op-b-prev"),
      bAuto: container.querySelector("#op-b-auto"),
      bNext: container.querySelector("#op-b-next"),
      bEnd: container.querySelector("#op-b-end"),
      bFlip: container.querySelector("#op-b-flip"),
      dVar: container.querySelector("#op-var"),
      tabMoves: container.querySelector("#op-tab-moves"),
      tabComment: container.querySelector("#op-tab-comment"),
      dMovelist: container.querySelector("#op-movelist"),
      dComment: container.querySelector("#op-comment"),
      train: container.querySelector("#op-train"),
      tEnd: container.querySelector("#op-t-end"),
      tTitle: container.querySelector("#op-t-title"),
      tPhase: container.querySelector("#op-t-phase"),
      tNote: container.querySelector("#op-t-note"),
      tStatus: container.querySelector("#op-t-status"),
      tChart: container.querySelector("#op-t-chart"),
      tEvents: container.querySelector("#op-t-events"),
      tMoves: container.querySelector("#op-t-moves"),
      tHint: container.querySelector("#op-t-hint"),
      tAnswer: container.querySelector("#op-t-answer"),
      tFlip: container.querySelector("#op-t-flip"),
      debrief: container.querySelector("#op-debrief"),
      dBack: container.querySelector("#op-d-back"),
      dTitle: container.querySelector("#op-d-title"),
      dVerdict: container.querySelector("#op-d-verdict"),
      dBody: container.querySelector("#op-d-body"),
      dAgain: container.querySelector("#op-d-again"),
      dDash: container.querySelector("#op-d-dash")
    };

    boardDetail = Board.create(container.querySelector("#op-board"), {
      onMove: () => Sound.play("illegal")   // 谱线浏览只看不走
    });
    boardTrain = Board.create(container.querySelector("#op-tboard"), {
      onMove: onUserMove,
      onIllegal: () => Sound.play("illegal")
    });
    player = Player.create();
    player.onChange = refreshDetailBoard;

    els.back.onclick = () => { player.stopAuto(); showSub("dash"); renderDash(); };
    els.trainR.onclick = () => startSession("r");
    els.trainB.onclick = () => startSession("b");
    els.bStart.onclick = () => { Sound.play("click"); player.gotoStart(); };
    els.bPrev.onclick = () => player.prev();
    els.bNext.onclick = () => player.next();
    els.bEnd.onclick = () => { Sound.play("click"); player.gotoEnd(); };
    els.bAuto.onclick = () => {
      if (player.autoRunning) player.stopAuto();
      else player.autoPlay(600);
      refreshDetailBoard();
    };
    els.bFlip.onclick = () => boardDetail.flip();
    els.tabMoves.onclick = () => setDetailTab("moves");
    els.tabComment.onclick = () => setDetailTab("comment");
    els.tEnd.onclick = () => endSession("abandon");
    els.tHint.onclick = showHint;
    els.tAnswer.onclick = showAnswer;
    els.tFlip.onclick = () => boardTrain.flip();
    els.dBack.onclick = () => { showSub("detail"); refreshDetail(); };
    els.dAgain.onclick = () => startSession(ses ? ses.mySide : "r");
    els.dDash.onclick = () => { showSub("dash"); renderDash(); };

    const saved = localStorage.getItem(RATE_KEY);
    if (saved) {
      devRate = Number(saved) || 0.35;
      els.devrate.value = saved;
    }
    els.devrate.onchange = () => {
      devRate = Number(els.devrate.value) || 0.35;
      try { localStorage.setItem(RATE_KEY, els.devrate.value); } catch (e) {}
    };

    loadAll();
    showSub("dash");
  }

  function showSub(name) {
    curSub = name;
    els.dash.classList.toggle("hidden", name !== "dash");
    els.detail.classList.toggle("hidden", name !== "detail");
    els.train.classList.toggle("hidden", name !== "train");
    els.debrief.classList.toggle("hidden", name !== "debrief");
  }

  /* ---------- 数据加载 ---------- */
  function loadAll() {
    els.dashNote.textContent = "加载体系列表…";
    fetch("data/openings/index.json").then(r => r.json()).then(idx => {
      indexData = idx;
      renderDash();
      els.dashNote.textContent = "加载谱库…";
      return Promise.all(idx.systems.map(s => loadSys(s.id)));
    }).then(() => {
      renderDash();
      updateDashNote();
    }).catch(e => {
      els.dashNote.textContent = "谱库加载失败：" + e.message;
    });
  }

  /* 内容版本（7.7）：以主线着法序列的哈希作为内容修订号。
   * 谱库更新后旧掌握记录标记「内容已更新」，避免误继承。 */
  const sysRev = {};
  function revOf(data) {
    const line = [];
    let nodes = data.moves || [];
    while (nodes.length && line.length < 40) { line.push(nodes[0].m); nodes = nodes[0].ch ? [nodes[0].ch[0]] : []; }
    let h = 5381;
    const str = line.join(" ");
    for (let i = 0; i < str.length; i++) { h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; }
    return "r" + h.toString(36);
  }
  function loadSys(id) {
    if (sysCache[id]) return Promise.resolve(sysCache[id]);
    const meta = indexData.systems.find(s => s.id === id);
    if (!meta) return Promise.reject(new Error("未知体系 " + id));
    return fetch(meta.file).then(r => r.json()).then(data => {
      sysCache[id] = data;
      sysRev[id] = revOf(data);
      pruneStore(id, data);
      return data;
    });
  }

  function updateDashNote() {
    els.dashNote.textContent = Engine.ready
      ? "引擎就绪——训练中会实时评级，对手会主动脱谱考你的惩罚。"
      : "引擎不可用：背谱模式（对手走主线、就地纠偏，无评级）。谱线浏览照常。";
  }

  /* ---------- 仪表盘 ---------- */
  function renderDash() {
    if (!indexData) return;
    updateDashNote();
    els.grid.innerHTML = "";
    for (const meta of indexData.systems) {
      const card = document.createElement("div");
      card.className = "op-card";
      let rows = "";
      for (const side of ["r", "b"]) {
        const st = sideStats(meta.id, side, meta);
        const pct = Math.round(st.coverage * 100);
        const punishTxt = st.rec.punishN
          ? "惩罚 " + st.rec.punishHit + "/" + st.rec.punishN
          : "惩罚 —";
        rows +=
          "<div class='op-cell'>" +
            "<span class='op-side-tag'>" + (side === "r" ? "执红" : "执黑") + "</span>" +
            scoreBadge(st.mastery, st.has) +
            "<div class='op-bar-cell'>" +
              "<div class='op-bar'><div class='op-fill' style='width:" + (st.has ? pct : 0) + "%'></div></div>" +
              "<div class='op-meta'>跟谱 " + (st.has ? pct : 0) + "% · " + punishTxt +
              " · 完成 " + st.rec.games + " · 上次 " + fmtDate(st.rec.lastAt) + "</div>" +
            "</div>" +
          "</div>";
      }
      card.innerHTML =
        "<h3>" + escapeHtml(meta.name) + "</h3>" +
        "<div class='op-tags'>" + escapeHtml(meta.redOpening) + " · 对 " + escapeHtml(meta.blackDefense) +
        " <span class='tk tk-c'>" + escapeHtml(meta.level || "入门") + "</span></div>" +
        rows;
      card.onclick = () => openDetail(meta);
      els.grid.appendChild(card);
    }
  }

  /* ---------- 详情 + 谱线浏览 ---------- */
  function openDetail(meta) {
    Sound.play("click");
    curSys = meta;
    loadSys(meta.id).then(data => {
      curData = data;
      els.title.textContent = meta.name;
      els.level.textContent = data.level || "入门";
      els.intro.textContent = data.intro || "";
      renderGuide(data.guide);
      player.load(data);
      showSub("detail");
      refreshDetail();
    }).catch(e => {
      els.dashNote.textContent = "谱加载失败：" + e.message;
    });
  }

  /* T6：体系阵型指南（data/openings/<id>.json 的 guide 字段，缺失时整块隐藏） */
  function renderGuide(g) {
    if (!g || !Array.isArray(g.formation) || !g.formation.length) {
      els.guide.classList.add("hidden");
      return;
    }
    const list = (icon, label, arr) =>
      arr && arr.length ? "<div style='margin:4px 0'>" + icon + " <b>" + label + "</b>：" +
        arr.map(s => escapeHtml(s)).join("；") + "</div>" : "";
    els.guide.innerHTML =
      list("🏰", "阵型目标", g.formation) +
      list("⚔️", "常见计划", g.plans) +
      list("⚠️", "要防的", g.warnings);
    els.guide.classList.remove("hidden");
  }

  function refreshDetail() {
    if (!curData) return;
    refreshDetailBoard();
  }

  function setDetailTab(name) {
    detailTab = name;
    els.tabMoves.classList.toggle("active", name === "moves");
    els.tabComment.classList.toggle("active", name === "comment");
    els.dMovelist.classList.toggle("hidden", name !== "moves");
    els.dComment.classList.toggle("hidden", name !== "comment");
  }

  function refreshDetailBoard() {
    if (!curData || curSub !== "detail") return;
    const { board, side } = player.replay();
    boardDetail.update({
      board, turn: side, lastMove: player.lastMove(),
      hint: null, interactive: false
    });
    els.bPrev.disabled = !player.canPrev();
    els.bNext.disabled = !player.canNext();
    els.bAuto.classList.toggle("on", player.autoRunning);
    els.bAuto.textContent = player.autoRunning ? "⏸" : "▶";
    renderVariations();
    renderComment();
    renderMoveList();
  }

  function renderVariations() {
    els.dVar.innerHTML = "";
    const ch = player.children();
    if (ch.length > 1) {
      const label = document.createElement("span");
      label.className = "var-label";
      label.textContent = "下一手变着：";
      els.dVar.appendChild(label);
      ch.forEach((n, i) => {
        const b = document.createElement("button");
        b.className = "var-btn";
        b.textContent = (i === 0 ? "正着：" : "变" + i + "：") + n.cn;
        b.onclick = () => { Sound.play("move"); player.choose(i); };
        els.dVar.appendChild(b);
      });
    }
  }

  function renderComment() {
    const c = player.comment();
    els.dComment.textContent = c || "走到带 ◎ 的着法可查看评注。";
  }

  /* 谱线表：主线沿 ch[0] 全展开，ch[1..] 作为完整变着线挂在分岔点下 */
  function renderMoveList() {
    const box = els.dMovelist;
    box.innerHTML = "";
    const root = (curData && curData.moves) || [];
    if (!root.length) return;

    function mvSpan(node, idx, ply) {
      const span = document.createElement("span");
      span.className = "mv";
      if (ply % 2 === 0) {
        const num = document.createElement("span");
        num.className = "mvnum";
        num.textContent = (Math.floor(ply / 2) + 1) + ".";
        span.appendChild(num);
      }
      const t = document.createElement("span");
      t.textContent = node.cn + (node.c ? " ◎" : "");
      t.className = "mv";
      span.appendChild(t);
      span.dataset.idx = JSON.stringify(idx);
      span.onclick = () => jumpTo(idx);
      return span;
    }

    /* 渲染 node 及其 ch[0] 主链；分岔变着整行挂在下方 */
    function renderChain(container, node, idx, ply) {
      let n = node, path = idx.slice(), d = ply;
      while (n) {
        container.appendChild(mvSpan(n, path, d));
        const ch = n.ch || [];
        for (let v = 1; v < ch.length; v++) {
          const vline = document.createElement("span");
          vline.className = "varline";
          vline.innerHTML = "<span class='vtag'>变" + v + "：</span>";
          renderChain(vline, ch[v], path.concat([v]), d + 1);
          container.appendChild(vline);
        }
        if (!ch.length) break;
        path = path.concat([0]);
        n = ch[0];
        d++;
      }
    }

    const frag = document.createDocumentFragment();
    root.forEach((node, i) => {
      if (i === 0) renderChain(frag, node, [i], 0);
      else {
        const vline = document.createElement("span");
        vline.className = "varline";
        vline.innerHTML = "<span class='vtag'>开局变" + i + "：</span>";
        renderChain(vline, node, [i], 0);
        frag.appendChild(vline);
      }
    });
    box.appendChild(frag);

    // 高亮当前节点
    const path = player.path;
    const idxArr = [];
    let siblings = root;
    for (const n of path) {
      const i = siblings.indexOf(n);
      if (i < 0) break;
      idxArr.push(i);
      siblings = (n.ch && n.ch.length) ? n.ch : [];
    }
    const want = JSON.stringify(idxArr);
    box.querySelectorAll(".mv[data-idx]").forEach(el => {
      if (el.dataset.idx === want) {
        el.classList.add("cur");
        el.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function jumpTo(idx) {
    let nodes = (curData && curData.moves) || [];
    const pathNodes = [];
    for (const i of idx) {
      const n = nodes[i];
      if (!n) return;
      pathNodes.push(n);
      nodes = n.ch || [];
    }
    Sound.play("click");
    player.setPath(pathNodes);
  }

  /* ---------- 训练会话 ---------- */
  function startSession(side) {
    if (!curData || !curSys) return;
    Sound.play("click");
    uiToken++;
    const endPly = curData.mainlineEndPly || 18;
    const pos = X.parseFen(curData.fen || INIT_FEN);
    ses = {
      meta: curSys, data: curData, mySide: side,
      board: pos.board, side: pos.side,
      moves: [],            // {m, cn, side, chk, kind}
      rep: [{ key: X.boardToFen(pos.board, pos.side), check: false, side: null }],
      bookNode: null, bookId: null,
      phase: "in_book",     // in_book | punish | free
      onMainline: true,     // 双方是否一直沿 ch[0] 主线走
      mode: Engine.ready ? "sim" : "memorize",
      endPly, softEnd: endPly + 4, hardEnd: endPly + 8,
      oppIn: 0,
      stats: { bookHit: 0, bookAnswer: 0, bookOff: 0, punishN: 0, punishHit: 0, freeN: 0 },
      events: [],
      evalHist: [],         // 实时走势：按 ply 槽位存放 {ply, cp}（cp 红方视角，已钳制）
      thinking: false,
      finished: false,
      reachedMid: false,
      masteryBefore: sideStats(curSys.id, side, curSys).mastery
    };
    store.bumpAttempt(curSys.id, side);
    store.save();
    // 执黑自动黑方视角
    const wantOrient = side === "b" ? "black" : "red";
    if (boardTrain.orientation !== wantOrient) boardTrain.flip();
    els.tTitle.textContent = curSys.name + "（" + (side === "r" ? "执红" : "执黑") + "）";
    showSub("train");
    if (ses.side !== ses.mySide) engineTurn();
    else refreshTrain();
  }

  function bookOptions() {
    if (!ses) return [];
    return ses.bookNode ? (ses.bookNode.ch || []) : ((ses.data && ses.data.moves) || []);
  }

  function bookIdFor(idx) {
    return ses.bookId == null ? String(idx) : ses.bookId + "/" + idx;
  }

  function setTrainStatus(html, cls) {
    els.tStatus.innerHTML = html;
    els.tStatus.className = "op-status" + (cls ? " " + cls : "");
  }

  function phaseBadge() {
    if (ses.mode === "memorize") { els.tPhase.className = "tk tk-c"; els.tPhase.textContent = "背谱模式"; return; }
    if (ses.phase === "punish") { els.tPhase.className = "tk tk-b"; els.tPhase.textContent = "⚡ 惩罚时刻"; }
    else if (ses.phase === "free") { els.tPhase.className = "tk tk-c"; els.tPhase.textContent = "自由中局"; }
    else { els.tPhase.className = "tk tk-a"; els.tPhase.textContent = "跟谱中"; }
  }

  function refreshTrain() {
    if (!ses || curSub !== "train") return;
    const last = ses.moves.length ? X.parseMove(ses.moves[ses.moves.length - 1].m) : null;
    const myTurn = !ses.finished && !ses.thinking && ses.side === ses.mySide;
    // 跟谱阶段轮到自己：bookOptions 即本回合被提供选择的谱着，计入掌握度分母
    if (myTurn && ses.phase === "in_book") {
      const opts = bookOptions();
      if (opts.length) {
        store.addOffered(ses.meta.id, ses.mySide, opts.map((n, i) => bookIdFor(i)));
      }
    }
    boardTrain.update({
      board: ses.board, turn: ses.side, lastMove: last,
      interactive: myTurn, hint: null
    });
    phaseBadge();
    renderEvalChart();
    renderTrainMoves();
    renderEvents();
    els.tHint.disabled = !myTurn;
    els.tAnswer.disabled = !myTurn;
    els.tEnd.disabled = ses.finished || ses.thinking;
    els.tNote.textContent = ses.mode === "memorize"
      ? "（背谱模式：引擎不可用，只跟谱不评级）"
      : (ses.phase === "punish" ? "对手脱谱了——走出最严厉的惩罚！" : "");
  }

  function renderTrainMoves() {
    const box = els.tMoves;
    box.innerHTML = "";
    ses.moves.forEach((node, i) => {
      if (node.side === "r") {
        const num = document.createElement("span");
        num.className = "mvnum";
        num.textContent = (Math.floor(i / 2) + 1) + ".";
        box.appendChild(num);
      }
      const span = document.createElement("span");
      span.className = "mv" + (node.kind === "dev" ? " badmove" : "");
      span.textContent = node.cn;
      box.appendChild(span);
    });
    const cur = box.lastElementChild;
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }

  function renderEvents() {
    const box = els.tEvents;
    if (!ses.events.length) {
      box.innerHTML = "<div class='dim'>暂无事件——跟谱走到入中局，或等对手脱谱考惩罚。</div>";
      return;
    }
    box.innerHTML = ses.events.map(e => {
      if (e.t === "dev") {
        return "<div class='op-ev'>⚡ 对手脱谱「<b>" + escapeHtml(e.cn) + "</b>」 " + sevBadge(e.fall) +
          (e.userCn ? "<br>你：" + escapeHtml(e.userCn) + " → " + escapeHtml(e.label || "") : "<br><span class='dim'>等你惩罚…</span>") +
          "</div>";
      }
      if (e.t === "off") {
        return "<div class='op-ev'>✘ 主动脱谱「" + escapeHtml(e.cn) + "」 → " +
          escapeHtml(e.label || "") + (e.loss != null ? "（损 " + e.loss + "）" : "") + "</div>";
      }
      if (e.t === "free") {
        return "<div class='op-ev'>· 走「" + escapeHtml(e.cn) + "」 → " +
          escapeHtml(e.label || "") + (e.loss != null ? "（损 " + e.loss + "）" : "") + "</div>";
      }
      if (e.t === "punish") {
        return "<div class='op-ev'>⚖ 惩罚「" + escapeHtml(e.cn) + "」 → " + escapeHtml(e.label || "") +
          (e.loss != null ? "（损 " + e.loss + "）" : "") + "</div>";
      }
      return "";
    }).join("");
  }

  function onUserMove(f0, r0, f1, r1) {
    if (!ses || ses.finished || ses.thinking) return;
    if (ses.side !== ses.mySide) return;
    const mv = [f0, r0, f1, r1];
    if (!X.isLegal(ses.board, ses.side, mv)) { Sound.play("illegal"); return; }
    const text = X.moveToText(mv);
    if (ses.phase === "in_book") {
      const opts = bookOptions();
      const idx = opts.findIndex(n => n.m === text);
      if (idx >= 0) { userBookHit(opts[idx], idx); return; }
      if (ses.mode === "memorize") {
        Sound.play("illegal");
        setTrainStatus("✘ 还不是谱着，再想想（可点「提示」或「看答案」）。");
        return;
      }
      userOffBook(text);
      return;
    }
    if (ses.phase === "punish") { userPunish(text); return; }
    userFree(text);
  }

  function userBookHit(node, idx) {
    const id = bookIdFor(idx);
    applyMove(node.m, "book");
    ses.bookNode = node;
    ses.bookId = id;
    if (idx !== 0) ses.onMainline = false;
    ses.stats.bookHit++;
    store.addHit(ses.meta.id, ses.mySide, id);
    ses.events.push({ t: "hit", ply: ses.moves.length, cn: node.cn, id });
    if (!node.ch || !node.ch.length) {
      if (bookLeafNext()) return;
      setTrainStatus("✅ 谱着 " + escapeHtml(node.cn) + "。变着线已走完——转入自由中局，引擎接管对手。");
      engineTurn();
      return;
    }
    if (maybeSoftEnd()) return;
    setTrainStatus("✅ 谱着 " + escapeHtml(node.cn) + "，继续跟谱。");
    engineTurn();
  }

  /* 用户主动脱谱：引擎评级 → 自由中局 */
  async function userOffBook(text) {
    const token = uiToken;
    ses.thinking = true;
    refreshTrain();
    const boardBefore = X.cloneBoard(ses.board);
    const sideBefore = ses.side;
    const cn = Notation.chinese(ses.board, ses.side, X.parseMove(text));
    const ev = await evaluateChoice(boardBefore, sideBefore, text);
    if (token !== uiToken) return;
    applyMove(text, "off");
    ses.stats.bookOff++;
    const label = ev ? offLabel(ev.loss) : "脱谱（未评级）";
    const bestCn = ev ? pvToCn(boardBefore, sideBefore, ev.bestLine, 4) : "";
    ses.events.push({ t: "off", ply: ses.moves.length, cn, loss: ev ? ev.loss : null, label, bestCn });
    setTrainStatus(
      "✘ 主动脱谱「" + escapeHtml(cn) + "」 → " + escapeHtml(label) +
      (ev ? "（损 " + ev.loss + " 分）" : "") +
      (bestCn ? "<br><span class='dim'>引擎主线：" + bestCn + "</span>" : "")
    );
    ses.phase = "free";
    if (checkEnd() || maybeSoftEnd()) { ses.thinking = false; return; }
    await engineTurnCore(token);
    if (token === uiToken) { ses.thinking = false; refreshTrain(); }
  }

  /* 惩罚时刻：对手脱谱后的第一应 */
  async function userPunish(text) {
    const token = uiToken;
    ses.thinking = true;
    refreshTrain();
    const boardBefore = X.cloneBoard(ses.board);
    const sideBefore = ses.side;
    const cn = Notation.chinese(ses.board, ses.side, X.parseMove(text));
    const ev = await evaluateChoice(boardBefore, sideBefore, text);
    if (token !== uiToken) return;
    applyMove(text, "punish");
    ses.stats.punishN++;
    const hit = ev ? ev.loss < 120 : false;
    if (hit) ses.stats.punishHit++;
    const label = ev ? punishLabel(ev.loss) : "（未评级）";
    const bestCn = ev ? pvToCn(boardBefore, sideBefore, ev.bestLine, 4) : "";
    const devEv = ses.events.filter(e => e.t === "dev").pop();
    if (devEv) {
      devEv.userCn = cn;
      devEv.loss = ev ? ev.loss : null;
      devEv.label = label;
      devEv.hit = hit;
      devEv.bestCn = bestCn;
      devEv.bestMv = ev ? ev.bestMv : null;
    }
    if (ev) store.addPunish(ses.meta.id, ses.mySide, hit);
    let msg = "⚖ 惩罚「" + escapeHtml(cn) + "」 → <b>" + escapeHtml(label) + "</b>" +
      (ev ? "（损 " + ev.loss + " 分）" : "");
    if (!hit && devEv && devEv.punish) {
      msg += "<br><span style='color:#e8cf8a'>💬 " + escapeHtml(devEv.punish) + "</span>";
    }
    if (bestCn) msg += "<br><span class='dim'>引擎主线：" + bestCn + "</span>";
    setTrainStatus(msg);
    ses.events.push({ t: "punish", ply: ses.moves.length, cn, loss: ev ? ev.loss : null, label, hit });
    ses.phase = "free";
    renderEvents();
    if (checkEnd() || maybeSoftEnd()) { ses.thinking = false; return; }
    await engineTurnCore(token);
    if (token === uiToken) { ses.thinking = false; refreshTrain(); }
  }

  /* 自由中局：用户着只做展示评级 */
  async function userFree(text) {
    const token = uiToken;
    ses.thinking = true;
    refreshTrain();
    const boardBefore = X.cloneBoard(ses.board);
    const sideBefore = ses.side;
    const cn = Notation.chinese(ses.board, ses.side, X.parseMove(text));
    const ev = await evaluateChoice(boardBefore, sideBefore, text);
    if (token !== uiToken) return;
    applyMove(text, "free");
    ses.stats.freeN++;
    const label = ev ? freeLabel(ev.loss) : "（未评级）";
    ses.events.push({ t: "free", ply: ses.moves.length, cn, loss: ev ? ev.loss : null, label });
    setTrainStatus("走 " + escapeHtml(cn) + " → " + escapeHtml(label) + (ev ? "（损 " + ev.loss + "）" : ""));
    renderEvents();
    if (checkEnd() || maybeSoftEnd()) { ses.thinking = false; return; }
    await engineTurnCore(token);
    if (token === uiToken) { ses.thinking = false; refreshTrain(); }
  }

  /* 提示：谱内直接亮谱着（零引擎）；惩罚/自由局问引擎 */
  async function showHint() {
    if (!ses || ses.finished || ses.thinking || ses.side !== ses.mySide) return;
    if (ses.phase === "in_book") {
      const opts = bookOptions();
      if (!opts.length) return;
      const hint = X.parseMove(opts[0].m);
      boardTrain.update({ board: ses.board, turn: ses.side, hint, interactive: true });
      setTrainStatus("💡 谱着提示：" + escapeHtml(opts[0].cn));
      return;
    }
    const token = uiToken;
    ses.thinking = true;
    refreshTrain();
    const fen = X.boardToFen(ses.board, ses.side);
    const mv = await Engine.hint(fen, 700, Engine.PRIORITY.USER);
    if (token !== uiToken) return;
    ses.thinking = false;
    if (mv) {
      boardTrain.update({ board: ses.board, turn: ses.side, hint: X.parseMove(mv), interactive: true });
      setTrainStatus("💡 引擎提示：" + escapeHtml(Notation.chinese(ses.board, ses.side, X.parseMove(mv))));
    } else {
      setTrainStatus("（引擎暂无提示）");
    }
  }

  /* 看答案：谱内代走谱着记 bookMiss；惩罚时刻代走引擎最佳着记未命中 */
  async function showAnswer() {
    if (!ses || ses.finished || ses.thinking || ses.side !== ses.mySide) return;
    const token = uiToken;
    if (ses.phase === "in_book") {
      const opts = bookOptions();
      if (!opts.length) return;
      const node = opts[0];
      const idx = 0;
      const id = bookIdFor(idx);
      ses.stats.bookAnswer++;
      applyMove(node.m, "answer");
      ses.bookNode = node;
      ses.bookId = id;
      setTrainStatus("正着是：" + escapeHtml(node.cn) + "（记一次未跟上）");
      if (!node.ch || !node.ch.length) {
        if (bookLeafNext()) return;
        setTrainStatus("正着是：" + escapeHtml(node.cn) + "。变着线已走完——转入自由中局。");
        engineTurn();
        return;
      }
      if (maybeSoftEnd()) return;
      engineTurn();
      return;
    }
    // 惩罚/自由：引擎给最佳着
    ses.thinking = true;
    refreshTrain();
    const boardBefore = X.cloneBoard(ses.board);
    const sideBefore = ses.side;
    const fen = X.boardToFen(boardBefore, sideBefore);
    const mv = await Engine.hint(fen, 700, Engine.PRIORITY.USER);
    if (token !== uiToken) return;
    if (!mv) {
      ses.thinking = false;
      setTrainStatus("（引擎暂无答案）");
      refreshTrain();
      return;
    }
    const cn = Notation.chinese(boardBefore, sideBefore, X.parseMove(mv));
    if (ses.phase === "punish") {
      applyMove(mv, "answer");
      ses.stats.punishN++;   // 看答案不算命中，但计入惩罚分母
      store.addPunish(ses.meta.id, ses.mySide, false);
      const devEv = ses.events.filter(e => e.t === "dev").pop();
      if (devEv) {
        devEv.userCn = cn;
        devEv.label = "看答案";
        devEv.hit = false;
        devEv.bestMv = mv;
        devEv.bestCn = cn;
      }
      ses.phase = "free";
      setTrainStatus("正解是：" + escapeHtml(cn) + "（惩罚记未命中）");
    } else {
      applyMove(mv, "answer");
      setTrainStatus("引擎推荐：" + escapeHtml(cn));
    }
    renderEvents();
    if (checkEnd() || maybeSoftEnd()) { ses.thinking = false; return; }
    await engineTurnCore(token);
    if (token === uiToken) { ses.thinking = false; refreshTrain(); }
  }

  /* ---------- 走子与终局判定（照 play.js，无 unmake） ---------- */
  function applyMove(mvText, kind) {
    const mv = X.parseMove(mvText);
    const cn = Notation.chinese(ses.board, ses.side, mv);
    const mover = ses.side;
    const captured = X.applyMove(ses.board, mv[0], mv[1], mv[2], mv[3]);
    const gaveCheck = X.isCheck(ses.board, X.other(ses.side));
    const mate = X.isCheckmate(ses.board, X.other(ses.side));
    ses.moves.push({ m: mvText, cn, side: mover, chk: gaveCheck, kind });
    if (mate || gaveCheck) Sound.play("check");
    else if (captured) Sound.play("capture");
    else Sound.play("move");
    ses.side = X.other(ses.side);
    ses.rep.push({ key: X.boardToFen(ses.board, ses.side), check: gaveCheck, side: mover });
    collectEval(ses.moves.length, X.boardToFen(ses.board, ses.side), ses.side);
  }

  /* 每手棋落地后 fire-and-forget 取实时评分：红方视角入 evalHist 的 ply 槽位，
   * 槽位写入天然去乱序；失败/跨会话结果静默丢弃，不打断状态机 */
  function collectEval(ply, fen, sideToMove) {
    if (!ses || ses.mode === "memorize" || !Engine.ready) return;
    const token = uiToken;
    Engine.evalCp(fen, 300, Engine.PRIORITY.AMBIENT).then(cp => {
      if (cp == null || token !== uiToken || !ses || ses.finished) return;
      ses.evalHist[ply] = { ply, cp: cpToRed(cp, sideToMove) };
      if (curSub === "train") renderEvalChart();
    }).catch(() => {});
  }

  /* 走势图 HTML（内联 SVG，viewBox 自适应容器宽度）：
   * 中线为 0，红优在上、黑优在下；当前手画竖直指示线 + 圆点 */
  function evalChartHtml(hist, curPly, mode, live) {
    if (mode === "memorize") return "<div class='op-chart-none dim'>背谱模式无实时评分</div>";
    const pts = [];
    for (let ply = 0; ply < (hist || []).length; ply++) {
      if (hist[ply]) pts.push({ ply, cp: hist[ply].cp });
    }
    if (!pts.length) return "<div class='op-chart-none dim'>等待评分……引擎逐手实时评估中</div>";
    const W = 320, H = 80, PAD = 6;
    const maxPly = Math.max(curPly, pts[pts.length - 1].ply, 1);
    const x = ply => PAD + ply * (W - 2 * PAD) / maxPly;
    const y = cp => evalY(cp, H);
    const last = pts[pts.length - 1];
    const v = last.cp / 100;
    const who = v > 0.15 ? "红优" : v < -0.15 ? "黑优" : "均势";
    const head = "<div class='op-chart-head'><span>" + (live ? "实时走势" : "本局走势") +
      "（红方视角）</span><span>" +
      who + " " + (v > 0 ? "+" : "") + v.toFixed(1) + "</span></div>";
    let dLine = "";
    for (const p of pts) dLine += (dLine ? " L" : "M") + x(p.ply).toFixed(1) + " " + y(p.cp).toFixed(1);
    const dArea = dLine +
      " L" + x(last.ply).toFixed(1) + " " + (H / 2) +
      " L" + x(pts[0].ply).toFixed(1) + " " + (H / 2) + " Z";
    let dots = "";
    for (const p of pts) {
      dots += "<circle cx='" + x(p.ply).toFixed(1) + "' cy='" + y(p.cp).toFixed(1) + "' r='1.6'/>";
    }
    const curX = x(curPly).toFixed(1);
    return head +
      "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='none' aria-hidden='true'>" +
      "<line class='op-ch-mid' x1='0' y1='" + H / 2 + "' x2='" + W + "' y2='" + H / 2 + "'/>" +
      "<path class='op-ch-area' d='" + dArea + "'/>" +
      "<path class='op-ch-line' d='" + dLine + "'/>" +
      "<g class='op-ch-dots'>" + dots + "</g>" +
      "<line class='op-ch-cur' x1='" + curX + "' y1='0' x2='" + curX + "' y2='" + H + "'/>" +
      "<circle class='op-ch-now' cx='" + x(last.ply).toFixed(1) + "' cy='" + y(last.cp).toFixed(1) + "' r='3'/>" +
      "</svg>";
  }

  function renderEvalChart() {
    if (!els.tChart) return;
    els.tChart.innerHTML = evalChartHtml(ses ? ses.evalHist : null, ses ? ses.moves.length : 0,
      ses ? ses.mode : "memorize", true);
  }

  function checkEnd() {
    const rep = X.repetitionResult(ses.rep);
    if (rep) {
      endSession("game_end", rep.result === "draw" ? "三次重复局面，不变作和" : (rep.side === "r" ? "红方" : "黑方") + "长将判负");
      return true;
    }
    const legal = X.legalMoves(ses.board, ses.side);
    if (legal.length > 0) return false;
    endSession("game_end", X.isCheck(ses.board, ses.side)
      ? (ses.side === "r" ? "红方" : "黑方") + "被将死"
      : "困毙（无子可动）判负");
    return true;
  }

  function maybeSoftEnd() {
    if (!ses || ses.finished) return true;
    if (ses.moves.length >= ses.hardEnd) { ses.reachedMid = true; endSession("soft_end"); return true; }
    if (ses.phase === "free" && ses.moves.length >= ses.softEnd) {
      ses.reachedMid = true;
      endSession("soft_end");
      return true;
    }
    return false;
  }

  /* ---------- 引擎回合（单 worker 串行，thinking 锁内完成） ---------- */
  function engineTurn() {
    const token = uiToken;
    ses.thinking = true;
    refreshTrain();
    engineTurnCore(token).then(() => {
      if (token !== uiToken) return;
      ses.thinking = false;
      refreshTrain();
    }).catch(e => {
      console.warn("引擎回合出错：", e);
      if (token !== uiToken) return;
      ses.thinking = false;
      setTrainStatus("引擎出错：" + escapeHtml(e.message || e) + "——可点「✕ 结束」收摊。");
      refreshTrain();
    });
  }

  async function engineTurnCore(token) {
    if (!ses || ses.finished) return;
    if (ses.phase === "in_book") await oppBookTurn(token);
    else await oppFreeTurn(token);
    if (token === uiToken && ses && !ses.finished) refreshTrain();
  }

  /* 对手谱内回合：先掷脱谱（第 4 次谱内行棋强制脱谱），失败再在 ch 里选 */
  async function oppBookTurn(token) {
    const opts = bookOptions();
    if (!opts.length) {
      // 理论上 bookNode 不会停在叶子上；万一走到，按叶子规则处理
      if (bookLeafNext()) return;
      await oppFreeTurn(token);
      return;
    }

    if (ses.mode === "sim") {
      ses.oppIn++;
      const force = ses.oppIn >= 4;
      if (force || Math.random() < devRate) {
        const dev = await pickDeviation();
        if (token !== uiToken) return;
        if (dev) { applyDeviation(dev); return; }
      }
    }

    // 谱内应着：30% 概率走分支（仍是谱着）
    let idx = 0;
    if (opts.length > 1 && Math.random() < 0.3) {
      idx = 1 + Math.floor(Math.random() * (opts.length - 1));
    }
    const node = opts[idx];
    applyMove(node.m, "book");
    ses.bookNode = node;
    ses.bookId = bookIdFor(idx);
    if (idx !== 0) ses.onMainline = false;
    if (!node.ch || !node.ch.length) {
      if (bookLeafNext()) return;
      setTrainStatus("对手走进变着末梢「" + escapeHtml(node.cn) + "」——谱线到此为止，转入自由中局，轮到你走棋。");
      return;
    }
    if (maybeSoftEnd()) return;
    let note = "对手走谱着 " + escapeHtml(node.cn) + "——轮到你跟谱。";
    if (idx > 0 && !node.c) {
      note += "<br><span class='dim'>这是变着，同样符合己方行棋原则，按谱应着即可。</span>";
    }
    setTrainStatus(note);
  }

  /* 谱树叶子处置：主线尽头（ply ≥ mainlineEndPly）→ book_end 完成；
   * 变着末梢/提前到叶 → 转自由中局（引擎接管对手），由 softEnd/hardEnd 结算 */
  function bookLeafNext() {
    if (ses.onMainline && ses.moves.length >= ses.endPly) {
      ses.reachedMid = true;
      endSession("book_end");
      return true;
    }
    ses.phase = "free";
    return false;
  }

  /* 对手脱谱选择：① 教学 dev[] ② 引擎第 3-5 名且亏 ≥60 的非谱着 ③ 放弃脱谱 */
  async function pickDeviation() {
    const opts = bookOptions();
    const chSet = new Set(opts.map(n => n.m));
    const legal = new Set(X.legalMoves(ses.board, ses.side).map(mv => X.moveToText(mv)));
    const devs = (ses.bookNode ? (ses.bookNode.dev || []) : ((ses.data && ses.data.dev) || []));

    const auth = devs.filter(d => d && d.m && legal.has(d.m) && !chSet.has(d.m));
    if (auth.length) {
      const d = auth[Math.floor(Math.random() * auth.length)];
      let fall = null, refCn = "";
      if (Engine.ready) {
        const ev = await evaluateChoice(X.cloneBoard(ses.board), ses.side, d.m);
        if (ev) {
          fall = ev.loss;
          refCn = pvToCn(X.cloneBoard(ses.board), ses.side, ev.bestLine, 4);
        }
      }
      return { m: d.m, cn: d.cn || d.m, why: d.why || "", punish: d.punish || "", fall, refCn, authored: true };
    }

    if (Engine.ready) {
      const fen = X.boardToFen(ses.board, ses.side);
      const cands = await Engine.candidates(fen, 400, 5, Engine.PRIORITY.PLAY);
      if (cands.length >= 3) {
        const bestCp = cands[0].cp;
        const pool = cands.slice(2, 5).filter(c => bestCp - c.cp >= 60 && !chSet.has(c.mv) && legal.has(c.mv));
        if (pool.length) {
          const c = pool[Math.floor(Math.random() * pool.length)];
          const fall = Math.max(0, bestCp - c.cp);
          const cn = Notation.chinese(ses.board, ses.side, X.parseMove(c.mv));
          const refCn = pvToCn(X.cloneBoard(ses.board), ses.side, cands[0].line || [cands[0].mv], 4);
          return {
            m: c.mv, cn,
            why: "对手主动变着——抛开棋谱考你：这手比主流应着差 " + Math.round(fall) + " 分。",
            punish: "", fall, refCn, authored: false
          };
        }
      }
    }
    return null;
  }

  function applyDeviation(dev) {
    applyMove(dev.m, "dev");
    ses.phase = "punish";
    ses.events.push({
      t: "dev", ply: ses.moves.length, cn: dev.cn, m: dev.m,
      why: dev.why, punish: dev.punish, fall: dev.fall, refCn: dev.refCn, authored: dev.authored
    });
    setTrainStatus(
      "⚠️ 对手脱谱走了「<b>" + escapeHtml(dev.cn) + "</b>」 " + sevBadge(dev.fall) +
      (dev.why ? "<br><span style='color:#e8cf8a'>" + escapeHtml(dev.why) + "</span>" : "") +
      "<br><b>轮到你：走出最严厉的惩罚！</b>"
    );
    renderEvents();
  }

  /* 自由中局：引擎应一手 */
  async function oppFreeTurn(token) {
    const fen = X.boardToFen(ses.board, ses.side);
    let mvText = null;
    if (Engine.ready) mvText = await Engine.hint(fen, 600, Engine.PRIORITY.PLAY);
    if (token !== uiToken) return;
    if (!mvText) {
      const legal = X.legalMoves(ses.board, ses.side);
      mvText = X.moveToText(legal[Math.floor(Math.random() * legal.length)]);
    }
    applyMove(mvText, "free");
    if (checkEnd()) return;
    if (maybeSoftEnd()) return;
    setTrainStatus("轮到你走棋。");
  }

  /* loss = max(0, best.cp − actual.cp)；actual 不在候选时 cloneBoard 重放后 evalCp 取负 */
  async function evaluateChoice(board, side, moveText) {
    if (!Engine.ready) return null;
    const fen = X.boardToFen(board, side);
    let cands = await Engine.candidates(fen, 350, 4, Engine.PRIORITY.USER);
    if (!cands.length) {
      await new Promise(r => setTimeout(r, 200));
      cands = await Engine.candidates(fen, 600, 4, Engine.PRIORITY.USER);
    }
    if (!cands.length) return null;
    const best = cands[0];
    const actual = cands.find(c => c.mv === moveText);
    let actualCp;
    if (actual) actualCp = actual.cp;
    else {
      const b2 = X.cloneBoard(board);
      try { X.applyMove(b2, ...X.parseMove(moveText)); } catch (e) { return null; }
      const e = await Engine.evalCp(X.boardToFen(b2, X.other(side)), 250, Engine.PRIORITY.USER);
      if (e === null) return null;
      actualCp = -e;
    }
    return {
      loss: Math.round(Math.max(0, best.cp - actualCp)),
      bestMv: best.mv,
      bestLine: best.line || [best.mv],
      bestCp: best.cp,
      actualCp
    };
  }

  /* ---------- 小结 ---------- */
  function endSession(reason, extraReason) {
    if (!ses || ses.finished) return;
    ses.finished = true;
    ses.thinking = false;
    uiToken++;   // 取消在途异步回调

    let completed = false, verdict = "";
    if (reason === "book_end") {
      completed = true;
      verdict = "✔ 跟谱走到入中局点，本局完成！";
    } else if (reason === "soft_end") {
      completed = true;
      verdict = "✔ 转入自由中局并走到中局点，本局完成！";
    } else if (reason === "game_end") {
      if (ses.moves.length >= ses.softEnd) {
        completed = true;
        verdict = "✔ 对局终了（" + escapeHtml(extraReason || "终局") + "），已过中局点。";
      } else {
        verdict = "对局在中局点之前结束（" + escapeHtml(extraReason || "终局") + "），本局不计完成。";
      }
    } else {
      verdict = "提前结束，本局不计完成。";
    }

    const key = ses.meta.id;
    const side = ses.mySide;
    if (completed) {
      ses.reachedMid = true;
      store.addGame(key, side);
      const rec = store.get(key, side);
      if (sysRev[key]) rec.rev = sysRev[key];   // 记录完成时的内容版本
      store.save();
    }
    store.pushRecent(key, side, {
      at: Date.now(),
      mastery: sideStats(key, side, ses.meta).mastery,
      bookHit: ses.stats.bookHit,
      bookN: ses.stats.bookHit + ses.stats.bookAnswer,
      punishHit: ses.stats.punishHit,
      punishN: ses.stats.punishN,
      completed
    });
    store.save();
    renderDebrief(reason, completed, verdict);
    showSub("debrief");
    Sound.play(completed ? "check" : "click");
  }

  function renderDebrief(reason, completed, verdict) {
    const st = ses.stats;
    const side = ses.mySide;
    const after = sideStats(ses.meta.id, side, ses.meta);
    const bookN = st.bookHit + st.bookAnswer;
    els.dTitle.textContent = ses.meta.name + "（" + (side === "r" ? "执红" : "执黑") + "）";
    els.dVerdict.innerHTML = verdict;

    let html = "";
    html += "<h4>本局数据</h4>";
    html += "<div>跟谱 <b>" + st.bookHit + "/" + bookN + "</b>" +
      "（看答案 " + st.bookAnswer + "）　" +
      "主动脱谱 " + st.bookOff + "　" +
      "惩罚 <b>" + st.punishHit + "/" + st.punishN + "</b>　" +
      "共 " + ses.moves.length + " 着" + (completed ? "　·　完成局 +1（累计 " + after.rec.games + "）" : "") + "</div>";
    html += "<div>掌握度 <b>" + ses.masteryBefore + "</b> → <b style='color:#ffd97a'>" + after.mastery + "</b>" +
      "　（跟谱率 " + Math.round(after.coverage * 100) + "% · 惩罚率 " +
      (after.rec.punishN ? Math.round(after.punishRate * 100) + "%" : "—") +
      " · 完成 " + after.rec.games + "）</div>";

    if (ses.mode !== "memorize") {
      html += "<h4>局势走势</h4><div class='op-chart op-chart-debrief'>" +
        evalChartHtml(ses.evalHist, ses.moves.length, ses.mode) + "</div>";
    }

    // 事件表（只列非跟谱事件）
    const evs = ses.events.filter(e => e.t !== "hit");
    if (evs.length) {
      html += "<h4>关键事件</h4><table class='op-table'><tr><th>回合</th><th>事件</th><th>着法</th><th>判定</th></tr>";
      for (const e of evs) {
        const kind = e.t === "dev" ? "对手脱谱" : e.t === "off" ? "主动脱谱" :
          e.t === "free" ? "自由着" : e.t === "answer" ? "看答案" : "惩罚应手";
        let judge = "";
        if (e.t === "dev") {
          judge = sevOf(e.fall) ? "脱谱·" + sevOf(e.fall) + (e.fall != null ? "（差 " + Math.round(e.fall) + "）" : "") : "脱谱";
          if (e.userCn) judge += "<br>你：" + escapeHtml(e.userCn) + " → " + escapeHtml(e.label || "");
        } else if (e.label) {
          judge = escapeHtml(e.label) + (e.loss != null ? "（损 " + e.loss + "）" : "");
        }
        const round = Math.ceil(e.ply / 2);
        const mover = e.ply % 2 ? "红" : "黑";
        html += "<tr><td>" + round + "回合·" + mover + "</td>" +
          "<td>" + kind + "</td><td>" + escapeHtml(e.cn || e.userCn || "") + "</td><td>" + judge + "</td></tr>";
      }
      html += "</table>";
    }

    // 惩罚讲评：错过惩罚的 dev.punish + 引擎正着
    const missed = ses.events.filter(e => e.t === "dev" && e.userCn && e.hit === false);
    const unanswered = ses.events.filter(e => e.t === "dev" && !e.userCn);
    if (missed.length || unanswered.length) {
      html += "<h4>惩罚讲评</h4>";
      for (const e of missed.concat(unanswered)) {
        html += "<div class='op-ev' style='margin:6px 0'>⚠️ 对手「<b>" + escapeHtml(e.cn) + "</b>」" +
          (e.why ? "<br>" + escapeHtml(e.why) : "");
        if (e.punish) html += "<br><span style='color:#e8cf8a'>💬 " + escapeHtml(e.punish) + "</span>";
        const ref = e.bestCn || e.refCn;
        if (ref) {
          html += "<br>引擎正着：<b style='color:#7fd492'>" + escapeHtml(ref) + "</b>";
        }
        if (!e.userCn) html += "<br><span class='dim'>（本局未做出惩罚应手）</span>";
        html += "</div>";
      }
    }

    if (ses.mode === "memorize") {
      html += "<p class='dim'>背谱模式不评级：引擎就绪后再练，可获得惩罚命中率与实时判定。</p>";
    }

    els.dBody.innerHTML = html;
  }

  /* ---------- 对外 ---------- */
  window.Opening = {
    mount,
    show() {
      if (!els.grid) return;
      if (curSub === "train" && ses && !ses.finished) {
        showSub("train");
        refreshTrain();
      } else if (curSub === "detail" && curData) {
        showSub("detail");
        refreshDetail();
      } else if (curSub === "debrief" && ses && ses.finished) {
        showSub("debrief");
      } else {
        showSub("dash");
        renderDash();
      }
    },
    hide() {
      if (player) player.stopAuto();
    }
  };

  window.OpeningDebug = {
    masteryOf: (id, side, meta) => sideStats(id, side,
      meta || (indexData && indexData.systems.find(x => x.id === id))),
    userIds: userNodeIds,
    cpToRed, evalY, clampCp,
    get store() { return store.data; },
    get session() { return ses; }
  };
})();
