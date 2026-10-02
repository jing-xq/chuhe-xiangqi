/* 飞刀/骗招分类纯函数（去重）：运行时（js/traps.js）与离线分类器（tools/gen_trap_cls.js）
 * 共用同一实现，杜绝两份手工副本漂移（曾因离线副本漏字段导致 loss=NaN 静默分叉）。
 * 依赖：仅 window.Xiangqi（Node 侧经 vm 加载，同 rules.js/notation.js），无 DOM、无引擎。
 * 全局对象：TrapCls
 *   TrapCls.classifyOne(data, searchFn[, opts]) -> Promise<{cls, loss, fall, trapPly, declineMv?, trapCn?}>
 *     data     课程 JSON（{fen, moves:[{m, cn, ch?}]}）
 *     searchFn (fen, movetime, multipv) -> Promise<[{mv, cp}]>  候选按 cp 降序，mv 内部坐标着法
 *     opts     { ms=300 每次搜索时长, wait=n=>Promise 重试前等待（测试可注入） }
 * 分类口径：沿主线扫描，对方实际应着比引擎最优差 ≥150 分视为「上当」；此时计算
 * 对方识破（走引擎最优）后陷阱方的损失：loss <60 → 飞刀（稳）、>150 → 骗招（险）、其余 → 险招。 */
(function () {
  "use strict";
  const X = window.Xiangqi;

  async function classifyOne(data, searchFn, opts) {
    opts = opts || {};
    const ms = opts.ms || 300;
    const wait = opts.wait || (n => new Promise(r => setTimeout(r, n)));
    const line = [];
    let nodes = data.moves || [];
    while (nodes.length && line.length < 22) { line.push(nodes[0]); nodes = nodes[0].ch || []; }
    if (line.length < 4) return { cls: "未知", loss: null, trapPly: null };

    function posAt(i) {
      const { board, side } = X.parseFen(data.fen);
      let s = side;
      for (let j = 0; j < i; j++) { X.applyMove(board, ...X.parseMove(line[j].m)); s = X.other(s); }
      return { board, side: s };
    }

    for (let j = 1; j + 1 < line.length && j <= 21; j++) {
      // j = 对方着子序号（陷阱方可能是红也可能是黑，所以双方步都扫）
      const p1 = posAt(j);
      const fen1 = X.boardToFen(p1.board, p1.side);
      let cands = await searchFn(fen1, ms, 4);
      if (!cands || !cands.length) { await wait(300); cands = await searchFn(fen1, ms * 2, 4); }
      if (!cands || !cands.length) break;
      const actual = cands.find(c => c.mv === line[j].m);
      let oppValue;
      if (actual) {
        oppValue = actual.cp;
      } else {
        const b2 = X.cloneBoard(p1.board);
        X.applyMove(b2, ...X.parseMove(line[j].m));
        const e = await searchFn(X.boardToFen(b2, X.other(p1.side)), ms, 1);
        if (!e || !e.length) break;
        oppValue = -e[0].cp;   // 转回对方视角
      }
      const fall = cands[0].cp - oppValue;   // 对方因上当损失的分
      if (fall < 150) continue;              // 不算上当，继续扫描

      // 找到陷阱点：陷阱着 = line[j-1]（对方上一步是陷阱方的关键着）
      const p0 = posAt(j - 1);
      const cands0 = await searchFn(X.boardToFen(p0.board, p0.side), ms, 4);
      if (!cands0 || !cands0.length) break;
      // 对方最优防御后的局面（陷阱方走子，评分即陷阱方视角）
      const b3 = X.cloneBoard(p1.board);
      X.applyMove(b3, ...X.parseMove(cands[0].mv));
      const decline = await searchFn(X.boardToFen(b3, X.other(p1.side)), ms, 1);
      if (!decline || !decline.length) break;
      const loss = Math.max(0, cands0[0].cp - decline[0].cp);
      const cls = loss < 60 ? "飞刀" : loss > 150 ? "骗招" : "险招";
      return { cls, loss: Math.round(loss), fall: Math.round(fall),
               trapPly: j, declineMv: cands[0].mv, trapCn: line[j - 1].cn };
    }
    return { cls: "未知", loss: null, trapPly: null };
  }

  window.TrapCls = { classifyOne };
})();
