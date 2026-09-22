/* Canvas 棋盘组件。
 * const board = Board.create(canvas, { onMove(f0,r0,f1,r1) });
 * board.update({ board, lastMove, turn, interactive, hint, selected });
 * board.flip() 切换红黑视角；board.destroy() 注销事件。 */
(function () {
  "use strict";

  const X = window.Xiangqi;

  const STYLE = {
    bg: "#efd6a7",
    bg2: "#e8c98d",
    line: "#7a5230",
    river: "#7a5230",
    red: "#c23b22",
    black: "#333",
    pieceBg: "#fdf6e3",
    pieceEdge: "#8a6a45",
    lastMove: "rgba(80,160,80,.32)",
    lastMoveEdge: "rgba(60,130,60,.55)",
    select: "rgba(212,160,60,.95)",
    target: "rgba(90,70,40,.55)",
    capture: "rgba(194,59,34,.9)",
    hover: "rgba(212,160,60,.55)",
    hint: "rgba(230,180,40,.7)",
    check: "rgba(230,60,60,.75)"
  };

  const CHARS = { K: "帥", A: "仕", B: "相", N: "馬", R: "俥", C: "炮", P: "兵", k: "將", a: "士", b: "象", n: "馬", r: "車", c: "砲", p: "卒" };

  function create(canvas, opts) {
    opts = opts || {};
    const ctx = canvas.getContext("2d");
    let orientation = opts.orientation || "red";
    let state = { board: null, lastMove: null, turn: "r", interactive: false, hint: null, selected: null };
    let selected = null;      // [f,r] 当前选中
    let dragging = null;      // {from:[f,r], x, y}
    let px = 0;               // 格子边长
    let anim = null;          // 走子/吃子动画 {piece, captured, from, to, t0, dur}
    let hoverSq = null;       // 鼠标悬停格 [f,r]

    function geom() {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      px = w / 10; // 9 线 8 间隔，左右各留半个边距 + 坐标
      return { w, h: px * 11, px };
    }

    function toDisplay(f, r) {
      // 红方视角：红在下（rank 0 显示在底部）；黑方视角：水平镜像、黑在下
      return orientation === "red" ? [f, 9 - r] : [8 - f, r];
    }
    function fromDisplay(df, dr) {
      return orientation === "red" ? [df, 9 - dr] : [8 - df, dr];
    }
    function sqXY(f, r) {
      const { px } = geom();
      const [df, dr] = toDisplay(f, r);
      return [px * (df + 1), px * (dr + 1)];
    }

    function draw() {
      const { w, h, px } = geom();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.height = h + "px";
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // 背景
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, STYLE.bg);
      grad.addColorStop(1, STYLE.bg2);
      ctx.fillStyle = grad;
      roundRect(ctx, 0, 0, w, h, 6);
      ctx.fill();

      const x0 = px, y0 = px, x1 = px * 9, y1 = px * 10;
      ctx.strokeStyle = STYLE.line;
      ctx.lineWidth = 1;

      // 横线
      for (let i = 0; i < 10; i++) {
        const y = y0 + i * px;
        line(ctx, x0, y, x1, y);
      }
      // 竖线（河道断开）
      for (let i = 0; i < 9; i++) {
        const x = x0 + i * px;
        if (i === 0 || i === 8) {
          line(ctx, x, y0, x, y1);
        } else {
          line(ctx, x, y0, x, y0 + 4 * px);
          line(ctx, x, y0 + 5 * px, x, y1);
        }
      }
      // 九宫斜线
      diag(ctx, x0 + 3 * px, y0, x0 + 5 * px, y0 + 2 * px);
      diag(ctx, x0 + 5 * px, y0, x0 + 3 * px, y0 + 2 * px);
      diag(ctx, x0 + 3 * px, y0 + 7 * px, x0 + 5 * px, y0 + 9 * px);
      diag(ctx, x0 + 5 * px, y0 + 7 * px, x0 + 3 * px, y0 + 9 * px);
      // 边框加粗
      ctx.lineWidth = 2;
      ctx.strokeRect(x0 - 4, y0 - 4, x1 - x0 + 8, y1 - y0 + 8);

      // 炮位/兵位 标记
      ctx.lineWidth = 1;
      const marks = [[1, 2], [7, 2], [1, 7], [7, 7], [0, 3], [2, 3], [4, 3], [6, 3], [8, 3], [0, 6], [2, 6], [4, 6], [6, 6], [8, 6]];
      for (const [mf, mr] of marks) drawMark(ctx, ...sqXY(mf, mr), px, x0, x1);

      // 楚河漢界
      ctx.fillStyle = STYLE.river;
      ctx.font = `bold ${px * 0.62}px KaiTi, STKaiti, serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const ry = y0 + 4.5 * px;
      const [t1, t2] = orientation === "red" ? ["楚 河", "漢 界"] : ["漢 界", "楚 河"];
      ctx.fillText(t1, x0 + 2.1 * px, ry);
      ctx.fillText(t2, x0 + 6.4 * px, ry);

      // 坐标（路数）：底边用下方一方的记法，顶边用上方一方的记法
      // 红方中文数字、从右往左一至九；黑方阿拉伯数字、从黑方右边（我方左侧）数 1-9
      ctx.font = `${px * 0.34}px sans-serif`;
      ctx.fillStyle = "rgba(122,82,48,.85)";
      const bottomRed = orientation === "red";
      for (let f = 0; f < 9; f++) {
        const [cx] = sqXY(f, 0);
        const topLabel = bottomRed ? Notation.fileCn("b", f) : Notation.fileCn("r", f);
        const botLabel = bottomRed ? Notation.fileCn("r", f) : Notation.fileCn("b", f);
        ctx.fillText(topLabel, cx, y0 - px * 0.42);
        ctx.fillText(botLabel, cx, y1 + px * 0.42);
      }

      if (!state.board) return;

      // 高亮：最后一着（圆角块 + 描边，更柔和）
      if (state.lastMove) {
        for (const [f, r] of [[state.lastMove[0], state.lastMove[1]], [state.lastMove[2], state.lastMove[3]]]) {
          const [cx, cy] = sqXY(f, r);
          ctx.fillStyle = STYLE.lastMove;
          roundRect(ctx, cx - px / 2 + 1, cy - px / 2 + 1, px - 2, px - 2, 5);
          ctx.fill();
          ctx.strokeStyle = STYLE.lastMoveEdge;
          ctx.lineWidth = 1.5;
          roundRect(ctx, cx - px / 2 + 1, cy - px / 2 + 1, px - 2, px - 2, 5);
          ctx.stroke();
        }
      }
      // 提示
      if (state.hint) {
        ctx.fillStyle = STYLE.hint;
        for (const [f, r] of [[state.hint[0], state.hint[1]], [state.hint[2], state.hint[3]]]) {
          const [cx, cy] = sqXY(f, r);
          ctx.beginPath();
          ctx.arc(cx, cy, px * 0.16, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 棋子（动画中的走子先不画在终点，由动画层绘制）
      const dragFrom = dragging ? dragging.from : null;
      for (let r = 0; r < 10; r++) {
        for (let f = 0; f < 9; f++) {
          const p = state.board[r][f];
          if (!p) continue;
          if (dragFrom && dragFrom[0] === f && dragFrom[1] === r) continue;
          if (anim && anim.to[0] === f && anim.to[1] === r) continue;
          const [cx, cy] = sqXY(f, r);
          drawPiece(ctx, p, cx, cy, px * 0.46);
        }
      }
      // 悬停高亮（仅己方可走棋子）
      if (hoverSq && !dragging && !selected && state.interactive) {
        const hp = state.board[hoverSq[1]][hoverSq[0]];
        if (hp && (hp === hp.toUpperCase()) === (state.turn === "r")) {
          const [hx, hy] = sqXY(hoverSq[0], hoverSq[1]);
          ctx.strokeStyle = STYLE.hover;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(hx, hy, px * 0.47, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      // 被选中
      if (selected) {
        const [cx, cy] = sqXY(selected[0], selected[1]);
        ctx.strokeStyle = STYLE.select;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, px * 0.47, 0, Math.PI * 2);
        ctx.stroke();
        // 合法落点：空位画圆点，可吃子画红圈
        for (const t of targetsFor(selected)) {
          const [tx, ty] = sqXY(t[2], t[3]);
          if (state.board[t[3]][t[2]]) {
            ctx.strokeStyle = STYLE.capture;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(tx, ty, px * 0.48, 0, Math.PI * 2);
            ctx.stroke();
          } else {
            ctx.fillStyle = STYLE.target;
            ctx.beginPath();
            ctx.arc(tx, ty, px * 0.13, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      // 拖拽中的棋子
      if (dragging) {
        drawPiece(ctx, state.board[dragging.from[1]][dragging.from[0]], dragging.x, dragging.y, px * 0.46);
      }

      // 走子/吃子动画层
      if (anim) {
        const t = Math.min(1, (performance.now() - anim.t0) / anim.dur);
        const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
        const [ax, ay] = sqXY(anim.from[0], anim.from[1]);
        const [bx, by] = sqXY(anim.to[0], anim.to[1]);
        if (anim.captured) {
          // 被吃子：原地淡出缩小 + 红色扩散环
          ctx.save();
          ctx.globalAlpha = 1 - t;
          drawPiece(ctx, anim.captured, bx, by, px * 0.46 * (1 - 0.3 * t));
          ctx.restore();
          ctx.strokeStyle = `rgba(194,59,34,${0.75 * (1 - t)})`;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(bx, by, px * (0.46 + 0.38 * t), 0, Math.PI * 2);
          ctx.stroke();
        }
        // 走子：从起点滑向终点（吃子时略放大后回落，有"压上去"的感觉）
        const rad = px * 0.46 * (anim.captured ? 1 + 0.1 * Math.sin(Math.PI * t) : 1);
        drawPiece(ctx, anim.piece, ax + (bx - ax) * e, ay + (by - ay) * e, rad);
      }

      // 被将军标记
      if (state.checkSquare) {
        const [cx, cy] = sqXY(state.checkSquare[0], state.checkSquare[1]);
        ctx.strokeStyle = STYLE.check;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(cx, cy, px * 0.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    function targetsFor(sq) {
      if (!state.interactive || !state.board) return [];
      return X.legalMoves(state.board, state.turn).filter(m => m[0] === sq[0] && m[1] === sq[1]);
    }

    function drawPiece(c, p, cx, cy, rad) {
      c.save();
      c.shadowColor = "rgba(0,0,0,.35)";
      c.shadowBlur = rad * 0.18;
      c.shadowOffsetY = rad * 0.08;
      c.beginPath();
      c.arc(cx, cy, rad, 0, Math.PI * 2);
      c.fillStyle = STYLE.pieceBg;
      c.fill();
      c.restore();
      c.beginPath();
      c.arc(cx, cy, rad, 0, Math.PI * 2);
      c.strokeStyle = STYLE.pieceEdge;
      c.lineWidth = 1.5;
      c.stroke();
      c.beginPath();
      c.arc(cx, cy, rad * 0.82, 0, Math.PI * 2);
      c.strokeStyle = p === p.toUpperCase() ? "rgba(194,59,34,.5)" : "rgba(51,51,51,.4)";
      c.lineWidth = 1;
      c.stroke();
      c.fillStyle = p === p.toUpperCase() ? STYLE.red : STYLE.black;
      c.font = `bold ${rad * 1.02}px KaiTi, STKaiti, "Kaiti SC", serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(CHARS[p], cx, cy + rad * 0.04);
    }

    function drawMark(c, cx, cy, px, x0, x1) {
      const s = px * 0.1, g = px * 0.22;
      c.beginPath();
      if (cx - g > x0) { c.moveTo(cx - g - s, cy - s); c.lineTo(cx - g, cy - s); c.lineTo(cx - g, cy + s); c.lineTo(cx - g - s, cy + s); }
      if (cx + g < x1) { c.moveTo(cx + g + s, cy - s); c.lineTo(cx + g, cy - s); c.lineTo(cx + g, cy + s); c.lineTo(cx + g + s, cy + s); }
      c.stroke();
    }

    function line(c, x0, y0, x1, y1) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
    function diag(c, x0, y0, x1, y1) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
    function roundRect(c, x, y, w, h, r) {
      c.beginPath();
      c.moveTo(x + r, y);
      c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r);
      c.closePath();
    }

    function eventSquare(e) {
      const rect = canvas.getBoundingClientRect();
      const { px } = geom();
      const dx = (e.clientX - rect.left - px) / px;
      const dy = (e.clientY - rect.top - px) / px;
      const df = Math.round(dx), dr = Math.round(dy);
      if (df < 0 || df > 8 || dr < 0 || dr > 9) return null;
      if (Math.abs(dx - df) > 0.48 || Math.abs(dy - dr) > 0.48) return null;
      return fromDisplay(df, dr);
    }

    function onDown(e) {
      if (!state.interactive || !state.board) return;
      const sq = eventSquare(e);
      if (!sq) return;
      e.preventDefault();
      const p = state.board[sq[1]][sq[0]];
      if (selected && targetsFor(selected).some(m => m[2] === sq[0] && m[3] === sq[1])) {
        fireMove(selected, sq);
        selected = null;
        draw();
        return;
      }
      if (selected && (p === null || (p === p.toUpperCase()) !== (state.turn === "r"))) {
        // 已选中棋子但点了非法落点：提示而不是静默取消
        if (opts.onIllegal) opts.onIllegal(selected, sq);
        draw();
        return;
      }
      if (p && (p === p.toUpperCase()) === (state.turn === "r")) {
        selected = sq;
        const rect = canvas.getBoundingClientRect();
        dragging = { from: sq, x: e.clientX - rect.left, y: e.clientY - rect.top };
        canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      } else {
        selected = null;
      }
      draw();
    }

    function onMove(e) {
      if (dragging) {
        const rect = canvas.getBoundingClientRect();
        dragging.x = e.clientX - rect.left;
        dragging.y = e.clientY - rect.top;
        draw();
        return;
      }
      // 悬停反馈：高亮可走的己方棋子并切换光标
      if (!state.interactive || !state.board) return;
      const sq = eventSquare(e);
      if (sq === hoverSq || (sq && hoverSq && sq[0] === hoverSq[0] && sq[1] === hoverSq[1])) return;
      hoverSq = sq;
      let cur = "default";
      if (sq) {
        const p = state.board[sq[1]][sq[0]];
        if (p && (p === p.toUpperCase()) === (state.turn === "r")) cur = "pointer";
        else if (selected && targetsFor(selected).some(m => m[2] === sq[0] && m[3] === sq[1])) cur = "pointer";
      }
      canvas.style.cursor = cur;
      draw();
    }

    function onLeave() {
      if (hoverSq) { hoverSq = null; canvas.style.cursor = "default"; draw(); }
    }

    function onUp(e) {
      if (!dragging) return;
      const from = dragging.from;
      dragging = null;
      const sq = eventSquare(e);
      if (sq && (sq[0] !== from[0] || sq[1] !== from[1]) &&
          targetsFor(from).some(m => m[2] === sq[0] && m[3] === sq[1])) {
        selected = null;
        fireMove(from, sq);
      }
      draw();
    }

    function fireMove(from, to) {
      if (opts.onMove) opts.onMove(from[0], from[1], to[0], to[1]);
    }

    function sameMove(a, b) {
      return !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
    }

    /* 检测本次 update 是否为"新走了一步棋"，是则启动滑动/吃子动画。
     * 重复渲染（同一局面同一 lastMove）、跳转、撤销都会因校验失败而直接落定。 */
    function maybeAnimate(prevBoard, prevLM, patch) {
      anim = null;
      if (opts.animate === false) return;
      if (!prevBoard || !state.board || patch.board === undefined) return;
      const lm = state.lastMove;
      if (!lm) return;
      if (sameMove(prevLM, lm) && prevBoard === state.board) return; // 重复渲染
      const [f0, r0, f1, r1] = lm;
      if (f0 < 0 || f0 > 8 || r0 < 0 || r0 > 9 || f1 < 0 || f1 > 8 || r1 < 0 || r1 > 9) return;
      const mover = prevBoard[r0][f0];
      if (!mover) return;                          // 起点原来没子：非相邻局面（跳转/撤销）
      if (state.board[r0][f0]) return;             // 起点仍有子：同上
      if (state.board[r1][f1] !== mover) return;   // 终点不是走过去的子
      const captured = prevBoard[r1][f1];
      anim = {
        piece: mover, captured,
        from: [f0, r0], to: [f1, r1],
        t0: performance.now(),
        dur: captured ? 240 : 170
      };
      requestAnimationFrame(tick);
    }

    function tick() {
      if (!anim) return;
      if (performance.now() - anim.t0 >= anim.dur) {
        anim = null;
        draw();
        return;
      }
      draw();
      requestAnimationFrame(tick);
    }

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointercancel", () => { dragging = null; draw(); });
    window.addEventListener("resize", draw);

    return {
      update(patch) {
        const prevBoard = state.board;
        const prevLM = state.lastMove;
        Object.assign(state, patch);
        if (patch.selected !== undefined) selected = patch.selected;
        if (patch.board !== undefined && !patch.selected) selected = null;
        // 将军标记
        if (state.board) {
          const k = X.findKing(state.board, state.turn);
          state.checkSquare = k && X.isCheck(state.board, state.turn) ? k : null;
        }
        maybeAnimate(prevBoard, prevLM, patch);
        draw();
      },
      redraw: draw,
      debug() { return { state: Object.assign({}, state, { board: state.board }), selected, dragging }; },
      flip() { orientation = orientation === "red" ? "black" : "red"; anim = null; draw(); },
      get orientation() { return orientation; },
      destroy() {
        anim = null;
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointerleave", onLeave);
        window.removeEventListener("resize", draw);
      }
    };
  }

  window.Board = { create };
})();
