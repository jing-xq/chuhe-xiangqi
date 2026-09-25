/* 新手核心课程路线生成器（规划 6.4 / 6.5 / 2.0-C）。
 *   node tools/build_route.js          生成 data/core/route.json
 * 内容原则：所有局面由「基础 FEN + 着法序列」经规则引擎推导并校验，
 *   - 每课：目标 / 演示（带解说）/ 3 道练习 / 1 道独立验收
 *   - 每道练习：任务、可验证的正确解（accept，可多解）、三级提示、解析、能力标签
 *   - 校验：FEN 可解析、演示着法合法、每道题的 accept 全部合法且至少存在一个
 *           非正确解的合法着（干扰项），保证「非目标着法不能误通关」可成立。
 * 着法一律来自规则引擎校验，讲解文字可改、着法不可改（与 build_openings 同则）。 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.dirname(__dirname);
const sandbox = { console, Math };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "js/rules.js"), "utf8"), sandbox, { filename: "rules.js" });
const X = sandbox.window.Xiangqi;

const INIT = X.INIT_FEN;

/* ---------- 小工具 ---------- */
// 从 base 局面走 moves 得到 { fen, side }
function pos(base, moves) {
  const { board, side } = X.parseFen(base);
  let s = side;
  for (const m of moves || []) {
    const mv = X.parseMove(m);
    if (!X.isLegal(board, s, mv)) throw new Error("非法着法 " + m + " @ " + X.boardToFen(board, s));
    X.applyMove(board, ...mv);
    s = X.other(s);
  }
  return { fen: X.boardToFen(board, s), side: s, board };
}
// 中文记谱（走前局面）
function cn(base, moves, m) {
  const { board, side } = pos(base, moves);
  return NotationOf(board, side, m);
}
let NotationImpl = null;
function NotationOf(board, side, m) {
  if (!NotationImpl) {
    const sb = { console, Math, window: {} };
    sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js/rules.js"), "utf8"), sb, { filename: "rules.js" });
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js/notation.js"), "utf8"), sb, { filename: "notation.js" });
    NotationImpl = sb.window.Notation;
  }
  return NotationImpl.chinese(board, side, X.parseMove(m));
}

let errors = [];
function need(cond, msg) { if (!cond) errors.push(msg); }

/* ---------- 课程内容 ---------- */
// demo/exercise 的局面 = pos(base, pre)；accept 为着法坐标集合
const STAGES = [
  { id: "s1", name: "认识规则", goal: "能分辨合法和非法走法" },
  { id: "s2", name: "保护将帅", goal: "能找到基本应将方案" },
  { id: "s3", name: "看住棋子", goal: "减少一步直接丢大子" },
  { id: "s4", name: "基础战术", goal: "在陌生局面识别简单机会" },
  { id: "s5", name: "开局原则", goal: "能解释走法目的" },
  { id: "s6", name: "第一盘完整对局", goal: "能下完并理解一个关键错误" }
];

const L = [];
function lesson(def) { L.push(def); }

/* ===== 阶段一：认识规则 ===== */
lesson({
  id: "s1l1", stage: "s1", title: "马腿：往哪儿跳得动", minutes: 6, abilities: ["马腿"],
  goal: "判断马被别腿时还能往哪个方向跳",
  explain: "马走「日」字：先沿直线走一格，再斜走一格。直线那一格若有棋子（不管是自己的还是对方的），就叫「别马腿」，这个方向整体作废。\n看马好不好走，先看它四个直格方向有没有子。",
  demo: {
    base: "4k4/9/9/9/9/9/9/9/p8/N2K5 w", pre: [],
    line: [{ m: "a0c1", note: "黑卒在 a1 别住了朝上跳的马腿——马只能往右跳。" }]
  },
  exercises: [
    { task: "黑卒别住了马腿，走出红马唯一能跳的一步。", base: "4k4/9/9/9/9/9/9/9/p8/N2K5 w", pre: [],
      accept: ["a0c1"], ability: "马腿",
      hints: ["先找马腿：马往上跳要经过哪一格？那一格有子吗？", "往上跳的马腿被黑卒占了。", "往右跳：先横一格、再斜一格，落点是 c1。"],
      explain: "a1 有黑卒，朝上跳（落 b2）的马腿被别住；朝右跳（落 c1）的马腿 b0 是空的，所以只有 a0c1 可走。" }
  ],
  acceptance: { task: "新的局面：黑卒换了位置，再找出红马能跳的方向。", base: "3k5/9/9/9/9/9/9/9/7p1/4K3N w",
    accept: ["i0h2"], ability: "马腿",
    explain: "黑卒在 h1，马朝左跳（落 g1）的马腿 h0 被占；朝上跳（落 h2）的马腿 i1 是空的，i0h2 可走。" }
});

lesson({
  id: "s1l2", stage: "s1", title: "象眼：田字中间有子就走不了", minutes: 6, abilities: ["象眼"],
  goal: "判断象的哪个方向被塞了象眼、哪些方向合法",
  explain: "相（象）走「田」：斜着走两格，且不能过河。「田」字的正中心那个点叫「象眼」——象眼里有任何一个子，这个方向就走不了。\n红相永远留在河界这一边（底线到第 5 线）。",
  demo: {
    base: "3k5/9/9/9/9/9/9/9/3p5/2B1K4 w", pre: [],
    line: [{ m: "c0a2", note: "黑兵塞住了向右走（落 e2）的象眼，相只能往左走。" }]
  },
  exercises: [
    { task: "黑兵塞住了向右的象眼，走出相唯一能走的一步。", base: "3k5/9/9/9/9/9/9/9/3p5/2B1K4 w", pre: [],
      accept: ["c0a2"], ability: "象眼",
      hints: ["相有两个方向：左上 a2、右上 e2。", "检查每个方向「田」字中心的象眼。", "d1 有黑兵，右上的象眼被塞，走左上。"],
      explain: "c0→e2 的象眼 d1 被黑兵塞住；c0→a2 的象眼 b1 是空的，c0a2 合法。" },
    { task: "这次黑兵换了边——走出相能走的那步。", base: "3k5/9/9/9/9/9/9/9/1p7/2B1K4 w", pre: [],
      accept: ["c0e2"], ability: "象眼",
      hints: ["两个方向的象眼分别是 b1 和 d1。", "b1 被黑兵塞住了。", "往右走，落点 e2。"],
      explain: "左上方向象眼 b1 被塞，右上方向象眼 d1 是空的，c0e2 合法。" },
    { task: "相已经到了河沿——记住红相不能过河，走出一步合法的着法。", base: "3k5/9/9/9/9/2B6/9/9/9/4K4 w", pre: [],
      accept: ["c4a2", "c4e2"], ability: "象眼",
      hints: ["先看哪几个「田」字会过河。", "往前的两个方向（a6、e6）都越过河界了，违法。", "往回走：a2 或 e2 都行。"],
      explain: "相不能过河，朝前（a6/e6）违法；c4a2 与 c4e2 都在本方半场且象眼通畅。" }
  ],
  acceptance: { task: "象眼＋河界一起考虑：走出相的唯一合法着法。", base: "3k5/9/9/9/9/2B6/1p7/9/9/4K4 w",
    accept: ["c4e2"], ability: "象眼",
    explain: "朝前的两个方向过河违法；往左（a2）的象眼 b3 被黑兵塞住；只剩 c4e2。" }
});

lesson({
  id: "s1l3", stage: "s1", title: "炮架：隔一个子才能吃", minutes: 7, abilities: ["炮架"],
  goal: "找到正确的炮架，吃对目标",
  explain: "炮平时走路和车一样；但吃子时必须隔着恰好一个棋子（「炮架」），并且只能吃隔完之后的第一个子。\n所以炮吃子要回答两个问题：架子在哪？隔完之后第一个是谁？",
  demo: {
    base: "3kn4/9/9/9/9/9/9/4A4/4C4/4K4 w", pre: [],
    line: [{ m: "e1e9", note: "红仕是现成的炮架，隔着一个子正好吃掉黑马。" }]
  },
  exercises: [
    { task: "用炮隔着红仕吃掉黑方的马。", base: "3kn4/9/9/9/9/9/9/4A4/4C4/4K4 w", pre: [],
      accept: ["e1e9"], ability: "炮架",
      hints: ["炮和黑马在同一条直线上吗？", "中间的红仕就是炮架。", "e1 的炮沿这条线吃 e9 的马。"],
      explain: "炮与黑马同线，中间恰好一个子（红仕），炮可以越过仕吃掉马。" },
    { task: "线上有两个黑子——炮只能吃「隔一个子之后的第一个」。吃掉能吃的那个。", base: "3kn4/9/9/9/4p4/9/9/4A4/4C4/4K4 w", pre: [],
      accept: ["e1e5"], ability: "炮架",
      hints: ["数一数：隔开仕之后，先碰到的是哪个子？", "e5 的卒在马前面。", "吃 e5 的卒，e9 的马隔着两个子吃不到。"],
      explain: "以仕为架，越过之后第一个子是 e5 的卒——只能吃它；黑马隔了两个子，不符合「恰好一个架」。" },
    { task: "黑车躲在黑卒后面——用炮隔卒吃车。", base: "r2k5/9/9/9/p8/9/9/9/9/C3K4 w", pre: [],
      accept: ["a0a9"], ability: "炮架",
      hints: ["炮和车在同一条竖线上。", "a5 的黑卒可以当炮架。", "a0 的炮隔卒吃 a9 的车。"],
      explain: "a5 卒是炮架，a0a9 隔一个子吃到车；直接吃卒反而没有架子（卒是第一个子），不成立。" }
  ],
  acceptance: { task: "综合：找到炮架，吃掉 b9 的黑车。", base: "1r2k4/9/9/9/9/9/9/1p7/9/1C1K5 w",
    accept: ["b0b9"], ability: "炮架",
    explain: "b2 的黑卒是现成的炮架，b0b9 隔卒吃车。帅在九宫内注意别乱动。" }
});

