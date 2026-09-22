/* 已讲解棋谱存档：私教点评过的棋谱（取名 + 评分 + 六维 + 讲解原文）。
 * Annotated.add(rec) / all() / get(id) / remove(id) / saveAnalysis(id, data)
 * Annotated.drawRadar(canvas, dims)  六维雷达图
 * 记录结构：{ id, ts, name, score, dims:{开局,中局,残局,进攻,防守,稳定},
 *            game:{moves,result,mySide,levelName,reason}, review } */
(function () {
  "use strict";

  const KEY = "xq-annotated-v1";
  let data = [];
  try { data = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { data = []; }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {} }

  /* 从本地分析数据兜底生成六维（LLM 未返回时也能出图） */
  function fallbackDims(game) {
    let losses = [];
    if (game.analysis) losses = game.analysis.perMove.map(p => p.loss);
    const avg = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 60;
    const big = losses.filter(x => x >= 250).length;
    const win = game.result === "win" ? 1 : game.result === "draw" ? 0.5 : 0;
    const q = v => Math.max(20, Math.min(95, Math.round(v)));
    return {
      "开局": q(70 + win * 15),
      "中局": q(85 - avg * 0.4),
      "残局": q(75 + win * 10 - big * 4),
      "进攻": q(60 + win * 25 - big * 3),
      "防守": q(88 - big * 12),
      "稳定": q(90 - avg * 0.5)
    };
  }

  /* 六维雷达图（紧凑版，讲解为主、图为辅） */
  function drawRadar(cv, dims) {
    const labels = ["开局", "中局", "残局", "进攻", "防守", "稳定"];
    const vals = labels.map(l => {
      const v = dims ? dims[l] : null;
      return v === null || v === undefined ? 0 : Math.max(0, Math.min(100, v));
    });
    const dpr = window.devicePixelRatio || 1;
    const size = 170;
    const cx = size / 2, cy = size / 2, R = size / 2 - 22;
    cv.width = size * dpr; cv.height = size * dpr;
    cv.style.height = size + "px";
    cv.style.width = size + "px";
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const angle = i => -Math.PI / 2 + i * Math.PI / 3;
    const pt = (i, r) => [cx + Math.cos(angle(i)) * r, cy + Math.sin(angle(i)) * r];

    // 网格（3 环）
    for (let ring = 1; ring <= 3; ring++) {
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const [x, y] = pt(i % 6, R * ring / 3);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = ring === 3 ? "#555" : "rgba(255,255,255,.12)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // 轴 + 标签
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < 6; i++) {
      const [x, y] = pt(i, R);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y);
      ctx.strokeStyle = "rgba(255,255,255,.12)";
      ctx.stroke();
      const [lx, ly] = pt(i, R + 14);
      ctx.fillStyle = "#e8cf8a";
      ctx.fillText(labels[i], lx, ly);
    }
    // 数据多边形
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const [x, y] = pt(i % 6, R * vals[i % 6] / 100);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(212,160,60,.30)";
    ctx.fill();
    ctx.strokeStyle = "#d4a03c";
    ctx.lineWidth = 2;
    ctx.stroke();
    // 顶点 + 分数
    for (let i = 0; i < 6; i++) {
      const [x, y] = pt(i, R * vals[i] / 100);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#ffd97a";
      ctx.fill();
    }
  }

  window.Annotated = {
    add(rec) {
      rec.id = "a" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
      rec.ts = rec.ts || Date.now();
      data.unshift(rec);
      persist();
      return rec.id;
    },
    all() { return data.slice(); },
    get(id) { return data.find(g => g.id === id) || null; },
    remove(id) { data = data.filter(g => g.id !== id); persist(); },
    saveAnalysis(id, analysis) {
      const g = data.find(x => x.id === id);
      if (g) { g.game.analysis = analysis; persist(); }
    },
    fallbackDims,
    drawRadar
  };
})();
