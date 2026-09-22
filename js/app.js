/* 主界面逻辑：课程目录、讲棋/练习双模式、进度记录、引擎提示。 */
(function () {
  "use strict";

  const X = window.Xiangqi;

  /* ---------- 进度存储 ---------- */
  const store = {
    key: "xqteach-progress-v1",
    data: {},
    load() {
      try { this.data = JSON.parse(localStorage.getItem(this.key) || "{}"); }
      catch (e) { this.data = {}; }
    },
    get(id) { return this.data[id] || null; },
    set(id, val) { this.data[id] = val; this.save(); },
    save() { try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {} },
    doneCount() { return Object.values(this.data).filter(v => v.done).length; }
  };
  store.load();

  /* ---------- 全局状态 ---------- */
  let indexData = null;
  let currentLessonId = null;
  let mode = "teach";   // teach | quiz
  let currentLesson = null;   // 原始 json

  const player = Player.create();
  const quiz = Quiz.create({ onUpdate: onQuizUpdate, onDone: onQuizDone });

  /* ---------- DOM ---------- */
  const $ = id => document.getElementById(id);
  const canvas = $("board");
  const board = Board.create(canvas, { onMove: onBoardMove });

  /* ---------- 视图切换 ---------- */
  const VIEWS = ["lessons", "guide", "traps", "play", "games", "coach"];
  let curView = "lessons";

  function showView(name) {
    curView = name;
    for (const v of VIEWS) {
      $("view-" + v).classList.toggle("hidden", v !== name);
    }
    document.querySelectorAll(".nav-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.view === name);
    });
    // 侧栏只在课程视图显示
    document.querySelector("aside").style.display = name === "lessons" ? "" : "none";
    if (name === "guide") { Guide.show(); $("welcome-banner").classList.add("hidden"); }
    else if (name === "traps") Traps.show();
    else if (name === "play") Play.show();
    else if (name === "games") Games.show();
    else if (name === "coach") Coach.show();
    else board.redraw();
  }
  document.querySelectorAll(".nav-btn").forEach(b => {
    b.onclick = () => { Sound.play("click"); showView(b.dataset.view); };
  });

  /* ---------- 课程目录 ---------- */
  async function boot() {
    const res = await fetch("data/index.json");
    indexData = await res.json();
    renderSidebar("");
    updateProgressSummary();
    // 新手提示
    const isNew = store.doneCount() === 0 && (!window.Guide || Guide.progress === 0);
    $("welcome-banner").classList.toggle("hidden", !isNew);
    // 挂载其余视图
    Guide.mount($("view-guide"));
    Traps.mount($("view-traps"));
    Play.mount($("view-play"));
    Games.mount($("view-games"));
    Coach.mount($("view-coach"));
    showView("lessons");
    $("search").addEventListener("input", e => renderSidebar(e.target.value.trim()));
    // 引擎后台初始化
    refreshEngineStatus("初始化…");
    Engine.init().then(ok => {
      refreshEngineStatus(ok ? "就绪" : "不可用", ok);
      if (curView === "play") Play.show();
    });
  }

  function refreshEngineStatus(text, ok) {
    const el = $("engine-status");
    el.textContent = "引擎：" + text;
    el.className = "engine-status " + (ok === true ? "on" : ok === false ? "off" : "");
  }

  function updateProgressSummary() {
    const total = indexData ? indexData.categories.reduce((n, c) => n + c.lessons.length, 0) : 0;
    $("progress-summary").textContent = "已完成 " + store.doneCount() + " / " + total + " 课";
  }

  function renderSidebar(filter) {
    const box = $("cat-list");
    box.innerHTML = "";
    for (const cat of indexData.categories) {
      const lessons = cat.lessons.filter(l => !filter || l.title.indexOf(filter) >= 0);
      if (!lessons.length) continue;
      const head = document.createElement("div");
      head.className = "cat-head";
      head.innerHTML = "<span>" + cat.id + " " + cat.name + "</span><span class='count'>" + lessons.length + "课</span>";
      const list = document.createElement("div");
      for (const l of lessons) {
        const item = document.createElement("div");
        item.className = "lesson-item" + (l.id === currentLessonId ? " active" : "");
        const prog = store.get(l.id);
        const meta = [];
        if (l.annotated) meta.push("评");
        if (l.vars) meta.push("变" + l.vars);
        item.innerHTML =
          (prog && prog.done ? "<span class='done'>✓</span>" : "<span></span>") +
          "<span class='t'>" + l.title + "</span>" +
          "<span class='meta'>" + meta.join(" ") + "</span>";
        item.onclick = () => openLesson(l);
        list.appendChild(item);
      }
      head.onclick = () => { list.style.display = list.style.display === "none" ? "" : "none"; };
      box.appendChild(head);
      box.appendChild(list);
    }
  }

  /* 从其他视图直达课程分类（私教报告的练习推荐按钮用） */
  function gotoLessons(catId) {
    showView("lessons");
    document.querySelectorAll("#cat-list .cat-head").forEach(h => {
      if (h.textContent.trim().indexOf(catId + " ") === 0) h.scrollIntoView({ block: "start" });
    });
  }

  /* ---------- 打开课程 ---------- */
  async function openLesson(lessonMeta) {
    Sound.play("click");
    $("welcome-banner").classList.add("hidden");
    currentLessonId = lessonMeta.id;
    const res = await fetch(lessonMeta.file);
    currentLesson = await res.json();
    $("lesson-title").textContent = lessonMeta.title;
    const cat = indexData.categories.find(c => c.id === lessonMeta.category || c.id === currentLesson.category);
    $("crumb-cat").textContent = cat ? cat.name : "";
    player.load(currentLesson);
    quiz.load(currentLesson);
    setMode(mode);
    renderSidebar($("search").value.trim());
  }

  /* ---------- 模式切换 ---------- */
  function setMode(m) {
    mode = m;
    $("mode-teach").classList.toggle("active", m === "teach");
    $("mode-quiz").classList.toggle("active", m === "quiz");
    $("quiz-panel").classList.toggle("hidden", m !== "quiz");
    player.stopAuto();
    if (m === "teach") {
      refreshTeach();
    } else {
      quiz.reset();
    }
  }

  $("mode-teach").onclick = () => setMode("teach");
  $("mode-quiz").onclick = () => setMode("quiz");

  /* ---------- 棋盘着子回调 ---------- */
  function onBoardMove(f0, r0, f1, r1) {
    if (mode === "quiz") {
      quiz.tryMove(f0, r0, f1, r1);
    }
  }

  /* ---------- 讲棋模式 ---------- */
  let lastPathLen = 0;

  player.onChange = () => {
    if (mode !== "teach") return;
    const path = player.path;
    // 前进一步的音效
    if (path.length === lastPathLen + 1) {
      const { board: b } = X.parseFen(currentLesson.fen);
      let s = X.parseFen(currentLesson.fen).side;
      for (let i = 0; i < path.length - 1; i++) {
        X.applyMove(b, ...X.parseMove(path[i].m));
        s = X.other(s);
      }
      const mv = X.parseMove(path[path.length - 1].m);
      const captured = X.applyMove(b, ...mv);
      const sAfter = X.other(s);
      if (X.isCheckmate(b, sAfter)) Sound.play("check");
      else if (X.isCheck(b, sAfter)) Sound.play("check");
      else if (captured) Sound.play("capture");
      else Sound.play("move");
    }
    lastPathLen = path.length;
    refreshTeach();
  };

  function refreshTeach() {
    if (!currentLesson) return;
    const { board: b, side } = player.replay();
    board.update({ board: b, turn: side, lastMove: player.lastMove(), hint: null, interactive: false });
    renderMoveList();
    renderComment();
    renderVariations();
    $("btn-prev").disabled = !player.canPrev();
    $("btn-next").disabled = !player.canNext();
    $("btn-auto").classList.toggle("on", player.autoRunning);
    $("btn-auto").textContent = player.autoRunning ? "⏸" : "▶";
    // 走到末尾自动记完成
    if (!player.canNext() && player.path.length > 0) markDone("teach");
  }

  function markDone(m, stats) {
    const prev = store.get(currentLessonId);
    if (prev && prev.done) return;
    store.set(currentLessonId, Object.assign({ done: true, mode: m, at: Date.now() }, stats));
    updateProgressSummary();
    renderSidebar($("search").value.trim());
  }

  function onQuizUpdate(state) {
    if (mode !== "quiz") return;
    board.update({
      board: state.board,
      turn: state.side,
      lastMove: null,
      hint: null,
      interactive: state.turn === "student"
    });
    const fb = $("quiz-feedback");
    fb.textContent = state.turn === "done"
      ? "✔ 完成！共 " + state.stats.steps + " 步正着，错 " + state.stats.wrong + " 次"
      : state.turn === "waiting"
        ? "棋谱应手中…"
        : (state.message || "轮到你了，走出正着！");
    fb.className = "quiz-feedback" + (state.turn === "done" ? " ok" : state.message ? " bad" : "");
    $("btn-hint").disabled = !(Engine.ready && state.turn === "student");
    $("btn-answer").disabled = state.turn !== "student";
  }

  function onQuizDone(stats) {
    markDone("quiz", stats);
    Sound.play("check");
  }

  /* ---------- 着法列表 ---------- */
  function renderMoveList() {
    const box = $("movelist");
    box.innerHTML = "";
    if (!currentLesson) return;
    const path = player.path;
    const root = currentLesson.moves || [];

    // 内联渲染一层节点序列（用于变着分支行）
    function renderLine(container, nodes, idxPrefix) {
      let i = 0;
      while (i < nodes.length) {
        const node = nodes[i];
        const span = document.createElement("span");
        span.className = "mv";
        span.textContent = node.cn + (node.c ? " ◎" : "");
        const idx = idxPrefix.concat([i]);
        span.dataset.idx = JSON.stringify(idx);
        span.onclick = () => jumpTo(idx);
        container.appendChild(span);
        // 变着：其余子节点作为分支行
        const ch = node.ch || [];
        if (ch.length > 1) {
          for (let v = 1; v < ch.length; v++) {
            const vline = document.createElement("span");
            vline.className = "varline";
            vline.innerHTML = "<span class='vtag'>变" + v + "：</span>";
            renderLine(vline, [ch[v]], idx.concat([v]));
            container.appendChild(vline);
          }
        }
        i++;
      }
    }

    // 主线路按节点链渲染（带回合号）
    const frag = document.createDocumentFragment();
    let depth = 0;
    let nodes = root;
    const pathIdx = [];
    while (nodes.length) {
      const node = nodes[0];
      const span = document.createElement("span");
      span.className = "mv";
      if (depth % 2 === 0) {
        span.innerHTML = "<span class='mvnum'>" + (Math.floor(depth / 2) + 1) + ".</span>";
      }
      const curIdx = pathIdx.concat([0]);
      const t = document.createElement("span");
      t.textContent = node.cn + (node.c ? " ◎" : "");
      t.className = "mv";
      span.appendChild(t);
      span.dataset.idx = JSON.stringify(curIdx);
      span.onclick = () => jumpTo(curIdx);
      frag.appendChild(span);
      // 变着行
      const ch = node.ch || [];
      for (let v = 1; v < ch.length; v++) {
        const vline = document.createElement("span");
        vline.className = "varline";
        vline.innerHTML = "<span class='vtag'>变" + v + "：</span>";
        renderLine(vline, [ch[v]], curIdx.concat([v]));
        frag.appendChild(vline);
      }
      pathIdx.push(0);
      nodes = ch.length ? ch[0].ch || [] : [];
      depth++;
    }
    box.appendChild(frag);
    // 高亮当前
    const curKey = JSON.stringify(path.map((_, i) => 0));
    // 实际高亮：沿当前路径每步取索引（路径节点在兄弟中的位置）
    const idxArr = [];
    let siblings = root;
    for (const n of path) {
      const i = siblings.indexOf(n);
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
    // idx: 从根到目标节点的兄弟索引路径
    let nodes = currentLesson.moves || [];
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

  function renderComment() {
    const c = player.comment();
    const box = $("comment");
    const count = countComments(currentLesson.moves || []);
    const badge = $("comment-badge");
    if (count > 0) {
      badge.textContent = count;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
    if (c) {
      box.textContent = c;
      if (userTab !== "moves") showTab("comment");
    } else {
      box.textContent = count ? "（本课共 " + count + " 处评注，走到带 ◎ 的着法可查看）" : "本课无评注。";
      if (count === 0 && userTab !== "comment") showTab("moves");
    }
  }

  function countComments(nodes) {
    let n = 0;
    for (const node of nodes) {
      if (node.c) n++;
      if (node.ch) n += countComments(node.ch);
    }
    return n;
  }

  function renderVariations() {
    const box = $("var-panel");
    box.innerHTML = "";
    const ch = player.children();
    if (ch.length > 1) {
      const label = document.createElement("span");
      label.className = "var-label";
      label.textContent = "下一手变着：";
      box.appendChild(label);
      ch.forEach((n, i) => {
        const b = document.createElement("button");
        b.className = "var-btn";
        b.textContent = (i === 0 ? "正着：" : "变" + i + "：") + n.cn;
        b.onclick = () => { player.choose(i); };
        box.appendChild(b);
      });
    }
  }

  /* ---------- 标签页 ---------- */
  let userTab = null;   // 用户手动选择：'moves' | 'comment'
  function showTab(name) {
    $("tab-moves").classList.toggle("active", name === "moves");
    $("tab-comment").classList.toggle("active", name === "comment");
    $("movelist").classList.toggle("hidden", name !== "moves");
    $("comment").classList.toggle("hidden", name !== "comment");
  }
  $("tab-moves").onclick = () => { userTab = "moves"; showTab("moves"); };
  $("tab-comment").onclick = () => { userTab = "comment"; showTab("comment"); };

  /* ---------- 控制按钮 ---------- */
  $("btn-prev").onclick = () => player.prev();
  $("btn-next").onclick = () => player.next();
  $("btn-start").onclick = () => player.gotoStart();
  $("btn-end").onclick = () => player.gotoEnd();
  $("btn-auto").onclick = () => {
    if (player.autoRunning) player.stopAuto();
    else player.autoPlay(Number($("speed").value));
    refreshTeach();
  };
  $("speed").onchange = () => { if (player.autoRunning) player.autoPlay(Number($("speed").value)); };
  $("btn-flip").onclick = () => board.flip();

  /* ---------- 练习按钮 ---------- */
  $("btn-reset").onclick = () => quiz.reset();
  $("btn-answer").onclick = () => quiz.showAnswer();
  $("btn-hint").onclick = async () => {
    const st = quiz.boardState();
    if (!st || st.turn !== "student") return;
    const fen = X.boardToFen(st.board, st.side);
    const mv = await Engine.hint(fen, 700);
    if (mv) board.update({ hint: X.parseMove(mv) });
  };

  /* ---------- 键盘 ---------- */
  document.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (!currentLesson && curView === "lessons") return;
    if (curView === "games") {
      if (e.key === "ArrowLeft") { Games.step(-1); e.preventDefault(); }
      else if (e.key === "ArrowRight") { Games.step(1); e.preventDefault(); }
      return;
    }
    if (curView !== "lessons") return;
    if (mode !== "teach") return;
    if (e.key === "ArrowLeft") { player.prev(); e.preventDefault(); }
    else if (e.key === "ArrowRight") { player.next(); e.preventDefault(); }
    else if (e.key === " ") {
      if (player.autoRunning) player.stopAuto(); else player.autoPlay(Number($("speed").value));
      refreshTeach();
      e.preventDefault();
    } else if (e.key === "Home") { player.gotoStart(); }
    else if (e.key === "End") { player.gotoEnd(); }
  });

  boot();

  /* 调试/自动化测试句柄 */
  window.AppDebug = {
    get player() { return player; },
    get quiz() { return quiz; },
    board, setMode, openLesson, gotoLessons,
    get lesson() { return currentLesson; },
    get lessonId() { return currentLessonId; }
  };
})();
