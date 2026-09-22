/* 本地私教大脑：不调外部大模型，零 tokens。
 * 用皮卡鱼引擎（fairy-stockfish + NNUE）逐手拆解对局，再用规则级棋理特征
 * （子力价值 / 将军 / 无根子 / 开局原则）把引擎数据翻译成学员听得懂的讲解。
 *
 * 棋理知识库来源：象棋经典口诀与教科书原则（炮勿轻发、马勿躁进、三步不出车、
 * 一子多动大忌、残局马胜炮、缺士怕双车等），见 KB 常量。
 *
 * CoachBrain.review(game, opts) -> Promise<{markdown, dims, score, name, avgLoss}>
 *   game: { moves:[{m,cn}], result, mySide, levelName, reason, ts }
 *   opts: { ms=每手思考毫秒, onProgress(i,n) }
 * 引擎未就绪时 reject，调用方回退到大模型路径。 */
(function () {
  "use strict";

  const X = window.Xiangqi;
  const START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
  const MATE = 99000;              // 引擎 mate 分编码阈值（见 engine.js）
  const ENDGAME_MAT = 4600;        // 双方非将子力总值低于此视为残局（开局约 9600）
  const OPEN_PLIES = 20;           // 前 20 个半回合视为开局
  // 子力价值（×100 分）：车9 炮4.5 马4 士象2 兵1
  const VAL = { k: 100000, r: 900, c: 450, n: 400, a: 200, b: 200, p: 100 };
  const PN = { k: "将帅", r: "车", n: "马", c: "炮", a: "士象", b: "士象", p: "兵卒" };

  /* 棋理知识库：问题类别 → 讲解模板 */
  const KB = {
    missedMate: "有杀先看杀。优势再大，错过绝杀就是给对手机会——入局前先问自己：这手能不能将死？",
    missedCapture: "「白吃白不喝」。对方送到嘴边的子要先算清能不能吃、吃完有没有后患，再决定动不动别的。",
    hanging: "「根」是棋子的命。走每一手之前看一眼：这手走完，我的大子有没有变成无根子、被对方白吃？",
    missedCheck: "「有将必先抽」。将军是先手中的先手，能将军时不将，等于把主动权让给对方。",
    unpunished: "对手失误是送礼，但礼物要自己伸手接。对方走出漏着时，先找最狠的惩罚手段，别按部就班走自己的。",
    repeated: "「一子多动是大忌」。开局要务是让所有大子尽快出动，一个子连走好几步，等于让对手白走好几步棋。",
    rookLate: "「三步不出车，必定要输棋」。车是最强子力却缩在角落，等于开局就让了对方大半个车。",
    positional: "分数不会说谎：这手棋让局面掉了不少分。正着的思路见下面的引擎主线，对比体会差别。"
  };

  const clsName = l => l < 40 ? "正常" : l < 120 ? "一般" : l < 250 ? "欠佳" : l < 500 ? "失误" : "漏着";

  function sideOf(p) { return p === p.toUpperCase() ? "r" : "b"; }

  function material(board) {
    let s = 0;
    for (let r = 0; r < 10; r++) for (let f = 0; f < 9; f++) {
      const p = board[r][f];
      if (p && p.toLowerCase() !== "k") s += VAL[p.toLowerCase()];
    }
    return s;
  }

  function phaseOf(board, ply) {
    if (material(board) <= ENDGAME_MAT) return "残局";
    return ply < OPEN_PLIES ? "开局" : "中局";
  }

  function captureVal(board, mv) {
    const t = board[mv[3]][mv[2]];
    return t ? VAL[t.toLowerCase()] : 0;
  }

  function givesCheck(board, side, mv) {
    const b = X.cloneBoard(board);
    X.applyMove(b, mv[0], mv[1], mv[2], mv[3]);
    return X.isCheck(b, X.other(side));
  }

  /* side 方被攻击且无根的大子（≥马） */
  function hanging(board, side) {
    const out = [];
    for (let r = 0; r < 10; r++) for (let f = 0; f < 9; f++) {
      const p = board[r][f];
      if (!p || sideOf(p) !== side) continue;
      const v = VAL[p.toLowerCase()];
      if (v < 400) continue;
      if (X.attackedBy(board, f, r, X.other(side)) && !X.attackedBy(board, f, r, side)) {
        out.push({ p, v, f, r });
      }
    }
    return out;
  }

  /* 把引擎主线（内部坐标数组）转成中文着法序列 */
  function pvToCn(board, side, line, maxPlies) {
    if (!line || !line.length) return "";
    const b = X.cloneBoard(board);
    let s = side;
    const out = [];
    const limit = Math.min(maxPlies || 6, line.length);
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

  function fmtCp(cp) {
    if (cp === null) return "未知";
    if (cp >= MATE) return "有绝杀";
    if (cp <= -MATE) return "已被绝杀";
    return (cp > 0 ? "+" : "") + cp + " 分";
  }

  /* 重放对局，得到每一步走前的局面序列（含终局，共 n+1 个）。
   * game.fen 存在时（导入的残局摆谱）以它为起点。 */
  function replay(moves, startFen) {
    const { board, side } = X.parseFen(startFen || START_FEN);
    const states = [{ board, side, fen: X.boardToFen(board, side) }];
    for (const m of moves) {
      const mv = X.parseMove(m.m);
      X.applyMove(board, mv[0], mv[1], mv[2], mv[3]);
      const s = X.other(states[states.length - 1].side);
      states.push({ board: X.cloneBoard(board), side: s, fen: X.boardToFen(board, s) });
    }
    return states;
  }

  /* 引擎逐手拆解：evals[i] = states[i] 走子方视角分数；infos[i] = MultiPV 候选 */
  async function enginePass(states, ms, onProgress) {
    const n = states.length;
    const evals = new Array(n).fill(null);
    const infos = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      const st = states[i];
      if (!X.legalMoves(st.board, st.side).length) {
        evals[i] = -100000;   // 象棋规则：无棋可动（将死或困毙）判负
      } else {
        const cands = await Engine.candidates(st.fen, ms, 3);
        if (cands && cands.length) {
          infos[i] = cands;
          evals[i] = cands[0].cp;
        }
      }
      if (onProgress) onProgress(i + 1, n);
    }
    return { evals, infos };
  }

  /* 开局棋理检测：一子多动、出车迟缓（只看己方前 12 手） */
  function openingFindings(moves, states, side) {
    const myPlies = [];
    for (let i = 0; i < moves.length; i++) if (states[i].side === side) myPlies.push(i);
    const pos = {}, times = {}, name = {};
    for (const i of myPlies.slice(0, 12)) {
      const mv = X.parseMove(moves[i].m);
      const p = states[i].board[mv[1]][mv[0]];
      if (!p) continue;
      let id = null;
      for (const k in pos) if (pos[k][0] === mv[0] && pos[k][1] === mv[1]) { id = k; break; }
      if (!id) { id = p + mv[0] + "." + mv[1]; name[id] = PN[p.toLowerCase()]; }
      times[id] = (times[id] || 0) + 1;
      pos[id] = [mv[2], mv[3]];
    }
    const repeated = Object.keys(times).filter(k => times[k] >= 3)
      .map(k => ({ piece: name[k] || "棋子", times: times[k] }));
    let rookLate = false;
    if (myPlies.length >= 9) {
      const b = states[myPlies[Math.min(9, myPlies.length - 1)] + 1].board;
      const homes = side === "r" ? [[0, 0], [8, 0]] : [[0, 9], [8, 9]];
      const rook = side === "r" ? "R" : "r";
      rookLate = homes.every(([f, r]) => b[r][f] === rook);
    }
    return { repeated, rookLate };
  }

  /* 单手的棋理解读：对比实战着与引擎正着，给出原因类别 */
  function diagnose(st, i, moves, evals, infos, side) {
    const board = st.board;
    const played = X.parseMove(moves[i].m);
    const playedCap = captureVal(board, played);
    const playedCheck = givesCheck(board, side, played);
    const after = X.cloneBoard(board);
    X.applyMove(after, played[0], played[1], played[2], played[3]);
    const hangBefore = hanging(board, side);
    const newHang = hanging(after, side).filter(h =>
      !hangBefore.some(b => b.f === h.f && b.r === h.r));
    const best = infos[i] && infos[i][0];
    let bestArr = null, bestCap = 0, bestCheck = false, bestCn = "", lineCn = "", bestCapPiece = "";
    if (best && best.mv) {
      try {
        const arr = X.parseMove(best.mv);
        // 引擎残留数据可能给出不属于本局面的着法，校验合法性后再用
        if (board[arr[1]][arr[0]] && X.isLegal(board, side, arr)) {
          bestArr = arr;
          bestCap = captureVal(board, bestArr);
          bestCheck = givesCheck(board, side, bestArr);
          bestCn = Notation.chinese(board, side, bestArr);
          lineCn = pvToCn(board, side, best.line, 6);
          const tp = board[bestArr[3]][bestArr[2]];
          if (tp) bestCapPiece = PN[tp.toLowerCase()];
        }
      } catch (e) { bestArr = null; }
    }
    const before = evals[i];
    const afterCp = evals[i + 1] === null ? null : -evals[i + 1];
    const missedMate = before !== null && before >= MATE && (afterCp === null || afterCp < MATE);
    // 对手上一手失误（损≥250），我这手也没抓住（继续损≥120）
    const unpunished = i > 0 && evals[i] !== null && evals[i - 1] !== null &&
      Math.max(0, evals[i - 1] + evals[i]) >= 250;

    const cats = [];
    if (missedMate) cats.push("missedMate");
    if (bestCheck && !playedCheck && bestCap >= playedCap) cats.push("missedCheck");
    if (bestCap - playedCap >= 400) cats.push("missedCapture");
    if (newHang.length) cats.push("hanging");
    if (unpunished) cats.push("unpunished");
    if (!cats.length) cats.push("positional");
    return {
      playedCap, playedCheck, bestCn, lineCn, bestCap, bestCheck, bestCapPiece,
      newHang, missedMate, unpunished, cats,
      cat: cats[0]
    };
  }

  function clampScore(v) { return Math.max(15, Math.min(98, Math.round(v))); }

  async function review(game, opts) {
    opts = opts || {};
    if (!window.Engine || !Engine.ready) throw new Error("本地引擎未就绪");
    if (!game || !game.moves || !game.moves.length) throw new Error("棋谱为空");
    const t0 = Date.now();
    const ms = opts.ms || 350;
    const my = game.mySide === "b" ? "b" : "r";
    const foe = X.other(my);

    const states = replay(game.moves, game.fen);
    const { evals, infos } = await enginePass(states, ms, opts.onProgress);

    /* 逐手损益与棋理诊断（着法中文名以棋盘现算为准——可纠正旧存档中的记谱错误） */
    const n = game.moves.length;
    const moves = game.moves.map((m, i) => {
      const before = evals[i], after = evals[i + 1] === null ? null : -evals[i + 1];
      const loss = before !== null && after !== null ? Math.max(0, before - after) : 0;
      const side = states[i].side;
      let cn = m.cn;
      try { cn = Notation.chinese(states[i].board, side, X.parseMove(m.m)); } catch (e) {}
      const diag = loss >= 40 || side === my
        ? diagnose(states[i], i, game.moves, evals, infos, side)
        : null;
      return { i, cn, side, loss, cls: clsName(loss), phase: phaseOf(states[i].board, i), diag };
    });

    const mine = moves.filter(m => m.side === my);
    const avgLoss = mine.length ? Math.round(mine.reduce((a, m) => a + m.loss, 0) / mine.length) : 0;
    const blunders = mine.filter(m => m.loss >= 500).length;
    const mistakes = mine.filter(m => m.loss >= 250 && m.loss < 500).length;
    const keyMoves = mine.filter(m => m.loss >= 120).sort((a, b) => b.loss - a.loss).slice(0, 5);
    const opening = openingFindings(game.moves, states, my);

    /* 亮点：与引擎正着的吻合度、最长连续吻合段 */
    let streak = 0, bestStreak = 0, matchCnt = 0;
    for (const m of moves) {
      if (m.side !== my) continue;
      if (m.loss < 40) { streak++; matchCnt++; if (streak > bestStreak) bestStreak = streak; }
      else streak = 0;
    }
    const acc = mine.length ? Math.round(100 * matchCnt / mine.length) : 0;

    /* 与「我的棋谱 → 分析本局」共用格式的形势曲线与逐手损益（红方视角） */
    const curve = [];
    let lastCp = 0;
    states.forEach((st2, i) => {
      if (evals[i] !== null) lastCp = st2.side === "r" ? evals[i] : -evals[i];
      curve.push(Math.round(lastCp));
    });
    const perMove = moves.map(m => ({ loss: Math.round(m.loss), cls: m.cls }));

    /* 六维评分 */
    const phaseLoss = ph => {
      const ms2 = mine.filter(m => m.phase === ph);
      return ms2.length ? ms2.reduce((a, m) => a + m.loss, 0) / ms2.length : avgLoss;
    };
    const missedOpp = mine.filter(m => m.diag && m.loss >= 150 &&
      ((m.diag.bestCap - m.diag.playedCap >= 400) || (m.diag.bestCheck && !m.diag.playedCheck) || m.diag.missedMate)).length;
    const hangBlunders = mine.filter(m => m.diag && m.diag.newHang.length && m.loss >= 150).length;
    const dims = {
      "开局": clampScore(95 - phaseLoss("开局") * 0.35 - (opening.repeated.length + (opening.rookLate ? 1 : 0)) * 10),
      "中局": clampScore(95 - phaseLoss("中局") * 0.35),
      "残局": clampScore(95 - phaseLoss("残局") * 0.35),
      "进攻": clampScore(88 - missedOpp * 12),
      "防守": clampScore(88 - hangBlunders * 12),
      "稳定": clampScore(96 - mistakes * 8 - blunders * 15)
    };
    const score = Math.round((dims["开局"] + dims["中局"] + dims["残局"] + dims["进攻"] + dims["防守"] + dims["稳定"]) / 6);

    /* 起名：按最突出的问题定主题 */
    const missedMate = mine.some(m => m.diag && m.diag.missedMate);
    const name =
      missedMate ? "绝杀擦肩而过" :
      hangBlunders >= 2 ? "慷慨送礼局" :
      opening.repeated.length ? "孤军深入陷重围" :
      opening.rookLate ? "大车睡过了头" :
      missedOpp >= 2 ? "到嘴的肥肉飞了" :
      game.result === "win" ? (avgLoss < 60 ? "兵不血刃" : "力战克敌") :
      game.result === "draw" ? "握手言和" :
      avgLoss < 60 ? "虽败犹荣" : "缠斗惜败";

    /* ---------- 生成 Markdown 报告 ---------- */
    const resText = game.result === "win" ? "胜" : game.result === "loss" ? "负" : game.result === "draw" ? "和" : "未知";
    const md = [];
    md.push("## 📋 引擎复盘报告（本地生成 · 0 tokens）");
    md.push("本局你执" + (my === "r" ? "红" : "黑") + "，结果" + resText + "。" +
      "皮卡鱼引擎逐手拆解 " + (n + 1) + " 个局面（每手约 " + ms + "ms），总评 **" + score + " 分**，" +
      "你的着法平均每手损 **" + avgLoss + " 分**，失误 " + mistakes + " 手、漏着 " + blunders + " 手，" +
      "与引擎正着吻合度 **" + acc + "%**" + (bestStreak >= 4 ? "（最长连续 " + bestStreak + " 手吻合）" : "") + "。" +
      (score >= 85 ? "整体发挥相当稳健，继续保持！" :
       score >= 70 ? "整体不错，抓住下面几个关键点就能再进一步。" :
       score >= 55 ? "中规中矩，但有几手代价不小的棋值得细看。" :
       "这盘暴露的问题比较多，别灰心，逐个改掉就是涨棋。"));

    const bright = [];
    if (acc >= 75) bright.push("吻合度 " + acc + "%：多数着法与引擎正着一致，基本功扎实");
    if (bestStreak >= 6) bright.push("曾连续 " + bestStreak + " 手走出正着，这段棋质量很高");
    if (!blunders && !mistakes && mine.length >= 10) bright.push("全局没有明显失误，稳定性值得肯定");
    if (bright.length) md.push("## ✨ 亮点\n" + bright.map(s => "- " + s).join("\n"));

    if (keyMoves.length) {
      md.push("## 🎯 关键问题着法（按损失排序）");
      keyMoves.forEach((m, k) => {
        const d = m.diag;
        md.push("### " + (k + 1) + ". 第 " + (m.i + 1) + " 手 " +
          (m.side === "r" ? "红" : "黑") + " · " + m.cn + "（" + m.cls + "，损 " + m.loss + " 分）");
        if (d && d.bestCn) {
          md.push("- **正着：" + d.bestCn + "**" + (d.lineCn ? "，主线：" + d.lineCn : ""));
        }
        const reasons = [];
        if (d) {
          if (d.missedMate) reasons.push("这手错过了绝杀！正着可以直接入局");
          if (d.bestCheck && !d.playedCheck && d.bestCap >= d.playedCap) reasons.push("错过了将军抢先的机会");
          if (d.bestCap - d.playedCap >= 400) reasons.push("正着能白吃对方的" + (d.bestCapPiece || "大子") + "，实战却没吃到");
          if (d.newHang.length) reasons.push("走完后 " + d.newHang.map(h => PN[h.p.toLowerCase()]).join("、") + " 无根，等于白送");
          if (d.unpunished) reasons.push("对手上一手明显失误，这手没有抓住惩罚机会");
        }
        m._reasons = reasons;
        md.push("- 问题：" + (reasons.length ? reasons.join("；") : "局面判断偏差，正着更紧凑（对比主线体会）") + "。");
        md.push("- 棋理：" + KB[d ? d.cat : "positional"]);
      });
    } else {
      md.push("## 🎯 关键问题着法\n全局没有明显失分着，发挥稳定 👍");
    }

    const openIssues = [];
    opening.repeated.forEach(r =>
      openIssues.push("前 12 手里" + r.piece + "连走了 " + r.times + " 步——" + KB.repeated));
    if (opening.rookLate) openIssues.push("第 10 回合双车仍在原位——" + KB.rookLate);
    md.push("## 🌱 开局检查");
    md.push(openIssues.length ? openIssues.map(s => "- " + s).join("\n") : "- 开局出子顺序正常，强子出动及时。");

    md.push("## 📊 六维简评");
    md.push("开局 " + dims["开局"] + " · 中局 " + dims["中局"] + " · 残局 " + dims["残局"] +
      " · 进攻 " + dims["进攻"] + " · 防守 " + dims["防守"] + " · 稳定 " + dims["稳定"] +
      "（雷达图见「我的棋谱 → 已讲解」）");

    const advice = [];
    const weak = Object.keys(dims).sort((a, b) => dims[a] - dims[b])[0];
    if (weak === "开局") advice.push("开局是最弱环：先背两三个先后手布局套路（如中炮对屏风马），重点体会「快出强子、左右均衡」。");
    if (weak === "中局") advice.push("中局算账要更细：每手走前多问一句「对方刚走的这手威胁我什么」。");
    if (weak === "残局") advice.push("残局多练基本杀法与例胜例和定式，记住「残局马胜炮」「缺士怕双车」。");
    if (weak === "进攻") advice.push("进攻嗅觉：养成「有杀看杀、有将先抽、有子先吃」的出手顺序习惯。");
    if (weak === "防守") advice.push("防守习惯：走完每手棋扫一遍自己大子是否生根，无根子先处理再走别的。");
    if (weak === "稳定") advice.push("稳定性：大漏都出在一两手上。关键时刻（得子后、被将军后）强制自己多想 10 秒。");
    /* 练习推荐：按最突出问题与最弱维度映射到课程分类 */
    const REC_BY_CAT = {
      missedMate: ["A", "基本杀法"], missedCheck: ["A", "基本杀法"],
      hanging: ["C", "子力基本定式"],
      missedCapture: ["D", "中局妙手300"], unpunished: ["D", "中局妙手300"],
      repeated: ["G", "现代布局评注"], rookLate: ["G", "现代布局评注"]
    };
    const REC_BY_DIM = { "开局": ["G", "现代布局评注"], "中局": ["D", "中局妙手300"], "残局": ["B", "实用残局100"], "进攻": ["A", "基本杀法"], "防守": ["C", "子力基本定式"], "稳定": ["A", "基本杀法"] };
    const catCounts = {};
    mine.forEach(m => {
      if (m.diag && m.loss >= 120) catCounts[m.diag.cat] = (catCounts[m.diag.cat] || 0) + 1;
    });
    if (opening.repeated.length) catCounts.repeated = (catCounts.repeated || 0) + 1;
    if (opening.rookLate) catCounts.rookLate = (catCounts.rookLate || 0) + 1;
    const recs = [];
    const topCat = Object.keys(catCounts).sort((a, b) => catCounts[b] - catCounts[a])[0];
    if (topCat && REC_BY_CAT[topCat]) recs.push(REC_BY_CAT[topCat]);
    if (REC_BY_DIM[weak] && !recs.some(r => r[0] === REC_BY_DIM[weak][0])) recs.push(REC_BY_DIM[weak]);
    if (recs.length) advice.push("推荐课程：" + recs.map(r => r[0] + " " + r[1]).join("、") + "（点报告下方的按钮直达）。");
    advice.push("到「我的棋谱」点「分析本局」可复看形势曲线与全部问题着；想深入聊某一手，直接在下面问我。");
    md.push("## 🎓 练习建议");
    md.push(advice.map(s => "- " + s).join("\n"));

    /* 结构化数据：润色层输入、习惯档案聚合、练习直达按钮 */
    const data = {
      theme: name, my: my === "r" ? "红" : "黑", result: resText, plies: n,
      score, avgLoss, acc, bestStreak, mistakes, blunders, dims,
      keyMoves: keyMoves.map(m => ({
        ply: m.i + 1, round: Math.floor(m.i / 2) + 1, side: m.side === "r" ? "红" : "黑",
        cn: m.cn, cls: m.cls, loss: Math.round(m.loss),
        bestCn: m.diag ? m.diag.bestCn : "", lineCn: m.diag ? m.diag.lineCn : "",
        reasons: m._reasons || [], kb: KB[m.diag ? m.diag.cat : "positional"]
      })),
      openingIssues: openIssues, bright, advice: advice.slice(0, -1),
      catCounts, recs
    };

    return {
      markdown: md.join("\n\n"),
      dims, score, name, avgLoss,
      elapsed: (Date.now() - t0) / 1000,
      analysis: { curve, perMove },
      data,
      /* 给习惯档案的一句话总结 */
      profileNote: "本局主题「" + name + "」：均手损 " + avgLoss + " 分，失误 " + mistakes + " 漏着 " + blunders +
        "，吻合度 " + acc + "%" +
        (opening.repeated.length ? "；开局有一子多动" : "") + (opening.rookLate ? "；出车迟缓" : "") +
        (hangBlunders ? "；有送子漏着" : "") + "。"
    };
  }

  window.CoachBrain = { review };
})();
