/* 统一学习记录（规划 4.2 / 6.6 / 7.3 / 7.4 / 8.2）。
 * 中心化四类数据：核心课程进度、复习（错题）队列、实战错题、用户设置。
 * 状态分层：viewed 看过 → followed 跟做完成 → independent 独立通过 → reviewPassed 复习通过。
 * 复习间隔：次日 / 3 日 / 7 日（level 0/1/2），可按使用反馈调整。
 * 能力档案：按练习的 ability 标签聚合样本量、无提示正确率、延迟复习正确率与证据入口；
 *           样本 < 3 显示「观察中」（minSamples）。
 * 全局对象：Learn
 *   Learn.lesson(id) / markDemo(id) / recordExercise(id, exId, tag, res, isAcceptance)
 *   Learn.statusOf(id) / progressSummary(routeMeta)
 *   Learn.review.due(now) / all() / result(key, ok, clean)
 *   Learn.gameEx.add(ex) / all() / get(id) / remove(id)
 *   Learn.abilities() / buildPlan(cfg)（纯函数，供今日学习页与测试使用）
 * 保存失败通过 window 事件 "xq-toast" 提示（backup.js 显示横幅）。 */
(function () {
  "use strict";

  const KEY = "xq-learn-v1";
  const REVIEW_INTERVALS_DAYS = [1, 3, 7];
  const MIN_ABILITY_SAMPLES = 3;

  let data = load();
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || "null") || fresh(); }
    catch (e) { return fresh(); }
  }
  function fresh() {
    return {
      version: 1,
      lessons: {},        // lessonId -> {viewedAt, ex:{exId -> rec}, reviewPassed, lastAt}
      review: [],         // [{key, type:"core"|"game", level, due, addedAt, lastAt}]
      gameEx: [],         // [{id, fen, side, accept:[{mv,cn}], loss, cls, tag, reason, gameId, ply, cn, created}]
      settings: { includeReview: true, includeNew: true, includeBattle: true, battleLevel: "auto" }
    };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) {
      try { window.dispatchEvent(new CustomEvent("xq-toast", { detail: "学习记录保存失败（存储空间不足或被禁用），近期进度可能丢失。" })); } catch (e2) {}
    }
  }

  const DAY = 24 * 3600 * 1000;

  function lesson(id) {
    if (!data.lessons[id]) data.lessons[id] = { viewedAt: null, ex: {}, reviewPassed: false, lastAt: null };
    return data.lessons[id];
  }

  /* 练习结果记录。res: {ok, wrong, hints, answered, at}
   * isAcceptance: 是否为该课的独立验收题（决定 independent 状态）。 */
  function recordExercise(lessonId, exId, tag, res, isAcceptance) {
    const rec = lesson(lessonId);
    const ex = rec.ex[exId] || (rec.ex[exId] = { tag, attempts: 0, wrong: 0, passes: 0, cleanPasses: 0, hints: 0, answered: false, reviewPasses: 0, lastAt: 0 });
    ex.tag = ex.tag || tag;   // 首次记录的能力标签作为归属
    ex.attempts++;
    ex.wrong += res.wrong || 0;
    ex.hints += res.hints || 0;
    if (res.answered) ex.answered = true;
    ex.lastAt = res.at || Date.now();
    rec.lastAt = ex.lastAt;
    const clean = res.ok && !res.answered && (res.hints || 0) === 0;
    if (res.ok) {
      ex.passes++;
      if (clean) ex.cleanPasses++;
      if (isAcceptance && clean && !rec.independentAt) rec.independentAt = ex.lastAt;
    }
    // 复习调度：带帮助的通过 / 失败 → 入队或回炉
    const key = "core/" + lessonId + "/" + exId;
    if (!res.ok || !clean) {
      review.schedule(key, "core", 0, ex.lastAt);
    } else if (res.reviewVisit) {
      // 复习场干净通过：升级或毕业
      review.promote(key, ex.lastAt);
      ex.reviewPasses++;
      if (isAcceptance) rec.reviewPassed = true;
    } else {
      review.remove(key);   // 首学干净通过：不进复习队列
    }
    save();
    return { clean };
  }

  function statusOf(lessonId) {
    const rec = data.lessons[lessonId];
    if (!rec) return { state: null };
    const exs = Object.keys(rec.ex).map(k => rec.ex[k]);
    const passed = exs.filter(e => e.passes > 0);
    const state =
      rec.reviewPassed ? "mastered" :
      rec.independentAt ? "independent" :
      passed.length ? "followed" :
      rec.viewedAt ? "viewed" : null;
    return { state, viewedAt: rec.viewedAt, independentAt: rec.independentAt, reviewPassed: rec.reviewPassed, lastAt: rec.lastAt };
  }

  /* ---------- 复习队列 ---------- */
  const review = {
    schedule(key, type, level, now) {
      now = now || Date.now();
      let item = data.review.find(r => r.key === key);
      if (!item) { item = { key, type, level: 0, addedAt: now }; data.review.push(item); }
      item.level = level;
      item.due = now + REVIEW_INTERVALS_DAYS[level] * DAY;
      item.lastAt = now;
      save();
    },
    promote(key, now) {
      const item = data.review.find(r => r.key === key);
      if (!item) return;
      const next = item.level + 1;
      if (next >= REVIEW_INTERVALS_DAYS.length) {
        review.remove(key);   // 三级复习全过：毕业
      } else {
        item.level = next;
        item.due = now + REVIEW_INTERVALS_DAYS[next] * DAY;
        item.lastAt = now;
        save();
      }
    },
    remove(key) {
      const n = data.review.length;
      data.review = data.review.filter(r => r.key !== key);
      if (data.review.length !== n) save();
    },
    all() { return data.review.slice().sort((a, b) => a.due - b.due); },
    due(now) { now = now || Date.now(); return review.all().filter(r => r.due <= now); },
    markVisit(key) {
      const item = data.review.find(r => r.key === key);
      if (item) { item._visiting = true; }
    },
    clearVisit(key) {
      const item = data.review.find(r => r.key === key);
      if (item) delete item._visiting;
    }
  };

  /* ---------- 实战错题（3.0-C / 7.5） ---------- */
  const gameEx = {
    add(ex) {
      ex.id = "ge" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
      ex.created = Date.now();
      data.gameEx.unshift(ex);
      review.schedule("game/" + ex.id, "game", 0, ex.created);
      save();
      return ex.id;
    },
    all() { return data.gameEx.slice(); },
    get(id) { return data.gameEx.find(g => g.id === id) || null; },
    remove(id) {
      data.gameEx = data.gameEx.filter(g => g.id !== id);
      review.remove("game/" + id);
      save();
    },
    /* 完成一次错题练习（复习场） */
    record(id, res) {
      const g = gameEx.get(id);
      if (!g) return { clean: false };
      g.attempts = (g.attempts || 0) + 1;
      g.wrong = (g.wrong || 0) + (res.wrong || 0);
      g.hints = (g.hints || 0) + (res.hints || 0);
      if (res.answered) g.answered = true;
      g.lastAt = Date.now();
      const clean = res.ok && !res.answered && (res.hints || 0) === 0;
      const key = "game/" + id;
      if (!res.ok || !clean) {
        review.schedule(key, "game", 0, g.lastAt);
      } else if (res.reviewVisit) {
        g.reviewPasses = (g.reviewPasses || 0) + 1;
        review.promote(key, g.lastAt);
      } else {
        g.passes = (g.passes || 0) + 1;
        g.cleanPasses = (g.cleanPasses || 0) + 1;
        review.remove(key);
      }
      save();
      return { clean };
    },
    /* 等价答案合并：新 best 与已有答案分差小于 30cp 时并入 accept（7.5 多解等价检查） */
    mergeEquivalent(id, mv, cn) {
      const g = gameEx.get(id);
      if (!g) return false;
      if (g.accept.some(a => a.mv === mv)) return false;
      g.accept.push({ mv, cn });
      save();
      return true;
    }
  };

  /* ---------- 能力档案（7.3） ---------- */
  function abilities() {
    const tags = {};
    function touch(tag) {
      return tags[tag] || (tags[tag] = {
        tag, attempts: 0, correct: 0, clean: 0, reviewOk: 0, lastAt: 0, evidence: []
      });
    }
    for (const lessonId of Object.keys(data.lessons)) {
      const rec = data.lessons[lessonId];
      for (const exId of Object.keys(rec.ex)) {
        const ex = rec.ex[exId];
        if (ex.attempts === 0) continue;
        const t = touch(ex.tag || "综合");
        t.attempts += ex.attempts;
        t.correct += ex.passes;
        t.clean += ex.cleanPasses;
        t.reviewOk += ex.reviewPasses;
        t.lastAt = Math.max(t.lastAt, ex.lastAt);
        t.evidence.push({ kind: "练习", lessonId, exId, at: ex.lastAt, ok: ex.passes > 0, clean: ex.cleanPasses > 0 });
      }
    }
    for (const g of data.gameEx) {
      if (!g.attempts) continue;
      const t = touch(g.tag || "实战错题");
      t.attempts += g.attempts || 0;
      t.correct += g.passes || 0;
      t.clean += g.cleanPasses || 0;
      t.reviewOk += g.reviewPasses || 0;
      t.lastAt = Math.max(t.lastAt, g.lastAt || g.created);
      t.evidence.push({ kind: "实战", gameId: g.gameId, ply: g.ply, at: g.lastAt || g.created, ok: (g.passes || 0) > 0 });
    }
    for (const t of Object.keys(tags)) {
      const a = tags[t];
      a.sample = a.attempts;
      a.noHintRate = a.attempts ? a.clean / a.attempts : null;
      a.reviewRate = a.correct ? a.reviewOk / a.correct : null;
      a.weak = a.sample >= MIN_ABILITY_SAMPLES && a.noHintRate !== null && a.noHintRate < 0.7;
      a.observing = a.sample < MIN_ABILITY_SAMPLES;   // 样本不足 → 观察中
      a.evidence.sort((x, y) => y.at - x.at);
      a.evidence = a.evidence.slice(0, 10);
    }
    return tags;
  }

  /* ---------- 今日学习计划（6.3 / 7.4，确定性规则） ----------
   * cfg: {
   *   now, settings,
   *   reviews: [{key, type, due}],                      // 到期复习
   *   route: [{id, stageIdx, title, ability}],          // 新手路线顺序
   *   progress: {id -> state},                          // 课程状态
   *   abilities: abilities() 的结果,
   *   lastGames: [{ts, result}]                         // 最近对局（新→旧）
   * }
   * 返回 [{type:"review"|"new"|"battle"|"weak", title, reason, link}] */
  /* 推荐理由语料（T2）：cfg.reasonBank 缺失时用内置 fallback（buildPlan 保持确定性可测）。
   * 语料变体含 {xxx} 占位符，vars 由调用方格式化好再传入。 */
  function pickReason(bank, key, vars, fallback) {
    const arr = bank && bank[key];
    const tpl = arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : fallback;
    return String(tpl).replace(/\{([a-z]+)\}/g, (m, k) =>
      vars && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : "");
  }

  function buildPlan(cfg) {
    const items = [];
    const bank = cfg.reasonBank || null;
    const s = cfg.settings || fresh().settings;
    if (s.includeReview) {
      for (const r of cfg.reviews.slice(0, 3)) {
        const days = Math.max(1, Math.round((cfg.now - r.due) / DAY));
        if (r.type === "game") {
          items.push({ type: "review", title: "实战错题复习", reason: pickReason(bank, "plan:reasonReview", { days, title: "实战错题" }, "这手棋的教训已隔 " + days + " 天，回来验证一下"), link: { review: r.key } });
        } else {
          const parts = r.key.split("/");
          const lesson = cfg.route.find(l => l.id === parts[1]);
          items.push({ type: "review", title: "复习：" + (lesson ? lesson.title : "练习"), reason: pickReason(bank, "plan:reasonReview", { days, title: lesson ? lesson.title : "练习" }, "距上次出错已 " + days + " 天"), link: { review: r.key } });
        }
      }
    }
    if (s.includeNew) {
      const next = cfg.route.find(l => {
        const st = cfg.progress[l.id];
        return !st || st === "viewed";
      });
      if (next) {
        const idx = cfg.route.indexOf(next) + 1;
        items.push({ type: "new", title: "新课：" + next.title, reason: pickReason(bank, "plan:reasonNew", { idx: "第 " + idx + " 课", stage: next.stage, title: next.title }, "新手路线第 " + idx + " 课（" + next.stage + "）"), link: { lesson: next.id } });
      } else {
        items.push({ type: "new", title: "路线已完成", reason: "30 课全部独立通过——去资料库继续进阶", link: { lessons: true } });
      }
    }
    // 薄弱项：样本足够且无提示正确率最低
    const weak = Object.keys(cfg.abilities || {})
      .map(k => cfg.abilities[k])
      .filter(a => a.weak)
      .sort((a, b) => a.noHintRate - b.noHintRate)[0];
    if (weak) {
      const pct = Math.round(weak.noHintRate * 100);
      items.push({ type: "weak", title: "薄弱项：" + weak.tag, reason: pickReason(bank, "plan:reasonWeak", { pct: pct + "%", tag: weak.tag }, "无提示正确率 " + pct + "%（" + weak.sample + " 次练习），今天先练三道观察题"), link: { ability: weak.tag } });
    } else {
      const obs = Object.keys(cfg.abilities || {}).map(k => cfg.abilities[k]).filter(a => a.observing);
      if (obs.length) items.push({ type: "weak", title: "观察中的能力：" + obs.slice(0, 2).map(o => o.tag).join("、"), reason: "样本还不足 " + MIN_ABILITY_SAMPLES + " 次，暂不生成结论", link: { profile: true } });
    }
    if (s.includeBattle) {
      const recent = (cfg.lastGames || []).slice(0, 3);
      let level = "业3";
      if (recent.length >= 2) {
        const wins = recent.filter(g => g.result === "win").length;
        if (wins === 0) level = "业1";
        else if (wins === recent.length) level = "业5";
      }
      const levelIdx = { "业1": 1, "业3": 2, "业5": 3 }[s.battleLevel] !== undefined ? s.battleLevel : null;
      const finalLevel = s.battleLevel !== "auto" ? s.battleLevel : level;
      const winsN = recent.filter(g => g.result === "win").length;
      items.push({
        type: "battle", title: "实战一盘（" + finalLevel + "）",
        // 无对局记录时不用语料（变体里的 {n}/{wins} 会落空成空串）
        reason: recent.length
          ? pickReason(bank, "plan:reasonBattle", { n: recent.length, wins: winsN, level: finalLevel }, "最近 " + recent.length + " 盘 " + winsN + " 胜，对手定为 " + finalLevel)
          : "还没有实战记录，先来一盘轻松的",
        link: { battle: finalLevel }
      });
    }
    return items;
  }

  function settings() { return data.settings; }
  function setSettings(patch) { Object.assign(data.settings, patch); save(); }

  /* 测试/备份钩子 */
  function _raw() { return data; }
  function _replace(d) { data = d || fresh(); save(); }

  window.Learn = {
    REVIEW_INTERVALS_DAYS, MIN_ABILITY_SAMPLES,
    lesson, markDemo(id) { const r = lesson(id); r.viewedAt = r.viewedAt || Date.now(); r.lastAt = Date.now(); save(); },
    recordExercise, statusOf,
    review, gameEx, abilities, buildPlan,
    settings, setSettings,
    progressSummary(routeIds) {
      const c = { viewed: 0, followed: 0, independent: 0, mastered: 0 };
      for (const id of routeIds) {
        const st = statusOf(id).state;
        if (st === "viewed") c.viewed++;
        else if (st === "followed") c.followed++;
        else if (st === "independent") c.independent++;
        else if (st === "mastered") c.mastered++;
      }
      return c;
    },
    _raw, _replace
  };
})();
