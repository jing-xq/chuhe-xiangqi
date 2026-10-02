/* 练习反馈语料库（低成本模型批量工作规划 T2）。
 * 数据：data/copy/feedback.json = {version, keys: {key: [变体…]}}
 * 全局对象：Feedback.pick(key) -> 随机变体（无语料/无该键返回 ""）
 *          Feedback.fmt(模板, vars) -> 把 {xxx} 占位符替换为 vars[xxx]
 * 语料缺失时调用方回退到内置字符串——语料是纯增强，绝不阻塞功能。 */
(function () {
  "use strict";

  let bank = null;   // {key: […]}
  let loading = null;

  function load() {
    if (bank || loading) return loading || Promise.resolve();
    loading = Data.getJSON("data/copy/feedback.json")
      .then(data => { bank = (data && data.keys) || {}; Diag.info("feedback.load", "语料 " + Object.keys(bank).length + " 组键"); })
      .catch(e => { bank = {}; Diag.info("feedback.load", "语料缺失，已回退内置文案：" + e.message); });
    return loading;
  }

  /* 随机取一条变体；文件未加载完成或无该键时返回 ""（调用方用 || 内置句兜底） */
  function pick(key) {
    if (!bank) { load(); return ""; }
    const arr = bank[key];
    if (!arr || !arr.length) return "";
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /* 把 {xxx} 替换为 vars[xxx]；未提供的占位符替换为空串 */
  function fmt(text, vars) {
    return String(text).replace(/\{([a-z]+)\}/g, (m, k) =>
      vars && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : "");
  }

  /* 诊断面板用：bank === null 未加载完成；{} 加载失败（回退内置）；否则正常 */
  window.Feedback = { pick, fmt, load, get status() { return bank === null ? "loading" : Object.keys(bank).length; } };

  load();   // 启动即加载（文件小且经 Data 缓存；此前只在首次 pick 才拉，诊断面板会一直显示「加载中」）
})();
