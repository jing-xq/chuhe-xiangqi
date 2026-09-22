/* 象棋私教：默认由本地引擎大脑（js/coachbrain.js，皮卡鱼逐手拆解 + 棋理模板）点评棋局，
 * 零 tokens、讲解可复核；引擎不可用时才回退到用户自填的大模型 API（OpenAI 兼容格式）。
 * 布局：左侧参照棋盘（跟随上下文）+ 设置入口；右侧对话（Markdown 渲染）。
 * 设置面板：API 配置 / 学员习惯档案（可编辑）/ 自定义私教提示词。
 * Coach.mount(container) / show() / hide() */
(function () {
  "use strict";

  const X = window.Xiangqi;
  const SET_KEY = "xq-coach-settings";
  const PROF_KEY = "xq-coach-profile";
  const PROMPT_KEY = "xq-coach-custom-prompt";

  const DEFAULT_BASE_PROMPT =
    "你是「象棋私教」，一位耐心、专业、善于鼓励的象棋教练，学员是业余爱好者（水平从业余初学到业余中坚）。\n" +
    "规则：\n" +
    "1. 说话通俗，多用具体着法（中文记谱，如 炮二平五、马8进7）说明，必要时给出 2-4 步的后续变化。\n" +
    "2. 点评时必须指出：哪几手不合棋理、为什么、更好的下法是什么。\n" +
    "3. 结合消息中附带的引擎数据（评分/推荐着）来讲，但要用学员听得懂的语言解释。\n" +
    "4. 一次不要讲太多，抓住最重要的一两个问题深入讲透。\n" +
    "5. 语气以鼓励为主，先肯定亮点再指出问题。\n" +
    "6. 回复使用 Markdown 排版（标题、加粗、列表），便于阅读。";

  let els = {};
  let settings = { base: "https://api.deepseek.com", key: "", model: "deepseek-chat" };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SET_KEY) || "{}")); } catch (e) {}
  let profile = null;
  try { profile = JSON.parse(localStorage.getItem(PROF_KEY) || "null"); } catch (e) {}
  let customPrompt = localStorage.getItem(PROMPT_KEY) || "";
  let messages = [];        // 本轮对话历史 [{role, content}]
  let lastReview = null;    // 最近一次针对某盘棋的讲解 { game, content }，供"存入"使用
  let refBoard = null;      // 参照棋盘
  let refTimer = null;

  function saveSettings() { try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (e) {} }
  function saveProfile() { try { localStorage.setItem(PROF_KEY, JSON.stringify(profile)); } catch (e) {} }

  /* ---------- Markdown 渲染：共享 js/md.js ---------- */

  /* ---------- 本地战绩统计 ---------- */
  function localStats() {
    const gs = window.Games ? Games.all() : [];
    let w = 0, l = 0, d = 0, losses = [], games = 0;
    for (const g of gs) {
      games++;
      if (g.result === "win") w++; else if (g.result === "loss") l++; else d++;
      if (g.analysis) for (const p of g.analysis.perMove) losses.push(p.loss);
    }
    losses.sort((a, b) => b - a);
    const avg = losses.length ? Math.round(losses.reduce((a, b) => a + b, 0) / losses.length) : null;
    return { games, w, l, d, avgLoss: avg, bigMistakes: losses.filter(x => x >= 250).length, analyzed: losses.length };
  }

  /* ---------- 引擎局面描述 ---------- */
  async function describeFen(fen) {
    if (!Engine.ready) return "（引擎不可用，无评分数据）";
    const { board, side } = X.parseFen(fen);
    const cp = await Engine.evalCp(fen, 400);
    const cands = await Engine.candidates(fen, 500, 3);
    let s = "引擎评估：" + (cp === null ? "未知" : (side === "r" ? "红方" : "黑方") + "走子方视角 " + cp + " 分") + "；推荐着：";
    s += cands.map((c, idx) => {
      const mv = X.parseMove(c.mv);
      return (idx + 1) + "." + Notation.chinese(board, side, mv) + "(" + c.cp + "分)";
    }).join("，");
    return s;
  }

  function gameToText(g) {
    const row = [];
    g.moves.forEach((m, i) => {
      if (i % 2 === 0) row.push((i / 2 + 1) + "." + m.cn);
      else row[row.length - 1] += " " + m.cn;
    });
    let s = "【对局】" + new Date(g.ts).toLocaleString() +
      " 对手：" + (g.levelName || "未知") + " 我执" + (g.mySide === "r" ? "红" : "黑") +
      " 结果：" + (g.result === "win" ? "胜" : g.result === "loss" ? "负" : "和") + "（" + (g.reason || "") + "）\n" +
      row.join(" ");
    if (g.analysis) {
      const bad = [];
      g.analysis.perMove.forEach((p, i) => {
        if (p.loss >= 120) bad.push(g.moves[i].cn + "(第" + (Math.floor(i / 2) + 1) + "手,损" + p.loss + "分," + p.cls + ")");
      });
      s += bad.length ? "\n【引擎标记的问题着】" + bad.join("、") : "\n【引擎分析】全局无大问题着。";
    }
    return s;
  }

  /* ---------- 大模型调用 ---------- */
  async function chat(sysPrompt, userContent, onTick) {
    if (!settings.key) throw new Error("请先在设置里填入 API Key");
    const msgs = [{ role: "system", content: sysPrompt }]
      .concat(messages.slice(-10))
      .concat([{ role: "user", content: userContent }]);
    const t0 = Date.now();
    const tickTimer = onTick ? setInterval(() => onTick((Date.now() - t0) / 1000), 500) : null;
    let res;
    try {
      res = await fetch(settings.base.replace(/\/+$/, "") + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + settings.key },
        body: JSON.stringify({ model: settings.model, messages: msgs, temperature: 0.6 })
      });
    } finally {
      if (tickTimer) clearInterval(tickTimer);
    }
    const elapsed = (Date.now() - t0) / 1000;
    if (onTick) onTick(null, elapsed);
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error("API " + res.status + "：" + t.slice(0, 200));
    }
    const data = await res.json();
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) return { content: "(空回复)", reasoning: null, elapsed };
    return {
      content: msg.content || "(空回复)",
      reasoning: msg.reasoning_content || null,
      elapsed
    };
  }

  function systemPrompt() {
    let s = (customPrompt && customPrompt.trim()) ? customPrompt.trim() : DEFAULT_BASE_PROMPT;
    s += (profile && profile.text)
      ? "\n【学员习惯档案】（你此前总结的该学员特点，可引用和更新）\n" + profile.text
      : "\n【学员习惯档案】暂无，先通过棋谱观察，不要臆断。";
    return s;
  }

  function extractProfile(reply) {
    const m = /```json\s*([\s\S]*?)```/.exec(reply);
    if (!m) return null;
    try {
      const obj = JSON.parse(m[1]);
      if (obj && (obj.profile || obj.habits)) {
        const text = obj.profile ||
          (Array.isArray(obj.habits) ? obj.habits.map((h, i) => (i + 1) + "." + h).join("\n") : null);
        if (text) return { text: String(text), ts: Date.now() };
      }
    } catch (e) {}
    return null;
  }

  /* ---------- 参照棋盘（含翻步与自由推导） ---------- */
  let refBase = null;      // { src, moves:[{m,cn}], ply }  ply=当前显示的步数
  let refSandbox = null;   // { board, side, moves:[{m,cn}] } 自由推导状态

  function refContext() {
    const v = els.ctx.value;
    if (v === "play" && window.PlayDebug && PlayDebug.state && PlayDebug.state.moves.length) {
      return { src: "当前对弈", label: "当前对弈", moves: PlayDebug.state.moves.map(m => ({ m: m.m, cn: m.cn })) };
    }
    if (v === "game") {
      const g = selectedGame();
      if (g && g.moves.length) {
        return { src: "所选棋谱:" + (g.id || ""), label: "所选棋谱", fen: g.fen || null, moves: g.moves.map(m => ({ m: m.m, cn: m.cn })) };
      }
    }
    return null;
  }

  function refPosition(moves, ply, fen) {
    const p = X.parseFen(fen || "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1");
    let s = p.side;
    let last = null;
    for (let i = 0; i < ply; i++) {
      last = X.parseMove(moves[i].m);
      X.applyMove(p.board, ...last);
      s = X.other(s);
    }
    return { board: p.board, side: s, lastMove: last };
  }

  function refreshRefBoard() {
    if (!refBoard) return;
    // 自由推导模式：只画推演局面
    if (refSandbox) {
      refBoard.update({
        board: refSandbox.board.map(r => r.slice()), turn: refSandbox.side,
        lastMove: refSandbox.moves.length ? X.parseMove(refSandbox.moves[refSandbox.moves.length - 1].m) : null,
        interactive: true
      });
      els.refLabel.textContent = "🧪 自由推导中 · " + (refSandbox.side === "r" ? "红方走" : "黑方走");
      els.sbinfo.classList.remove("hidden");
      els.sbinfo.textContent = "已推 " + refSandbox.moves.length + " 手：" +
        refSandbox.moves.map(m => m.cn).slice(-6).join(" ") + (refSandbox.moves.length > 6 ? " …" : "");
      setRefBar("sandbox");
      return;
    }
    const ctx = refContext();
    if (!ctx) {
      els.refBox.classList.add("hidden");
      refBase = null;
      return;
    }
    els.refBox.classList.remove("hidden");
    // 跟随终局；若用户正在翻步则保持其位置
    if (!refBase || refBase.src !== ctx.src ||
        (refBase.moves.length !== ctx.moves.length && refBase.ply >= refBase.moves.length)) {
      refBase = { src: ctx.src, label: ctx.label, fen: ctx.fen || null, moves: ctx.moves, ply: ctx.moves.length };
    } else {
      refBase.moves = ctx.moves;
      refBase.label = ctx.label;
      refBase.fen = ctx.fen || null;
      if (refBase.ply > ctx.moves.length) refBase.ply = ctx.moves.length;
    }
    const pos = refPosition(refBase.moves, refBase.ply, refBase.fen);
    refBoard.update({ board: pos.board, turn: pos.side, lastMove: pos.lastMove, interactive: false });
    els.refLabel.textContent = (refBase.label || refBase.src) + " 第 " + refBase.ply + "/" + refBase.moves.length + " 手 · " +
      (pos.side === "r" ? "红方走" : "黑方走");
    setRefBar("view");
  }

  function setRefBar(mode) {
    els.refPrev.classList.toggle("hidden", mode === "sandbox");
    els.refNext.classList.toggle("hidden", mode === "sandbox");
    els.refSandbox.classList.toggle("hidden", mode === "sandbox");
    els.refSbend.classList.toggle("hidden", mode !== "sandbox");
    els.refSbsend.classList.toggle("hidden", mode !== "sandbox" || !refSandbox || !refSandbox.moves.length);
    if (mode !== "sandbox") els.sbinfo.classList.add("hidden");
  }

  function refStep(d) {
    if (!refBase || refSandbox) return;
    Sound.play("click");
    refBase.ply = Math.max(0, Math.min(refBase.moves.length, refBase.ply + d));
    refreshRefBoard();
  }

  function sandboxStart() {
    if (!refBase) return;
    Sound.play("click");
    const pos = refPosition(refBase.moves, refBase.ply, refBase.fen);
    refSandbox = { board: pos.board, side: pos.side, moves: [] };
    refreshRefBoard();
  }

  function sandboxEnd() {
    refSandbox = null;
    Sound.play("click");
    refreshRefBoard();
  }

  function sandboxSend() {
    if (!refSandbox || !refSandbox.moves.length) return;
    const line = refSandbox.moves.map((m, i) => {
      return (i % 2 === 0 ? (Math.floor(i / 2) + 1) + "." : "") + m.cn;
    }).join(" ");
    const head = "【自由推导】我从「" + (refBase ? (refBase.label || refBase.src) + " 第" + refBase.ply + "手" : "当前局面") +
      "」开始推演了这样一个变化：" + line + "。请点评这个变化的好坏，并给出更合理的下法。";
    refSandbox = null;
    refreshRefBoard();
    ask(head);
  }

  function sandboxMove(f0, r0, f1, r1) {
    if (!refSandbox) return;
    const mv = [f0, r0, f1, r1];
    if (!X.isLegal(refSandbox.board, refSandbox.side, mv)) { Sound.play("illegal"); return; }
    const cn = Notation.chinese(refSandbox.board, refSandbox.side, mv);
    X.applyMove(refSandbox.board, ...mv);
    refSandbox.side = X.other(refSandbox.side);
    refSandbox.moves.push({ m: X.moveToText(mv), cn });
    Sound.play("move");
    refreshRefBoard();
  }

  /* ---------- UI ---------- */
  function mount(container) {
    container.innerHTML = `
      <div class="coach-wrap">
        <div class="coach-left">
          <div class="coach-toolbar">
            <button id="co-settings-btn">⚙️ 设置</button>
            <button id="co-summarize">🧠 总结习惯</button>
          </div>
          <div id="co-refbox" class="co-refbox hidden">
            <canvas id="co-refboard"></canvas>
            <div class="co-reflabel"><span id="co-reflabel"></span> <button id="co-refflip">⇅</button></div>
            <div class="co-refbar">
              <button id="co-ref-prev" title="上一步">◀</button>
              <button id="co-ref-next" title="下一步">▶</button>
              <button id="co-ref-sandbox">🧪 自由推导</button>
              <button id="co-ref-sbend" class="hidden">✔ 结束推导</button>
              <button id="co-ref-sbsend" class="hidden">📤 发给私教</button>
            </div>
            <div id="co-ref-sbinfo" class="dim hidden" style="font-size:12px"></div>
          </div>
          <div id="co-profile-card" class="coach-card co-fold">
            <div class="co-fold-head" id="co-profile-fold">
              <span>🧠 学员习惯档案</span><span class="co-fold-arrow">▸</span>
            </div>
            <div class="co-fold-body hidden">
              <div id="co-profile-text" class="co-profile">（还没有档案——点评一两盘棋后，私教会自动总结你的习惯）</div>
              <div id="co-stats" class="dim" style="font-size:12px;margin-top:8px"></div>
            </div>
          </div>
        </div>

        <div class="coach-card coach-chat">
          <h4>💬 私教对话</h4>
          <div class="co-context">
            上下文：
            <select id="co-ctx">
              <option value="none">无（自由问答）</option>
              <option value="play">当前对弈局面</option>
              <option value="game">选择棋谱…</option>
            </select>
            <select id="co-game" class="hidden"></select>
            <button id="co-review">点评这盘棋</button>
            <button id="co-save-annotated" title="把最近一次私教讲解存入已讲解棋谱">💾 存入</button>
          </div>
          <div id="co-msgs" class="co-msgs"></div>
          <div class="co-presets">
            <span class="dim" style="font-size:12px">常用问题：</span>
            <button class="co-chip" data-q="我这盘棋输在哪？请指出最关键的两三手">我这盘输在哪</button>
            <button class="co-chip" data-q="复盘这盘棋的关键转折点，讲讲每个转折双方的得失">关键转折点</button>
            <button class="co-chip" data-q="结合我的习惯档案，指出我最近下棋里最该改的一个坏习惯，并给我一个针对性的练习建议">我的坏习惯</button>
            <button class="co-chip" data-q="根据我的档案和战绩，给我制定一份接下来两周的象棋练习计划">帮我定练习计划</button>
            <button class="co-chip" data-q="讲讲我这个局面现在最该走的一手棋及理由（结合引擎推荐）">这局该怎么走</button>
          </div>
          <div class="co-input">
            <textarea id="co-input" rows="2" placeholder="向私教提问，Enter 发送，Shift+Enter 换行"></textarea>
            <button id="co-send" class="primary">发送</button>
          </div>
        </div>
      </div>

      <div id="co-settings" class="co-settings hidden">
        <div class="co-settings-panel">
          <div class="co-settings-head">
            <b>⚙️ 私教设置</b>
            <button id="co-settings-close">✕</button>
          </div>
          <div class="co-settings-body">
            <h4>模型配置</h4>
            <label>API 地址 <input id="co-base" placeholder="https://api.deepseek.com"></label>
            <label>模型 <input id="co-model" placeholder="deepseek-chat / deepseek-reasoner"></label>
            <label>API Key <input id="co-key" type="password" placeholder="sk-..."></label>
            <div class="coach-btns">
              <button id="co-save" class="primary">保存</button>
              <button id="co-test">测试连接</button>
            </div>
            <div id="co-test-result" class="dim" style="font-size:12px;margin-top:6px"></div>

            <h4 style="margin-top:16px">学员习惯档案（可手动修改）</h4>
            <textarea id="co-profile-edit" rows="4"></textarea>
            <div class="coach-btns">
              <button id="co-profile-save">保存档案</button>
              <button id="co-profile-auto">让私教根据战绩总结</button>
            </div>

            <h4 style="margin-top:16px">私教提示词（留空使用默认）</h4>
            <textarea id="co-prompt-edit" rows="8" placeholder="自定义私教的人设与规则…"></textarea>
            <div class="coach-btns">
              <button id="co-prompt-save">保存提示词</button>
              <button id="co-prompt-reset">恢复默认</button>
            </div>
          </div>
        </div>
      </div>`;
    els = {
      ctx: container.querySelector("#co-ctx"),
      game: container.querySelector("#co-game"),
      review: container.querySelector("#co-review"),
      msgs: container.querySelector("#co-msgs"),
      input: container.querySelector("#co-input"),
      send: container.querySelector("#co-send"),
      summarize: container.querySelector("#co-summarize"),
      settingsBtn: container.querySelector("#co-settings-btn"),
      settings: container.querySelector("#co-settings"),
      base: container.querySelector("#co-base"),
      model: container.querySelector("#co-model"),
      key: container.querySelector("#co-key"),
      save: container.querySelector("#co-save"),
      test: container.querySelector("#co-test"),
      testResult: container.querySelector("#co-test-result"),
      profileText: container.querySelector("#co-profile-text"),
      profileEdit: container.querySelector("#co-profile-edit"),
      profileSave: container.querySelector("#co-profile-save"),
      profileAuto: container.querySelector("#co-profile-auto"),
      promptEdit: container.querySelector("#co-prompt-edit"),
      promptSave: container.querySelector("#co-prompt-save"),
      promptReset: container.querySelector("#co-prompt-reset"),
      stats: container.querySelector("#co-stats"),
      refBox: container.querySelector("#co-refbox"),
      refLabel: container.querySelector("#co-reflabel"),
      refPrev: container.querySelector("#co-ref-prev"),
      refNext: container.querySelector("#co-ref-next"),
      refSandbox: container.querySelector("#co-ref-sandbox"),
      refSbend: container.querySelector("#co-ref-sbend"),
      refSbsend: container.querySelector("#co-ref-sbsend"),
      sbinfo: container.querySelector("#co-ref-sbinfo")
    };
    refBoard = Board.create(container.querySelector("#co-refboard"), { onMove: sandboxMove });
    container.querySelector("#co-refflip").onclick = () => refBoard.flip();
    els.refPrev.onclick = () => refStep(-1);
    els.refNext.onclick = () => refStep(1);
    els.refSandbox.onclick = sandboxStart;
    els.refSbend.onclick = sandboxEnd;
    els.refSbsend.onclick = sandboxSend;

    // 习惯档案折叠
    container.querySelector("#co-profile-fold").onclick = () => {
      const body = container.querySelector(".co-fold-body");
      const arrow = container.querySelector(".co-fold-arrow");
      const hidden = body.classList.toggle("hidden");
      arrow.textContent = hidden ? "▸" : "▾";
    };

    // 棋谱选择器
    els.ctx.onchange = () => {
      refSandbox = null;
      els.game.classList.toggle("hidden", els.ctx.value !== "game");
      if (els.ctx.value === "game") fillGameSelect();
      refreshRefBoard();
    };
    els.game.onchange = refreshRefBoard;

    // 预设问题
    container.querySelectorAll(".co-chip").forEach(chip => {
      chip.onclick = () => sendPreset(chip.dataset.q);
    });

    els.base.value = settings.base;
    els.model.value = settings.model;
    els.key.value = settings.key;
    els.promptEdit.value = customPrompt;
    els.profileEdit.value = profile ? profile.text : "";

    els.settingsBtn.onclick = () => {
      els.settings.classList.toggle("hidden");
      els.profileEdit.value = profile ? profile.text : "";
      els.promptEdit.value = customPrompt;
    };
    container.querySelector("#co-settings-close").onclick = () => els.settings.classList.add("hidden");

    els.save.onclick = () => {
      settings.base = els.base.value.trim() || "https://api.deepseek.com";
      settings.model = els.model.value.trim() || "deepseek-chat";
      settings.key = els.key.value.trim();
      saveSettings();
      els.testResult.textContent = "已保存。";
    };
    els.test.onclick = async () => {
      els.save.onclick();
      els.testResult.textContent = "连接中…";
      const tick = thinkingStatus();
      try {
        const r = await chat("你是象棋私教，只回复一个字：好", "你好", tick);
        tick(null);
        addMsg("assistant", r.content, { elapsed: r.elapsed, reasoning: r.reasoning });
        els.testResult.textContent = "✅ 连接成功（" + r.elapsed.toFixed(1) + "s）";
      } catch (e) {
        tick(null);
        els.testResult.textContent = "❌ " + e.message;
      }
    };
    els.profileSave.onclick = () => {
      const t = els.profileEdit.value.trim();
      profile = t ? { text: t, ts: Date.now() } : null;
      saveProfile();
      renderProfile();
      els.testResult.textContent = "档案已保存。";
    };
    els.profileAuto.onclick = () => { els.settings.classList.add("hidden"); summarizeHabits(); };
    els.promptSave.onclick = () => {
      customPrompt = els.promptEdit.value;
      try { localStorage.setItem(PROMPT_KEY, customPrompt); } catch (e) {}
      els.testResult.textContent = "提示词已保存。";
    };
    els.promptReset.onclick = () => {
      customPrompt = "";
      try { localStorage.removeItem(PROMPT_KEY); } catch (e) {}
      els.promptEdit.value = "";
      els.testResult.textContent = "已恢复默认提示词。";
    };

    els.summarize.onclick = summarizeHabits;
    els.review.onclick = reviewLastGame;
    els.send.onclick = sendMessage;
    container.querySelector("#co-save-annotated").onclick = saveAnnotated;
    els.input.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    renderProfile();
  }

  /* 棋谱选择器：列出全部棋谱 */
  function fillGameSelect() {
    const gs = window.Games ? Games.all() : [];
    els.game.innerHTML = "";
    gs.forEach((g, i) => {
      const d = new Date(g.ts);
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = d.toLocaleString() + " · " +
        (g.result === "win" ? "胜" : g.result === "loss" ? "负" : g.result === "draw" ? "和" : "谱") +
        " · " + g.moves.length + "着";
      els.game.appendChild(opt);
    });
    if (!gs.length) {
      const opt = document.createElement("option");
      opt.textContent = "（暂无棋谱）";
      els.game.appendChild(opt);
    }
  }
  function selectedGame() {
    if (els.ctx.value !== "game") return null;
    const gs = window.Games ? Games.all() : [];
    return gs[Number(els.game.value)] || null;
  }

  function renderProfile() {
    els.profileText.textContent = profile ? profile.text : "（还没有档案——点评一两盘棋后，私教会自动总结你的习惯）";
    const s = localStats();
    let t = s.games
      ? "本地战绩：" + s.games + "盘 " + s.w + "胜" + s.d + "和" + s.l + "负" +
        (s.avgLoss !== null ? " · 平均每手损" + s.avgLoss + "分 · 严重失误" + s.bigMistakes + "次" : "（未跑过分析）")
      : "本地暂无对局记录。";
    if (agg && agg.games) {
      const top = Object.keys(agg.cats).sort((a, b) => agg.cats[b] - agg.cats[a]).slice(0, 3)
        .map(c => (CAT_LABEL[c] || c) + "×" + agg.cats[c]).join("、");
      t += "\n近 " + agg.games + " 盘私教点评：均手损 " + Math.round(agg.lossSum / agg.games) +
        " 分 · 吻合度 " + Math.round(agg.accSum / agg.games) + "%" +
        (top ? " · 高频问题：" + top : "") +
        (agg.scores.length > 1 ? "\n评分走势 " + agg.scores.join(" → ") : "");
    }
    els.stats.textContent = t;
  }

  function addMsg(role, text, opts) {
    opts = opts || {};
    messages.push({ role, content: text });
    const div = document.createElement("div");
    div.className = "co-msg " + role;
    div.innerHTML = renderMarkdown(text);
    if (opts.elapsed) {
      const meta = document.createElement("div");
      meta.className = "co-meta";
      meta.textContent = opts.local
        ? "⚙️ 本地引擎拆解 " + opts.elapsed.toFixed(1) + "s · 0 tokens"
        : "🧠 思考用时 " + opts.elapsed.toFixed(1) + "s · " + settings.model;
      div.appendChild(meta);
    }
    if (opts.reasoning) {
      const det = document.createElement("details");
      det.className = "co-reasoning";
      const sum = document.createElement("summary");
      sum.textContent = "查看思考过程（" + opts.reasoning.length + " 字）";
      det.appendChild(sum);
      const body = document.createElement("div");
      body.textContent = opts.reasoning.slice(0, 4000);
      det.appendChild(body);
      div.appendChild(det);
    }
    els.msgs.appendChild(div);
    els.msgs.scrollTop = els.msgs.scrollHeight;
    return div;
  }

  /* 参照棋盘跳到指定步数（报告里的回合号点击联动） */
  function refJump(ply) {
    refreshRefBoard();
    if (!refBase) return;
    refBase.ply = Math.max(0, Math.min(refBase.moves.length, ply));
    refreshRefBoard();
    els.refBox.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  /* ---------- 跨对局习惯聚合（本地，无 LLM） ---------- */
  const AGG_KEY = "xq-coach-agg";
  const CAT_LABEL = {
    missedMate: "错过绝杀", missedCheck: "漏看将军", missedCapture: "错过得子",
    hanging: "送子/无根", unpunished: "没抓住对手失误",
    repeated: "一子多动", rookLate: "出车迟缓", positional: "局面判断"
  };
  let agg = null;
  try { agg = JSON.parse(localStorage.getItem(AGG_KEY) || "null"); } catch (e) {}

  function recordAgg(rep) {
    if (!agg) agg = { games: 0, cats: {}, scores: [], lossSum: 0, accSum: 0 };
    agg.games++;
    agg.lossSum += rep.avgLoss;
    agg.accSum += rep.data.acc;
    agg.scores.push(rep.score);
    if (agg.scores.length > 8) agg.scores.shift();
    Object.keys(rep.data.catCounts).forEach(c => { agg.cats[c] = (agg.cats[c] || 0) + 1; });
    try { localStorage.setItem(AGG_KEY, JSON.stringify(agg)); } catch (e) {}
  }

  /* ---------- 本地引擎报告的增强：回合联动、练习直达、润色按钮 ---------- */
  function enhanceLocalReport(div, rep, opts) {
    opts = opts || {};
    div.querySelectorAll("h4").forEach(h => {
      const m = /第\s*(\d+)\s*手\s*(红|黑)/.exec(h.textContent);
      if (!m) return;
      const ply = Number(m[1]);
      h.classList.add("co-jump");
      h.title = "点击在左侧棋盘查看这一手";
      h.onclick = () => { Sound.play("click"); refJump(ply); };
    });
    if (rep.data && rep.data.recs && rep.data.recs.length) {
      const row = document.createElement("div");
      row.className = "co-recs";
      row.appendChild(document.createTextNode("推荐练习："));
      rep.data.recs.forEach(r => {
        const b = document.createElement("button");
        b.textContent = r[0] + " " + r[1] + " →";
        b.onclick = () => {
          Sound.play("click");
          if (window.AppDebug && AppDebug.gotoLessons) AppDebug.gotoLessons(r[0]);
        };
        row.appendChild(b);
      });
      div.appendChild(row);
    }
    if (!opts.noPolish && settings.key) {
      const btn = document.createElement("button");
      btn.className = "co-polish";
      btn.textContent = "✨ 润色讲解（少量 tokens）";
      btn.onclick = () => polishReview(div, btn);
      div.appendChild(btn);
    }
  }

  /* 润色层：皮卡鱼（数学老师）写教案，LLM（语文老师）只负责讲得生动。
   * 评分与数据永远以本地引擎为准。 */
  async function polishReview(div, btn) {
    if (!lastReview || !lastReview.local) return;
    const d = lastReview.local.data;
    btn.disabled = true;
    btn.textContent = "✨ 润色中…";
    try {
      const lesson = {
        主题: d.theme, 执方: d.my, 结果: d.result, 总评: d.score,
        均手损分: d.avgLoss, 吻合度: d.acc + "%", 失误手数: d.mistakes, 漏着手数: d.blunders,
        六维评分: d.dims, 亮点: d.bright,
        关键问题: d.keyMoves.map(k => ({
          位置: "第" + k.ply + "手" + k.side, 实战: k.cn, 评价: k.cls, 损分: k.loss,
          正着: k.bestCn, 后续主线: k.lineCn, 原因: k.reasons, 棋理: k.kb
        })),
        开局问题: d.openingIssues, 练习建议: d.advice
      };
      const sys =
        "你是「象棋私教」，一位语言生动、循循善诱的象棋语文老师。搭档的数学老师（强引擎）已经把棋算完并写好教案，你只负责把教案讲得生动好懂。\n" +
        "铁律：\n" +
        "1. 教案里的着法、分数、结论一律不许改动，更不许新增任何着法、变化或分数——只能引用教案原文给出的内容。\n" +
        "2. 总评分与六维分数原样保留在开头显眼处。\n" +
        "3. 用 Markdown 排版；先肯定亮点再讲问题；每个问题按「实战走了什么 → 为什么亏 → 正着与后续变化 → 棋理口诀」讲透。\n" +
        "4. 篇幅以讲清教案要点为限，不得编造教案之外的内容。";
      const r = await chat(sys,
        "【教案】\n```json\n" + JSON.stringify(lesson, null, 1) + "\n```\n请把这份教案改写成给学员看的生动讲解。", null);
      div.innerHTML = renderMarkdown(r.content);
      const meta = document.createElement("div");
      meta.className = "co-meta";
      meta.textContent = "✨ 润色版 · 评分与数据来自本地引擎 · " + settings.model;
      div.appendChild(meta);
      enhanceLocalReport(div, lastReview.local, { noPolish: true });
      lastReview.content = r.content;
      if (messages[lastReview.msgIdx]) messages[lastReview.msgIdx].content = r.content;
      els.msgs.scrollTop = els.msgs.scrollHeight;
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "✨ 润色讲解（少量 tokens）";
      addMsg("assistant", "润色失败：" + e.message + "（本地报告不受影响）");
    }
  }

  function thinkingStatus() {
    const div = document.createElement("div");
    div.className = "co-msg assistant co-thinking";
    div.textContent = "🧠 私教思考中… 0.0s";
    els.msgs.appendChild(div);
    els.msgs.scrollTop = els.msgs.scrollHeight;
    return (secs, final) => {
      if (secs === null) div.remove();
      else div.textContent = "🧠 私教思考中… " + secs.toFixed(1) + "s（重思考模型可能需要几十秒，请稍候）";
    };
  }

  function busy(on) {
    els.send.disabled = on;
    els.review.disabled = on;
    els.summarize.disabled = on;
  }

  async function buildContext() {
    const v = els.ctx.value;
    if (v === "play" && window.PlayDebug && PlayDebug.fen) {
      return "【当前局面 FEN】" + PlayDebug.fen + "\n" + await describeFen(PlayDebug.fen);
    }
    if (v === "game") {
      const g = selectedGame();
      if (g && g.moves.length) return gameToText(g);
      return "（暂无棋谱，请先对弈或导入）";
    }
    return "";
  }

  async function ask(question) {
    addMsg("user", question);
    busy(true);
    const tick = thinkingStatus();
    try {
      const ctx = await buildContext();
      const ctxGame = els.ctx.value === "game" ? selectedGame() : null;
      const r = await chat(systemPrompt(), (ctx ? ctx + "\n\n" : "") + "【学员提问】" + question, tick);
      tick(null);
      addMsg("assistant", r.content, { elapsed: r.elapsed, reasoning: r.reasoning });
      if (ctxGame) lastReview = { game: ctxGame, content: r.content };
      const p = extractProfile(r.content);
      if (p) { profile = p; saveProfile(); renderProfile(); }
    } catch (e) {
      tick(null);
      addMsg("assistant", "出错了：" + e.message);
    }
    busy(false);
  }

  function sendPreset(question) {
    if (!settings.key) {
      addMsg("assistant", "请先在 ⚙️ 设置里填入 API Key，再向私教提问。");
      return;
    }
    Sound.play("click");
    ask(question);
  }

  async function sendMessage() {
    const text = els.input.value.trim();
    if (!text) return;
    els.input.value = "";
    await ask(text);
  }

  async function reviewLastGame() {
    const g = selectedGame() || (window.Games ? Games.all().find(x => x.moves.length) : null);
    if (!g) { addMsg("assistant", "还没有可对局的棋谱，先去「人机对弈」下一盘或导入一盘吧。"); return; }
    addMsg("user", "【请求】请点评这盘棋（" + new Date(g.ts).toLocaleString() + "），指出不合棋理之处，给出推荐着与后续变化，并更新我的习惯档案。");
    // 优先走本地引擎大脑：逐手拆解 + 棋理模板，零 tokens
    if (window.Engine && Engine.ready && window.CoachBrain) {
      busy(true);
      const div = document.createElement("div");
      div.className = "co-msg assistant co-thinking";
      div.textContent = "⚙️ 本地引擎拆解中…";
      els.msgs.appendChild(div);
      els.msgs.scrollTop = els.msgs.scrollHeight;
      try {
        const rep = await CoachBrain.review(g, {
          onProgress: (i, n2) => { div.textContent = "⚙️ 本地引擎逐手拆解中 " + i + "/" + n2 + "（不消耗 tokens）"; }
        });
        div.remove();
        const repDiv = addMsg("assistant", rep.markdown, { elapsed: rep.elapsed, local: true });
        lastReview = { game: g, content: rep.markdown, local: rep, msgIdx: messages.length - 1 };
        enhanceLocalReport(repDiv, rep);
        // 点评的引擎数据回存棋谱：棋谱页的形势曲线/问题着与报告一致，不必重复分析
        if (g.id && rep.analysis && window.Games) {
          try { Games.saveAnalysis(g.id, rep.analysis); } catch (e) {}
        }
        profile = { text: rep.profileNote, ts: Date.now() };
        saveProfile();
        recordAgg(rep);
        renderProfile();
      } catch (e) {
        console.error("本地复盘异常：", e);
        div.remove();
        addMsg("assistant", "本地引擎复盘失败（" + e.message + "），可检查引擎状态后重试。");
      }
      busy(false);
      return;
    }
    // 引擎不可用时的兜底：外接大模型（消耗 tokens）
    busy(true);
    const tick = thinkingStatus();
    try {
      const ctx = gameToText(g);
      const r = await chat(systemPrompt(),
        ctx + "\n\n请点评这盘棋。结尾请用 ```json 代码块输出更新后的学员习惯档案，格式：{\"profile\": \"不超过150字的学员棋风与习惯总结\"}", tick);
      tick(null);
      addMsg("assistant", r.content, { elapsed: r.elapsed, reasoning: r.reasoning });
      lastReview = { game: g, content: r.content };
      const p = extractProfile(r.content);
      if (p) { profile = p; saveProfile(); renderProfile(); }
    } catch (e) {
      tick(null);
      addMsg("assistant", "出错了：" + e.message);
    }
    busy(false);
  }

  /* ---------- 存入已讲解棋谱 ---------- */
  async function saveAnnotated() {
    if (!lastReview) {
      addMsg("assistant", "还没有可存入的讲解——先选一盘棋谱让私教点评，或带着棋谱上下文问一个问题，然后再点「💾 存入」。");
      return;
    }
    if (!window.Annotated) { addMsg("assistant", "存档模块未加载。"); return; }
    busy(true);
    addMsg("user", "【请求】把刚才这盘讲解存入已讲解棋谱。");
    const tick = thinkingStatus();
    const g = lastReview.game;
    let name = g && g.reason ? g.reason : "私教讲解谱";
    let score = null, dims = null;
    // 本地引擎报告已自带名称/评分/六维，存档不再请求大模型
    if (!lastReview.local) {
      try {
        const r = await chat(systemPrompt(),
          "【已讲解的棋谱与点评原文】\n" + gameToText(g) + "\n\n【你的点评原文】\n" + lastReview.content.slice(0, 3000) +
          "\n\n请为这盘讲解生成存档信息，只输出一个 ```json 代码块：{\"name\": \"给这盘棋起个简短有味道的名字（不超过12字）\", " +
          "\"score\": 0到100的总体价值评分（体现这盘棋对学员的学习价值）, " +
          "\"dims\": {\"开局\": 0-100, \"中局\": 0-100, \"残局\": 0-100, \"进攻\": 0-100, \"防守\": 0-100, \"稳定\": 0-100}}", tick);
        tick(null);
        const m = /```json\s*([\s\S]*?)```/.exec(r.content);
        if (m) {
          const obj = JSON.parse(m[1]);
          if (obj.name) name = String(obj.name).slice(0, 20);
          if (typeof obj.score === "number") score = Math.max(0, Math.min(100, Math.round(obj.score)));
          if (obj.dims && typeof obj.dims === "object") dims = obj.dims;
        }
      } catch (e) {
        tick(null);
        addMsg("assistant", "生成存档信息失败（" + e.message + "），已用默认信息保存。");
      }
    } else {
      tick(null);
      name = lastReview.local.name;
      score = lastReview.local.score;
      dims = lastReview.local.dims;
    }
    if (!dims && g) dims = Annotated.fallbackDims(g);
    const id = Annotated.add({
      name,
      score: score === null ? (dims ? Math.round((dims["开局"] + dims["中局"] + dims["残局"] + dims["进攻"] + dims["防守"] + dims["稳定"]) / 6) : 60) : score,
      dims,
      game: {
        moves: g.moves.map(m => ({ m: m.m, cn: m.cn })),
        result: g.result, mySide: g.mySide,
        levelName: g.levelName, reason: g.reason || "",
        fen: g.fen || null,
        analysis: g.analysis || null
      },
      review: lastReview.content.replace(/```json\s*[\s\S]*?```/g, "").trim()
    });
    Sound.play("check");
    addMsg("assistant", "✅ 已存入「**" + name + "**」（评分 **" +
      (score === null ? "—" : score) + "**）。\n\n到顶部「🗂️ 我的棋谱」→「已讲解」标签即可查看：棋盘复盘、六维雷达图和这份讲解。");
    busy(false);
  }

  async function summarizeHabits() {
    busy(true);
    addMsg("user", "【请求】请根据我的战绩和已有档案，总结我的下棋习惯与改进方向，并更新档案。");
    const tick = thinkingStatus();
    try {
      const s = localStats();
      const gs = window.Games ? Games.all() : [];
      const recent = gs.slice(0, 3).map(gameToText).join("\n\n");
      const r = await chat(systemPrompt(),
        "【本地统计】对局" + s.games + "盘 " + s.w + "胜" + s.d + "和" + s.l + "负" +
        (s.avgLoss !== null ? "，平均每手损" + s.avgLoss + "分，严重失误" + s.bigMistakes + "次" : "") +
        "\n【最近棋谱】\n" + (recent || "无") +
        "\n\n请总结学员的棋风习惯与最该改进的 2-3 点。结尾用 ```json 输出 {\"profile\": \"...\"} 更新档案。", tick);
      tick(null);
      addMsg("assistant", r.content, { elapsed: r.elapsed, reasoning: r.reasoning });
      const p = extractProfile(r.content);
      if (p) { profile = p; saveProfile(); renderProfile(); }
    } catch (e) {
      tick(null);
      addMsg("assistant", "出错了：" + e.message);
    }
    busy(false);
  }

  window.Coach = {
    mount,
    show() {
      renderProfile();
      fillGameSelect();
      refreshRefBoard();
      if (refTimer) clearInterval(refTimer);
      refTimer = setInterval(refreshRefBoard, 2000);
    },
    hide() { if (refTimer) { clearInterval(refTimer); refTimer = null; } }
  };
})();