lesson({
  id: "s1l4", stage: "s1", title: "兵：过河才能横着走", minutes: 6, abilities: ["兵"],
  goal: "掌握兵「只进不退、过河横移」的规律",
  explain: "兵（卒）只能向前走一格，永远不能后退；过河之后，额外获得左右平移一格的能力。\n过河的兵价值大增——它是离敌将最近的攻击力量。",
  demo: {
    base: "4k4/9/9/9/4P4/9/9/9/9/3K5 w", pre: [],
    line: [{ m: "e5d5", note: "这个兵已经过河——它可以选择横移。" }]
  },
  exercises: [
    { task: "红兵还没过河——走出它唯一的一招。", base: "3k5/9/9/9/9/9/9/6P2/9/4K4 w", pre: [],
      accept: ["g2g3"], ability: "兵",
      hints: ["没过河的兵会横移吗？", "只能向前。", "往前平推一格。"],
      explain: "未过河的兵只能向前走一格。" },
    { task: "过河兵学横移：吃掉旁边的黑马。", base: "4k4/9/9/9/3nP4/9/9/9/9/3K5 w", pre: [],
      accept: ["e5d5"], ability: "兵",
      hints: ["这个兵过河了吗？", "过河兵可以左右平移吃子。", "e5d5，横着吃掉黑马。"],
      explain: "兵在 e5 已过河，d5 是相邻格且有黑马——横移吃掉。" },
    { task: "把兵再往黑方的城下推进一步。", base: "3k5/9/9/4P4/9/9/9/9/9/4K4 w", pre: [],
      accept: ["e6e7"], ability: "兵",
      hints: ["兵的正面是哪个方向？", "向前一格。", "e6e7。"],
      explain: "e6e7 把兵推到九宫门口，下一步就能参与攻击。" }
  ],
  acceptance: { task: "换一个方向：用横移吃掉黑马。", base: "4k4/9/9/9/3Pn4/9/9/9/9/3K5 w",
    accept: ["d5e5"], ability: "兵",
    explain: "兵在 d5 已过河，e5 有黑马，d5e5 横移吃掉。注意兵永远不能后退。" }
});

lesson({
  id: "s1l5", stage: "s1", title: "九宫与照面", minutes: 6, abilities: ["九宫", "照面"],
  goal: "记住帅士的活动范围，理解将帅照面禁着",
  explain: "帅（将）和仕（士）只能在九宫里活动：九宫是底线中央的三列格子。\n双方将帅同在一条竖线上、中间又没有子隔开，叫「照面」——任何一方都不允许走出照面。",
  demo: {
    base: "4k4/9/9/9/4P4/9/9/9/4A4/4K4 w", pre: [],
    line: [{ m: "e5e6", note: "红兵一直挡在帅前面——两将不照面，这步合法。" }]
  },
  exercises: [
    { task: "两将正对着！把帅平到四路（左边），避开照面。", base: "4k4/9/9/9/9/9/9/9/9/4K4 w", pre: [],
      accept: ["e0d0"], ability: "照面",
      hints: ["往上走会怎样？", "上下走都还在照面线上。", "e0d0，往左平一步。"],
      explain: "帅往左右平移离开中线，照面解除；往上走仍是照面，软件会拒绝。" },
    { task: "把帅从底线走到九宫的中心。", base: "3k5/9/9/9/9/9/9/9/9/4K4 w", pre: [],
      accept: ["e0e1"], ability: "九宫",
      hints: ["九宫中心是哪一格？", "帅每次走一格。", "e0e1。"],
      explain: "e1 是九宫的中心，帅一步即可到达。" },
    { task: "把仕走到九宫中心（花心）。", base: "3k5/9/9/9/9/9/9/3A5/9/4K4 w", pre: [],
      accept: ["d2e1"], ability: "九宫",
      hints: ["仕走斜线。", "从九宫顶角斜走一格就是花心。", "d2e1。"],
      explain: "仕沿九宫斜线走，d2e1 正好落到中心。" }
  ],
  acceptance: { task: "自家炮挡在中间，两将暂时不照面——把帅平开一步继续安全。", base: "4k4/9/9/9/4C4/9/9/9/9/4K4 w",
    accept: ["e0d0", "e0f0"], ability: "照面",
    explain: "炮留在 e4 挡线，帅往左右平都安全；若把炮挪走反而会立刻照面。" }
});

/* ===== 阶段二：保护将帅 ===== */
lesson({
  id: "s2l1", stage: "s2", title: "什么是在被将军", minutes: 7, abilities: ["识别将军"],
  goal: "识别将军，并学会「吃掉进攻子」这一应将方法",
  explain: "你的帅正被对方的子攻击，就叫「被将军」。被将军必须立刻处理，只有三种办法：挪开帅、吃掉进攻的子、垫子挡住。\n第一步永远是找到「谁在将军我」。",
  demo: {
    base: "3k5/9/9/9/9/9/9/9/4r4/3RK4 w", pre: [],
    line: [{ m: "e0e1", note: "黑车贴身将军——帅直接吃掉它，这就是第二种应将。" }]
  },
  exercises: [
    { task: "黑车正在将军！用帅吃掉它。", base: "3k5/9/9/9/9/9/9/9/4r4/3RK4 w", pre: [],
      accept: ["e0e1"], loose: true, ability: "识别将军",
      hints: ["谁在攻击你的帅？", "黑车就在帅的旁边。", "帅往上一格，吃掉黑车。"],
      explain: "进攻子是 e1 的黑车，帅吃掉它即解除将军。" },
    { task: "黑车从边线远远将军——挪开你的帅。", base: "3k5/9/9/9/9/4P4/9/9/9/r3K4 w", pre: [],
      accept: ["e0e1"], loose: true, ability: "识别将军",
      hints: ["黑车在一条横线上盯着你。", "留在底线上都还在它的射程里。", "往上走：e1、d1、f1 都安全。"],
      explain: "黑车控制整条底线，帅往上走一步即离开射线。" },
    { task: "找到将军你的黑车，用车吃掉它。", base: "3k5/9/9/9/9/9/9/9/9/r2RK4 w", pre: [],
      accept: ["d0a0"], ability: "识别将军",
      hints: ["谁在将军？它在哪条线上？", "a0 的黑车正沿着底线瞄着你。", "d0 的车横过去吃掉它。"],
      explain: "d0a0 直接消灭进攻子。" }
  ],
  acceptance: { task: "黑车远远将军——你可以挪帅，也可以用仕垫住。任选一种应将。", base: "3k5/9/9/9/4r4/9/4P4/9/9/3AK4 w",
    accept: ["e0f0", "d0e1"], loose: true, ability: "应将",
    explain: "e0f0 挪开；d0e1 垫在将军线上同样解将。两种都是标准应将。" }
});

lesson({
  id: "s2l2", stage: "s2", title: "挪开应将：往安全的地方走", minutes: 6, abilities: ["应将"],
  goal: "在被将军时选择安全的挪开方向",
  explain: "挪帅时要看两件事：离开将军线了吗？落点安全吗？\n对方的某些子（比如小卒）平时不起眼，却控制着关键格——挪错方向等于送将。",
  demo: {
    base: "3k5/9/9/9/4c4/4p4/9/9/9/3AK4 w", pre: [],
    line: [{ m: "d0e1", note: "黑炮隔卒将军——仕垫到花心也是一种「挪」，把保护垫进了射线。" }]
  },
  exercises: [
    { task: "黑炮隔卒将军——三种办法任选其一。", base: "3k5/9/9/9/4c4/4p4/9/9/9/3AK4 w", pre: [],
      accept: ["e0f0", "d0e1"], loose: true, ability: "应将",
      hints: ["将军线在哪条线上？", "挪开（f0）或垫住（e1）都行。", "试 e0f0 或 d0e1。"],
      explain: "帅往右挪离开射线；或仕垫到花心挡住射线。均解除将军。" },
    { task: "注意：黑卒控制着左边的格子——往安全的一侧挪。", base: "3k5/9/9/9/4r4/9/9/6P2/3p5/4K4 w", pre: [],
      accept: ["e0f0"], loose: true, ability: "应将",
      hints: ["先找黑卒控制了哪个点。", "d0 在黑卒的口里，走过去照样被吃。", "只有往右：e0f0。"],
      explain: "黑卒守住 d0，挪到 f0 是唯一既解将又安全的方向。" },
    { task: "黑马将军！用车吃掉它。", base: "3k5/9/9/9/9/9/9/3n5/3R5/4K4 w", pre: [],
      accept: ["d1d2"], ability: "应将",
      hints: ["进攻子是一匹马——马能被垫住吗？", "不能垫。看看谁能吃到 d2。", "d1d2，车吃黑马。"],
      explain: "马的将军无法垫住，但 d1 的车正好能吃掉它——吃子解将。" }
  ],
  acceptance: { task: "黑马将军，黑卒还守着一路——找出唯一安全的挪法。", base: "3k5/9/9/9/9/9/7P1/3n5/3p5/4K4 w",
    accept: ["e0f0"], loose: true, ability: "应将",
    explain: "黑卒守 d1，黑马控制 e1 一带的斜点；往右 f0 是唯一安全的应将。" }
});

