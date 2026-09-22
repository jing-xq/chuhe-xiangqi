/* 新手入门：交互式学棋课程。
 * 每一步 = 文字讲解 + 棋盘演示 + 动手试走（任意合法着 / 指定任务着）。
 * Guide.mount(container)  Guide.show() / hide() */
(function () {
  "use strict";

  const X = window.Xiangqi;
  const FEN0 = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";

  /* accept: "any" 任意合法着; "capture" 任意吃子着; ["h2e2"] 指定着集合 */
  const STEPS = [
    {
      t: "认识棋盘",
      text: "棋盘由 9 条竖线和 10 条横线交叉组成，共 90 个交叉点。棋子就下在交叉点上。\n中间空白的一条叫「河界」，把棋盘分成红方（下方）和黑方（上方）两块阵地。\n双方底线中央的正方形叫「九宫」，是将帅活动的范围。",
      fen: FEN0, mode: "view"
    },
    {
      t: "将 / 帅",
      text: "将帅是全局最重要的棋子，只能在九宫内上下左右一步一步走。\n试着点击红帅，把它走到任意合法位置。",
      fen: "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1",
      mode: "try", accept: "any", who: "帅"
    },
    {
      t: "仕 / 士",
      text: "仕（士）只能在九宫内沿斜线走，每次一格，不能出九宫。\n试着走一步红仕。",
      fen: "4k4/9/9/9/9/9/9/9/9/3AK4 w - - 0 1",
      mode: "try", accept: "any", who: "仕"
    },
    {
      t: "相 / 象",
      text: "相（象）走「田」字（斜两格），不能过河，而且「塞象眼」时不能走——\n象行进路线正中的那个点若有棋子，这步就走不了。\n棋盘上故意放了一个黑兵塞住象眼，试着走相，体会一下。",
      fen: "4k4/9/9/9/9/2p6/9/9/9/2B1K4 w - - 0 1",
      mode: "try", accept: "any", who: "相"
    },
    {
      t: "马 与 马腿",
      text: "马走「日」字（先直一格再斜一格）。\n但如果直走方向的第一格有棋子（「别马腿」），这个方向就不能走。\n棋盘上黑兵别住了左马的马腿，试着跳马。",
      fen: "4k4/9/9/9/9/9/9/1p7/9/N3K4 w - - 0 1",
      mode: "try", accept: "any", who: "马"
    },
    {
      t: "车",
      text: "车沿直线走，横竖不限步数（不能越过棋子），是威力最大的棋子。\n试着用车吃掉黑方的卒。",
      fen: "4k4/9/9/9/9/9/3p4/9/9/4K2R1 w - - 0 1",
      mode: "try", accept: "capture", who: "车"
    },
    {
      t: "炮 与 炮架",
      text: "炮走直线跟车一样；但吃子时必须隔恰好一个棋子（「炮架」）。\n试着用炮隔着红仕，吃掉黑方的马。",
      fen: "2n1k4/9/9/9/9/9/9/4A4/4C4/4K4 w - - 0 1",
      mode: "try", accept: "capture", who: "炮"
    },
    {
      t: "兵 / 卒",
      text: "兵（卒）只能向前走，每次一格；过河（走进对方阵地）后才能左右平移一格。\n永远不会后退。试着把红兵向前走一格。",
      fen: "4k4/9/9/9/9/9/9/1p7/9/3PK4 w - - 0 1",
      mode: "try", accept: "any", who: "兵"
    },
    {
      t: "将军 与 应将",
      text: "当你的将帅被对手攻击时，叫「被将军」，必须立即应将。\n应将只有三种办法：① 把将帅挪开 ② 吃掉进攻的棋子 ③ 垫一个棋子挡住。\n现在黑车正在将军！试着应将。",
      fen: "4k4/9/9/9/9/9/9/9/4r4/3RK4 w - - 0 1",
      mode: "try", accept: "any", who: "应将"
    },
    {
      t: "将帅照面",
      text: "双方将帅不能在同一条竖线上直接相对（中间不能有棋子）。\n违反这一点的走法是违法的——软件不会允许你这样走。\n可以试试：把红帅往上走一格，软件会拒绝。",
      fen: "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1",
      mode: "try", accept: "any", who: "帅"
    },
    {
      t: "胜负与和棋",
      text: "被将军而无法应将，叫「将死」，判负。\n轮到走棋时没有任何合法着法（「困毙」），也判负。\n长将、长捉等循环走法在正式规则中不允许（本软件的对弈暂不判罚）。",
      fen: FEN0, mode: "view"
    },
    {
      t: "认识记谱法",
      text: "每步棋用文字记录：棋子名 + 所在路数 + 方向 + 步数/到达路数。\n红方用中文数字（一~九，从右往左数），黑方用阿拉伯数字（1~9，从左往右数）。\n例：「炮二平五」= 红方二路炮横移到五路（最常见的开局第一步）。\n直走子（车炮兵）说进退几步，斜走子（马相仕）说进退到几路。",
      fen: FEN0, mode: "view"
    },
    {
      t: "毕业啦 🎉",
      text: "你已经掌握了象棋的基本规则！\n建议下一步：\n1. 到「课程」页学 A 类「基本杀法」，学会常见的取胜手段；\n2. 到「对弈」页选「启蒙」难度实战几盘；\n3. 下完的棋谱在「棋谱」页可以复盘分析。",
      fen: FEN0, mode: "view"
    }
  ];

  let els = {}, board = null, idx = 0, tries = 0;
  let doneSet = {};
  try { doneSet = JSON.parse(localStorage.getItem("xq-guide-done") || "{}"); } catch (e) {}

  function saveDone() {
    try { localStorage.setItem("xq-guide-done", JSON.stringify(doneSet)); } catch (e) {}
  }

  function mount(container) {
    container.innerHTML = `
      <div class="guide-wrap">
        <div class="guide-steps" id="gd-steps"></div>
        <div class="guide-main">
          <canvas id="gd-board"></canvas>
          <div class="guide-panel">
            <h3 id="gd-title"></h3>
            <div id="gd-text" class="gd-text"></div>
            <div id="gd-feedback" class="gd-feedback"></div>
            <div class="guide-nav">
              <button id="gd-prev">← 上一步</button>
              <span id="gd-progress"></span>
              <button id="gd-flip">⇅ 翻转</button>
              <button id="gd-next" class="primary">下一步 →</button>
            </div>
          </div>
        </div>
      </div>`;
    els = {
      steps: container.querySelector("#gd-steps"),
      title: container.querySelector("#gd-title"),
      text: container.querySelector("#gd-text"),
      feedback: container.querySelector("#gd-feedback"),
      prev: container.querySelector("#gd-prev"),
      next: container.querySelector("#gd-next"),
      progress: container.querySelector("#gd-progress")
    };
    board = Board.create(container.querySelector("#gd-board"), {
      onMove: onMove,
      onIllegal: (from, to) => {
        Sound.play("illegal");
        els.feedback.textContent = "这步违法则哦（马腿/象眼/炮架/九宫/过河/照面，想想这条规则）。";
        els.feedback.className = "gd-feedback bad";
      }
    });
    els.prev.onclick = () => goto(idx - 1);
    els.next.onclick = () => goto(idx + 1);
    container.querySelector("#gd-flip").onclick = () => board.flip();
    renderSteps();
    goto(Math.min(idx, STEPS.length - 1));
  }

  function renderSteps() {
    els.steps.innerHTML = "";
    STEPS.forEach((s, i) => {
      const item = document.createElement("div");
      item.className = "gd-item" + (i === idx ? " active" : "") + (doneSet[i] ? " done" : "");
      item.innerHTML = "<span>" + (doneSet[i] ? "✓ " : "") + (i + 1) + ". " + s.t + "</span>";
      item.onclick = () => goto(i);
      els.steps.appendChild(item);
    });
  }

  function goto(i) {
    if (i < 0 || i >= STEPS.length) return;
    idx = i;
    tries = 0;
    const step = STEPS[i];
    els.title.textContent = (i + 1) + ". " + step.t;
    els.text.textContent = step.text;
    els.feedback.textContent = step.mode === "view" ? "" : "👉 " + (step.who ? "请走「" + step.who + "」" : "轮到你了") + "：在棋盘上试着走一着";
    els.feedback.className = "gd-feedback";
    const { board: b, side } = X.parseFen(step.fen);
    board.update({
      board: b, turn: side,
      interactive: step.mode === "try",
      lastMove: null, hint: null
    });
    els.prev.disabled = i === 0;
    els.next.textContent = i === STEPS.length - 1 ? "完成 ✓" : "下一步 →";
    els.progress.textContent = (i + 1) + " / " + STEPS.length;
    renderSteps();
  }

  function onMove(f0, r0, f1, r1) {
    const step = STEPS[idx];
    if (!step || step.mode !== "try") return;
    const mv = [f0, r0, f1, r1];
    // 合法性与任务校验
    const { board: b, side } = X.parseFen(step.fen);
    if (!X.isLegal(b, side, mv)) {
      Sound.play("illegal");
      els.feedback.textContent = "这步不违法则哦。记住每个棋子的走法限制，再试试。（可看左侧讲解）";
      els.feedback.className = "gd-feedback bad";
      return;
    }
    const text = X.moveToText(mv);
    let ok = false;
    if (step.accept === "any") ok = true;
    else if (step.accept === "capture") ok = b[r1][f1] !== null;
    else if (Array.isArray(step.accept)) ok = step.accept.indexOf(text) >= 0;
    if (!ok) {
      tries++;
      Sound.play("illegal");
      els.feedback.textContent = step.accept === "capture"
        ? "要用吃子的方式！提示：看看目标位置上有对方棋子的落点。"
        : "再想想这步的目标是什么。（可多试几次）";
      els.feedback.className = "gd-feedback bad";
      return;
    }
    // 走对了
    Sound.play(b[r1][f1] !== null ? "capture" : "move");
    doneSet[idx] = true;
    saveDone();
    els.feedback.textContent = "🎉 走对了！" + (step.accept === "capture" ? " 吃子成功。" : "");
    els.feedback.className = "gd-feedback ok";
    X.applyMove(b, ...mv);
    board.update({ board: b, turn: X.other(side), interactive: false, lastMove: mv });
    renderSteps();
    setTimeout(() => { if (idx < STEPS.length - 1) goto(idx + 1); }, 900);
  }

  window.Guide = {
    mount, show() { goto(idx); }, hide() {},
    get progress() { return Object.keys(doneSet).length; },
    get _board() { return board; }
  };
})();
