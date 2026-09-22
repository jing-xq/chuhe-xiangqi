/* 公共 Markdown 渲染（先转义再排版，防注入）。
 * window.renderMarkdown(src) -> html */
(function () {
  "use strict";

  function escapeHtml(s) {
    // 不转义 > ：块级语法（引用块）依赖行首 >
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  }

  function inlineMd(s) {
    return s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "<a href=\"$2\" target=\"_blank\" rel=\"noopener\">$1</a>");
  }

  function renderMarkdown(src) {
    const lines = escapeHtml(String(src)).split("\n");
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^```/.test(line)) {
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push("<pre>" + buf.join("\n") + "</pre>");
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        const header = line.split("|").slice(1, -1).map(c => c.trim());
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          rows.push(lines[i].split("|").slice(1, -1).map(c => c.trim()));
          i++;
        }
        let html = "<table><thead><tr>" + header.map(h => "<th>" + inlineMd(h) + "</th>").join("") + "</tr></thead><tbody>";
        html += rows.map(r => "<tr>" + r.map(c => "<td>" + inlineMd(c) + "</td>").join("") + "</tr>").join("") + "</tbody></table>";
        out.push(html);
        continue;
      }
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) { out.push("<h" + (h[1].length + 1) + ">" + inlineMd(h[2]) + "</h" + (h[1].length + 1) + ">"); i++; continue; }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
      if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.、]\s+/.test(line)) {
        const ordered = /^\s*\d+/.test(line);
        const items = [];
        while (i < lines.length && (/^\s*[-*+]\s+/.test(lines[i]) || /^\s*\d+[.、]\s+/.test(lines[i]))) {
          items.push(inlineMd(lines[i].replace(/^\s*(?:[-*+]|\d+[.、])\s+/, "")));
          i++;
        }
        const tag = ordered ? "ol" : "ul";
        out.push("<" + tag + "><li>" + items.join("</li><li>") + "</li></" + tag + ">");
        continue;
      }
      if (/^>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(inlineMd(lines[i].replace(/^>\s?/, ""))); i++; }
        out.push("<blockquote>" + buf.join("<br>") + "</blockquote>");
        continue;
      }
      if (/^\s*$/.test(line)) { i++; continue; }
      const buf = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) &&
             !/^(```|#|>|\s*[-*+]\s|\s*\d+[.、]\s|\s*\|)/.test(lines[i])) {
        buf.push(lines[i]); i++;
      }
      out.push("<p>" + inlineMd(buf.join(" ")) + "</p>");
    }
    return out.join("\n");
  }

  window.renderMarkdown = renderMarkdown;
})();