lesson({
  id: "s2l3", stage: "s2", title: "垫子应将", minutes: 6, abilities: ["应将"],
  goal: "学会在将军线上垫子解将",
  explain: "车、炮从远处将军时，把任意一个子垫进将军线，就能暂时挡住攻击。\n垫子只是缓解——垫上的子可能被兑掉，之后还要继续处理。",
  demo: {
    base: "3k5/9/9/9/4r4/9/4P4/9/9/3AK4 w", pre: [],
    line: [{ m: "d0e1", note: "仕垫进射线——远将军被挡住了。" }]
  },
  exercises: [
    { task: "用垫子的办法应将。", base: "3k5/9/9/9/4r4/9/4P4/9/9/3AK4 w", pre: [],
      accept: ["d0e1"], ability: "应将",
      hints: ["黑车在哪个方向将军？", "把子垫进 e 线。", "d0e1。"],
      explain: "仕垫到花心，射线被切断。" },
    { task: "帅的两边都被自己的仕挡住了，只能垫子——解将！", base: "3k5/9/9/9/4r4/9/4P4/9/9/3AKA3 w", pre: [],
      accept: ["d0e1", "f0e1"], loose: true, ability: "应将",
      hints: ["帅挪得动吗？", "两个方向都被自家仕占了。", "任一仕垫到花心 e1。"],
      explain: "帅无法移动，垫仕到 e1 是唯一解将办法。" },
    { task: "黑炮隔卒将军——把车垫进射线里挡住它。", base: "3k5/9/9/4c4/R8/9/9/4p4/9/4K4 w", pre: [],
      accept: ["a5e5"], ability: "应将",
      hints: ["黑炮的架子在哪？射线从哪到哪？", "在炮架之前垫车，炮就打不到帅了。", "a5e5。"],
      explain: "炮要隔一个子才能将军，车垫进 e 线任意一点，炮后面就有了两个遮挡，攻击失效。" }
  ],
  acceptance: { task: "底线被将——垫住它！", base: "4k4/9/9/9/4r4/9/4P4/9/9/3AKA3 w",
    accept: ["d0e1", "f0e1"], loose: true, ability: "应将",
    explain: "黑车在第五线将军，帅动不了，垫仕到花心是唯一应将。" }
});

lesson({
  id: "s2l4", stage: "s2", title: "第一步杀：双车错", minutes: 8, abilities: ["一步杀"],
  goal: "认识双车配合的底线杀",
  explain: "两辆车一前一后错开在对方底二线，随时可以轮流沉底将军——对方老将无处可躲，这叫「双车错」。\n杀法的关键：先算清对方老将的所有逃跑格，全部封死才算杀。",
  demo: {
    base: "4k4/1RR6/9/9/9/9/9/9/9/3K5 w", pre: [],
    line: [{ m: "b8b9", note: "前车沉底将军：黑将上下左右的格子全被两辆车和规则封死——绝杀！" }]
  },
  exercises: [
    { task: "一步杀！用双车错结束战斗。", base: "4k4/1RR6/9/9/9/9/9/9/9/3K5 w", pre: [],
      accept: ["b8b9", "c8c9"], ability: "一步杀",
      hints: ["黑将现在有几个逃跑点？", "底线和第 8 线，各封一条。", "任一车沉底都是杀。"],
      explain: "车沉底线将军，另一车封住第 8 线——黑将无路可走。" },
    { task: "两辆车分在将门两侧——走出一步杀。", base: "4k4/3R1R3/9/9/9/9/9/9/9/3K5 w", pre: [],
      accept: ["d8d9", "f8f9"], ability: "一步杀",
      hints: ["谁去沉底将军？", "另一辆车会守住哪条线？", "任一侧沉底都是杀。"],
      explain: "任一车沉底将军，另一车封锁第 8 线，黑将无路。" },
    { task: "黑方有仕也挡不住——走出一步杀。", base: "4k4/1R2a4/9/9/9/9/9/9/9/3K5 w", pre: [],
      accept: ["b8b9"], ability: "一步杀",
      hints: ["黑将的逃跑点有哪些？", "花心的黑仕把 e8 自己堵住了。", "b8b9 沉底将军，成杀。"],
      explain: "黑仕恰好挡住自家将的退路，车沉底线即杀。" }
  ],
  acceptance: { task: "毕业前最后一杀：两车分在两翼，一步成杀。", base: "4k4/R6R1/9/9/9/9/9/9/9/3K5 w",
    accept: ["a8a9", "h8h9"], ability: "一步杀",
    explain: "任一车沉底将军，另一车封住第 8 线——黑将无路可逃。" }
});

lesson({
  id: "s2l5", stage: "s2", title: "应将综合练习", minutes: 7, abilities: ["应将"],
  goal: "在混合局面里快速选择正确的应将方式",
  explain: "被将军时按顺序问：① 能吃掉进攻子吗？② 能垫住吗？③ 挪帅安全吗？\n三个问题过一遍，答案自然出来。",
  demo: {
    base: "3k5/9/9/9/9/9/7P1/3n5/9/4K4 w", pre: [],
    line: [{ m: "e0f0", note: "黑马将军——帅往右挪，安全。" }]
  },
  exercises: [
    { task: "黑车贴身将军——两种应将都可以，选一个。", base: "3k5/9/9/9/9/9/9/9/R3r4/4K4 w", pre: [],
      accept: ["a1e1", "e0e1"], ability: "应将",
      hints: ["进攻子是哪个？它有没有保护？", "车能吃它，帅也能吃它（车没保护）。", "a1e1 或 e0e1。"],
      explain: "黑车无保护，车吃、帅吃都是标准应将。" },
    { task: "黑车远远将军——仕可以垫住，车也可以吃……先看清楚谁够得着。", base: "3k5/9/9/9/4r4/9/4P4/9/9/3AK4 w", pre: [],
      accept: ["e0f0", "d0e1"], loose: true, ability: "应将",
      hints: ["你的车在攻击线上吗？", "吃不到就垫或挪。", "e0f0 挪开，或 d0e1 垫住。"],
      explain: "红车不在 e 线够不到黑车，垫仕或挪帅均可。" },
    { task: "黑马将军——挪帅，但注意黑卒守着的格子。", base: "3k5/9/9/9/9/9/7P1/3n5/3p5/4K4 w", pre: [],
      accept: ["e0f0"], loose: true, ability: "应将",
      hints: ["黑马控制哪些点？黑卒又控制哪个点？", "d1 一带在黑卒嘴里。", "只有 e0f0 安全。"],
      explain: "d1 被卒守、e1 被马控，帅往右是唯一安全应将。" }
  ],
  acceptance: { task: "综合验收：黑马将军、黑卒守着一路——走出唯一正确的应将。", base: "3k5/9/9/9/9/9/7P1/3n5/3p5/4K4 w",
    accept: ["e0f0"], loose: true, ability: "应将",
    explain: "这一题在练习里出现过变体——独立完成说明你已经掌握应将的思考顺序。" }
});

/* ===== 阶段三：看住棋子 ===== */
lesson({
  id: "s3l1", stage: "s3", title: "发现无根子", minutes: 7, abilities: ["无根子"],
  goal: "学会检查「谁的子没有保护」",
  explain: "一个子被对方攻击、又没有自己的子保护，叫「无根子」——它是棋盘上最危险的目标。\n每回合先扫一眼：对方的子谁没根？我的子谁没根？",
  demo: {
    base: "4k4/9/9/9/4r2R1/9/9/9/9/3K5 w", pre: [],
    line: [{ m: "h5e5", note: "黑车没有自己的子保护——直接白吃。" }]
  },
  exercises: [
    { task: "黑车没有根——吃掉它。", base: "4k4/9/9/9/4r2R1/9/9/9/9/3K5 w", pre: [],
      accept: ["h5e5"], ability: "无根子",
      hints: ["黑车旁边有没有黑方的子保护它？", "黑将在底线，够不着它。", "h5e5 白吃。"],
      explain: "黑车无根，吃掉即净赚一车。" },
    { task: "两匹黑马只有一匹没根——吃掉它。", base: "2r1k4/9/2n3n2/9/9/9/9/9/9/3K2R2 w", pre: [],
      accept: ["g0g5"], ability: "无根子",
      hints: ["黑马后面同线有黑车吗？", "c5 的马有 c9 的车保着；g5 的马呢？", "g0g5 吃掉无根的马。"],
      explain: "c5 马有根，g5 马无根——只吃无根的。" },
    { task: "黑炮正捉你的无根车——把车挪开。", base: "3k5/9/9/9/9/c8/9/9/9/R3K4 w", pre: [],
      accept: ["a0b0", "a0c0"], ability: "无根子",
      hints: ["黑炮的射线在哪条线上？", "沿这条线挪没用，要离开。", "a0b0 或 a0c0，横着离开。"],
      explain: "车被炮沿着 a 线捉，往右横移离开射线即安全；a0a1 仍在炮口，不算脱险。" }
  ],
  acceptance: { task: "三个目标只有一个能白吃——吃掉无根的黑车。", base: "3k3r1/9/9/9/4r2n1/9/9/9/9/4RK1R1 w", pre: [],
    accept: ["e0e5"], ability: "无根子",
    explain: "h5 的马有 h9 的车保着，吃了要亏；e5 的车没根，e0e5 白吃。" }
});

