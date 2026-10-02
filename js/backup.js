/* 备份与设置（规划 2.0-E / 6.8 / 8.2 / 8.3）。
 * Backup.mount(container)  Backup.show() / hide()
 * 导出：全部 xq* 本地数据打包为带版本号的 JSON（默认剥离私教 API Key）。
 * 导入：版本检查 → 各类记录条数预览 → 替换 / 合并（按 id 去重）→ 刷新页面生效。
 * 保存失败统一通过 window 事件 "xq-toast" 提示，这里挂全局横幅。
 * 另挂「诊断信息」折叠块（Diag 最近记录 + 引擎/语料状态 + 上次备份时间，P1-2/P1-5）。 */
(function () {
  "use strict";

  const FORMAT_VERSION = 1;
  const API_KEY_HOLDER = "xq-coach-settings";   // 其中的 key 字段不导出
  const LAST_BACKUP_KEY = "xq-last-backup-at";  // 上次导出备份的时间戳（本地提示用）
  let renderDiagRef = null;                     // show() 时刷新诊断块

  function collect() {
    const keys = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.indexOf("xq") !== 0) continue;
      let val = localStorage.getItem(k);
      if (k === API_KEY_HOLDER) {
        try { const o = JSON.parse(val); delete o.key; val = JSON.stringify(o); } catch (e) { Diag.warn("backup.stripKey", e); }
      }
      keys[k] = val;
    }
    return keys;
  }

  function statsOf(keys) {
    const lines = [];
    for (const k of Object.keys(keys)) {
      let n = "";
      try {
        const v = JSON.parse(keys[k]);
        if (Array.isArray(v)) n = v.length + " 条";
        else if (v && typeof v === "object") n = Object.keys(v).length + " 项";
      } catch (e) { n = "文本"; }
      lines.push("<div>" + k + " — " + n + "</div>");
    }
    return lines.join("");
  }

  function mergeValue(oldV, newV) {
    // 数组按 id/ts 去重合并；对象按键合并（新值优先）；其余取新值
    try {
      const o = JSON.parse(oldV), n = JSON.parse(newV);
      if (Array.isArray(o) && Array.isArray(n)) {
        const seen = new Set(n.map(x => x.id !== undefined ? x.id : x.key !== undefined ? x.key : JSON.stringify(x)));
        return JSON.stringify(n.concat(o.filter(x => {
          const id = x.id !== undefined ? x.id : x.key !== undefined ? x.key : undefined;
          if (id === undefined) return !seen.has(JSON.stringify(x));
          return !seen.has(id);
        })));
      }
      if (o && n && typeof o === "object" && typeof n === "object" && !Array.isArray(o) && !Array.isArray(n)) {
        return JSON.stringify(Object.assign({}, o, n));
      }
    } catch (e) { Diag.warn("backup.mergeValue", e); }
    return newV;
  }

  function mount(container) {
    container.innerHTML = `
      <div class="backup-wrap">
        <h3>💾 备份与恢复</h3>
        <p class="dim">学习进度、错题复习、棋谱、已讲解棋谱、开局掌握度、实战错题与设置全部保存在本浏览器（localStorage）。
        清缓存/换浏览器前请先导出备份。私教 API Key 不会包含在备份里。</p>
        <div class="backup-btns">
          <button id="bk-export" class="primary">📤 导出备份</button>
          <button id="bk-copy">复制到剪贴板</button>
          <button id="bk-download">下载为文件</button>
        </div>
        <textarea id="bk-text" placeholder="导出的备份会出现在这里；恢复时把备份内容粘贴进来"></textarea>
        <div class="backup-btns">
          <button id="bk-preview">🔍 检查备份内容</button>
          <button id="bk-import-replace">⬆️ 恢复（替换现有数据）</button>
          <button id="bk-import-merge">⬆️ 恢复（合并重复保留）</button>
        </div>
        <div id="bk-report" class="backup-report"></div>
        <h3>🗄️ 当前本地数据</h3>
        <div id="bk-stats" class="backup-report"></div>
        <details id="diag-box" style="margin-top:14px">
          <summary style="cursor:pointer">🩺 诊断信息（状态与最近警告）</summary>
          <div id="diag-status" class="backup-report"></div>
          <div id="diag-list" class="backup-report" style="max-height:220px;overflow:auto"></div>
          <div class="backup-btns"><button id="diag-copy">复制诊断信息</button></div>
        </details>
      </div>`;
    const $ = id => container.querySelector("#" + id);
    const text = $("bk-text"), report = $("bk-report");

    $("bk-export").onclick = () => {
      text.value = JSON.stringify({ format: "xiangqi-teach-backup", version: FORMAT_VERSION, at: new Date().toISOString(), keys: collect() }, null, 1);
      try { localStorage.setItem(LAST_BACKUP_KEY, String(Date.now())); } catch (e) { Diag.warn("backup.stamp", e); }
      report.innerHTML = "<div class='ok'>✅ 已导出 " + Object.keys(collect()).length + " 类数据（API Key 已剥离）。请复制或下载保存。</div>";
      $("bk-stats").innerHTML = statsOf(collect());
      renderDiag();
    };
    $("bk-copy").onclick = () => {
      if (!text.value) { report.innerHTML = "<div class='bad'>请先导出。</div>"; return; }
      navigator.clipboard.writeText(text.value).then(() => { report.innerHTML = "<div class='ok'>已复制到剪贴板。</div>"; }, () => { report.innerHTML = "<div class='bad'>复制失败，请手动全选复制。</div>"; });
    };
    $("bk-download").onclick = () => {
      if (!text.value) { report.innerHTML = "<div class='bad'>请先导出。</div>"; return; }
      const blob = new Blob([text.value], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "xiangqi-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      URL.revokeObjectURL(a.href);
    };
    function parseBackup() {
      let data;
      try { data = JSON.parse(text.value); } catch (e) { report.innerHTML = "<div class='bad'>❌ 不是有效的备份 JSON。</div>"; return null; }
      if (!data || data.format !== "xiangqi-teach-backup" || !data.keys) {
        report.innerHTML = "<div class='bad'>❌ 缺少备份标识（format/version），请确认粘贴的是本软件导出的备份。</div>"; return null;
      }
      if (data.version > FORMAT_VERSION) {
        report.innerHTML = "<div class='bad'>❌ 备份版本（v" + data.version + "）比当前软件更新，请先升级软件。</div>"; return null;
      }
      report.innerHTML = "<div class='ok'>✅ 备份有效（" + (data.at || "时间未知") + "，版本 v" + data.version + "）：</div>" + statsOf(data.keys);
      return data;
    }
    $("bk-preview").onclick = () => parseBackup();
    function doImport(merge) {
      const data = parseBackup();
      if (!data) return;
      if (!confirm((merge ? "合并" : "替换") + "导入 " + Object.keys(data.keys).length + " 类数据？替换会覆盖现有同名记录，不可撤销。")) return;
      let n = 0, fail = 0;
      for (const k of Object.keys(data.keys)) {
        try {
          if (merge && k !== API_KEY_HOLDER && localStorage.getItem(k) !== null) {
            localStorage.setItem(k, mergeValue(localStorage.getItem(k), data.keys[k]));
          } else if (k === API_KEY_HOLDER && merge && localStorage.getItem(k)) {
            // 合并设置但保留本机 API Key
            try {
              const cur = JSON.parse(localStorage.getItem(k));
              const inc = JSON.parse(data.keys[k]);
              inc.key = cur.key;
              localStorage.setItem(k, JSON.stringify(inc));
            } catch (e) { localStorage.setItem(k, data.keys[k]); }
          } else {
            localStorage.setItem(k, data.keys[k]);
          }
          n++;
        } catch (e) { fail++; }
      }
      report.innerHTML = "<div class='" + (fail ? "bad" : "ok") + "'>" + (fail ? "⚠️" : "✅") + " 已写入 " + n + " 类" + (fail ? "，失败 " + fail + " 类（存储空间不足？）" : "") + "。即将刷新页面生效…</div>";
      setTimeout(() => location.reload(), 1200);
    }
    $("bk-import-replace").onclick = () => doImport(false);
    $("bk-import-merge").onclick = () => doImport(true);
    $("bk-stats").innerHTML = statsOf(collect());

    /* ---------- 诊断信息（P1-2/P1-5） ---------- */
    function renderDiag() {
      const last = Number(localStorage.getItem(LAST_BACKUP_KEY) || 0);
      const days = last ? Math.floor((Date.now() - last) / 864e5) : null;
      const engineTxt = Engine.ready ? "就绪" : "不可用 / 初始化中";
      const fb = typeof Feedback !== "undefined" ? Feedback.status : "—";
      const fbTxt = fb === "loading" ? "加载中" : typeof fb === "number" ? (fb ? fb + " 组键" : "缺失（已回退内置文案）") : "—";
      const recs = Diag.last(20);
      $("diag-status").innerHTML =
        "<div>引擎：" + engineTxt + "　｜　反馈语料：" + fbTxt + "</div>" +
        "<div>上次导出备份：" + (days === null ? "<b>从未备份</b>——学习记录只存在本浏览器，建议立即导出一次" : days === 0 ? "今天 ✓" : "<b>" + days + "</b> 天前") + "</div>" +
        "<div class='dim'>以下为各模块静默捕获的异常记录（Diag 环形缓冲，最多保留 50 条）。</div>";
      $("diag-list").innerHTML = recs.length
        ? recs.map(r => "<div>" + r.at + " [" + r.level + "] " + r.tag + " — " + r.detail + "</div>").join("")
        : "<div class='dim'>暂无记录。功能静默失败时（如私教不说话、分类不出）先来这里找线索。</div>";
    }
    $("diag-copy").onclick = () => {
      navigator.clipboard.writeText(Diag.dump()).then(
        () => { $("diag-list").innerHTML = "<div class='ok'>诊断信息已复制到剪贴板。</div>"; },
        () => {}
      );
    };
    renderDiag();
    renderDiagRef = renderDiag;

    // 全局保存失败横幅（8.2 存储失败提示）
    if (!window.__xqToastHook) {
      window.__xqToastHook = true;
      window.addEventListener("xq-toast", ev => {
        const bar = document.getElementById("storage-toast");
        if (!bar) return;
        bar.textContent = ev.detail;
        bar.classList.remove("hidden");
        setTimeout(() => bar.classList.add("hidden"), 6000);
      });
    }
  }

  window.Backup = {
    mount,
    show() { if (renderDiagRef) renderDiagRef(); },
    hide() {}
  };
})();
