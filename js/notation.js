/* 中文着法生成：坐标着法 → 炮二平五 / 马8进7。
 * 全局对象：Notation.chinese(board, side, mv) */
(function () {
  "use strict";

  const RED = "r", BLACK = "b";
  const CN_NUM = "一二三四五六七八九";
  const PIECE_CN = {
    k: ["帅", "将"], a: ["仕", "士"], b: ["相", "象"], n: ["马", "马"],
    r: ["车", "车"], c: ["炮", "炮"], p: ["兵", "卒"]
  };

  function numCn(side, n) {
    return side === RED ? CN_NUM[n - 1] : String(n);
  }

  function fileCn(side, f) {
    // 红方从右往左数一-九（file8=一），黑方从左往右 1-9
    return side === RED ? numCn(side, 9 - f) : numCn(side, f + 1);
  }

  /* 走前棋盘 board、走子方 side、着法 mv=[f0,r0,f1,r1] */
  function chinese(board, side, mv) {
    const [f0, r0, f1, r1] = mv;
    const p = board[r0][f0];
    const lp = p.toLowerCase();
    const name = PIECE_CN[lp][side === RED ? 0 : 1];

    // 同文件同名子 → 前/后
    let same = [];
    for (let r = 0; r < 10; r++) {
      for (let f = 0; f < 9; f++) {
        const q = board[r][f];
        if (q !== null && q.toLowerCase() === lp &&
            (q === q.toUpperCase()) === (side === RED) &&
            f === f0 && !(f === f0 && r === r0)) {
          same.push([f, r]);
        }
      }
    }
    let prefix = "", fileStr = fileCn(side, f0);
    if (same.length) {
      // 同线同名子：两个用前/后；三个及以上（残局多兵同线）用前/中/后
      const frontHigh = side === RED;   // 红方前线在 rank 大的一侧
      const all = same.concat([[f0, r0]]).sort((a, b) => frontHigh ? b[1] - a[1] : a[1] - b[1]);
      const pos = all.findIndex(([f, r]) => f === f0 && r === r0);
      if (all.length === 2) prefix = pos === 0 ? "前" : "后";
      else prefix = pos === 0 ? "前" : pos === all.length - 1 ? "后" : "中";
      fileStr = "";
    }

    // 将/帅：横走记「平」+ 到达路数；进退记步数（恒为一）
    if (lp === "k") {
      if (r1 === r0) return prefix + name + fileStr + "平" + fileCn(side, f1);
      const forwardK = side === RED ? r1 > r0 : r1 < r0;
      return prefix + name + fileStr + (forwardK ? "进" : "退") + numCn(side, Math.abs(r1 - r0));
    }
    // 仕/相/马：进退记到达路数
    if (lp === "a" || lp === "b" || lp === "n") {
      const forward = side === RED ? r1 > r0 : r1 < r0;
      return prefix + name + fileStr + (forward ? "进" : "退") + fileCn(side, f1);
    }
    if (r1 === r0) {
      return prefix + name + fileStr + "平" + fileCn(side, f1);
    }
    const dist = Math.abs(r1 - r0);
    const forward = side === RED ? r1 > r0 : r1 < r0;
    return prefix + name + fileStr + (forward ? "进" : "退") + numCn(side, dist);
  }

  window.Notation = { chinese, fileCn, numCn };
})();