lesson({
  id: "s3l2", stage: "s3", title: "保护与撤离", minutes: 7, abilities: ["保护"],
  goal: "受攻击时会给子生根或撤到安全处",
  explain: "自己的子被捉，两条路：① 再派一个子保护它（生根）；② 把它挪到安全的地方。\n两步之前先算：对方吃不吃得动、吃了亏不亏。",
  demo: {
    base: "4k4/9/9/9/2n6/4C4/9/9/9/3KR4 w", pre: [],
    line: [{ m: "e0e1", note: "黑马正捉炮——车垫到炮后给它生根。" }]
  },
  exercises: [
    { task: "黑马正捉你的炮——用 车 给它生根。", base: "4k4/9/9/9/2n6/4C4/9/9/9/3KR4 w", pre: [],
      accept: ["e0e1"], ability: "保护",
      hints: ["炮在 e 线上受攻。", "车要到炮的后面同一条线。", "e0e1，车在炮身后保护它。"],
      explain: "车到 e1 后与炮同线，黑马吃炮会被车反吃——炮有了根。" },
    { task: "黑马捉车——把车挪到安全的地方。", base: "3k5/9/9/9/9/6n2/9/7R1/9/4K4 w", pre: [],
      accept: ["h2h3", "h2h4", "h2g2"], ability: "保护",
      hints: ["黑马能攻击到哪些点？", "远离马口。", "h3 / h4 / g2 / g3 都安全。"],
      explain: "离开黑马的控制圈即可，四个落点都安全。" },
    { task: "黑马捉你的马——吃掉它，或者走开，任选。", base: "3k5/9/9/9/9/9/6n2/4N4/9/4K4 w", pre: [],
      accept: ["e2g3", "e2c1", "e2c3", "e2g1"], ability: "保护",
      hints: ["黑马有没有根？", "它孤零零的，可以直接吃！", "e2g3 白吃；不想吃也可以撤到马口外。"],
      explain: "黑马无根，直接吃最赚；撤离也是稳妥选择。" }
  ],
  acceptance: { task: "黑马一捉两个（车和炮）——车更值钱，先把车挪到安全处。", base: "3k5/9/9/9/r1n6/c3R4/9/9/9/4K4 w", pre: [],
    accept: ["e4e5", "e4e3"], ability: "保护",
    explain: "黑马被 a5 的黑车保着不能吃；车先离开马口（留在 e 线的 e5、e3 均安全）。" }
});

lesson({
  id: "s3l3", stage: "s3", title: "简单交换：兑子不亏的判断", minutes: 8, abilities: ["兑子"],
  goal: "判断一次交换是赚、是亏、还是等价",
  explain: "子力价值粗算：车 > 炮 ≈ 马 > 士象 > 兵。\n吃「有根的子」会被吃回：车换车不亏，车换马你赚，车换兵你大亏。吃之前先问「吃完它能不能吃回来」。",
  demo: {
    base: "3k5/9/9/9/3r5/9/9/9/9/3R1K3 w", pre: [],
    line: [{ m: "d0d5", note: "黑车有根——但车兑车谁也不亏，这是干净的交换。" }]
  },
  exercises: [
    { task: "兑掉对方的车（会被吃回也不亏）。", base: "3rk4/9/9/9/3r5/9/9/9/9/3R1K3 w", pre: [],
      accept: ["d0d5"], ability: "兑子",
      hints: ["黑车后面有黑车保着。", "车换车是等价交换。", "d0d5。"],
      explain: "吃回来是车换车，谁也不亏。" },
    { task: "黑马有黑卒保着——用车吃它你赚了还是亏了？想清楚再吃。", base: "3k5/9/9/4n4/4p4/9/9/9/9/4RK3 w", pre: [],
      accept: ["e0e5"], ability: "兑子",
      hints: ["车和马谁值钱？", "卒吃回你的车：车换马。", "赚了——e0e5 吃！"],
      explain: "车换马是明显赚的交换，有根也照吃。" },
    { task: "两个黑马：一匹有象保护、一匹没有——吃掉真正没根的。", base: "3k5/9/9/9/9/9/4n1n2/9/6b2/4RK3 w", pre: [],
      accept: ["e0e3"], ability: "兑子",
      hints: ["黑象在哪里？它保护着谁？", "g1 的黑象正保护 g3 的马。", "e0e3 吃掉没根的马。"],
      explain: "g3 马有象根，e3 马没根——目标明确。" }
  ],
  acceptance: { task: "综合判断：只有一个目标能白吃——找到并吃掉它。", base: "3k3r1/9/9/9/4r2n1/9/9/9/9/4RK1R1 w",
    accept: ["e0e5"], ability: "兑子",
    explain: "e5 黑车无根（白吃）；h5 马有 h9 车的根，动它就亏。" }
});

lesson({
  id: "s3l4", stage: "s3", title: "主动捉子", minutes: 7, abilities: ["捉子"],
  goal: "用捉子争取主动，把子走到有攻击的位置",
  explain: "「捉」就是赶：逼对方的子逃命，你趁机抢占地盘或发动别的进攻。\n捉子要求落点有攻击——走之前想好这步棋「干了什么」。",
  demo: {
    base: "3k5/9/9/9/9/4n4/9/9/2R6/4K4 w", pre: [],
    line: [{ m: "c1e1", note: "车移到 e 线——黑马立刻被捉，得逃命。" }]
  },
  exercises: [
    { task: "把车移到线上捉黑马。", base: "3k5/9/9/9/9/4n4/9/9/2R6/4K4 w", pre: [],
      accept: ["c1e1"], ability: "捉子",
      hints: ["黑马在哪条线上？", "你的车要到同一条线上。", "c1e1。"],
      explain: "车到 e1 与黑马同线，形成捉。" },
    { task: "跳马——跳出去的同时正好捉住黑炮。", base: "3k5/9/9/9/9/9/4c4/9/9/4K2N1 w", pre: [],
      accept: ["h0g2"], ability: "捉子",
      hints: ["马跳到哪个点能攻击 e3？", "出子的同时攻击才是好跳法。", "h0g2，马踩黑炮。"],
      explain: "马到 g2 既出动又捉炮，一手两用。" },
    { task: "把车开到五线，捉住中路的黑炮。", base: "3k5/9/9/3c5/9/9/9/9/9/R3K4 w", pre: [],
      accept: ["a0a5"], ability: "捉子",
      hints: ["黑炮在第五线上。", "车要跟它同线。", "a0a5。"],
      explain: "车占五线捉炮，逼黑炮让出要道。" }
  ],
  acceptance: { task: "黑马正捉你的车，但它自己有保护——别硬吃，把车安全挪开。", base: "2r1k4/9/9/1p7/2n6/4R4/9/9/9/4K4 w",
    accept: ["e4e5", "e4e3"], ability: "捉子",
    explain: "黑马有 c9 车的根，吃不得；车沿 e 线挪到 e5 或 e3 即脱险，帅位也安全。" }
});

lesson({
  id: "s3l5", stage: "s3", title: "看子综合检查", minutes: 7, abilities: ["无根子", "保护"],
  goal: "养成「先看根、再动子」的习惯",
  explain: "每走一步前扫三眼：① 我的子走完有没有根？② 对方有没有无根子可吃？③ 对方上一步是不是送了什么？\n这三眼就是避免「一步丢大子」的全部秘密。",
  demo: {
    base: "3k5/9/9/9/9/8c/9/9/9/4K3R w", pre: [],
    line: [{ m: "i0i4", note: "黑炮孤零零在边线——车直接白吃。" }]
  },
  exercises: [
    { task: "扫一眼：黑方哪个子没根？吃掉它。", base: "3k5/9/9/9/9/8c/9/9/9/4K3R w", pre: [],
      accept: ["i0i4"], ability: "无根子",
      hints: ["黑方的子都有根吗？", "边线的炮离黑将最远。", "i0i4 白吃。"],
      explain: "边炮无根，直接吃。" },
    { task: "黑车盯着你的马——把马挪到安全处。", base: "3k5/7r1/9/9/9/9/9/7N1/9/4K4 w", pre: [],
      accept: ["h2g4", "h2f3", "h2f1", "h2g0"], ability: "保护",
      hints: ["黑车控制整条 h 线。", "离开 h 线。", "g4 / f3 / f1 / g0 都行。"],
      explain: "马跳出 h 线即安全。" },
    { task: "兑掉占位的黑车（被吃回也不亏）。", base: "3rk4/9/9/9/3r5/9/9/9/9/3R1K3 w", pre: [],
      accept: ["d0d5"], ability: "兑子",
      hints: ["黑车有根，但你的车……", "车兑车是等价交换。", "d0d5。"],
      explain: "等价兑子， simplified 局面里这常常是最干净的走法。" }
  ],
  acceptance: { task: "黑方送了一个目标，但旁边有陷阱——吃对那一个。", base: "3k5/9/9/9/9/4p2r1/4c4/6N2/9/4K3R w",
    accept: ["i0i4"], ability: "无根子",
    explain: "h4 黑车无根可吃；e3 黑炮有 e4 卒的根，用马去换就亏了。" }
});

