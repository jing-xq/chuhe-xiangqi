/* 诊断层（P1-2）：把静默吞掉的异常与关键状态记入环形缓冲，供「我的 → 备份与设置」
 * 页的「诊断信息」折叠块展示。只记录，不改变任何控制流——空 catch 逐一改为记一条。
 * 全局对象：Diag
 *   Diag.warn(tag[, e])       记录一条警告（tag 建议「模块.位置」，如 "spar.coachAfterOppMove"）
 *   Diag.info(tag, msg)       记录一条状态（引擎降级、语料缺失等非异常信息）
 *   Diag.storageFail(tag, e)  存储写入失败专用：记一条 + 节流弹全局横幅（一分钟内不重复）
 *   Diag.last([n])            最近 n 条（默认 20）：[{at, level, tag, detail}]
 *   Diag.dump()               全部记录拼成文本（排障复制用） */
(function () {
  "use strict";
  const MAX = 50;
  const buf = [];
  let lastToastAt = 0;

  function push(level, tag, detail) {
    buf.push({
      at: new Date().toTimeString().slice(0, 8),
      level, tag: String(tag),
      detail: String(detail == null ? "" : (detail && detail.message) || detail).slice(0, 200)
    });
    if (buf.length > MAX) buf.shift();
  }

  window.Diag = {
    warn(tag, e) { push("警告", tag, e); },
    info(tag, msg) { push("状态", tag, msg); },
    storageFail(tag, e) {
      push("存储", tag, e);
      const now = Date.now();
      if (now - lastToastAt < 60000) return;
      lastToastAt = now;
      try {
        window.dispatchEvent(new CustomEvent("xq-toast", {
          detail: "本地数据保存失败（存储空间不足或被禁用），近期改动可能丢失。请到「我的 → 备份与设置」导出备份。"
        }));
      } catch (e2) {}
    },
    last(n) { return buf.slice(-(n || 20)); },
    dump() { return buf.map(r => r.at + " [" + r.level + "] " + r.tag + " " + r.detail).join("\n"); }
  };
})();
