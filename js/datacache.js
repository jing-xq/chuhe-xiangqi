/* 数据文件内存缓存（P1-6）：serve.py 对 data/ 设 no-store（数据新鲜度的正确策略），
 * 代价是同一文件被多处视图反复下载 + 解析（index.json 双处 fetch、语料/谱库重复拉）。
 * 这里做一层会话内内存缓存：同一 URL 只 fetch 一次，失败不缓存（下次自动重试）。
 * 全局对象：Data
 *   Data.getJSON(url) -> Promise<object>
 *   Data.bust([url])   backup 导入 / 开发调试时强制失效（无参全清）
 * 只用于静态数据文件；私教 API 请求与引擎二进制不走这里。 */
(function () {
  "use strict";
  const map = new Map();   // url -> Promise<object>

  window.Data = {
    getJSON(url) {
      if (!map.has(url)) {
        map.set(url,
          fetch(url).then(r => {
            if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
            return r.json();
          }).catch(e => { map.delete(url); throw e; }));
      }
      return map.get(url);
    },
    bust(url) { if (url) map.delete(url); else map.clear(); }
  };
})();