/* ===== 阶段四：基础战术 ===== */
lesson({
  id: "s4l1", stage: "s4", title: "捉双：一手抓两个", minutes: 8, abilities: ["捉双"],
  goal: "发现并制造一手捉两个的着法",
  explain: "一个子同时攻击对方两个子，叫「捉双」。对方只能救一个，你吃掉另一个。\n制造捉双的诀窍：找两条线的交点，让对方的两个子分别落在两条线上。",
  demo: {
    base: "2c1k4/9/4n4/9/9/9/9/9/9/2R3K2 w", pre: [],
    line: [{ m: "c0c7", note: "车到交点：竖线捉炮，横线捉马——捉双！" }]
  },
  exercises: [
    { task: "走出捉双：一手捉住黑炮和黑马。", base: "2c1k4/9/4n4/9/9/9/9/9/9/2R3K2 w", pre: [],
      accept: ["c0c7"], ability: "捉双",
      hints: ["找两条线的交点。", "c 线上有炮，第 7 线上有马。", "c0c7。"],
      explain: "车到 c7，竖捉 c9 炮、横捉 e7 马。" },
    { task: "用马捉双：跳一步，同时踩住两匹黑马。", base: "3k5/9/2n1n4/9/9/9/2N6/9/9/4K4 w", pre: [],
      accept: ["c3d5"], ability: "捉双",
      hints: ["马的攻击点呈「日」字八个方向。", "找一个点，能同时踩到 c7 和 e7。", "c3d5。"],
      explain: "马到 d5，日字两点正好踩住两匹黑马。" },
    { task: "抽将：车将军的同时捉住黑马（黑不敢吃你的车）。", base: "3k5/5R1N1/3P5/9/9/9/9/9/9/4K4 w", pre: [],
      accept: ["f8d8"], ability: "捉双",
      hints: ["车落在哪既能将军又够到黑马？", "黑马在底线边上。", "f8d8：将军，顺手抽马。"],
      explain: "车到 d8 将军（有 d7 兵做根不怕吃），横线同时捉住 h8 马。" }
  ],
  acceptance: { task: "综合：一手捉住黑方的炮和马。", base: "c3k4/9/1n7/9/9/9/9/9/9/R4K3 w",
    accept: ["a0a7"], ability: "捉双",
    explain: "车到 a7：竖捉 a9 炮，横捉 b7 马——捉双成立。" }
});

lesson({
  id: "s4l2", stage: "s4", title: "牵制：钉住不敢动的子", minutes: 8, abilities: ["牵制"],
  goal: "理解牵制并利用牵制得子",
  explain: "用自己的车盯住对方中线上的子，它身后就是老将——这个子就不敢随便离开，这叫「牵制」。\n被牵制的子动弹不得，就是你的猎物：再调一个子去围攻它。",
  demo: {
    base: "4k4/9/4c4/9/9/9/9/9/9/3K3R1 w", pre: [],
    line: [{ m: "h0e0", note: "车占中线：黑炮身后就是老将，不敢离开——牵制成立。" }]
  },
  exercises: [
    { task: "走出牵制：用车盯住黑炮，让它不敢动。", base: "4k4/9/4c4/9/9/9/9/9/9/3K3R1 w", pre: [],
      accept: ["h0e0"], ability: "牵制",
      hints: ["黑炮身后是什么？", "车要和黑炮同线，中间没有别的子。", "h0e0。"],
      explain: "车占 e 线，炮一离开，车就直接射到老将——炮被钉住。" },
    { task: "你的炮被黑车牵住了——解除牵制（挪帅或垫子都行）。", base: "3kr4/9/9/9/9/4C4/3A5/9/9/4K4 w", pre: [],
      accept: ["e0d0", "e0f0", "d3e2"], ability: "牵制",
      hints: ["牵制的「绳子」拴在炮和帅之间。", "挪开帅，或垫个子剪断绳子。", "帅平一步，或仕垫进 e 线。"],
      explain: "帅离开中线，或仕垫进射线，炮都重获自由。" }
  ],
  acceptance: { task: "牵制之后收割：用马吃掉被牵住的黑炮。", base: "4k4/9/4c4/2N6/9/9/9/9/9/3K4R w",
    accept: ["c6e7"], ability: "牵制",
    explain: "黑炮被车牵住动弹不得，马 c6e7 直接吃掉它——牵制的红利。" }
});

lesson({
  id: "s4l3", stage: "s4", title: "卧槽马杀", minutes: 8, abilities: ["一步杀", "卧槽马"],
  goal: "学会马跳卧槽点配合小兵绝杀",
  explain: "马跳到对方底线两肋（三路或七路的底二线），正好将军对方的老将，这叫「卧槽马」。\n卧槽马将军前，先用小兵封住老将的逃路——两步准备，一步成杀。",
  demo: {
    base: "4k4/3P1P3/9/7N1/9/9/9/9/9/3K5 w", pre: [],
    line: [{ m: "h6g8", note: "双兵已封住黑将的逃路——马跳卧槽点，绝杀！" }]
  },
  exercises: [
    { task: "双兵已经就位——跳马成杀！", base: "4k4/3P1P3/9/7N1/9/9/9/9/9/3K5 w", pre: [],
      accept: ["h6g8"], ability: "一步杀",
      hints: ["马跳到哪个点能将军？", "底线两肋的卧槽点。", "h6g8。"],
      explain: "马到卧槽点将军，黑将的 d9、f9、e8 全被双兵封死——绝杀。" },
    { task: "从另一侧卧槽：走出绝杀。", base: "4k4/3P1P3/9/1N7/9/9/9/9/9/3K5 w", pre: [],
      accept: ["b6c8"], ability: "一步杀",
      hints: ["左侧的卧槽点在哪？", "三路底线，c8。", "b6c8。"],
      explain: "马跳 c8 卧槽将军，双兵封死逃路，绝杀。" }
  ],
  acceptance: { task: "换一匹马、换一个起点——走出卧槽马杀。", base: "4k4/3P1P3/4N4/9/9/9/9/9/9/3K5 w",
    accept: ["e7g8"], ability: "一步杀",
    explain: "e7g8 跳到卧槽点，双兵守门，绝杀成立。" }
});

lesson({
  id: "s4l4", stage: "s4", title: "闷杀：炮的关门绝杀", minutes: 8, abilities: ["一步杀"],
  goal: "认识对方自堵城门时的炮杀",
  explain: "对方的双士和马把自己的老将围得严严实实时，炮从边线沉底，借用士当炮架——老将被自己的子闷死，这叫「闷杀」。\n看到对方城门自堵，就要想到边炮。",
  demo: {
    base: "3aka3/4n4/9/9/9/9/9/9/C8/3K5 w", pre: [],
    line: [{ m: "a1a9", note: "边炮沉底：借黑士做炮架将军——黑将闷死在宫里！" }]
  },
  exercises: [
    { task: "黑将自己堵住了城门——走出闷杀。", base: "3aka3/4n4/9/9/9/9/9/9/C8/3K5 w", pre: [],
      accept: ["a1a9"], ability: "一步杀",
      hints: ["黑将在哪条线上？炮架是谁？", "黑方的士就是现成的炮架。", "a1a9 沉底。"],
      explain: "炮借 d9 士做架将军，黑将所有出口都被自己的子堵死。" },
    { task: "从另一侧沉炮，走出闷杀。", base: "3aka3/4n4/9/9/9/9/9/9/8C/3K5 w", pre: [],
      accept: ["i1i9"], ability: "一步杀",
      hints: ["右侧底线是哪条边线？", "借黑士做架。", "i1i9。"],
      explain: "i1i9 沉底闷杀，与左侧同理。" }
  ],
  acceptance: { task: "炮的位置更远了——还是一步闷杀。", base: "3aka3/4n4/9/9/9/9/C8/9/9/3K5 w", pre: [],
    accept: ["a3a9"], ability: "一步杀",
    explain: "a3a9 沿边线沉底，借士为架，闷杀成立。" }
});

