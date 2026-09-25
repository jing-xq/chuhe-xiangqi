/* 今日学习页（规划 2.0-B / 6.3 / 7.4）。
 * Today.mount(container)  Today.show() / hide()
 * 确定性规则生成今日计划：到期复习 → 推荐新课 → 薄弱项 → 实战一盘；
 * 每项附推荐理由；用户可勾选包含哪些板块、指定对手等级。
 * 推荐逻辑为纯函数 Learn.buildPlan，无随机、可解释、可测试。 */
(function () {
  "use strict";

  let els = {}, route = null;

  function mount(container) {
    container.innerHTML = "<div id='today-body' class='today-wrap'><div class='dim' style='padding:30px'>加载中…</div></div>";
    els = { body: container.querySelector("#today-body") };
    fetch("data/core/route.json").then(r => r.json()).then(data => {
      route = data;
      render();
    }).catch(() => { els.body.innerHTML = "<div class='dim' style='padding:30px'>课程数据加载失败。</div>"; });
  }

  function render() {
    if (!route) return;
    const settings = Learn.settings();
    const ids = route.lessons.map(l => l.id);
    const cfg = {
      now: Date.now(),
      settings,
      reviews: Learn.review.due(),
      route: route.lessons.map(l => ({ id: l.id, stage: route.stages.find(st => st.id === l.stage).name, title: l.title, ability: l.abilities[0] })),
      progress: Object.fromEntries(ids.map(id => [id, Learn.statusOf(id).state])),
      abilities: Learn.abilities(),
      lastGames: (window.Games ? Games.all() : []).slice(0, 3).map(g => ({ ts: g.ts, result: Games.userResult ? Games.userResult(g) : g.result }))
    };
    const items = Learn.buildPlan(cfg);
    const c = Learn.progressSummary(ids);

    let html = "<h2 class='today-title'>今日学习</h2>" +
      "<div class='today-summary'>路线进度：独立通过 <b>" + c.independent + "</b> / " + route.lessons.length +
      " · 复习通过 " + c.mastered + " · 到期复习 <b>" + cfg.reviews.length + "</b></div>";

    // 首次使用引导
    if (c.viewed + c.followed + c.independent + c.mastered === 0 && !cfg.reviews.length) {
      html += "<div class='today-hero'>👋 欢迎来到象棋课堂！下面这条路线会带你从零基础到下完第一盘完整对局。<br>" +
        "每天 15 分钟：学一课 → 练几题 → 隔天复习。先从第一课开始吧！</div>";
    }

    if (!items.length) {
      html += "<div class='dim' style='padding:20px'>今天没有安排——可以在下方打开板块开关。</div>";
    }
    html += "<div class='today-items'>";
    const ICON = { review: "🔁", new: "📖", weak: "🎯", battle: "⚔️" };
    for (const it of items) {
      html += "<div class='today-item'><div class='today-icon'>" + (ICON[it.type] || "📌") + "</div>" +
        "<div class='today-main'><b>" + it.title + "</b><span class='dim'><br>" + it.reason + "</span></div>" +
        "<button class='today-go primary' data-i='" + html_escape(JSON.stringify(it.link)) + "'>去完成 →</button></div>";
    }
    html += "</div>";

    // 用户可调整（7.4：用户可以调整训练内容）
    html += "<div class='today-settings'><h4>调整今日安排</h4>" +
      label("includeReview", "包含到期复习", settings.includeReview) +
      label("includeNew", "包含新课推荐", settings.includeNew) +
      label("includeBattle", "包含实战对局", settings.includeBattle) +
      "<label>对手等级 <select id='battleLevel'>" +
      ["auto", "业1", "业3", "业5"].map(v => "<option value='" + v + "'" + (settings.battleLevel === v ? " selected" : "") + ">" + (v === "auto" ? "自动（按战绩）" : v) + "</option>").join("") +
      "</select></label></div>";

    els.body.innerHTML = html;

    els.body.querySelectorAll(".today-go").forEach(b => b.onclick = () => {
      const link = JSON.parse(b.dataset.i);
      Sound.play("click");
      if (link.lesson) { window.App && App.showSub("learn"); Core.gotoLesson(link.lesson); }
      else if (link.review) {
        window.App && App.showSub("learn");
        if (link.review.indexOf("game/") === 0) { Core.show(); Core.gotoReview(link.review); }
        else Core.gotoReview(link.review);
      }
      else if (link.lessons) { window.App && App.showSub("lessons"); }
      else if (link.battle) { window.App && App.showSub("play"); }
      else if (link.ability !== undefined || link.profile) { window.App && App.showSub("learn"); Core.show(); }
    });
    ["includeReview", "includeNew", "includeBattle"].forEach(k => {
      const cb = els.body.querySelector("#" + k);
      if (cb) cb.onchange = () => { const patch = {}; patch[k] = cb.checked; Learn.setSettings(patch); render(); };
    });
    const bl = els.body.querySelector("#battleLevel");
    if (bl) bl.onchange = () => { Learn.setSettings({ battleLevel: bl.value }); render(); };

    function label(key, text, checked) {
      return "<label><input type='checkbox' id='" + key + "'" + (checked ? " checked" : "") + "> " + text + "</label>";
    }
  }

  function html_escape(str) {
    return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  window.Today = { mount, show() { render(); }, hide() {} };
})();
