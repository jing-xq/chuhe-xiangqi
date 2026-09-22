/* 讲棋播放器：管理一课棋谱的走子树导航。
 * const p = Player.create();
 * p.load(lessonJson); p.onChange = fn;
 * p.next() / prev() / gotoStart() / gotoEnd() / choose(i)
 * p.children() 当前节点的变着列表
 * p.comment() 当前节点评注
 * p.replay()  -> { board, side }
 * p.pathNodes() 当前线路节点数组
 * p.autoPlay(ms) / p.stopAuto() */
(function () {
  "use strict";

  const X = window.Xiangqi;

  function create() {
    let lesson = null;
    let path = [];        // 当前线路：从根 moves 中选出的节点链
    let autoTimer = null;
    let autoDelay = 600;

    function rootMoves() { return lesson ? (lesson.moves || []) : []; }
    function currentNode() { return path.length ? path[path.length - 1] : null; }

    function replay() {
      const { board, side } = X.parseFen(lesson.fen);
      let s = side;
      for (const n of path) {
        X.applyMove(board, ...X.parseMove(n.m));
        s = X.other(s);
      }
      return { board, side: s };
    }

    function notify() {
      if (api.onChange) api.onChange();
    }

    function stopAuto() {
      if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    }

    function step() {
      const ch = api.children();
      if (!ch.length) { stopAuto(); notify(); return; }
      path.push(ch[0]);
      notify();
      autoTimer = setTimeout(step, autoDelay);
    }

    function doChoose(i) {
      const ch = api.children();
      if (i < 0 || i >= ch.length) return false;
      path.push(ch[i]);
      stopAuto();
      notify();
      return true;
    }

    const api = {
      onChange: null,
      load(data) {
        stopAuto();
        lesson = data;
        path = [];
        notify();
      },
      get lesson() { return lesson; },
      get path() { return path.slice(); },
      setPath(nodes) { stopAuto(); path = nodes.slice(); notify(); },
      replay,
      pathNodes: () => path.slice(),
      children() {
        const n = currentNode();
        return n ? (n.ch || []) : rootMoves();
      },
      comment() {
        const n = currentNode();
        return n ? (n.c || null) : null;
      },
      canNext() { return api.children().length > 0; },
      canPrev() { return path.length > 0; },
      next() { return doChoose(0); },
      prev() {
        if (!path.length) return false;
        path.pop();
        stopAuto();
        notify();
        return true;
      },
      choose: doChoose,
      gotoStart() { stopAuto(); path = []; notify(); },
      gotoEnd() {
        stopAuto();
        let guard = 0;
        while (api.children().length && guard++ < 500) path.push(api.children()[0]);
        notify();
      },
      autoPlay(ms) {
        stopAuto();
        autoDelay = ms || 600;
        autoTimer = setTimeout(step, 60);
      },
      stopAuto,
      get autoRunning() { return !!autoTimer; },
      /* 最后一着（当前线路末节点） */
      lastMove() {
        const n = currentNode();
        return n ? X.parseMove(n.m) : null;
      }
    };
    return api;
  }

  window.Player = { create };
})();
