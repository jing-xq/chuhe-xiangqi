/* 全局常量统一出处（P2 去副本）：此前 MATE / 子力价值在 coachbrain.js 与 spar.js 各存一份，
 * 两套子力口径数值不同且各有用途——现在同一出处、各自命名，改口径只改这里。
 * 全局对象：XqConst
 *   APP_VERSION   软件版本号（index.html 角落显示；CHANGELOG.md 记录变更）
 *   MATE          引擎 mate 分编码阈值（engine.js：mate 编码 ±(100000-n)，判绝杀用 ±99000）
 *   VAL_COACH     coachbrain 拆解口径子力值（车900 炮450 马400 仕/相200 兵100，将占位 10 万）
 *   ENDGAME_MAT   coachbrain 残局阈值：双方非将子力总值低于此视为残局（开局约 9600）
 *   VAL_SPAR      spar 实时口述口径子力值（车600 炮300 马300 仕/相100 兵60，将 0 不计）
 *   ENDGAME_MAT2  spar 残局阈值 = ENDGAME_MAT 按 VAL_SPAR/VAL_COACH 比例折算（4600 × 约 0.645 ≈ 2970），
 *                 两表口径必须同步修改，否则残局判定漂移 */
window.XqConst = {
  APP_VERSION: "1.1.0",
  MATE: 99000,
  VAL_COACH: { k: 100000, r: 900, c: 450, n: 400, a: 200, b: 200, p: 100 },
  ENDGAME_MAT: 4600,
  VAL_SPAR: { r: 600, c: 300, n: 300, b: 100, a: 100, p: 60, k: 0 },
  ENDGAME_MAT2: 2970
};
