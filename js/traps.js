/* 飞刀与骗招练习。
 * 数据来源：I 类「布局陷阱100局精选」。
 * 分类由引擎判定：陷阱着若与最优着差距小（<60分）→ 飞刀（不上当也无损）；
 * 差距大（>150分）→ 骗招（不上当则大亏）；其余 → 险招（灰色地带）。
 * 分类结果缓存 localStorage，引擎不可用时不可见分类（仍可练习）。
 * Traps.mount(container) / show() / hide() */
(function () {
  "use strict";

  const X = window.Xiangqi;
  const CLS_KEY = "xq-trapcls-v2";
  let lessons = [];          // I 类课程
  let clsCache = {};
  try { clsCache = JSON.parse(localStorage.getItem(CLS_KEY) || "{}"); } catch (e) {}
  function saveCls() { try { localStorage.setItem(CLS_KEY, JSON.stringify(clsCache)); } catch (e) {} }

  let els = {}, board = null, quiz = null, cur = null;
  let filter = "all";        // all | 飞刀 | 骗招
  let lastClsStart = 0;      // 时间戳防重（避免僵尸 await 卡死分类）

  function mount(container) {
    container.innerHTML = `
      <div class="trap-wrap">
        <div class="trap-side">
          <div class="trap-tabs">
            <button data-f="all" class="tab active">全部</button>
            <button data-f="飞刀" class="tab">飞刀</button>
            <button data-f="骗招" class="tab">骗招</button>
          </div>
          <div id="trap-note" class="dim" style="padding:8px 4px;font-size:13px">
            分类由引擎实时判定：飞刀=对方不上当自己也不亏；骗招=对方不上当自己大亏。
          </div>
          <div id="trap-list" class="trap-list"></div>
        </div>
        <div class="trap-main">
          <div id="trap-empty" class="dim" style="padding:30px">从左侧选择一局飞刀/骗招开始拆解学习。<br>每局分为：铺垫讲棋 → 陷阱讲解 → 试走陷阱着 → 上当/识破变化对照。</div>
          <div id="trap-view" class="hidden">
            <div class="trap-bar">
              <span id="trap-title"></span>
              <span id="trap-badge"></span>
              <span id="trap-stage" class="tk tk-x"></span>
              <button id="trap-back">← 返回列表</button>
            </div>
            <div class="trap-content">
              <canvas id="trap-board"></canvas>
              <div class="trap-right">
                <div id="trap-clsinfo" class="trap-clsinfo"></div>
                <div id="trap-panel" class="trap-clsinfo"></div>
                <div id="trap-buttons" class="quiz-buttons"></div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    els = {
      list: container.querySelector("#trap-list"),
      note: container.querySelector("#trap-note"),
      empty: container.querySelector("#trap-empty"),
      view: container.querySelector("#trap-view"),
      title: container.querySelector("#trap-title"),
      badge: container.querySelector("#trap-badge"),
      stage: container.querySelector("#trap-stage"),
      back: container.querySelector("#trap-back"),
      clsinfo: container.querySelector("#trap-clsinfo"),
      panel: container.querySelector("#trap-panel"),
      buttons: container.querySelector("#trap-buttons")
    };
    board = Board.create(container.querySelector("#trap-board"), { onMove: (a, b, c, d) => {
      if (flow.stage === "quiz") quiz.tryMove(a, b, c, d);
      else if (flow.stage === "lecture" || flow.stage === "explain") {
        Sound.play("illegal");
        setPanel("先按下方按钮一步步来，一会儿就轮到你走 🙂");
      }
    } });
    quiz = Quiz.create({ onUpdate: onQuizUpdate, onDone: onQuizDone });
    els.back.onclick = () => { stopLecture(); flow = {}; els.view.classList.add("hidden"); els.empty.classList.remove("hidden"); };
    container.querySelectorAll(".trap-tabs .tab").forEach(b => {
      b.onclick = () => {
        filter = b.dataset.f;
        container.querySelectorAll(".trap-tabs .tab").forEach(x => x.classList.toggle("active", x === b));
        renderList();
      };
    });
    loadLessons();
  }

  async function loadLessons() {
    const idx = await fetch("data/index.json").then(r => r.json());
    const cat = idx.categories.find(c => c.id === "I");
    lessons = cat ? cat.lessons : [];
    renderList();
    classifyAll();
  }

  async function classifyAll() {
    if (Date.now() - lastClsStart < 30000) return;
    lastClsStart = Date.now();
    if (!Engine.ready) {
      els.note.textContent = "等待引擎就绪后进行自动分类…";
      for (let i = 0; i < 180 && !Engine.ready; i++) await new Promise(r => setTimeout(r, 500));
      if (!Engine.ready) { els.note.textContent = "引擎不可用：无法自动分类，可直接练习。"; return; }
    }
    const pending = lessons.filter(l => !clsCache[l.id]);
    if (!pending.length) { renderList(); return; }
    els.note.textContent = "引擎正在判定飞刀/骗招（" + pending.length + " 局）…";
    for (const l of pending) {
      try {
        clsCache[l.id] = await classifyOne(l);
      } catch (e) {
        clsCache[l.id] = { cls: "未知", loss: null, trapPly: null };
      }
      saveCls();
      renderList();
    }
    els.note.textContent = "分类完成。飞刀=不上当也不亏；骗招=不上当大亏。";
    renderList();
  }

  /* 判定一局：
   * 1) 沿主线扫描前 12 步，找对方"上当"的分岔点（其实际应法比引擎最优差 150 分以上）
   * 2) 在该点计算陷阱方"最优着"与"陷阱着后对方最优防御"的差值 = 不上当的代价
   *    代价 <60 分 → 飞刀（稳）；>150 分 → 骗招（险）；其余 → 险招 */
  async function classifyOne(meta) {
    const data = await fetch(meta.file).then(r => r.json());
    const line = [];
    let nodes = data.moves || [];
    while (nodes.length && line.length < 22) {
      line.push(nodes[0]);
      nodes = nodes[0].ch || [];
    }
    if (line.length < 4) return { cls: "未知", loss: null, trapPly: null };

    function posAt(i) {
      const { board, side } = X.parseFen(data.fen);
      let s = side;
      for (let j = 0; j < i; j++) {
        X.applyMove(board, ...X.parseMove(line[j].m));
        s = X.other(s);
      }
      return { board, side: s };
    }

    for (let j = 1; j + 1 < line.length && j <= 21; j++) {
      // j = 对方着子序号（陷阱方可能是红也可能是黑，所以双方步都扫）
      const p1 = posAt(j);
      const fen1 = X.boardToFen(p1.board, p1.side);
      let cands = await Engine.candidates(fen1, 300, 4);
      if (!cands.length) {
        await new Promise(r => setTimeout(r, 300));
        cands = await Engine.candidates(fen1, 600, 4);   // 重试一次
      }
      if (!cands.length) break;
      const actual = cands.find(c => c.mv === line[j].m);
      let oppValue;
      if (actual) {
        oppValue = actual.cp;
      } else {
        const b2 = X.cloneBoard(p1.board);
        X.applyMove(b2, ...X.parseMove(line[j].m));
        const e = await Engine.evalCp(X.boardToFen(b2, X.other(p1.side)), 250);
        if (e === null) break;
        oppValue = -e;   // 转回对方视角
      }
      const fall = cands[0].cp - oppValue;   // 对方因上当损失的分
      if (fall < 150) continue;              // 不算上当，继续扫描

      // 找到陷阱点：陷阱着 = line[j-1]（对方上一步是陷阱方的关键着）
      const p0 = posAt(j - 1);
      const cands0 = await Engine.candidates(X.boardToFen(p0.board, p0.side), 300, 4);
      if (!cands0.length) break;
      // 对方最优防御后的局面（陷阱方走子，评分即陷阱方视角）
      const b3 = X.cloneBoard(p1.board);
      X.applyMove(b3, ...X.parseMove(cands[0].mv));
      const decline = await Engine.evalCp(X.boardToFen(b3, X.other(p1.side)), 300);
      if (decline === null) break;
      const loss = Math.max(0, cands0[0].cp - decline);
      const cls = loss < 60 ? "飞刀" : loss > 150 ? "骗招" : "险招";
      return { cls, loss: Math.round(loss), fall: Math.round(fall),
               trapPly: j, declineMv: cands[0].mv, trapCn: line[j - 1].cn };
    }
    return { cls: "未知", loss: null, trapPly: null };
  }

  function renderList() {
    els.list.innerHTML = "";
    const shown = lessons.filter(l => {
      const c = clsCache[l.id];
      if (filter === "all") return true;
      return c && c.cls === filter;
    });
    if (!shown.length) {
      els.list.innerHTML = "<div class='dim' style='padding:10px'>暂无分类结果（等引擎判定完或换个筛选）</div>";
      return;
    }
    for (const l of shown) {
      const c = clsCache[l.id];
      const item = document.createElement("div");
      item.className = "trap-item";
      const badge = c
        ? (c.cls === "飞刀" ? "<span class='tk tk-a'>飞刀</span>"
          : c.cls === "骗招" ? "<span class='tk tk-b'>骗招</span>"
          : c.cls === "险招" ? "<span class='tk tk-c'>险招</span>"
          : "<span class='tk tk-x'>?</span>")
        : "<span class='tk tk-x'>…</span>";
      item.innerHTML = badge + "<span class='trap-name'>" + l.title + "</span>";
      item.onclick = () => openTrap(l);
      els.list.appendChild(item);
    }
  }

  /* ---------- 拆解教学流程 ---------- */
  let flow = {};        // { data, line, trapPly, stage, ply, timer }
  let lectureTimer = null;

  function stopLecture() { if (lectureTimer) { clearInterval(lectureTimer); lectureTimer = null; } }

  function setPanel(html) { els.panel.innerHTML = html; }
  function setButtons(defs) {
    els.buttons.innerHTML = "";
    for (const d of defs) {
      const b = document.createElement("button");
      b.textContent = d.label;
      if (d.primary) b.className = "primary";
      b.onclick = d.fn;
      els.buttons.appendChild(b);
    }
  }
  function stageLabel(t) { els.stage.textContent = t; }

  function posOf(data, line, i) {
    const { board, side } = X.parseFen(data.fen);
    let s = side;
    for (let j = 0; j < i; j++) {
      X.applyMove(board, ...X.parseMove(line[j].m));
      s = X.other(s);
    }
    return { board, side: s };
  }

  async function openTrap(meta) {
    Sound.play("click");
    const data = await fetch(meta.file).then(r => r.json());
    const line = [];
    let nodes = data.moves || [];
    while (nodes.length && line.length < 60) { line.push(nodes[0]); nodes = nodes[0].ch || []; }
    const c = clsCache[meta.id];
    const trapPly = c && c.trapPly ? c.trapPly : null;
    flow = { meta, data, line, trapPly, stage: "lecture", ply: 0 };
    els.empty.classList.add("hidden");
    els.view.classList.remove("hidden");
    els.title.textContent = meta.title;
    renderBadge(c);
    renderClsInfo(c);
    gotoLecture(0);
  }

  function renderBadge(c) {
    if (c && c.cls !== "未知" && c.cls) {
      els.badge.innerHTML = "<span class='tk " + (c.cls === "飞刀" ? "tk-a" : c.cls === "骗招" ? "tk-b" : "tk-c") + "'>" + c.cls + "</span>";
    } else els.badge.innerHTML = "";
  }

  function renderClsInfo(c) {
    if (c && c.cls && c.cls !== "未知") {
      const fallTxt = c.fall !== undefined ? "对方若随手应对将损 <b>" + c.fall + "</b> 分；" : "";
      els.clsinfo.innerHTML = c.cls === "飞刀"
        ? "✅ <b>飞刀</b>：" + fallTxt + "即便对方识破不上当，自己也仅损 <b>" + c.loss + "</b> 分，可以放心使用。"
        : c.cls === "骗招"
          ? "⚠️ <b>骗招</b>：" + fallTxt + "但若对方识破，自己将损 <b>" + c.loss + "</b> 分！风险极高，慎用。"
          : "😐 <b>险招</b>：" + fallTxt + "不上当损 " + c.loss + " 分，介于飞刀与骗招之间。";
    } else {
      els.clsinfo.textContent = "（本局陷阱点较深或引擎未检出，跟随讲解一步步学习）";
    }
  }

  /* 第 1 阶段：铺垫讲棋 */
  function gotoLecture(ply) {
    stopLecture();
    const { data, line, trapPly } = flow;
    flow.stage = "lecture";
    flow.ply = ply;
    const target = trapPly ? trapPly - 1 : line.length;   // 讲到陷阱前一手（或全盘）
    const pos = posOf(data, line, ply);
    const last = ply > 0 ? X.parseMove(line[ply - 1].m) : null;
    board.update({ board: pos.board, turn: pos.side, lastMove: last, interactive: false, hint: null });
    stageLabel("铺垫讲棋");

    const node = line[ply];
    if (ply >= target) { enterExplain(); return; }
    const who = pos.side === "r" ? "红方" : "黑方";
    const stepNo = Math.floor(ply / 2) + 1;
    let html = "<b>第 " + stepNo + " 回合" + (pos.side === "b" ? "（黑）" : "") + " · " + who + "走</b><br>";
    html += node ? "谱着：<b>" + node.cn + "</b><br>" : "";
    if (node && node.c) html += "<span style='color:#e8cf8a'>💬 " + node.c + "</span>";
    else html += "<span class='dim'>" + (trapPly ? "双方布局铺垫中……注意双方子力的位置和意图。" : "按谱学习这局棋。") + "</span>";
    setPanel(html);

    const defs = [{ label: "下一步 →", primary: true, fn: () => { Sound.play("move"); gotoLecture(ply + 1); } }];
    if (!lectureTimer) defs.push({ label: "▶ 自动播放", fn: startAuto });
    defs.push({ label: "⏭ 直达陷阱点", fn: () => { Sound.play("click"); gotoLecture(target); } });
    setButtons(defs);
  }

  function startAuto() {
    Sound.play("click");
    stopLecture();
    lectureTimer = setInterval(() => {
      const { trapPly, line, ply } = flow;
      const target = trapPly ? trapPly - 1 : line.length;
      if (ply >= target) { stopLecture(); return; }
      Sound.play("move");
      gotoLecture(ply + 1);
    }, 900);
  }

  /* 第 2 阶段：陷阱讲解 */
  function enterExplain() {
    stopLecture();
    const { data, line, trapPly, meta } = flow;
    if (!trapPly) { startFullQuiz(); return; }
    flow.stage = "explain";
    flow.ply = trapPly - 1;
    const pos = posOf(data, line, trapPly - 1);
    const last = trapPly > 1 ? X.parseMove(line[trapPly - 2].m) : null;
    board.update({ board: pos.board, turn: pos.side, lastMove: last, interactive: false, hint: null });
    stageLabel("陷阱讲解");

    const c = clsCache[meta.id] || {};
    const trapNode = line[trapPly - 1];
    const victimNode = line[trapPly];
    const p1 = posOf(data, line, trapPly);
    const declineCn = c.declineMv ? Notation.chinese(p1.board, p1.side, X.parseMove(c.declineMv)) : "（引擎推荐应法）";
    const who = pos.side === "r" ? "红方" : "黑方";
    const stepNo = Math.floor((trapPly - 1) / 2) + 1;
    let html = "<b>⚡ 关键局面（第 " + stepNo + " 回合）</b><br>" +
      who + "的「<b style='color:#ffd97a'>" + trapNode.cn + "</b>」暗藏玄机——这步棋就是本局的" +
      (c.cls === "骗招" ? "骗招" : c.cls === "飞刀" ? "飞刀" : "关键陷阱") + "。<br>";
    if (victimNode) html += "对方若随手应以谱着「" + victimNode.cn + "」，将损 <b style='color:#ff9070'>" + (c.fall || "?") + "</b> 分，正中下怀！<br>";
    html += "正解是「<b style='color:#7fd492'>" + declineCn + "</b>」（引擎推荐）。<br>";
    if (trapNode.c) html += "<span style='color:#e8cf8a'>💬 原谱评注：" + trapNode.c + "</span>";
    setPanel(html);
    setButtons([
      { label: "我来找这步陷阱着！", primary: true, fn: startTrapQuiz },
      { label: "← 回铺垫", fn: () => gotoLecture(Math.max(0, trapPly - 2)) }
    ]);
  }

  /* 第 3 阶段：试走陷阱着（上当线 = 谱着惩罚） */
  function startTrapQuiz() {
    Sound.play("click");
    const { data, line, trapPly } = flow;
    flow.stage = "quiz";
    stageLabel("试走陷阱着");
    const p0 = posOf(data, line, trapPly - 1);
    const trapNode = line[trapPly - 1];
    // 合成一课：从陷阱前局面开始，正解 = 陷阱着及其后续谱着
    quiz.load({ fen: X.boardToFen(p0.board, p0.side), title: flow.meta.title, moves: [trapNode] });
    setPanel("🤔 轮到你执" + (p0.side === "r" ? "红" : "黑") + "。在棋盘上走出那步暗藏杀机的陷阱着！<br><span class='dim'>走错可以反复试，看你能不能用出来。</span>");
  }

  function onQuizUpdate(st) {
    if (flow.stage !== "quiz") return;
    board.update({
      board: st.board, turn: st.side, lastMove: null, hint: null,
      interactive: st.turn === "student"
    });
    if (st.turn === "done") return;   // onQuizDone 接手
    if (st.message) setPanel("<span style='color:#ff9070'>" + st.message + "</span><br>🤔 再想想哪一步藏着杀机？");
    else if (st.turn === "waiting") setPanel("✅ 好棋！陷阱已布下，看对方应手……");
    else setPanel("🤔 陷阱已布下。继续按谱着把杀法走完全程！");
    renderQuizButtons(st);
  }

  function renderQuizButtons(st) {
    const defs = [];
    defs.push({
      label: "💡 提示", fn: async () => {
        const s2 = quiz.boardState();
        if (!s2 || s2.turn !== "student") return;
        const mv = await Engine.hint(X.boardToFen(s2.board, s2.side), 600);
        if (mv) board.update({ hint: X.parseMove(mv) });
      }
    });
    defs.push({ label: "显示答案", fn: () => quiz.showAnswer() });
    defs.push({ label: "↻ 重来", fn: () => startTrapQuiz() });
    defs.push({ label: "← 返回列表", fn: () => els.back.onclick() });
    setButtons(defs);
  }

  function onQuizDone(stats) {
    Sound.play("check");
    if (flow.stage !== "quiz") return;
    const c = clsCache[flow.meta.id] || {};
    flow.stage = "debrief";
    stageLabel("上当线完成");
    setPanel("🎉 漂亮！你已经掌握了这步陷阱着（共走 " + stats.steps + " 步，试错 " + stats.wrong + " 次）。<br>" +
      (c.fall !== undefined ? "对方按谱着应对，整整损了 <b style='color:#ff9070'>" + c.fall + "</b> 分！" : "") +
      "<br>接下来看看：如果对方<b>识破不上当</b>会怎样？");
    setButtons([
      { label: "看识破变化 →", primary: true, fn: showDecline },
      { label: "↻ 再练一次", fn: startTrapQuiz },
      { label: "← 返回列表", fn: () => els.back.onclick() }
    ]);
  }

  /* 第 4 阶段：识破线 */
  async function showDecline() {
    const { data, line, trapPly, meta } = flow;
    const c = clsCache[meta.id] || {};
    flow.stage = "decline";
    stageLabel("识破变化");
    const p1 = posOf(data, line, trapPly);
    let html;
    if (c.declineMv) {
      const declineCn = Notation.chinese(p1.board, p1.side, X.parseMove(c.declineMv));
      const b2 = X.cloneBoard(p1.board);
      X.applyMove(b2, ...X.parseMove(c.declineMv));
      board.update({ board: b2, turn: X.other(p1.side), lastMove: X.parseMove(c.declineMv), interactive: false, hint: null });
      let evalTxt = "";
      if (Engine.ready) {
        setPanel("引擎评估识破后的局面……");
        const cp = await Engine.evalCp(X.boardToFen(b2, X.other(p1.side)), 400);
        if (cp !== null) {
          const trapper = X.other(p1.side);
          evalTxt = "此时局面评估：" + (trapper === "r" ? "红方" : "黑方") + "（陷阱方）" +
            (cp >= 0 ? "优 " + cp : "劣 " + (-cp)) + " 分。";
        }
      }
      const lossTxt = c.cls === "飞刀"
        ? "对方识破后自己只损 <b style='color:#7fd492'>" + c.loss + "</b> 分——这就是<b>飞刀</b>：进可诱敌，退可自保。"
        : c.cls === "骗招"
          ? "对方识破后自己要亏 <b style='color:#ff9070'>" + c.loss + "</b> 分——这就是<b>骗招</b>：只求一击，落空则伤筋动骨。"
          : "对方识破后损 " + c.loss + " 分，介于两者之间。";
      html = "🧐 对方识破了陷阱，走的是「<b style='color:#7fd492'>" + declineCn + "</b>」。<br>" +
        evalTxt + "<br>" + lossTxt +
        "<br><span class='dim'>记住这个感觉：用飞刀时心态放松，用骗招时务必确认对手大概率会上当。</span>";
    } else {
      html = "本局未收录识破变化（引擎分类时尚未检出）。";
      board.update({ board: p1.board, turn: p1.side, lastMove: X.parseMove(line[trapPly - 1].m), interactive: false });
    }
    setPanel(html);
    setButtons([
      { label: "↻ 重新拆解", primary: true, fn: () => gotoLecture(0) },
      { label: "← 返回列表", fn: () => els.back.onclick() }
    ]);
  }

  /* 无 trapPly 的课：整盘讲完后从头练习（旧模式兜底） */
  function startFullQuiz() {
    const { data } = flow;
    flow.stage = "quiz";
    stageLabel("整盘练习");
    quiz.load(data);
    setPanel("🤔 跟着棋谱把正着走完。注意体会其中设套与惩罚的时机。");
  }

  window.Traps = {
    mount,
    show() {
      renderList();
      // 引擎就绪后补跑未分类项（30 秒防重）
      if (lessons.some(l => !clsCache[l.id])) classifyAll();
    },
    hide() {},
    _classifyOne: meta => classifyOne(meta)
  };
})();
