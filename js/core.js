/* 新手核心课程路线（规划 2.0-C / 2.0-D / 6.4 / 6.5 / 6.6 / 3.0-C）。
 * Core.mount(container)  Core.show() / hide()
 * Core.gotoLesson(id)  Core.gotoReview(key)  从今日学习页/复盘页直达。
 * 课程结构：目标讲解 → 演示（逐步带解说）→ 3 道分级提示练习 → 独立验收 → 小结。
 * 状态：Learn.recordExercise 记录 看过/跟做/独立；错题与带帮助的通过进入复习队列。
 * 「错题复习」页：到期复习（课程错题 + 实战错题），练习通过自动升级间隔（次日/3日/7日）。 */
(function () {
  "use strict";

  const X = window.Xiangqi;
  let els = {}, board = null, route = null, sub = "route";
  let run = null;   // 当前课程运行状态 {lesson, phase, demoIdx, exIdx, hints, wrong, answered, reviewKey}

  function mount(container) {
    container.innerHTML = `
      <div class="core-wrap">
        <div class="core-tabs">
          <button data-t="route" class="tab active">🗺️ 新手路线</button>
          <button data-t="review" class="tab">🔁 错题复习 <span id="core-review-badge" class="badge hidden"></span></button>
        </div>
        <div id="core-body"></div>
      </div>`;
    els = { body: container.querySelector("#core-body"), tabs: container.querySelectorAll(".core-tabs .tab"), badge: container.querySelector("#core-review-badge") };
    els.tabs.forEach(b => b.onclick = () => { setSub(b.dataset.t); });
    board = Board.create(document.createElement("canvas"));
    fetch("data/core/route.json").then(r => r.json()).then(data => {
      route = data;
      if (!pendingJump) renderSub(); else doJump();
    }).catch(() => { els.body.innerHTML = "<div class='dim' style='padding:30px'>课程数据加载失败。</div>"; });
  }

  let pendingJump = null;   // {lesson} | {reviewKey}
  function setSub(t) {
    sub = t;
    els.tabs.forEach(b => b.classList.toggle("active", b.dataset.t === t));
    if (run) { closeRun(); } else renderSub();
  }

  function renderSub() {
    updateBadge();
    if (sub === "route") renderRoute(); else renderReview();
  }

  function updateBadge() {
    const n = route ? Learn.review.due().length : 0;
    els.badge.textContent = n;
    els.badge.classList.toggle("hidden", !n);
  }

  /* ---------- 路线列表 ---------- */
  function renderRoute() {
    const ids = route.lessons.map(l => l.id);
    const c = Learn.progressSummary(ids);
    const done = c.independent + c.mastered;
    let html = "<div class='core-summary'>已完成 <b>" + done + "</b> / " + route.lessons.length + " 课" +
      "（独立通过 " + c.independent + " · 复习通过 " + c.mastered + " · 跟做 " + c.followed + "）</div>";
    for (const stage of route.stages) {
      const lessons = route.lessons.filter(l => l.stage === stage.id);
      html += "<div class='core-stage'><h4>" + stage.name + "<span class='dim'>　" + stage.goal + "</span></h4>";
      for (const l of lessons) {
        const st = Learn.statusOf(l.id).state;
        const badge = st === "mastered" ? "<span class='core-tag ok'>复习通过</span>"
          : st === "independent" ? "<span class='core-tag ok'>独立通过</span>"
          : st === "followed" ? "<span class='core-tag mid'>跟做完成</span>"
          : st === "viewed" ? "<span class='core-tag'>看过</span>" : "";
        html += "<div class='core-lesson' data-id='" + l.id + "'>" +
          "<div class='core-lesson-main'><b>" + l.title + "</b>" +
          "<span class='dim'>　" + l.goal + " · 约 " + l.minutes + " 分钟</span>" + badge + "</div>" +
          "<button class='core-start'>" + (st && st !== "viewed" ? "继续" : "开始") + " →</button></div>";
      }
      html += "</div>";
    }
    els.body.innerHTML = html;
    els.body.querySelectorAll(".core-lesson").forEach(el => {
      el.querySelector(".core-start").onclick = () => gotoLesson(el.dataset.id);
    });
  }

  /* ---------- 复习列表 ---------- */
  function renderReview() {
    const due = Learn.review.due();
    let html = "<div class='core-summary'>到期复习 <b>" + due.length + "</b> 项（间隔：次日 / 3 日 / 7 日，通过自动升级）</div>";
    if (!due.length) html += "<div class='dim' style='padding:20px'>暂无到期复习。做错的练习与实战错题会自动排进这里。</div>";
    for (const r of due) {
      if (r.type === "game") {
        const g = Learn.gameEx.get(r.key.slice(5));
        if (!g) continue;
        html += "<div class='core-lesson'><div class='core-lesson-main'><b>♟ 实战错题：" + (g.cn || "") + "</b>" +
          "<span class='dim'>　来自复盘 · " + (g.cls || "") + " 损 " + g.loss + " 分</span></div>" +
          "<button class='core-start' data-ge='" + g.id + "'>练习 →</button>" +
          "<button class='core-del' data-del='" + g.id + "'>删除</button></div>";
      } else {
        const parts = r.key.split("/");
        const l = route && route.lessons.find(x => x.id === parts[1]);
        const ex = l && (l.exercises.concat(l.acceptance ? [l.acceptance] : [])).find(x => x.id === parts[2]);
        html += "<div class='core-lesson'><div class='core-lesson-main'><b>📖 " + (l ? l.title : "练习") + "：" + (ex ? ex.task.slice(0, 18) + "…" : "") + "</b>" +
          "<span class='dim'>　间隔第 " + (r.level + 1) + " 轮</span></div>" +
          "<button class='core-start' data-rk='" + r.key + "'>复习 →</button></div>";
      }
    }
    // 已入库未到期的实战错题也列出
    const future = Learn.gameEx.all().filter(g => !due.some(r => r.key === "game/" + g.id));
    for (const g of future) {
      html += "<div class='core-lesson'><div class='core-lesson-main'><b>♟ 实战错题：" + (g.cn || "") + "</b>" +
        "<span class='dim'>　已入库 · 未到期</span></div>" +
        "<button class='core-start' data-ge='" + g.id + "'>提前练 →</button>" +
        "<button class='core-del' data-del='" + g.id + "'>删除</button></div>";
    }
    els.body.innerHTML = html;
    els.body.querySelectorAll("[data-rk]").forEach(b => b.onclick = () => gotoReview(b.dataset.rk));
    els.body.querySelectorAll("[data-ge]").forEach(b => b.onclick = () => gotoGameEx(b.dataset.ge));
    els.body.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
      if (confirm("删除这道实战错题？")) { Learn.gameEx.remove(b.dataset.del); renderReview(); }
    });
  }

  /* ---------- 直达 ---------- */
  function gotoLesson(id) {
    if (!route) { pendingJump = { lesson: id }; return; }
    const lesson = route.lessons.find(l => l.id === id);
    if (!lesson) return;
    sub = "route";
    els.tabs.forEach(b => b.classList.toggle("active", b.dataset.t === "route"));
    startRun(lesson);
  }
  function gotoReview(key) {
    if (!route) { pendingJump = { reviewKey: key }; return; }
    const parts = key.split("/");
    const lesson = route.lessons.find(l => l.id === parts[1]);
    if (!lesson) return;
    sub = "route";
    els.tabs.forEach(b => b.classList.toggle("active", b.dataset.t === "route"));
    startRun(lesson, { reviewKey: key, exId: parts[2] });
  }
  function gotoGameEx(id) {
    const g = Learn.gameEx.get(id);
    if (!g) return;
    sub = "review";
    startGameExRun(g);
  }
  function doJump() {
    const j = pendingJump; pendingJump = null;
    if (j.lesson) gotoLesson(j.lesson);
    else if (j.reviewKey) gotoReview(j.reviewKey);
    else renderSub();
  }

  /* ---------- 课程运行器 ---------- */
  function closeRun() { run = null; renderSub(); }

  function startRun(lesson, opt) {
    opt = opt || {};
    run = {
      lesson, phase: "intro", demoIdx: 0, exIdx: 0,
      hints: 0, wrong: 0, answered: false,
      reviewKey: opt.reviewKey || null, exId: opt.exId || null,
      onlyExercise: !!opt.reviewKey
    };
    if (run.reviewKey) Learn.review.markVisit(run.reviewKey);
    if (run.reviewKey) {
      run.phase = "exercise";
      run.exIdx = exIndexOf(lesson, run.exId);
    }
    Learn.markDemo(lesson.id);
    renderRun();
  }

  function boardPos(fen) {
    const { board: b, side } = X.parseFen(fen);
    return { b, side };
  }

  function renderRun() {
    const l = run.lesson;
    let html = "<div class='core-runner'><div class='core-run-head'><button id='cr-back'>← 返回路线</button><b>" + l.title + "</b></div>";
    html += "<div class='core-run-main'><div class='core-run-board'><canvas id='cr-board'></canvas><div class='board-buttons' id='cr-demo-btns'></div></div><div class='core-run-side' id='cr-side'></div></div></div>";
    els.body.innerHTML = html;
    const canvas = els.body.querySelector("#cr-board");
    board = Board.create(canvas, { onMove: onRunMove, onIllegal: () => Sound.play("illegal") });
    els.body.querySelector("#cr-back").onclick = closeRun;
    if (run.phase === "intro") renderIntro();
    else if (run.phase === "demo") renderDemo();
    else if (run.phase === "exercise") renderExercise();
    else if (run.phase === "done") renderDebrief();
  }

  function renderIntro() {
    const l = run.lesson;
    board.update({ board: boardPos(l.demo.fen).b, turn: boardPos(l.demo.fen).side, interactive: false });
    els.body.querySelector("#cr-demo-btns").innerHTML = "";
    els.body.querySelector("#cr-side").innerHTML =
      "<h4>🎯 本课目标</h4><p>" + l.goal + "</p><h4>📘 讲解</h4><pre class='core-explain'>" + l.explain + "</pre>" +
      "<button id='cr-next' class='primary'>开始演示 →</button>";
    els.body.querySelector("#cr-next").onclick = () => { run.phase = "demo"; renderRun(); };
  }

  function renderDemo() {
    const l = run.lesson;
    const i = run.demoIdx;
    const pos = boardPos(l.demo.fen);
    // 回放到第 i 手
    const b = X.cloneBoard(pos.b);
    let s = pos.side, last = null;
    for (let k = 0; k < i; k++) {
      last = X.parseMove(l.demo.moves[k].m);
      X.applyMove(b, ...last);
      s = X.other(s);
    }
    board.update({ board: b, turn: s, lastMove: last, interactive: false });
    const move = l.demo.moves[i];
    const btns = els.body.querySelector("#cr-demo-btns");
    btns.innerHTML = "<button id='cr-prev'>◀</button><button id='cr-auto'>▶</button><button id='cr-next'>▶|</button>";
    els.body.querySelector("#cr-prev").onclick = () => { if (i > 0) { run.demoIdx--; renderDemo(); } };
    els.body.querySelector("#cr-next").onclick = next;
    els.body.querySelector("#cr-auto").onclick = () => {
      const t = setInterval(() => {
        if (!run || run.phase !== "demo" || run.demoIdx >= l.demo.moves.length - 1) { clearInterval(t); return; }
        run.demoIdx++; renderDemo();
      }, 900);
    };
    function next() {
      if (i < l.demo.moves.length - 1) { run.demoIdx++; renderDemo(); }
      else { run.phase = run.onlyExercise ? "exercise" : "exercise"; run.exIdx = run.onlyExercise ? indexEx() : 0; renderRun(); }
    }
    let side;
    els.body.querySelector("#cr-side").innerHTML =
      "<h4>📖 演示（" + (i + 1) + "/" + l.demo.moves.length + "）</h4>" +
      "<p class='core-movenote'>" + (move ? "<b>" + move.cn + "</b>　" + move.note : "观察局面。") + "</p>" +
      (i >= l.demo.moves.length - 1 ? "<button id='cr-go-ex' class='primary'>开始练习 →</button>" : "");
    const go = els.body.querySelector("#cr-go-ex");
    if (go) go.onclick = () => { run.phase = "exercise"; run.exIdx = indexEx(); run.hints = 0; run.wrong = 0; run.answered = false; renderRun(); };
    function indexEx() { return exIndexOf(l, run.onlyExercise ? run.exId : null); }
  }

  function exIndexOf(lesson, exId) {
    const all = lesson.exercises.concat(lesson.acceptance ? [lesson.acceptance] : []);
    const i = all.findIndex(x => x.id === exId);
    return i >= 0 ? i : 0;
  }

  function currentEx() {
    const l = run.lesson;
    const all = l.exercises.concat(l.acceptance ? [l.acceptance] : []);
    return { ex: all[run.exIdx], all, isAcceptance: run.exIdx === l.exercises.length };
  }

  function renderExercise() {
    const { ex, all, isAcceptance } = currentEx();
    const pos = boardPos(ex.fen);
    board.update({ board: pos.b, turn: pos.side, interactive: true });
    els.body.querySelector("#cr-demo-btns").innerHTML = "";
    const taskTag = isAcceptance ? "<span class='core-tag ok'>独立验收</span>" : "";
    els.body.querySelector("#cr-side").innerHTML =
      "<h4>🧩 练习 " + (run.exIdx + 1) + " / " + all.length + " " + taskTag + "</h4>" +
      "<p class='core-task'>" + ex.task + "</p>" +
      "<div id='cr-feedback' class='core-feedback'>轮到你，在棋盘上走出着法。</div>" +
      "<div class='core-btns' id='cr-ex-btns'></div>" +
      "<div id='cr-explain'></div>";
    renderExBtns(ex, isAcceptance);
  }

  function renderExBtns(ex, isAcceptance) {
    const box = els.body.querySelector("#cr-ex-btns");
    const btns = [];
    if (!isAcceptance) {
      ex.hints.forEach((h, i) => btns.push({ label: "💡 提示" + (i + 1), fn: () => {
        run.hints = i + 1;
        els.body.querySelector("#cr-feedback").textContent = h;
        Sound.play("click");
      } }));
      btns.push({ label: "显示答案", fn: showAnswer });
    } else {
      btns.push({ label: "显示答案（计入跟做）", fn: showAnswer });
    }
    btns.push({ label: "↻ 重摆", fn: () => renderExercise() });
    box.innerHTML = "";
    for (const d of btns) {
      const b = document.createElement("button");
      b.textContent = d.label;
      if (d.label.indexOf("提示1") === 0) b.className = "primary";
      b.onclick = d.fn;
      box.appendChild(b);
    }
  }

  function onRunMove(f0, r0, f1, r1) {
    if (!run || run.phase !== "exercise") return;
    const { ex, isAcceptance } = currentEx();
    const pos = boardPos(ex.fen);
    const mv = [f0, r0, f1, r1];
    if (!X.isLegal(pos.b, pos.side, mv)) {
      Sound.play("illegal");
      els.body.querySelector("#cr-feedback").textContent = "这步不合法，再想想。";
      return;
    }
    const text = X.moveToText(mv);
    if (ex.accept.indexOf(text) >= 0) {
      Sound.play(X.applyMove(X.cloneBoard(pos.b), ...mv) !== null ? "capture" : "move");
      finishExercise(true);
    } else {
      run.wrong++;
      Sound.play("illegal");
      els.body.querySelector("#cr-feedback").textContent = "不是这步——对照任务再想想（可点提示）。";
    }
  }

  function showAnswer() {
    const { ex } = currentEx();
    run.answered = true;
    const pos = boardPos(ex.fen);
    const mv = X.parseMove(ex.accept[0]);
    const b = X.cloneBoard(pos.b);
    X.applyMove(b, ...mv);
    board.update({ board: b, turn: X.other(pos.side), lastMove: mv, interactive: false });
    Sound.play("click");
    els.body.querySelector("#cr-feedback").textContent = "答案：" + ex.accept.join(" / ");
    finishExercise(false);
  }

  function finishExercise(ok) {
    const { ex, all, isAcceptance } = currentEx();
    const fb = els.body.querySelector("#cr-feedback");
    fb.textContent = ok ? "✅ 正确！" : "答案已演示。";
    fb.className = "core-feedback ok";
    els.body.querySelector("#cr-ex-btns").innerHTML = "";
    els.body.querySelector("#cr-explain").innerHTML =
      "<div class='core-explain-box'><b>解析</b>" + ex.explain + "</div>" +
      "<button id='cr-ex-next' class='primary'>" + (run.exIdx < all.length - 1 ? "下一题 →" : "完成本课 →") + "</button>";
    // 记录
    // 用答案完成也算「通过」（计入跟做，而非独立通过）
    const res = { ok: ok || run.answered, wrong: run.wrong, hints: run.hints, answered: run.answered, reviewVisit: !!run.reviewKey };
    if (run.reviewKey && isAcceptance === null) { /* game 走独立流程 */ }
    if (run.onlyExercise) {
      // 复习场：只针对单题
      if (run.reviewKey && run.reviewKey.indexOf("core/") === 0) {
        Learn.recordExercise(run.lesson.id, ex.id, ex.ability, res, isAcceptance);
      }
    } else {
      Learn.recordExercise(run.lesson.id, ex.id, ex.ability, res, isAcceptance);
    }
    els.body.querySelector("#cr-ex-next").onclick = () => {
      if (run.exIdx < all.length - 1) {
        run.exIdx++; run.hints = 0; run.wrong = 0; run.answered = false;
        run.reviewKey = null;   // 复习跳转只针对单题
        renderExercise();
      } else {
        run.phase = "done"; renderDebrief();
      }
    };
  }

  function renderDebrief() {
    const l = run.lesson;
    const st = Learn.statusOf(l.id).state;
    const stateText = st === "mastered" ? "复习通过 🎉" : st === "independent" ? "独立通过 ✅" : st === "followed" ? "跟做完成（验收时用了答案——进入复习队列，通过后即为独立通过）" : "看过";
    els.body.querySelector("#cr-side").innerHTML =
      "<h4>🎓 本课小结</h4><p>当前状态：<b>" + stateText + "</b></p>" +
      "<p class='dim'>做错的和用答案完成的练习会排进「错题复习」，按 次日 / 3 日 / 7 日 的间隔回来验证。</p>" +
      "<button id='cr-finish' class='primary'>返回路线 →</button>";
    els.body.querySelector("#cr-demo-btns").innerHTML = "";
    board.update({ board: boardPos(l.demo.fen).b, turn: boardPos(l.demo.fen).side, interactive: false });
    els.body.querySelector("#cr-finish").onclick = closeRun;
  }

  /* ---------- 实战错题练习（3.0-C） ---------- */
  function startGameExRun(g) {
    run = { gameEx: g, phase: "exercise", hints: 0, wrong: 0, answered: false, reviewKey: "game/" + g.id, onlyExercise: true };
    renderGameExRun();
  }
  function renderGameExRun() {
    const g = run.gameEx;
    els.body.innerHTML = "<div class='core-runner'><div class='core-run-head'><button id='cr-back'>← 返回复习</button><b>♟ 实战错题</b></div>" +
      "<div class='core-run-main'><div class='core-run-board'><canvas id='cr-board'></canvas></div><div class='core-run-side' id='cr-side'></div></div></div>";
    board = Board.create(els.body.querySelector("#cr-board"), { onMove: onGameExMove, onIllegal: () => Sound.play("illegal") });
    els.body.querySelector("#cr-back").onclick = closeRun;
    const pos = boardPos(g.fen);
    board.update({ board: pos.b, turn: pos.side, interactive: true });
    els.body.querySelector("#cr-side").innerHTML =
      "<h4>♟ 找回最佳着</h4><p class='core-task'>这是你在对局中走出问题着之后的局面（" + (g.cls || "") + "，损 " + g.loss + " 分）。<br>" +
      (g.reason || "走出当时引擎推荐的最佳着。") + "</p>" +
      "<div id='cr-feedback' class='core-feedback'>轮到你，走出更好的一手。</div>" +
      "<div class='core-btns' id='cr-ex-btns'></div><div id='cr-explain'></div>";
    const box = els.body.querySelector("#cr-ex-btns");
    [["💡 提示1", () => { run.hints = 1; fb("先找当时你走的那手有什么问题。"); }],
     ["💡 提示2", () => { run.hints = 2; fb("注意双方大子的安全与将军威胁。"); }],
     ["显示答案", showGameExAnswer], ["↻ 重摆", () => renderGameExRun()]].forEach(([label, fn]) => {
      const b = document.createElement("button"); b.textContent = label; b.onclick = fn; box.appendChild(b);
    });
    function fb(t) { els.body.querySelector("#cr-feedback").textContent = t; Sound.play("click"); }
    function showGameExAnswer() {
      run.answered = true;
      const pos = boardPos(g.fen);
      const mv = X.parseMove(g.accept[0].mv);
      const b = X.cloneBoard(pos.b);
      X.applyMove(b, ...mv);
      board.update({ board: b, turn: X.other(pos.side), lastMove: mv, interactive: false });
      els.body.querySelector("#cr-feedback").textContent = "答案：" + g.accept.map(a => a.cn).join(" / ");
      finishGameEx(false);
    }
    run._fb = fb;
    run._showAnswer = showGameExAnswer;
  }
  function onGameExMove(f0, r0, f1, r1) {
    if (!run || !run.gameEx || run.phase !== "exercise") return;
    const g = run.gameEx;
    const pos = boardPos(g.fen);
    const mv = [f0, r0, f1, r1];
    if (!X.isLegal(pos.b, pos.side, mv)) { Sound.play("illegal"); return; }
    const text = X.moveToText(mv);
    if (g.accept.some(a => a.mv === text)) {
      Sound.play("move");
      els.body.querySelector("#cr-feedback").textContent = "✅ 正确！这就是当时的最佳着。";
      els.body.querySelector("#cr-feedback").className = "core-feedback ok";
      els.body.querySelector("#cr-ex-btns").innerHTML = "";
      els.body.querySelector("#cr-explain").innerHTML = "<button id='cr-ex-next' class='primary'>完成 →</button>";
      Learn.gameEx.record(g.id, { ok: true, wrong: run.wrong, hints: run.hints, answered: run.answered, reviewVisit: true });
      els.body.querySelector("#cr-ex-next").onclick = closeRun;
    } else {
      run.wrong++;
      Sound.play("illegal");
      els.body.querySelector("#cr-feedback").textContent = "还不是最佳——再想想（可点提示）。";
    }
  }
  function finishGameEx(ok) {
    Learn.gameEx.record(run.gameEx.id, { ok, wrong: run.wrong, hints: run.hints, answered: run.answered, reviewVisit: true });
    els.body.querySelector("#cr-ex-btns").innerHTML = "";
    els.body.querySelector("#cr-explain").innerHTML = "<button id='cr-ex-next' class='primary'>完成 →</button>";
    els.body.querySelector("#cr-ex-next").onclick = closeRun;
  }

  window.Core = { mount, show() { renderSub(); }, hide() { run = null; }, gotoLesson, gotoReview };
})();