lesson({
  id: "s4l5", stage: "s4", title: "杀法综合：找到那一步杀", minutes: 8, abilities: ["一步杀"],
  goal: "在混合局面里识别杀法机会",
  explain: "杀法万变不离三问：老将有哪些出口？我能将军吗？将军时出口封住了吗？\n出口一个个数，缺哪个补哪个。",
  demo: {
    base: "4k4/3R1P3/9/9/9/9/9/9/9/3K5 w", pre: [],
    line: [{ m: "d8d9", note: "车沉底线将军，小兵封住 f9——杀！" }]
  },
  exercises: [
    { task: "车兵配合：走出一步杀。", base: "4k4/3R1P3/9/9/9/9/9/9/9/3K5 w", pre: [],
      accept: ["d8d9"], ability: "一步杀",
      hints: ["黑将的出口在哪几个点？", "f9 谁看着？", "d8d9 沉底将军。"],
      explain: "车沉底将军，小兵封住另一翼，绝杀。" },
    { task: "中路上炮：借黑方的士做架，一步杀。", base: "3aka3/4n4/9/9/9/9/9/9/6C2/3K5 w", pre: [],
      accept: ["g1g9"], ability: "一步杀",
      hints: ["炮架是谁？", "黑士就在黑将旁边。", "g1g9 沉底闷杀。"],
      explain: "借士为架沉底炮，黑将闷死。" },
    { task: "经典双车错再现：一步成杀。", base: "4k4/R6R1/9/9/9/9/9/9/9/3K5 w", pre: [],
      accept: ["a8a9", "h8h9"], ability: "一步杀",
      hints: ["两条底线边线任选。", "另一辆车封第 8 线。", "任一车沉底。"],
      explain: "双车错：一车将军、一车封线。" }
  ],
  acceptance: { task: "最后检验：车兵配合，一步杀！", base: "4k4/3P1R3/9/9/9/9/9/9/9/3K5 w",
    accept: ["f8f9"], ability: "一步杀",
    explain: "车沉底线将军，小兵（d8）封住黑将的左翼——绝杀。" }
});

/* ===== 阶段五：开局原则 ===== */
lesson({
  id: "s5l1", stage: "s5", title: "快出强子：炮马车", minutes: 7, abilities: ["出子"],
  goal: "按「炮马车」的顺序快速出动强子",
  explain: "开局第一目标：让所有大子（车马炮）尽快投入战斗。\n常见顺序：架中炮 → 跳正马 → 出车。一个子别连走好几步。",
  demo: {
    base: INIT, pre: [],
    line: [
      { m: "h2e2", note: "炮二平五：架中炮，直指对方中路。" },
      { m: "h9g7", note: "黑方跳起屏风马，稳住中路的门。" },
      { m: "h0g2", note: "红马二进三：正马出动，护住中兵。" }
    ]
  },
  exercises: [
    { task: "第一步：架起中炮。", base: INIT, pre: [],
      accept: ["h2e2"], ability: "出子",
      hints: ["最常见的第一步是什么？", "把炮移到中路。", "h2e2，炮二平五。"],
      explain: "中炮直指对方中路的将门，是最经典的开局第一手。" },
    { task: "你是黑方——跳起屏风马应住中炮。", base: INIT, pre: ["h2e2"],
      accept: ["h9g7"], ability: "出子",
      hints: ["屏风马保护哪一路？", "左正马跳到屏风位。", "h9g7，马8进7。"],
      explain: "马8进7 与右马形成屏风，守住中路边门。" },
    { task: "出车：把右车开出来（两个方向都算）。", base: INIT, pre: ["h2e2", "h9g7", "h0g2", "b9c7"],
      accept: ["i0h0", "i0i1"], ability: "出子",
      hints: ["车是最强的子，越早出来越好。", "马已经跳开，原位空了。", "i0h0 或 i0i1，车二进一或平四。"],
      explain: "马跳开后让出车位，右车立即投入。" }
  ],
  acceptance: { task: "黑方也出了车——把你的右车也开出来。", base: INIT, pre: ["h2e2", "h9g7", "h0g2", "i9h9"],
    accept: ["i0h0", "i0i1"], ability: "出子",
    explain: "双方比快：你的右车也应尽快出动，保持先手。" }
});

lesson({
  id: "s5l2", stage: "s5", title: "两翼均衡：别冷落任何一侧", minutes: 7, abilities: ["出子", "协调"],
  goal: "理解左右两翼均衡出子的重要性",
  explain: "只顾一侧进攻，另一侧的大子会永远留在家里。\n出子口诀：一炮一马一车之后，看看另一侧还有什么没动。",
  demo: {
    base: INIT, pre: ["h2e2", "h9g7", "h0g2", "i9h9"],
    line: [
      { m: "b0c2", note: "右翼的炮马都动了——现在轮到左翼的马。" }
    ]
  },
  exercises: [
    { task: "右翼已经出动，开发左翼：跳起左马。", base: INIT, pre: ["h2e2", "h9g7", "h0g2", "i9h9"],
      accept: ["b0c2"], ability: "协调",
      hints: ["左边的马还在原位。", "跳正马。", "b0c2，马八进七。"],
      explain: "马八进七让左翼也投入战斗，两翼均衡。" },
    { task: "这匹马已经走了两步——别再动它了，走别的强子（任选一个合理出动）。", base: INIT, pre: ["h0g2", "h9g7", "g2e1", "c6c5"],
      accept: ["h2e2", "c3c4", "g0e2", "i0h0", "b0c2", "e3e4"], ability: "协调",
      hints: ["数一数：那匹马动了几次？", "一子多动，等于让对手白走。", "炮、车、相、兵都行，就是别再动马。"],
      explain: "一子多动是大忌；出动其他强子才是正事。" },
    { task: "你是黑方——选择一手稳健的出子（不要让炮过河冒险）。", base: INIT, pre: ["h2e2", "b9c7", "h0g2"],
      accept: ["h9g7", "c6c5", "e6e5"], ability: "出子",
      hints: ["稳妥 = 出子、挺兵，不动攻击性的炮。", "屏风马、出车、挺兵都是好选择。", "h9g7 / i9h9 / c6c5 / e6e5 均可。"],
      explain: "开局以出子与阵型为先，冒进的过河炮容易受攻。" }
  ],
  acceptance: { task: "只差最后一个大子了——把左车开出来。", base: INIT, pre: ["h2e2", "h9g7", "h0g2", "i9h9", "b0c2", "b7e7"],
    accept: ["a0a1"], ability: "出子",
    explain: "左车抬起，至此炮双马双车全部出动，开局任务完成。" }
});

lesson({
  id: "s5l3", stage: "s5", title: "兵形与中路", minutes: 7, abilities: ["兵形", "中路"],
  goal: "学会用兵通路、巩固中路",
  explain: "兵是「通路」：挺起三路兵能给马路让出落脚点。\n中路是「大门」：中炮对峙时，补士、护中兵都是在锁门。",
  demo: {
    base: INIT, pre: ["h2e2", "h9g7", "h0g2", "b7e7"],
    line: [
      { m: "c3c4", note: "黑炮镇中——红挺三路兵活通马路，稳一手。" }
    ]
  },
  exercises: [
    { task: "挺起三路兵，给马路让点。", base: INIT, pre: ["h2e2", "h9g7", "b0c2", "c6c5"],
      accept: ["c3c4"], ability: "兵形",
      hints: ["哪一路兵挡着自己的马？", "三路。", "c3c4，兵三进一。"],
      explain: "兵三进一活通马路，是屏风马体系的标配。" },
    { task: "你是黑方，中炮压顶——补士巩固中路。", base: INIT, pre: ["h2e2", "h9g7", "h0g2"],
      accept: ["d9e8", "f9e8"], ability: "中路",
      hints: ["哪个子负责护门？", "士。", "d9e8 或 f9e8，士4进5 或 士6进5。"],
      explain: "补士收紧中门，让中炮没有冲击点。" },
    { task: "黑炮镇住了中路——一手处理好它（出车牵制或补相均可）。", base: INIT, pre: ["h2e2", "h9g7", "h0g2", "b7e7"],
      accept: ["i0h0"], ability: "中路",
      hints: ["对付镇中炮：对峙、牵制或补厚。", "车到中线牵制它最直接。", "h0e0 / i0h0 均可。"],
      explain: "出车牵制镇中炮是教科书应法；挺兵补厚同样稳妥。" }
  ],
  acceptance: { task: "你是黑方——选一手符合开局原则的出子。", base: INIT, pre: ["h2e2", "c6c5", "h0g2"],
    accept: ["h9g7", "b9c7"], ability: "出子",
    explain: "出马、出车都是稳步出动；开局阶段阵型完整比小便宜重要。" }
});

