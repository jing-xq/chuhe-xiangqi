/* 中国象棋规则引擎：FEN 解析、走法生成、合法性判断。
 * 坐标：file 0-8（对应 a-i），rank 0-9（红方底线到黑方底线）。
 * 与鹏飞 .pfc 的 FEN/着法（h2e2）完全兼容。
 * 全局对象：Xiangqi */
(function () {
  "use strict";

  const RED = "r", BLACK = "b";
  const FILES = "abcdefghi";

  function other(side) { return side === RED ? BLACK : RED; }
  function inBoard(f, r) { return f >= 0 && f <= 8 && r >= 0 && r <= 9; }
  function inPalace(f, r, side) {
    if (f < 3 || f > 5) return false;
    return side === RED ? r >= 0 && r <= 2 : r >= 7 && r <= 9;
  }
  function crossedRiver(side, r) { return side === RED ? r >= 5 : r <= 4; }

  function cloneBoard(board) { return board.map(row => row.slice()); }

  function parseFen(fen) {
    const parts = fen.trim().split(/\s+/);
    const rows = parts[0].split("/");
    if (rows.length !== 10) throw new Error("FEN 必须 10 行: " + fen);
    const board = new Array(10);
    rows.forEach((row, idx) => {
      const rank = 9 - idx; // FEN 首行是黑方底线（rank 9）
      const rankRow = [];
      for (const ch of row) {
        if (/\d/.test(ch)) {
          for (let i = 0; i < Number(ch); i++) rankRow.push(null);
        } else {
          rankRow.push(ch);
        }
      }
      if (rankRow.length !== 9) throw new Error("FEN 行必须 9 列: " + row);
      board[rank] = rankRow;
    });
    return { board, side: parts[1] === "w" ? RED : BLACK };
  }

  function boardToFen(board, side) {
    const rows = [];
    for (let r = 9; r >= 0; r--) {
      let row = "", empty = 0;
      for (let f = 0; f < 9; f++) {
        const p = board[r][f];
        if (p === null) { empty++; }
        else {
          if (empty) { row += empty; empty = 0; }
          row += p;
        }
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return rows.join("/") + (side === RED ? " w - - 0 1" : " b - - 0 1");
  }

  function findKing(board, side) {
    const k = side === RED ? "K" : "k";
    for (let r = 0; r < 10; r++)
      for (let f = 0; f < 9; f++)
        if (board[r][f] === k) return [f, r];
    return null;
  }

  function kingsFace(board) {
    const rk = findKing(board, RED), bk = findKing(board, BLACK);
    if (!rk || !bk || rk[0] !== bk[0]) return false;
    const f = rk[0];
    const [lo, hi] = rk[1] < bk[1] ? [rk[1], bk[1]] : [bk[1], rk[1]];
    for (let r = lo + 1; r < hi; r++) if (board[r][f] !== null) return false;
    return true;
  }

  function applyMove(board, f0, r0, f1, r1) {
    const captured = board[r1][f1];
    board[r1][f1] = board[r0][f0];
    board[r0][f0] = null;
    return captured;
  }

  /* (tf,tr) 是否被 side 方攻击 */
  function attackedBy(board, tf, tr, side) {
    const mine = p => p !== null && (p === p.toUpperCase()) === (side === RED);
    // 马
    const knightOffs = [[-1, -2], [1, -2], [-2, -1], [2, -1], [-2, 1], [2, 1], [-1, 2], [1, 2]];
    for (const [df, dr] of knightOffs) {
      const f = tf + df, r = tr + dr;
      if (!inBoard(f, r)) continue;
      const p = board[r][f];
      if (p && p.toLowerCase() === "n" && mine(p)) {
        let legFree;
        if (Math.abs(df) === 2) {
          const lf = f - (df > 0 ? 1 : -1);
          legFree = board[r][lf] === null;
        } else {
          const lr = r - (dr > 0 ? 1 : -1);
          legFree = board[lr][f] === null;
        }
        if (legFree) return true;
      }
    }
    // 车、炮（直线）与将、兵（单步）
    for (const [df, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      let f = tf + df, r = tr + dr, blocked = 0;
      while (inBoard(f, r)) {
        const p = board[r][f];
        if (p !== null) {
          if (mine(p)) {
            const lp = p.toLowerCase();
            if (blocked === 0 && lp === "r") return true;
            if (blocked === 1 && lp === "c") return true;
            // 将帅：相邻一步算攻击；同纵线隔空格是白脸将（飞将）也算；
            // 同横线隔多格不算（两将本不可能同横线，此分支只影响私教的无根子判定）
            if (blocked === 0 && lp === "k") {
              if (Math.abs(f - tf) + Math.abs(r - tr) === 1 || f === tf) return true;
            }
            if (blocked === 0 && lp === "p") {
              const ps = p === p.toUpperCase() ? RED : BLACK;
              const forward = ps === RED ? 1 : -1;
              if (f === tf && r === tr - forward) return true;              // 兵向前
              if (crossedRiver(ps, r) && r === tr && Math.abs(f - tf) === 1) return true; // 过河兵平吃
            }
          }
          blocked++;
          if (blocked > 1) break;
        }
        f += df; r += dr;
      }
    }
    // 士
    for (const [df, dr] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const f = tf + df, r = tr + dr;
      if (inBoard(f, r)) {
        const p = board[r][f];
        if (p && p.toLowerCase() === "a" && mine(p) && inPalace(f, r, side)) return true;
      }
    }
    // 象
    for (const [df, dr] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
      const f = tf + df, r = tr + dr;
      if (inBoard(f, r)) {
        const p = board[r][f];
        if (p && p.toLowerCase() === "b" && mine(p)) {
          if (board[(tr + r) >> 1][(tf + f) >> 1] === null) {
            if ((side === RED && r <= 4) || (side === BLACK && r >= 5)) return true;
          }
        }
      }
    }
    return false;
  }

  /* side 方全部伪合法走法，返回 [[f0,r0,f1,r1], ...] */
  function pseudoMoves(board, side) {
    const moves = [];
    const mine = p => p !== null && (p === p.toUpperCase()) === (side === RED);
    for (let r = 0; r < 10; r++) {
      for (let f = 0; f < 9; f++) {
        const p = board[r][f];
        if (!mine(p)) continue;
        const lp = p.toLowerCase();
        if (lp === "k") {
          for (const [df, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            const nf = f + df, nr = r + dr;
            if (inPalace(nf, nr, side)) moves.push([f, r, nf, nr]);
          }
        } else if (lp === "a") {
          for (const [df, dr] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const nf = f + df, nr = r + dr;
            if (inPalace(nf, nr, side)) moves.push([f, r, nf, nr]);
          }
        } else if (lp === "b") {
          for (const [df, dr] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
            const nf = f + df, nr = r + dr;
            if (!inBoard(nf, nr)) continue;
            if (side === RED && nr > 4) continue;
            if (side === BLACK && nr < 5) continue;
            if (board[(r + nr) >> 1][(f + nf) >> 1] === null) moves.push([f, r, nf, nr]);
          }
        } else if (lp === "n") {
          const offs = [
            [-1, -2, 0, -1], [1, -2, 0, -1], [-2, -1, -1, 0], [2, -1, 1, 0],
            [-2, 1, -1, 0], [2, 1, 1, 0], [-1, 2, 0, 1], [1, 2, 0, 1]
          ];
          for (const [df, dr, ef, er] of offs) {
            const nf = f + df, nr = r + dr;
            if (!inBoard(nf, nr)) continue;
            if (board[r + er][f + ef] !== null) continue;
            moves.push([f, r, nf, nr]);
          }
        } else if (lp === "r" || lp === "c") {
          for (const [df, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            let nf = f + df, nr = r + dr, jumped = false;
            while (inBoard(nf, nr)) {
              const t = board[nr][nf];
              if (!jumped) {
                if (t === null) {
                  moves.push([f, r, nf, nr]);
                } else if (lp === "r") {
                  if (!mine(t)) moves.push([f, r, nf, nr]);
                  break;
                } else {
                  jumped = true; // 炮越子
                }
              } else {
                if (t !== null) {
                  if (!mine(t)) moves.push([f, r, nf, nr]);
                  break;
                }
              }
              nf += df; nr += dr;
            }
          }
        } else if (lp === "p") {
          const forward = side === RED ? 1 : -1;
          if (inBoard(f, r + forward)) moves.push([f, r, f, r + forward]);
          if (crossedRiver(side, r)) {
            if (inBoard(f - 1, r)) moves.push([f, r, f - 1, r]);
            if (inBoard(f + 1, r)) moves.push([f, r, f + 1, r]);
          }
        }
      }
    }
    return moves;
  }

  function isLegal(board, side, mv) {
    const [f0, r0, f1, r1] = mv;
    if (!inBoard(f0, r0) || !inBoard(f1, r1)) return false;
    const p = board[r0][f0];
    if (p === null || (p === p.toUpperCase()) !== (side === RED)) return false;
    const t = board[r1][f1];
    if (t !== null && (t === t.toUpperCase()) === (side === RED)) return false;
    const pm = pseudoMoves(board, side);
    if (!pm.some(m => m[0] === f0 && m[1] === r0 && m[2] === f1 && m[3] === r1)) return false;
    const captured = applyMove(board, f0, r0, f1, r1);
    const k = findKing(board, side);
    const ok = k !== null && !attackedBy(board, k[0], k[1], other(side)) && !kingsFace(board);
    board[r0][f0] = board[r1][f1];
    board[r1][f1] = captured;
    return ok;
  }

  function legalMoves(board, side) {
    return pseudoMoves(board, side).filter(mv => isLegal(board, side, mv));
  }

  function isCheck(board, side) {
    const k = findKing(board, side);
    return k !== null && attackedBy(board, k[0], k[1], other(side));
  }

  function isCheckmate(board, side) {
    return isCheck(board, side) && legalMoves(board, side).length === 0;
  }

  /* 重复局面与长打判定（教学简化版亚洲规则）。
   * history: [{ key, check, side }]，key=走完该着后的局面（棋盘+走子方 FEN），
   * check=该着是否将军，side=走子方（初始局面 side 为 null）。
   * 返回 null（未重复三次）| { result:"draw" }（重复判和，含双方长将/长捉）
   *      | { result:"loss", side }（side 长将判负）。
   * 注：长捉判负的完整规则（捉子合法性分类）工程量很大，这里长捉按重复判和处理。 */
  function repetitionResult(history) {
    const last = history[history.length - 1];
    if (!last) return null;
    const occ = [];
    for (let i = 0; i < history.length; i++) if (history[i].key === last.key) occ.push(i);
    if (occ.length < 3) return null;
    const cycle = history.slice(occ[occ.length - 2] + 1);
    const perpR = cycle.some(h => h.side === "r") && cycle.filter(h => h.side === "r").every(h => h.check);
    const perpB = cycle.some(h => h.side === "b") && cycle.filter(h => h.side === "b").every(h => h.check);
    if (perpR && !perpB) return { result: "loss", side: "r" };
    if (perpB && !perpR) return { result: "loss", side: "b" };
    return { result: "draw" };
  }

  function parseMove(text) {
    text = text.trim().toLowerCase();
    if (text.length !== 4) throw new Error("着法长度须为 4: " + text);
    const c2f = c => {
      if (c >= "a" && c <= "i") return c.charCodeAt(0) - 97;
      if (c >= "0" && c <= "8") return Number(c);
      throw new Error("非法文件字符: " + c);
    };
    return [c2f(text[0]), Number(text[1]), c2f(text[2]), Number(text[3])];
  }

  function moveToText(mv) {
    return FILES[mv[0]] + mv[1] + FILES[mv[2]] + mv[3];
  }

  window.Xiangqi = {
    RED, BLACK, FILES, other, inBoard, inPalace, crossedRiver, cloneBoard,
    parseFen, boardToFen, findKing, kingsFace, applyMove, attackedBy,
    pseudoMoves, isLegal, legalMoves, isCheck, isCheckmate, parseMove, moveToText,
    repetitionResult
  };
})();
