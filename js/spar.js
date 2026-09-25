/* 私教陪练视图：人机对弈 + 特大式实时讲解。
 * Spar.mount(container)  Spar.show() / Spar.hide()
 * 与 play.js 同一状态机范式（复制改写，play.js 不动）：
 * 对手按八档难度应着；学员每手落地后私教解析——开局识别、对手应法点评、
 * 脱谱指正、中局损益点评、威胁提示；「💡 私教推荐」由学员主动按下才泄露正着（棋盘画指引箭头）。
 * 引擎单 worker 无队列：所有引擎调用串行（st.thinking 锁 + st.token 防僵尸回调）。 */
(function () {
  "use strict";

  const X = window.Xiangqi;
  const START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
  const MATE = 99000;

  /* 对手难度（与 play.js 同口径：名次概率 + 随机漏着注入 / 特大最优） */
  const LEVELS = [
    { name: "学前", time: 0,    pick: "randomLegal", desc: "刚学会规则的棋友水平，走子没有章法——适合人生第一盘" },
    { name: "业1",  time: 250,  pv: 8, ranks: [12, 12, 12, 12, 12, 12, 12, 12], rand: 0.18, book: 0.5, desc: "知道规则，但经常丢子、漏看将军，一步大亏很常见" },
    { name: "业3",  time: 300,  pv: 8, ranks: [38, 22, 14, 9, 6, 4, 3, 4],      rand: 0.07, book: 0.75, desc: "社区初级水平：大子看不住会送，偶尔走出随手棋" },
    { name: "业5",  time: 450,  pv: 8, ranks: [52, 25, 11, 5, 3, 2, 1, 1],      rand: 0.025, book: 0.9, desc: "业余中坚：开局熟练，中局偶有方向性错误，偶尔丢子" },
    { name: "业7",  time: 600,  pv: 6, ranks: [68, 20, 8, 2, 1, 1],             rand: 0.01, desc: "业余高手：攻防有章法，抓机会能力很强" },
    { name: "业9",  time: 800,  pv: 5, ranks: [82, 12, 4, 1, 1],                rand: 0, desc: "准专业水平：计算精准，盘面破绽很少" },
    { name: "大师", time: 1200, pv: 4, ranks: [94, 5, 1, 0],                    rand: 0, desc: "职业大师：几乎不走坏棋，先求稳再求胜" },
    { name: "特大", time: 1800, pick: "best", desc: "特级大师全力模式，象棋的天花板" }
  ];

  /* 对手开局库（坐标着法，运行时校验合法性）——让低难度对手的开局有真人味道 */
  const BOOK = {
    "": ["h2e2", "c3c4", "g0e2", "b0c2"],
    "h2e2": ["h9g7", "b9c7", "h7e7", "g6g5"],
    "h2e2 h9g7": ["b0c2", "h0g2"],
    "h2e2 h9g7 b0c2": ["g6g5", "b9c7"],
    "h2e2 h9g7 b0c2 g6g5": ["a0b0", "c3c4"],
    "h2e2 h9g7 b0c2 g6g5 a0b0": ["b9c7", "c9e7"],
    "h2e2 h9g7 b0c2 g6g5 a0b0 b9c7": ["c3c4", "h0g2"],
    "h2e2 h9g7 b0c2 g6g5 c3c4": ["b9c7", "g9e7"],
    "h2e2 b9c7": ["b0c2", "h0g2"],
    "h2e2 b9c7 b0c2": ["g6g5", "c6c5"],
    "h2e2 h7e7": ["b0c2", "h0g2"],
    "h2e2 h7e7 b0c2": ["h9g7", "b9c7"],
    "h2e2 g6g5": ["b0c2", "h0g2"],
    "c3c4": ["h7e7", "g6g5", "h9g7"],
    "c3c4 h7e7": ["b0c2", "h0g2"],
    "c3c4 g6g5": ["b0c2", "g0e2"],
    "g0e2": ["h9g7", "b9c7", "c6c5"],
    "g0e2 h9g7": ["b0c2", "h0g2"],
    "b0c2": ["g6g5", "h9g7"],
    "b0c2 g6g5": ["h0g2", "g0e2"]
  };

  /* 棋理口诀库（脱谱/大亏时点拨一句，先扬后抑、口诀体） */
  const TIPS = [
    "有杀先看杀——入局前先问自己：这手能不能直接成杀？",
    "白吃白不喝——对方送到嘴边的子，先算清再吃。",
    "根是棋子的命——走前先扫一眼自己的大子有没有根。",
    "一子多动是大忌——强子要尽快出动，别让一个子连跑好几步。",
    "三步不出车，必定要输棋——车不出动，等于让对手半只车。",
    "得子失先非上策——光吃子丢了先手，往往是亏的。",
    "临杀勿急——越是机会在手，越要把变化算完整。",
    "车占肋道，炮镇中路——子力要占要道，别窝在边角。"
  ];

  const clsName = l => l < 40 ? "正常" : l < 120 ? "一般" : l < 250 ? "欠佳" : l < 500 ? "失误" : "漏着";

  /* ---------- 纯函数（SparDebug 导出供测试） ---------- */

  /* 红方视角分差 → 局势描述（±30 均势 / ±100 稍优稍劣 / ±300 优势劣势 / 以上明显优势） */
  function describeRed(cp) {
    if (cp === null || cp === undefined) return "形势不明";
    const a = Math.abs(cp);
    if (a <= 30) return "均势";
    if (a <= 100) return cp > 0 ? "红方稍优" : "黑方稍优";
    if (a <= 300) return cp > 0 ? "红方优势" : "黑方优势";
    return cp > 0 ? "红方明显优势" : "黑方明显优势";
  }

  /* 红方视角分差 → 「红优 +1.5 / 黑优 +1.5 / 均势 0.0」式短评 */
  function fmtEvalRed(cp) {
    if (cp === null || cp === undefined) return "评分未知";
    if (cp >= MATE) return "红优 · 绝杀";
    if (cp <= -MATE) return "黑优 · 绝杀";
    const a = Math.abs(cp);
    if (a <= 30) return "均势 0.0";
    return (cp > 0 ? "红优 +" : "黑优 +") + (a / 100).toFixed(1);
  }

  /* 在树的一层里找 m === mvText 的节点（ch[0] 主线与 ch[1+] 变着同等对待） */
  function findChild(nodes, mvText) {
    for (const n of (nodes || [])) if (n.m === mvText) return n;
    return null;
  }

  /* 单步谱分类（纯函数）。
   * book: 候选体系集合 {cands: [{sys, node}]}，cands 为空数组 = 尚未入门；
   * 中炮这类共享前缀的体系会同时留在 cands 里，随走子逐步收窄，收窄到唯一时 greet。
   * 返回 {book, offBook, ev, dev?}；ev ∈
   *   greet   候选收窄到唯一（含第一手就唯一命中）→ 体系识别，发 intro
   *   onBook  着法命中候选节点（学员着、或多候选未定时双方着，静默）
   *   comment 已唯一时对手着命中谱节点（有评注则点评）
   *   dev     着法命中候选节点的脱谱教学点（多个 cand 各带 dev 取第一个）
   *   stuOff  学员在谱时走出谱外（要 engine 算账）
   *   stuFree 学员着手完全不属任何体系（温和转入引擎模式）
   *   oppOff  对手走出谱外且无教学点
   *   none    已脱谱后的着法 */
  function classifyMove(book, offBook, mover, mvText, mySide, sysList) {
    if (offBook) return { book, offBook: true, ev: "none" };
    const prev = book ? book.cands : [];
    // 在每个候选（尚未入门则在所有体系根）上找匹配并收窄
    const cands = [];
    if (prev.length === 0) {
      for (const sys of (sysList || [])) {
        const node = findChild(sys.data.moves, mvText);
        if (node) cands.push({ sys, node });
      }
    } else {
      for (const cand of prev) {
        const node = findChild(cand.node.ch, mvText);
        if (node) cands.push({ sys: cand.sys, node });
      }
    }
    const nb = { cands };
    if (!cands.length) {
      // 全部不匹配：先查各候选节点的 dev[] 脱谱教学点
      for (const cand of prev) {
        const dev = (cand.node.dev || []).find(d => d.m === mvText);
        if (dev) return { book: { cands: [] }, offBook: true, ev: "dev", dev };
      }
      return { book: { cands: [] }, offBook: true, ev: mover === mySide ? "stuOff" : "oppOff" };
    }
    if (cands.length === 1 && prev.length !== 1) {
      return { book: nb, offBook: false, ev: "greet" };
    }
    if (cands.length === 1 && mover !== mySide) return { book: nb, offBook: false, ev: "comment" };
    return { book: nb, offBook: false, ev: "onBook" };
  }

  /* 全序列重放（悔棋后按新序列重建谱状态）：走到第一个非 greet/onBook/comment 事件为止
   * （中途可能出现 greet——多体系共享根在若干手后才收窄到唯一），其后全是引擎模式 */
  function replayBook(sysList, seq, mySide) {
    let book = { cands: [] }, offBook = false, mover = "r";
    let i = 0;
    for (; i < seq.length; i++) {
      const r = classifyMove(book, offBook, mover, seq[i], mySide, sysList);
      book = r.book; offBook = r.offBook;
      if (r.ev !== "greet" && r.ev !== "onBook" && r.ev !== "comment") break;
      mover = X.other(mover);
    }
    return { book, offBook, plies: i };
  }

  /* 脱谱文案组装（纯函数）：返回气泡文本数组，每条 ≤3 行 */
  function buildOffBookMsg(o) {
    const out = [];
    out.push("你脱谱了。这手「" + o.cn + "」损 " + o.loss + " 分（" + clsName(o.loss) + "）。");
    if (o.loss >= 120 && o.bestCn) {
      out.push("引擎推荐 " + o.bestCn + (o.lineCn ? "，主线：" + o.lineCn : "") + "。");
    }
    if (o.tip) out.push("记住：" + o.tip);
    if (o.preDesc && o.postDesc && o.preDesc !== o.postDesc) {
      out.push("局面从" + o.preDesc + "变成" + o.postDesc + "。");
    }
    return out;
  }

  /* ---------- 着法意图分析（纯函数，供所有文案复用） ---------- */
  const VAL2 = { r: 600, c: 300, n: 300, b: 100, a: 100, p: 60, k: 0 };
  const NAME_OF = { K: "帅", k: "将", R: "车", r: "车", N: "马", n: "马", C: "炮", c: "炮", B: "相", b: "象", A: "仕", a: "士", P: "兵", p: "卒" };
  function pv(p) { return VAL2[p.toLowerCase()] || 0; }

  /* 各兵种原位（side 方视角，出子判定用） */
  function homeSquares(pt, side) {
    const back = side === "r" ? 0 : 9;
    switch (pt) {
      case "r": return [[0, back], [8, back]];
      case "n": return [[1, back], [7, back]];
      case "c": { const cr = side === "r" ? 2 : 7; return [[1, cr], [7, cr]]; }
      case "b": return [[2, back], [6, back]];
      case "a": return [[3, back], [5, back]];
      case "k": return [[4, back]];
      default: return [];
    }
  }

  /* 真实攻击判定：side 是否有子能吃到 (tf,tr)。
   * 实现：克隆棋盘、在目标格放一个假敌子后逐子测吃子合法性（吃子合法==攻击该格，
   * 炮架语义天然正确，己方子占格也能测出"保护"）。
   * 不用 attackedBy 的原因：它把「白脸将」（将帅同纵线隔空）也算攻击，会把对方将帅
   * 身后的子误判为"有保护"。 */
  function attackedByReal(board, tf, tr, side) {
    const b = X.cloneBoard(board);
    b[tr][tf] = side === "r" ? "p" : "P";
    for (let r = 0; r < 10; r++) for (let f = 0; f < 9; f++) {
      if (f === tf && r === tr) continue;
      const p = b[r][f];
      if (!p || (p === p.toUpperCase()) !== (side === "r")) continue;
      if (p.toLowerCase() === "k" && Math.abs(f - tf) + Math.abs(r - tr) !== 1) continue;   // 白脸将不算吃
      try { if (X.isLegal(b, side, [f, r, tf, tr])) return true; } catch (e) {}
    }
    return false;
  }

  /* moveIntent(board, side, mvText)：这手棋「干了什么」。
   * kind 优先级：check > freeCapture/trade/sac > attack(捉无根) > answerCheck > escape/rescue > develop > move */
  function moveIntent(board, side, mvText) {
    let mv;
    try { mv = X.parseMove(mvText); } catch (e) { return { kind: "unknown", side }; }
    const piece = board && board[mv[1]] && board[mv[1]][mv[0]];
    if (!piece) return { kind: "unknown", side };
    const pt = piece.toLowerCase();
    const opp = X.other(side);
    const target = board[mv[3]][mv[2]];
    const intent = { kind: "move", side, piece: pt, to: [mv[2], mv[3]], check: false, gain: 0, developed: false };
    let afterCache = null;
    const afterBoard = () => (afterCache || (afterCache = (() => {
      const b = X.cloneBoard(board);
      X.applyMove(b, ...mv);
      return b;
    })()));
    intent.developed = homeSquares(pt, side).some(([f, r]) => f === mv[0] && r === mv[1]);   // 这手是否从原位出子
    // 吃子 / 兑子：吃过去后吃子者会不会被吃回
    if (target) {
      const canBack = attackedByReal(afterBoard(), mv[2], mv[3], opp);
      intent.capture = { piece: target.toLowerCase(), name: NAME_OF[target], value: pv(target) };
      intent.protectedTarget = canBack;
      intent.gain = canBack ? pv(target) - pv(piece) : pv(target);
    }
    // 将军
    try { if (X.isCheck(afterBoard(), opp)) intent.check = true; } catch (e) {}
    // 捉：走后新攻击对方无根大子（不含将帅，且不是吃子本身）
    if (!target && !intent.check) {
      const isOpp = (p) => (p === p.toUpperCase()) === (side === "b");
      const hanging = (b, bySide) => {
        const out = [];
        for (let r = 0; r < 10; r++) for (let f = 0; f < 9; f++) {
          const p = b[r][f];
          if (!p || !isOpp(p) || p.toLowerCase() === "k") continue;
          if (attackedByReal(b, f, r, bySide) && !attackedByReal(b, f, r, opp)) out.push({ f, r, p, v: pv(p) });
        }
        return out;
      };
      const before = hanging(board, side), after = hanging(afterBoard(), side);
      for (const a of after) {
        if (before.some(b2 => b2.f === a.f && b2.r === a.r)) continue;
        if (!intent.attack || a.v > intent.attack.value) intent.attack = { name: NAME_OF[a.p], value: a.v };
      }
    }
    // 逃 / 保：走前被攻击且无根的大子，走后解套（移动本身是那个子=逃，否则=保）
    const hangsOf = (b) => {
      const out = [];
      for (let r = 0; r < 10; r++) for (let f = 0; f < 9; f++) {
        const p = b[r][f];
        if (!p || (p === p.toUpperCase()) !== (side === "r") || pv(p) < 300) continue;
        if (attackedByReal(b, f, r, opp) && !attackedByReal(b, f, r, side)) out.push({ f, r, p });
      }
      return out;
    };
    const hb = hangsOf(board), ha = hangsOf(afterBoard());
    const resolved = hb.filter(h => !ha.some(x => x.f === h.f && x.r === h.r));
    if (resolved.length) {
      if (resolved.some(h => h.f === mv[0] && h.r === mv[1])) intent.escape = true;
      else { intent.rescue = true; intent.rescueName = NAME_OF[resolved[0].p]; }
    }
    // 应将（走前自己被将军）
    try { if (X.isCheck(board, side)) intent.answerCheck = true; } catch (e) {}
    // 主类型
    if (intent.check) intent.kind = "check";
    else if (intent.capture) intent.kind = intent.protectedTarget ? (intent.gain >= 0 ? "trade" : "sac") : "freeCapture";
    else if (intent.attack) intent.kind = "attack";
    else if (intent.answerCheck) intent.kind = "answerCheck";
    else if (intent.escape) intent.kind = "escape";
    else if (intent.rescue) intent.kind = "rescue";
    else if (intent.developed) intent.kind = "develop";
    return intent;
  }

  /* intent → 中文短语（「白吃中卒」「沉底将军」「捉你的无根炮」「出车占肋」） */
  function intentPhrase(intent) {
    if (!intent || !intent.to) return "藏着手段";
    const p = intent.piece, nm = NAME_OF[p] || "子";
    const side = intent.side || "r";
    const t = intent.to;
    const bottom = t[1] === (side === "r" ? 9 : 0);
    const rib = t[0] === 3 || t[0] === 5;
    const center = t[0] === 4;
    const river = t[1] === (side === "r" ? 4 : 5);
    const k = intent.kind;
    if (k === "check") return (bottom && (p === "r" || p === "c") ? "沉底" : center && p === "c" ? "镇中" : "") + "将军";
    if (k === "freeCapture") return "白吃一" + (intent.capture ? intent.capture.name : "子");
    if (k === "trade") return "兑一" + (intent.capture ? intent.capture.name : "子");
    if (k === "sac") return "贪吃一" + (intent.capture ? intent.capture.name : "子") + "反被吃回";
    if (k === "attack") return "捉你的无根" + (intent.attack ? intent.attack.name : "子");
    if (k === "answerCheck") return "应将";
    if (k === "escape") return nm + "逃出受攻";
    if (k === "rescue") return "解" + (intent.rescueName || "受攻子") + "之围";
    if (k === "develop") return "出" + nm + (rib ? "占肋" : center ? "占中" : river ? "巡河" : "");
    if (rib && p === "r") return "车占肋道";
    if (center && p === "c") return "炮镇中路";
    if (river) return nm + "巡河";
    return "调整阵型";
  }

  /* 防守类着手判定（威胁提示用）：应将 / 逃出受攻 / 解救受攻子 */
  function isDefensive(board, side, mvText) {
    const it = moveIntent(board, side, mvText);
    return !!(it.answerCheck || it.escape || it.rescue);
  }

  /* ---------- 局面快照叙述（纯函数） ---------- */
  function piecesWords(d) {
    const units = [[600, "车"], [300, "炮"], [100, "士象"], [60, "兵"]];
    const out = [];
    for (const [v, n] of units) while (d >= v && out.length < 3) { out.push("一" + n); d -= v; }
    return out.length ? out.join("") : "少许子力";
  }

  /* positionSnapshot(board, side, redCp, prevClauses)：
   * 算子力/出子/中炮/肋道/将军/兵差 → 变化过的特征拼 1-2 句 + 一句方向建议。
   * 返回 {clauses, text}；text 只含相对 prevClauses 新出现的特征，全无变化则为 ""。 */
  function positionSnapshot(board, side, redCp, prevClauses) {
    prevClauses = prevClauses || [];
    const clauses = [];
    let mr = 0, mb = 0, pwnR = 0, pwnB = 0, devR = 0, devB = 0;
    let centerR = false, centerB = false, ribR = false, ribB = false;
    for (let r = 0; r < 10; r++) for (let f = 0; f < 9; f++) {
      const p = board[r][f];
      if (!p) continue;
      const red = p === p.toUpperCase();
      const pt = p.toLowerCase();
      if (red) mr += pv(p); else mb += pv(p);
      if (pt === "p") { if (red) pwnR++; else pwnB++; }
      if (pt === "r" || pt === "n" || pt === "c") {
        if (!homeSquares(pt, red ? "r" : "b").some(([hf, hr]) => hf === f && hr === r)) {
          if (red) devR++; else devB++;
        }
        if (pt === "c" && f === 4) { if (red) centerR = true; else centerB = true; }
        if (pt === "r" && (f === 3 || f === 5)) { if (red) ribR = true; else ribB = true; }
      }
    }
    const diff = mr - mb;
    if (Math.abs(diff) >= 100) clauses.push((diff > 0 ? "红方" : "黑方") + "净多" + piecesWords(Math.abs(diff)));
    if (pwnR !== pwnB) clauses.push((pwnR > pwnB ? "红方" : "黑方") + "多" + Math.abs(pwnR - pwnB) + "兵");
    if (devR >= 5 && devB >= 5) clauses.push("双方强子尽出");
    else {
      if (devR <= 2) clauses.push("红方出子迟缓");
      if (devB <= 2) clauses.push("黑方出子迟缓");
    }
    if (centerR) clauses.push("红方中炮镇中路");
    if (centerB) clauses.push("黑方中炮镇中路");
    if (ribR) clauses.push("红方车占肋道");
    if (ribB) clauses.push("黑方车占肋道");
    try {
      if (X.isCheck(board, "r")) clauses.push("红方被将军");
      if (X.isCheck(board, "b")) clauses.push("黑方被将军");
    } catch (e) {}
    const changed = clauses.filter(c => prevClauses.indexOf(c) < 0);
    const myDev = side === "r" ? devR : devB;
    const myCenter = side === "r" ? centerR : centerB;
    const myDiff = side === "r" ? diff : -diff;
    let advice;
    if (redCp !== null && redCp !== undefined && Math.abs(redCp) >= MATE) advice = "抓住机会入局，别给对方喘息";
    else if (myDiff <= -200) advice = "少子先稳住阵脚，把战线缩短再图反击";
    else if (!myCenter) advice = "争取炮镇中路，车抢肋道";
    else if (myDev < 4) advice = "强子先到位，再谈决战";
    else advice = "保持主动，把战火引向对方的弱侧";
    const text = changed.length ? changed.join("，") + "。" + advice + "。" : "";
    return { clauses, text };
  }

  /* 兜底句式池（顺序轮换，同一句式一局内不连续出现两次） */
  const WHY_POOL = [
    "这手没找到局面的主战场——{best}才是当前的急所",
    "先手不能丢，{best}才是这局该抢的方向",
    "子力没到位就开战，先回本阵：{best}把阵型先补齐",
    "这手脱离了我们原来的作战计划，回到{best}的路上来",
    "棋要朝着对方的空当下，{best}就是冲着他的弱点去的",
    "这手没有目的性——看看{best}，那才是这局面该干的事"
  ];
  function nextWhy(bestCn) {
    st.whyIdx = (st.whyIdx + 1) % WHY_POOL.length;
    return WHY_POOL[st.whyIdx].replace(/\{best\}/g, bestCn);
  }

  /* ---------- 谱数据（show() 时懒加载，失败静默降级为纯引擎模式；并发调用共享同一请求） ---------- */
  let bookList = null;     // [{meta, data}]
  let bookPromise = null;

  function loadBook() {
    if (!bookPromise) {
      bookPromise = (async () => {
        try {
          const idx = await fetch("data/openings/index.json").then(r => r.json());
          const list = await Promise.all(idx.systems.map(meta =>
            fetch(meta.file).then(r => r.json()).then(data => ({ meta, data })).catch(() => null)
          ));
          bookList = list.filter(Boolean);
        } catch (e) {
          bookList = null;
        }
      })();
    }
    return bookPromise;
  }

  /* ---------- 全局状态 ---------- */
  let board = null;
  let els = {};
  let st = null;

  function newState() {
    const { board: b, side } = X.parseFen(START_FEN);
    return {
      board: b, side,
      moves: [],            // [{m, cn, side, chk}]
      rep: [{ key: X.boardToFen(b, side), check: false, side: null }],
      mySide: "r",
      level: 2,             // 默认业3
      status: "idle",       // idle | playing | finished
      thinking: false,
      browsing: null,
      result: null,
      token: 0,             // 异步会话令牌：防僵尸回调（hide()/新阶段时失效）
      // 私教
      book: { cands: [] },  // 候选体系集合 {cands:[{sys,node}]}，收窄到唯一即识别成功
      offBook: false,
      arrow: null,          // 私教推荐指引箭头 {from:[f,r], to:[f,r]}
      lastRedCp: null,      // 最近一次引擎评分（红方视角）
      praises: 0,           // 鼓励次数上限 2
      tipIdx: 0,
      worstMine: null,      // {cn, loss} 学员最损一手
      worstOpp: null,       // {cn, loss} 对手最损一手
      snapClauses: [],      // 上次局面快照已报过的特征（只报变化）
      whyIdx: 0             // 兜底句式池轮换指针
    };
  }

  function mount(container) {
    container.innerHTML = `
      <div class="play-options">
        <label>我执 <select id="sp-side">
          <option value="r">红（先手）</option>
          <option value="b">黑（后手）</option>
        </select></label>
        <label>对手 <select id="sp-level">
          ${LEVELS.map((l, i) => `<option value="${i}" ${i === 2 ? "selected" : ""}>${l.name}</option>`).join("")}
        </select></label>
        <button id="sp-start" class="primary">开始对练</button>
        <button id="sp-reco" title="主动请求私教指路（棋盘会画出指引线）">💡 私教推荐</button>
        <span id="sp-note" class="dim"></span>
      </div>
      <div id="sp-desc" class="pl-desc"></div>
      <div class="spar-main">
        <div class="play-board-col">
          <div id="spar-top" class="spar-top"></div>
          <canvas id="spar-board"></canvas>
          <div class="evalbar" id="spar-evalbar"><div id="spar-evalfill"></div><span id="spar-evaltext"></span></div>
          <div id="spar-status" class="pl-status">点击「开始对练」，私教全程陪你下这一盘。</div>
        </div>
        <div class="spar-side">
          <div id="spar-label" class="spar-label">📌 自由对局</div>
          <div id="spar-chat" class="spar-chat"></div>
          <div id="spar-moves" class="movelist"></div>
          <div class="play-btns">
            <button id="sp-undo">悔棋</button>
            <button id="sp-resign">认输</button>
            <button id="sp-flip">⇅ 翻转</button>
            <button id="sp-restart">新对局</button>
          </div>
        </div>
      </div>`;
    els = {
      side: container.querySelector("#sp-side"),
      level: container.querySelector("#sp-level"),
      start: container.querySelector("#sp-start"),
      reco: container.querySelector("#sp-reco"),
      note: container.querySelector("#sp-note"),
      desc: container.querySelector("#sp-desc"),
      top: container.querySelector("#spar-top"),
      status: container.querySelector("#spar-status"),
      chat: container.querySelector("#spar-chat"),
      label: container.querySelector("#spar-label"),
      moves: container.querySelector("#spar-moves"),
      undo: container.querySelector("#sp-undo"),
      resign: container.querySelector("#sp-resign"),
      flip: container.querySelector("#sp-flip"),
      restart: container.querySelector("#sp-restart"),
      evalfill: container.querySelector("#spar-evalfill"),
      evaltext: container.querySelector("#spar-evaltext")
    };
    board = Board.create(container.querySelector("#spar-board"), {
      onMove: onHumanMove,
      onIllegal: () => Sound.play("illegal")
    });
    els.start.onclick = startGame;
    els.restart.onclick = startGame;
    els.undo.onclick = undo;
    els.resign.onclick = () => { if (st && st.status === "playing") finish("loss", "认输"); };
    els.flip.onclick = () => board.flip();
    els.reco.onclick = onRecommend;
    els.level.onchange = updateLevelInfo;
    st = newState();
    updateLevelInfo();
    refresh();
  }

  function updateLevelInfo() {
    const lvl = LEVELS[Number(els.level.value)];
    let w = 0, l = 0, d = 0;
    for (const g of (window.Games ? Games.all() : [])) {
      if (g.levelName !== lvl.name) continue;
      const ur = Games.userResult ? Games.userResult(g) : g.result;
      if (ur === "win") w++; else if (ur === "loss") l++; else if (ur === "draw") d++;
    }
    const record = (w + l + d) ? `你对该对手战绩：${w}胜${d}和${l}负` : "与该对手尚未交手";
    els.desc.textContent = "🎓 私教全程陪练 · " + lvl.desc + "　·　" + record;
  }

  /* ---------- 气泡 ---------- */
  function bubble(text, role) {
    if (!els.chat) return;
    const div = document.createElement("div");
    div.className = "sp-bub " + (role === "label" ? "sp-label-b" : "sp-coach");
    div.textContent = (role === "label" ? "📌 " : "🎓 ") + text;
    els.chat.appendChild(div);
    els.chat.scrollTop = els.chat.scrollHeight;
    Sound.play("click");
  }
  function coachSay(text) { bubble(text, "coach"); }
  function setLabel(text, announce) {
    els.label.textContent = "📌 " + text;
    if (announce) bubble(text, "label");
  }
  function labelText() {
    const n = st.book ? st.book.cands.length : 0;
    if (n === 1) return "开局·" + st.book.cands[0].sys.meta.name + "（" + st.book.cands[0].sys.meta.level + "）";
    if (n > 1) return "开局·待对手应法定体系";
    if (st.offBook) return "已脱谱·引擎模式";
    return "自由对局·引擎模式";
  }
  function pickTip() {
    const t = TIPS[st.tipIdx % TIPS.length];
    st.tipIdx++;
    return t;
  }

  /* ---------- 对局流程 ---------- */
  async function startGame() {
    await loadBook();   // 谱是懒加载：开局前确保就位（加载失败静默降级为纯引擎模式）
    st = newState();
    st.mySide = els.side.value;
    st.level = Number(els.level.value);
    st.status = "playing";
    st.whyIdx = Math.floor(Math.random() * WHY_POOL.length);   // 兜底句式从随机槽位开始轮换
    els.chat.innerHTML = "";
    setLabel(labelText(), false);
    coachSay("好，这盘你执" + (st.mySide === "r" ? "红先行" : "黑后走") + "，对手是「" + LEVELS[st.level].name + "」。落子无悔，我在旁边看着你走。");
    refresh();
    if (st.side !== st.mySide) engineTurn();
  }

  function onHumanMove(f0, r0, f1, r1) {
    if (!st || st.status !== "playing" || st.thinking) return;
    if (st.side !== st.mySide) return;
    const mv = [f0, r0, f1, r1];
    if (!X.isLegal(st.board, st.side, mv)) { Sound.play("illegal"); return; }
    const preBoard = X.cloneBoard(st.board);
    const preSide = st.side;
    const preRedCp = st.lastRedCp;
    applyMove(mv);
    if (checkEnd()) return;
    afterStudentMove(preBoard, preSide, preRedCp);
  }

  /* 学员着手落地后：谱分类 → 引擎串行解析（脱谱算账 / 中局点评 / 形势刷新）→ 对手应着 */
  async function afterStudentMove(preBoard, preSide, preRedCp) {
    const node = st.moves[st.moves.length - 1];
    const beforeLabel = labelText();
    const r = classifyMove(st.book, st.offBook, node.side, node.m, st.mySide, bookList || []);
    st.book = r.book; st.offBook = r.offBook;
    handleBookEvent(r, node);
    setLabel(labelText(), labelText() !== beforeLabel);
    st.thinking = true; refresh();
    const tk = ++st.token;
    try {
      await coachReviewStudentMove(r, node, preBoard, preSide, preRedCp, tk);
    } catch (e) {}
    if (st.token !== tk) return;   // 视图已切换/令牌失效
    st.thinking = false; refresh();
    if (st.status !== "playing") return;
    engineTurn();
  }

  /* 谱事件 → 气泡（不含引擎算账类） */
  function handleBookEvent(r, node) {
    if (r.ev === "greet") {
      const sys = r.book.cands[0].sys;
      coachSay("这局走成了「" + sys.meta.name + "」（" + sys.meta.redOpening + " · 对 " + sys.meta.blackDefense + "）。" + (sys.data.intro || ""));
    } else if (r.ev === "comment") {
      const n = r.book.cands[0].node;
      coachSay("对手走了「" + n.cn + "」。" + (n.c ? n.c : "这是谱里的正着，想想它想干什么。"));
    } else if (r.ev === "dev") {
      const d = r.dev;
      coachSay("对手这手「" + d.cn + "」正是这个局面的常见变化，但有问题——" + d.why + " 惩罚思路：" + d.punish);
    } else if (r.ev === "oppOff") {
      coachSay("对手走出了谱外的新变化，我们不背谱了，转入引擎模式随机应变。");
    } else if (r.ev === "stuFree") {
      coachSay("这步不在我先前讲的开局体系里——没关系，转入引擎模式，你走一手我拆一手。");
    }
  }

  /* 学员着手引擎点评：stuOff 脱谱算账 / 脱谱后中局点评 / 谱内只刷形势 */
  async function coachReviewStudentMove(r, node, preBoard, preSide, preRedCp, tk) {
    const cn = node.cn;
    if (r.ev === "stuOff" || (st.offBook && r.ev === "none")) {
      const res = await evaluateChoice(preBoard, preSide, node.m, Engine.PRIORITY.USER);
      if (st.token !== tk || !res) {
        if (r.ev === "stuOff") coachSay("这手走出了谱——我没算清具体亏多少，但形状已经不是正变，稳住再下。");
      } else {
        const redAfter = st.mySide === "r" ? res.actualCp : -res.actualCp;
        const bestCn = safeCn(preBoard, preSide, res.bestMv);
        const lineCn = pvToCn(preBoard, preSide, res.bestLine, 4);
        if (r.ev === "stuOff") {
          const msgs = buildOffBookMsg({
            cn, loss: res.loss, bestCn, lineCn,
            tip: pickTip(),
            preDesc: preRedCp === null ? null : describeRed(preRedCp),
            postDesc: describeRed(redAfter)
          });
          msgs.forEach(coachSay);
        } else if (res.loss >= 120) {
          coachSay(buildMistakeMsg(cn, res, node, preBoard, preSide));
        } else if (res.loss < 40 && st.praises < 2 && Math.random() < 0.35) {
          st.praises++;
          coachSay("这手「" + cn + "」很准，和引擎正着一致，就这么下！");
        }
        if (!st.worstMine || res.loss > st.worstMine.loss) st.worstMine = { cn, loss: res.loss };
        st.lastRedCp = redAfter;
        updateEvalUI(redAfter);
        return;
      }
    }
    // 谱内 / 无需逐手点评：只刷新形势条与顶部评分
    if (st.token !== tk) return;
    if (Engine.ready) {
      const cp = await Engine.evalCp(X.boardToFen(st.board, st.side), 250, Engine.PRIORITY.AMBIENT);
      if (st.token !== tk || cp === null) return;
      const redCp = st.side === "r" ? cp : -cp;
      st.lastRedCp = redCp;
      updateEvalUI(redCp);
    }
  }

  /* 对手着手后引擎解析（一次 candidates 复用：形势刷新 + 送机会/真实威胁判定）。
   * oppIntent：对手这手的意图（engineTurn 在走子前算好传入），威胁句用它说清"他想干什么"。 */
  async function coachAfterOppMove(tk, oppIntent) {
    if (st.token !== tk) return;
    const node = st.moves[st.moves.length - 1];
    const prev = st.lastRedCp;
    let cands = null;
    if (Engine.ready) {
      cands = await Engine.candidates(X.boardToFen(st.board, st.side), 300, 3, Engine.PRIORITY.USER);
      if (st.token !== tk) return;
    }
    if (cands && cands.length) {
      const redCp = st.side === "r" ? cands[0].cp : -cands[0].cp;
      st.lastRedCp = redCp;
      updateEvalUI(redCp);
    }
    if (prev === null || !cands || !cands.length || st.status !== "playing") return;
    const swing = Math.round(st.lastRedCp - prev);     // 红方视角改善量
    const good = st.mySide === "r" ? swing : -swing;   // 学员视角的获益
    // 2. 对手送机会（特大最值钱的点评，必须报）
    if (good >= 150) {
      if (!st.worstOpp || good > st.worstOpp.loss) st.worstOpp = { cn: node.cn, loss: good };
      const best = cands[0];
      const bestCn = safeCn(st.board, st.side, best.mv);
      const phrase = intentPhrase(moveIntent(st.board, st.side, best.mv));
      const lineCn = pvToCn(st.board, st.side, best.line, 3);
      coachSay((good >= 300 ? "对手这手「" + node.cn + "」送了大礼（损 " + good + " 分）" :
        "对手这手「" + node.cn + "」有问题（损 " + good + " 分）") +
        "，你可以 " + bestCn + "——" + phrase + "，主线：" + lineCn + "。");
      return;
    }
    // 3. 真实威胁：我方局面恶化 ≥80 且引擎正着是防守类才开口（不报裸数字）
    if (good <= -80) {
      const b0 = cands[0] && cands[0].line && cands[0].line[0];
      let defensive = false;
      if (b0) { try { defensive = isDefensive(st.board, st.side, b0); } catch (e) {} }
      if (defensive) {
        const parts = pvToCn(st.board, st.side, cands[0].line, 3).split(" → ");
        const oppWhat = oppIntent ? intentPhrase(oppIntent) : "藏着后续手段";
        coachSay("注意，对手这手「" + node.cn + "」来者不善——他想" + oppWhat +
          "，你大概只有 " + parts[0] + (parts[1] ? "，然后他 " + parts[1] : "") + "。稳住，别让他牵着走。");
      }
    }
  }

  /* 4. 局面叙述：每 8 手至多一次，只报相对上次快照变化的特征 */
  function maybeSnapshot() {
    if (!st || st.status !== "playing" || !st.moves.length || st.moves.length % 8 !== 0) return;
    const snap = positionSnapshot(st.board, st.side, st.lastRedCp, st.snapClauses);
    st.snapClauses = snap.clauses;
    if (snap.text) coachSay(snap.text);
  }

  function safeCn(board, side, mvText) {
    try {
      const mv = X.parseMove(mvText);
      if (X.isLegal(board, side, mv)) return Notation.chinese(board, side, mv);
    } catch (e) {}
    return mvText;
  }

  /* 学员失误（loss≥120）的具体理由：按优先级找第一条成立的，兜底走句式池 */
  function buildMistakeMsg(cn, res, node, preBoard, preSide) {
    const bestCn = safeCn(preBoard, preSide, res.bestMv);
    const itB = moveIntent(preBoard, preSide, res.bestMv);
    const head = "这手「" + cn + "」损 " + res.loss + " 分（" + clsName(res.loss) + "），";
    const lineCn = pvToCn(preBoard, preSide, res.bestLine, 4);
    const tail = "，主线：" + lineCn + "。";
    const mv = X.parseMove(node.m);
    const afterBoard = X.cloneBoard(preBoard);
    X.applyMove(afterBoard, ...mv);
    const opp = X.other(preSide);
    const moverPiece = preBoard[mv[1]][mv[0]];
    // 1. 送子：走后这手移动的子被攻击且无保护（排除白脸将假阳性）
    if (attackedByReal(afterBoard, mv[2], mv[3], opp) && !attackedByReal(afterBoard, mv[2], mv[3], preSide)) {
      return head + "把" + (NAME_OF[moverPiece] || "子") + "送到了对方火力下——正着 " + bestCn +
        "（" + intentPhrase(itB) + "）不丢子也不丢先" + tail;
    }
    // 2. 被将未理
    if (X.isCheck(preBoard, preSide) && X.isCheck(afterBoard, preSide)) {
      return head + "上将不应将是大忌——先解将再说，正着是 " + bestCn + tail;
    }
    // 3. 正着是将军先手
    if (itB.check) {
      const parts = lineCn.split(" → ");
      return head + "正着 " + bestCn + " 是先手将军，他应不过来，你接着 " + (parts[1] || "扩先取势") + tail;
    }
    // 4. 正着捉子/得子
    if (itB.kind === "freeCapture" || itB.kind === "trade" || itB.kind === "attack") {
      return head + "正着 " + bestCn + "——" + intentPhrase(itB) + "，他必丢一子" + tail;
    }
    // 5. 兜底句式池（顺序轮换，不连续重复）
    return head + nextWhy(bestCn) + tail;
  }

  /* 引擎主线（内部坐标文本）→ 中文着法序列 */
  function pvToCn(board, side, line, maxPlies) {
    if (!line || !line.length) return "";
    const b = X.cloneBoard(board);
    let s = side;
    const out = [];
    const limit = Math.min(maxPlies || 4, line.length);
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

  /* loss = max(0, best.cp − actual.cp)；actual 不在候选时 cloneBoard 重放后 evalCp 取负 */
  async function evaluateChoice(board, side, moveText, priority) {
    if (!Engine.ready) return null;
    const fen = X.boardToFen(board, side);
    let cands = await Engine.candidates(fen, 350, 4, priority);
    if (!cands.length) {
      await new Promise(r => setTimeout(r, 200));
      cands = await Engine.candidates(fen, 600, 4, priority);
    }
    if (!cands.length) return null;
    const best = cands[0];
    const actual = cands.find(c => c.mv === moveText);
    let actualCp;
    if (actual) actualCp = actual.cp;
    else {
      const b2 = X.cloneBoard(board);
      try { X.applyMove(b2, ...X.parseMove(moveText)); } catch (e) { return null; }
      const e = await Engine.evalCp(X.boardToFen(b2, X.other(side)), 250, priority);
      if (e === null) return null;
      actualCp = -e;
    }
    return {
      loss: Math.round(Math.max(0, best.cp - actualCp)),
      bestMv: best.mv,
      bestLine: best.line || [best.mv],
      bestCp: best.cp,
      actualCp
    };
  }

  function applyMove(mv) {
    const cn = Notation.chinese(st.board, st.side, mv);
    const mover = st.side;
    const captured = X.applyMove(st.board, ...mv);
    const gaveCheck = X.isCheck(st.board, X.other(st.side));
    const mate = X.isCheckmate(st.board, X.other(st.side));
    st.moves.push({ m: X.moveToText(mv), cn, side: mover, chk: gaveCheck });
    if (mate) Sound.play("check");
    else if (gaveCheck) Sound.play("check");
    else if (captured) Sound.play("capture");
    else Sound.play("move");
    st.side = X.other(st.side);
    st.rep.push({ key: X.boardToFen(st.board, st.side), check: gaveCheck, side: mover });
    st.browsing = null;
    st.arrow = null;   // 指引箭头只保持到学员走子
  }

  function checkEnd() {
    const rep = X.repetitionResult(st.rep);
    if (rep) {
      if (rep.result === "draw") finish("draw", "三次重复局面，不变作和");
      else finish(rep.side === st.mySide ? "loss" : "win", (rep.side === "r" ? "红方" : "黑方") + "长将判负");
      return true;
    }
    const legal = X.legalMoves(st.board, st.side);
    if (legal.length > 0) { refresh(); return false; }
    const loser = st.side;
    if (X.isCheck(st.board, st.side)) {
      finish(loser === st.mySide ? "loss" : "win", loser === "r" ? "红方被将死" : "黑方被将死");
    } else {
      finish(loser === st.mySide ? "loss" : "win", "困毙（无子可动）判负");
    }
    return true;
  }

  function finish(result, reason) {
    st.status = "finished";
    st.thinking = false;
    st.arrow = null;
    st.token++;   // 使在途异步点评失效
    st.result = { result, reason };
    Sound.play(result === "win" ? "check" : result === "draw" ? "draw" : "illegal");
    // result 统一为用户视角；winner 为红黑视角（字段约定见 games.js）
    const winner = result === "draw" ? "draw" : result === "win" ? st.mySide : X.other(st.mySide);
    const who = result === "draw" ? "和棋" : result === "win" ? "你赢了" : "你输了";
    let summary = "这盘" + who + "（" + reason + "）。";
    if (st.worstMine && st.worstMine.loss >= 120) {
      summary += "你最损的一手是「" + st.worstMine.cn + "」（损 " + st.worstMine.loss + " 分），下次走前先默念一句口诀。";
    } else {
      summary += "这盘你没有明显亏着，输贏之外，棋是合格的。";
    }
    if (st.worstOpp && st.worstOpp.loss >= 120) {
      summary += "对手最损的一手是「" + st.worstOpp.cn + "」，送了你约 " + st.worstOpp.loss + " 分。";
    }
    coachSay(summary);
    if (st.moves.length) {
      Games.add({
        ts: Date.now(),
        level: st.level,
        levelName: LEVELS[st.level].name,
        mySide: st.mySide,
        winner, result, reason,
        moves: st.moves.map(m => ({ m: m.m, cn: m.cn }))
      });
    }
    refresh();
  }

  /* ---------- 对手应着（引擎串行：此刻引擎必然空闲） ---------- */
  async function engineTurn() {
    if (st.status !== "playing") return;
    st.thinking = true;
    els.status.textContent = "电脑思考中…";
    refresh();
    const tk = ++st.token;
    try {
      const lvl = LEVELS[st.level];
      let mvText = null;
      if (lvl.pick === "randomLegal") {
        const legal = X.legalMoves(st.board, st.side);
        mvText = X.moveToText(legal[Math.floor(Math.random() * legal.length)]);
        await new Promise(r => setTimeout(r, 350));
      } else {
        mvText = bookMove(lvl);
        if (!mvText) {
          const cands = await Engine.candidates(X.boardToFen(st.board, st.side), lvl.time, lvl.pv || 4, Engine.PRIORITY.PLAY);
          if (!cands.length) throw new Error("no candidates");
          mvText = pickMove(cands, lvl);
        }
      }
      if (st.token !== tk || st.status !== "playing") return;
      let oppIntent = null;
      try { oppIntent = moveIntent(st.board, st.side, mvText); } catch (e) {}
      applyMove(X.parseMove(mvText));
      if (checkEnd()) return;
      // 谱分类 + 私教点评（引擎已空闲，可立即发起解析）
      const node = st.moves[st.moves.length - 1];
      const beforeLabel = labelText();
      const r = classifyMove(st.book, st.offBook, node.side, node.m, st.mySide, bookList || []);
      st.book = r.book; st.offBook = r.offBook;
      handleBookEvent(r, node);
      setLabel(labelText(), labelText() !== beforeLabel);
      await coachAfterOppMove(tk, oppIntent);
      maybeSnapshot();
    } catch (e) {
      if (st.token === tk) els.status.textContent = "引擎出错：" + e.message;
    }
    if (st.token !== tk) return;
    st.thinking = false; refresh();
  }

  function bookMove(lvl) {
    if (!lvl.book || Math.random() > lvl.book) return null;
    const list = BOOK[st.moves.map(m => m.m).join(" ")];
    if (!list) return null;
    const legal = X.legalMoves(st.board, st.side).map(mv => X.moveToText(mv));
    const ok = list.filter(mv => legal.indexOf(mv) >= 0);
    return ok.length ? ok[Math.floor(Math.random() * ok.length)] : null;
  }

  function pickMove(cands, lvl) {
    if (lvl.pick === "best") return cands[0].mv;
    if (lvl.rand && st && st.board && Math.random() < lvl.rand) {
      const legal = X.legalMoves(st.board, st.side);
      return X.moveToText(legal[Math.floor(Math.random() * legal.length)]);
    }
    const n = Math.min(cands.length, lvl.ranks.length);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += lvl.ranks[i];
    let r = Math.random() * sum;
    for (let i = 0; i < n; i++) {
      r -= lvl.ranks[i];
      if (r <= 0) return cands[i].mv;
    }
    return cands[0].mv;
  }

  /* ---------- 💡 私教推荐（学员主动按下才泄露，未点击不发请求） ---------- */
  function canRecommend() {
    return !!(st && st.status === "playing" && !st.thinking &&
      st.side === st.mySide && st.browsing === null && Engine.ready);
  }

  async function onRecommend() {
    if (!canRecommend()) return;
    Sound.play("click");
    st.thinking = true; refresh();
    const tk = ++st.token;
    try {
      const fen = X.boardToFen(st.board, st.side);
      const cands = await Engine.candidates(fen, 400, 1, Engine.PRIORITY.USER);
      if (st.token !== tk) return;
      const best = cands && cands[0];
      let mv = null;
      try { if (best) mv = X.parseMove(best.mv); } catch (e) {}
      if (!best || !mv || !X.isLegal(st.board, st.side, mv)) {
        coachSay("引擎这步还没算清，凭你的第一感觉走吧。");
        return;
      }
      st.arrow = { from: [mv[0], mv[1]], to: [mv[2], mv[3]] };
      const bestCn = Notation.chinese(st.board, st.side, mv);
      const lineCn = pvToCn(st.board, st.side, best.line, 4);
      const redCp = st.side === "r" ? best.cp : -best.cp;
      coachSay("私教推荐：" + bestCn + "（" + fmtEvalRed(redCp) + "）。思路：" + (lineCn || "按棋盘上的指引线走"));
      refresh();
    } finally {
      if (st.token === tk) { st.thinking = false; refresh(); }
    }
  }

  /* ---------- 悔棋 / 重放 ---------- */
  function undo() {
    if (!st || st.status !== "playing" || st.thinking || !st.moves.length) return;
    let pop = (st.moves[st.moves.length - 1].side !== st.mySide) ? 2 : 1;
    while (pop-- > 0 && st.moves.length) st.moves.pop();
    replayFromMoves();
    // 谱匹配状态按重放后的序列重算
    const r = replayBook(bookList || [], st.moves.map(m => m.m), st.mySide);
    st.book = r.book; st.offBook = r.offBook;
    st.browsing = null;
    setLabel(labelText(), false);
    coachSay("悔棋至第 " + st.moves.length + " 手，前面的讲解不算数——我们按新的变化重来。");
    refresh();
  }

  function replayFromMoves() {
    const { board: b, side } = X.parseFen(START_FEN);
    st.board = b;
    st.side = side;
    st.arrow = null;
    st.rep = [{ key: X.boardToFen(b, side), check: false, side: null }];
    for (const node of st.moves) {
      const mover = st.side;
      X.applyMove(st.board, ...X.parseMove(node.m));
      st.side = X.other(st.side);
      st.rep.push({ key: X.boardToFen(st.board, st.side), check: !!node.chk, side: mover });
    }
  }

  /* ---------- 形势条 / 顶部评分 ---------- */
  function updateEvalUI(redCp) {
    const mine = st.mySide === "r" ? redCp : -redCp;
    const pct = Math.max(4, Math.min(96, 50 + mine / 12));
    els.evalfill.style.width = pct + "%";
    els.evalfill.style.background = mine >= 0 ? "#d4a03c" : "#666";
    els.evaltext.textContent = (mine >= 0 ? "优 " : "劣 ") + Math.abs(Math.round(mine)) + "分";
    els.top.textContent = "引擎：" + (Engine.ready ? "就绪" : "不可用") + " · 局面：" + describeRed(redCp) + "（" + fmtEvalRed(redCp) + "）";
  }

  function refresh() {
    if (!board) return;
    const view = boardStateForView();
    board.update({
      board: view.board, turn: view.side,
      lastMove: view.lastMove,
      arrow: st.browsing === null ? st.arrow : null,
      interactive: st.status === "playing" && !st.thinking && view.side === st.mySide && st.browsing === null
    });
    renderMoves();
    els.undo.disabled = st.status !== "playing" || st.thinking || !st.moves.length;
    els.resign.disabled = st.status !== "playing";
    els.restart.disabled = false;
    els.reco.disabled = !canRecommend();
    if (st.status === "playing" && !st.thinking && st.browsing === null) {
      els.status.textContent = st.moves.length === 0 && st.side !== st.mySide
        ? "电脑先行。"
        : "轮到你走棋。";
    }
  }

  function boardStateForView() {
    if (st.browsing === null) {
      const last = st.moves.length ? X.parseMove(st.moves[st.moves.length - 1].m) : null;
      return { board: st.board, side: st.side, lastMove: last };
    }
    const { board: b, side } = X.parseFen(START_FEN);
    let s = side;
    let last = null;
    for (let i = 0; i < st.browsing; i++) {
      last = X.parseMove(st.moves[i].m);
      X.applyMove(b, ...last);
      s = X.other(s);
    }
    return { board: b, side: s, lastMove: last };
  }

  function renderMoves() {
    const box = els.moves;
    box.innerHTML = "";
    st.moves.forEach((node, i) => {
      if (node.side === "r") {
        const num = document.createElement("span");
        num.className = "mvnum";
        num.textContent = (Math.floor(i / 2) + 1) + ".";
        box.appendChild(num);
      }
      const span = document.createElement("span");
      span.className = "mv" + (st.browsing === i + 1 ? " cur" : "");
      span.textContent = node.cn;
      span.onclick = () => { st.browsing = i + 1; refresh(); };
      box.appendChild(span);
    });
    const cur = box.querySelector(".cur");
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }

  window.Spar = {
    mount,
    show() {
      // hide() 会失效所有在途回调，若切走时正在思考/点评，返回后会卡在 thinking 锁上。
      // 恢复策略：清锁并续上流程——该谁走谁走（对手在走则重新发起应着）。
      if (st && st.status === "playing" && st.thinking) {
        st.token++;          // 再失效一次：迟到的旧回调不得与恢复流程并发
        st.thinking = false;
        refresh();
        if (st.side !== st.mySide) engineTurn();
      }
      refresh();
      updateLevelInfo();
      els.note.textContent = Engine.ready ? "" : "（引擎不可用：私教无法实时解析）";
      els.top.textContent = "引擎：" + (Engine.ready ? "就绪" : "不可用") + " · 局面：—";
      loadBook();
    },
    hide() {
      if (st) st.token++;   // 失效所有在途异步回调（本视图无定时器）
    }
  };

  /* 私教/调试：纯函数与内部状态取口（tests 用） */
  window.SparDebug = {
    get fen() { return st && st.board ? X.boardToFen(st.board, st.side) : null; },
    get state() { return st; },
    describeRed, fmtEvalRed, clsName,
    classifyMove, replayBook, buildOffBookMsg, findChild,
    moveIntent, intentPhrase, isDefensive, positionSnapshot,
    get levels() { return LEVELS; },
    get tips() { return TIPS; }
  };
})();