lesson({
  id: "s5l4", stage: "s5", title: "将帅安全", minutes: 7, abilities: ["将帅安全"],
  goal: "理解开局阶段帅位与中路的防守要点",
  explain: "开局里帅位安全 = 中路有士象、门前有子守。\n不要过早动帅——每动一步帅，防守就松一分。",
  demo: {
    base: INIT, pre: ["h2e2", "h9g7", "h0g2", "b7e7"],
    line: [
      { m: "c3c4", note: "黑炮镇中——红挺兵活马，中路从容不迫。" }
    ],
  },
  exercises: [
    { task: "黑炮镇中——选出稳健的一手（出车牵制、补相或挺兵）。", base: INIT, pre: ["h2e2", "h9g7", "h0g2", "b7e7"],
      accept: ["i0h0", "c3c4"], ability: "将帅安全",
      hints: ["帅位受到什么威胁？", "先把中路补厚或对峙。", "i0h0 / c3c4 都稳。"],
      explain: "处理镇中炮的原则：对峙、牵制、补厚，不慌不乱。" },
    { task: "黑车将军——把士垫到帅身后。", base: "4k4/9/4r4/9/9/9/9/9/9/3AKA3 w", pre: [],
      accept: ["d0e1", "f0e1"], loose: true, ability: "应将",
      hints: ["帅身后是哪一格？", "花心。", "d0e1 或 f0e1。"],
      explain: "士落花心，中线立即多一层保护。" },
    { task: "两车同线对峙，轮到你走——黑车没有根，怎么下？", base: "3k5/9/9/4r4/9/9/4R4/9/9/3AK3R w", pre: [],
      accept: ["e3e6"], ability: "兑子",
      hints: ["先数：对方这辆车有没有自己的子保护？", "黑将保不到它。", "e3e6，直接吃掉无根车！"],
      explain: "对车时轮走方先吃——黑车无根，e3e6 净赚一车。" }
  ],
  acceptance: { task: "开局检查：选出最稳的一手。", base: INIT, pre: ["h2e2", "h9g7", "h0g2", "b7e7"],
    accept: ["i0h0", "c3c4"], ability: "将帅安全",
    explain: "出车、挺兵——都是把帅位与阵型放心的着法。" }
});

lesson({
  id: "s5l5", stage: "s5", title: "开局综合：解释你的每一步", minutes: 7, abilities: ["出子", "协调"],
  goal: "能为自己的开局着法说出目的",
  explain: "开局好坏的检验标准：你说得出每一手的目的吗？" + String.fromCharCode(10) + "「出子、占点、护帅、通路」——四件事总得占一样。",
  demo: {
    base: INIT, pre: ["h2e2", "h9i7"],
    line: [
      { m: "h0g2", note: "黑方跳了边马——红方按计划出马即可，不慌不抢。" }
    ]
  },
  exercises: [
    { task: "挑一手「有明确目的」的出子。", base: INIT, pre: ["h2e2", "h9g7"],
      accept: ["h0g2", "b0c2", "i0i1", "a0a1", "c3c4"], ability: "出子",
      hints: ["四个大子谁还没动？", "马、车都在家。", "跳马或出车都可以，说得出目的就好。"],
      explain: "出马护中、出车占线——每手都有名堂。" },
    { task: "黑方边马阵型偏软——你按计划挺兵活马。", base: INIT, pre: ["h2e2", "h9i7"],
      accept: ["c3c4", "h0g2", "b0c2"], ability: "协调",
      hints: ["按自己的计划出子，不跟着对手走神。", "挺兵、跳马都是计划内。", "c3c4 / h0g2 / b0c2 均可。"],
      explain: "对手阵型出偏差时，最有力的回应是把自己的事做完。" },
    { task: "中炮对屏风马第 3 回合——选出最积极的一手。", base: INIT, pre: ["h2e2", "h9g7", "h0g2", "b9c7"],
      accept: ["i0h0", "i0i1", "b0c2", "c3c4"], ability: "出子",
      hints: ["还剩什么大子没动？", "车！", "出右车或跳左马都积极。"],
      explain: "尽快把最后一个大子（车）投入战斗。" }
  ],
  acceptance: { task: "验收：为你的开局选一手出子并说出目的（出车、跳马皆可）。", base: INIT, pre: ["h2e2", "h9g7"],
    accept: ["h0g2", "b0c2", "i0i1", "a0a1", "c3c4"], ability: "出子",
    explain: "只要说得出「出子/占点/护帅/通路」，就是好棋。" }
});

/* ===== 阶段六：第一盘完整对局 ===== */
lesson({
  id: "s6l1", stage: "s6", title: "小兵的残局价值", minutes: 6, abilities: ["兵"],
  goal: "残局里会用兵：推进、抢线、破城",
  explain: "残局里兵的价值翻倍：它离敌将越近越危险。\n会用的三个动作：推进（逼近）、抢线（占肋道）、破城（兑士或吃士）。",
  demo: {
    base: "4k4/9/9/3P5/9/9/9/9/9/3K5 w", pre: [],
    line: [{ m: "d6d7", note: "兵一步步逼近九宫——黑将已经开始不舒服了。" }]
  },
  exercises: [
    { task: "把兵推进到九宫门口。", base: "4k4/9/9/3P5/9/9/9/9/9/3K5 w", pre: [],
      accept: ["d6d7"], ability: "兵",
      hints: ["兵的价值来自距离。", "向前！", "d6d7。"],
      explain: "兵进一步，黑将的活动空间就小一分。" },
    { task: "把兵移到肋道（将门）。", base: "4k4/9/9/2P6/9/9/9/9/9/3K5 w", pre: [],
      accept: ["c6d6"], ability: "兵",
      hints: ["黑将门口的两条线叫什么？", "肋道。", "c6d6。"],
      explain: "兵占肋道，直接威胁将门。" },
    { task: "用兵吃掉挡路的黑士（过河兵可以横吃）。", base: "3k5/9/3aP4/9/9/9/9/9/9/3K5 w", pre: [],
      accept: ["e7d7"], ability: "兵",
      hints: ["士是城门。", "过河兵横移吃。", "e7d7，吃士破城。"],
      explain: "吃掉守门的士，九宫大门敞开。" }
  ],
  acceptance: { task: "残局验收：再推进一步，逼近黑将。", base: "3k5/9/9/4P4/9/9/9/9/9/4K4 w",
    accept: ["e6e7"], ability: "兵",
    explain: "兵到宫门，与帅位配合即可成杀。" }
});

lesson({
  id: "s6l2", stage: "s6", title: "残局常识：车炮帅各就各位", minutes: 7, abilities: ["残局"],
  goal: "掌握残局基本站位：车占肋、炮归中、帅助攻",
  explain: "残局三条站位常识：① 车占肋道限制老将；② 炮要归中（有架才有力）；③ 帅也要参与——助攻或牵制。",
  demo: {
    base: "3k5/9/9/9/9/9/9/9/9/R4K3 w", pre: [],
    line: [{ m: "a0d0", note: "车占四路肋道——黑将的活动被压缩。" }]
  },
  exercises: [
    { task: "用车占住四路肋道。", base: "3k5/9/9/9/9/9/9/9/9/R4K3 w", pre: [],
      accept: ["a0d0"], ability: "残局",
      hints: ["黑将门口的两条线。", "四路或六路。", "a0d0。"],
      explain: "车占肋道是残局控制黑将的第一步。" },
    { task: "残局炮归中路。", base: "3k5/9/9/9/9/9/9/7C1/9/4K4 w", pre: [],
      accept: ["h2e2"], ability: "残局",
      hints: ["中路在哪条线？", "炮镇中路。", "h2e2。"],
      explain: "炮归中路，随时可以借架发力。" },
    { task: "残局里帅也要助攻——把帅平到肋道。", base: "3k5/9/9/9/9/9/9/9/9/4K4 w", pre: [],
      accept: ["e0f0"], ability: "残局",
      hints: ["帅能帮什么忙？", "占住六路肋道牵制黑将。", "e0f0。"],
      explain: "残局帅活性越高，配合成杀越容易。" }
  ],
  acceptance: { task: "残局验收：把右车开到六路肋道。", base: "3k5/9/9/9/9/9/9/9/9/4K3R w",
    accept: ["i0f0"], ability: "残局",
    explain: "车占六路肋道，与帅形成两道封锁。" }
});

lesson({
  id: "s6l3", stage: "s6", title: "一盘完整对局：中炮对屏风马", minutes: 9, abilities: ["对局规划"],
  goal: "看懂一盘短对局里每一手的目的",
  explain: "把这盘十步小对局当作模板：每一手都在做「出子、占点、护帅」中的一件事。\n看完之后，你要能替红方接着走。",
  demo: {
    base: INIT, pre: [],
    line: [
      { m: "h2e2", note: "红：架中炮——攻中路。" },
      { m: "h9g7", note: "黑：屏风马——守中路。" },
      { m: "h0g2", note: "红：跳正马——护中兵。" },
      { m: "b7e7", note: "黑：左炮也镇中——针锋相对。" },
      { m: "i0h0", note: "红：出右车——抢占要线。" },
      { m: "i9h9", note: "黑：同样出车——谁也不让。" },
      { m: "h0h5", note: "红：车过河——压迫黑方阵地！" },
      { m: "c6c5", note: "黑：挺卒活马——稳步出子。" }
    ]
  },
  exercises: [
    { task: "回到第 4 手：黑炮镇中之后，红方此时最该做什么大子的决定？", base: INIT, pre: ["h2e2", "h9g7", "h0g2", "b7e7"],
      accept: ["i0h0", "b0c2", "a0a1"], ability: "对局规划",
      hints: ["数一数哪些大子还没动。", "出车、跳马、补相都名正言顺。", "任选一手有目的的出动。"],
      explain: "对局思维：每一手问「我在出子、占点还是护帅」。" },
    { task: "第 7 手红车占中线之后——黑方挺卒活马。你替黑方检查：这手合理吗？（走一手黑方的合理续着）", base: INIT, pre: ["h2e2", "h9g7", "h0g2", "b7e7", "i0h0", "i9h9", "h0h5"],
      accept: ["c6c5", "b9c7", "g6g5"], ability: "对局规划",
      hints: ["黑方被牵制，先稳住阵型。", "挺卒活马或跳正马。", "c6c5 / b9c7 / g6g5 都合理。"],
      explain: "被牵制时以稳为先，活出子力等待机会。" },
    { task: "接着红方走——选一手有目的的续着。", base: INIT, pre: ["h2e2", "h9g7", "h0g2", "b7e7", "i0h0", "i9h9", "h0h5", "c6c5"],
      accept: ["b0c2", "c3c4", "h5h6"], ability: "对局规划",
      hints: ["左翼还空着；e 线上还有文章。", "跳左马、挺兵或车进一步牵制。", "b0c2 / c3c4 / e0e5 均可。"],
      explain: "续着依旧围绕出子与牵制，开局原则贯穿全盘。" }
  ],
  acceptance: { task: "验收：从这盘对局里学到的一手——继续红方的出子计划。", base: INIT, pre: ["h2e2", "h9g7", "h0g2", "b7e7", "i0h0", "i9h9", "h0h5", "c6c5"],
    accept: ["b0c2", "c3c4", "h5h6"], ability: "对局规划",
    explain: "完整对局的重点不是背谱，而是每一手都知道自己在做什么。" }
});

lesson({
  id: "s6l4", stage: "s6", title: "复盘方法：找出最大错误", minutes: 8, abilities: ["复盘"],
  goal: "学会复盘的第一技能：定位并惩罚失误",
  explain: "复盘三步：① 找出盘面上最大的错误（谁送了子？谁漏了杀？）；② 想清楚正确着法；③ 记住教训。\n复盘不是重下一遍，而是抓住关键错误。",
  demo: {
    base: "3k5/9/9/9/9/7r1/9/9/9/4K2R1 w", pre: [],
    line: [{ m: "h0h4", note: "复盘视角：黑车孤零零的没有根——这手直接白吃。" }]
  },
  exercises: [
    { task: "黑方刚送了车——抓住失误，吃掉它。", base: "3k5/9/9/9/9/7r1/9/9/9/4K2R1 w", pre: [],
      accept: ["h0h4"], ability: "复盘",
      hints: ["黑方哪个子没根？", "h4 的黑车。", "h0h4。"],
      explain: "复盘第一步：惩罚最大的失误。" },
    { task: "黑车将军的同时边上还有诱饵——先处理什么？", base: "3k5/9/9/3n4r/9/9/9/9/9/4K4 w", pre: [],
      accept: ["e0d0", "e0f0"], ability: "复盘",
      hints: ["将军和吃子，哪个优先？", "被将军必须先应将。", "e0d0 或 e0f0。"],
      explain: "复盘常见教训：贪吃忽略将军，次序错了全盘皆输。" },
    { task: "找出黑方上一步漏掉的马——吃掉它。", base: "3k5/9/9/9/n8/9/9/9/9/R3K4 w", pre: [],
      accept: ["a0a4"], ability: "复盘",
      hints: ["哪个子没根？", "边线的黑马。", "a0a4。"],
      explain: "复盘要能快速定位「无根子」这类典型失误。" }
  ],
  acceptance: { task: "综合复盘：黑方刚把炮挪开，露出了更大的破绽——找到并惩罚。", base: "3k5/9/7n1/9/9/4c4/9/9/9/4K2R1 w",
    accept: ["h0h7"], ability: "复盘",
    explain: "炮挪开后 h7 的黑马彻底无根——h0h7 白吃，这就是「找最大错误」。" }
});

lesson({
  id: "s6l5", stage: "s6", title: "毕业验收：开好你的第一盘", minutes: 8, abilities: ["应将", "一步杀", "出子"],
  goal: "综合运用全部阶段能力，准备第一盘完整对局",
  explain: "毕业检查三题：应将、一步杀、开局出子。\n全部独立通过后，去「下棋」页实战你的第一盘——输赢不重要，下完记得复盘。",
  demo: {
    base: "4k4/3P1R3/9/9/9/9/9/9/9/3K5 w", pre: [],
    line: [{ m: "f8f9", note: "车兵配合绝杀——你现在已经能看懂这样的杀局了。" }]
  },
  exercises: [
    { task: "热身：黑车远处将军，垫住它。", base: "4k4/9/9/9/4r4/9/4P4/9/9/3AKA3 w", pre: [],
      accept: ["d0e1", "f0e1"], loose: true, ability: "应将",
      hints: ["帅动得了吗？", "垫进将军线。", "任一仕到花心。"],
      explain: "应将三法的肌肉记忆。" },
    { task: "杀法热身：一步绝杀。", base: "4k4/3P1R3/9/9/9/9/9/9/9/3K5 w", pre: [],
      accept: ["f8f9"], ability: "一步杀",
      hints: ["黑将的出口有哪些？", "小兵封着一路。", "f8f9 沉底杀。"],
      explain: "车沉底将军，兵封另一翼。" },
    { task: "开局热身：选一手符合原则的出子。", base: INIT, pre: ["h2e2", "h9g7"],
      accept: ["h0g2", "b0c2", "i0i1", "a0a1", "c3c4"], ability: "出子",
      hints: ["说出目的：出子、占点、护帅、通路。", "马或车。", "任一合理出动。"],
      explain: "开局原则内化于心。" }
  ],
  acceptance: { task: "最终验收：走出一步杀，证明你已准备好第一盘实战！", base: "4k4/3P1R3/9/9/9/9/9/9/9/3K5 w",
    accept: ["f8f9"], ability: "一步杀",
    explain: "🎉 独立完成这道题，说明杀、守、开三关你都过了。去实战吧——下完棋记得来复盘！" }
});

/* ---------- 组装与校验 ---------- */
function buildLesson(def, idx) {
  const out = { id: def.id, stage: def.stage, title: def.title, goal: def.goal,
    minutes: def.minutes, abilities: def.abilities, explain: def.explain, reviewed: true };
  // 演示
  const dPos = pos(def.demo.base, def.demo.pre);
  const demoMoves = [];
  let cur = { base: def.demo.base, pre: def.demo.pre.slice() };
  for (const step of def.demo.line) {
    const before = pos(def.demo.base, cur.pre);
    const [df, dr] = [X.parseMove(step.m)[0], X.parseMove(step.m)[1]];
    if (!before.board[dr][df]) throw new Error(def.id + " 演示着法起点无子: " + step.m + " @ " + before.fen);
    demoMoves.push({ m: step.m, cn: NotationOf(before.board, before.side, step.m), note: step.note });
    cur.pre.push(step.m);
    pos(def.demo.base, cur.pre);   // 合法性校验
  }
  out.demo = { fen: dPos.fen, moves: demoMoves };
  // 练习
  out.exercises = def.exercises.map((ex, i) => {
    const id = def.id + "e" + (i + 1);
    const p = pos(ex.base, ex.pre);
    const legal = X.legalMoves(p.board, p.side).map(X.moveToText);
    for (const a of ex.accept) {
      need(legal.includes(a), def.id + " 第" + (i + 1) + "题 accept 非法: " + a);
    }
    const distract = legal.filter(m => !ex.accept.includes(m)).length;
    need(ex.loose || distract >= 1, def.id + " 第" + (i + 1) + "题 无干扰着法（任意着都判对）");
    return { id, fen: p.fen, side: p.side, task: ex.task, accept: ex.accept.slice(),
             hints: ex.hints, explain: ex.explain, ability: ex.ability, loose: !!ex.loose };
  });
  // 验收
  if (def.acceptance) {
    const a = def.acceptance;
    const p = pos(a.base, a.pre || []);
    const legal = X.legalMoves(p.board, p.side).map(X.moveToText);
    for (const acc of a.accept) {
      need(legal.includes(acc), def.id + " 验收 accept 非法: " + acc);
    }
    need(a.loose || legal.filter(m => !a.accept.includes(m)).length >= 1, def.id + " 验收 无干扰着法");
    out.acceptance = { id: def.id + "ex", fen: p.fen, side: p.side, task: a.task,
                       accept: a.accept.slice(), explain: a.explain, ability: a.ability, loose: !!a.loose };
  }
  return out;
}

const built = L.map(buildLesson);
if (errors.length) {
  console.error("路线内容校验失败：");
  for (const e of errors) console.error("  ✗ " + e);
  process.exit(1);
}

const route = {
  version: 1,
  generatedAt: new Date().toISOString(),
  generator: "tools/build_route.js",
  stages: STAGES,
  lessons: built
};

const outPath = path.join(ROOT, "data", "core", "route.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(route, null, 1), "utf8");

const exCount = built.reduce((n, l) => n + l.exercises.length + (l.acceptance ? 1 : 0), 0);
console.log("route.json 生成完毕：" + built.length + " 课 / " + STAGES.length + " 阶段 / " + exCount + " 道练习（含验收），全部通过规则引擎校验。");
