/* 练习模式：猜下一手。
 * const q = Quiz.create({ onUpdate, onDone });
 * q.load(lessonJson); q.tryMove(f0,r0,f1,r1); q.showAnswer(); q.reset();
 * 状态：q.boardState() -> { board, side, turn: "student"|"waiting"|"done", message }
 * 说明：学员走完正着后，棋谱自动应一手；学员走完无后续的着法即完成。 */
(function () {
  "use strict";

  const X = window.Xiangqi;

  function create(hooks) {
    hooks = hooks || {};
    let lesson = null;
    let path = [];         // 已走的节点链（与 Player 相同结构）
    let phase = "idle";    // student | waiting | done | idle
    let stats = { steps: 0, wrong: 0 };
    let lastFeedback = "";

    function rootMoves() { return lesson ? (lesson.moves || []) : []; }
    function currentNode() { return path.length ? path[path.length - 1] : null; }
    function options() {
      const n = currentNode();
      return n ? (n.ch || []) : rootMoves();
    }

    function boardState() {
      if (!lesson) return null;
      const { board, side } = X.parseFen(lesson.fen);
      let s = side;
      for (const n of path) {
        X.applyMove(board, ...X.parseMove(n.m));
        s = X.other(s);
      }
      return { board, side: s, turn: phase, message: lastFeedback, stats: { ...stats } };
    }

    function notify() {
      if (hooks.onUpdate) hooks.onUpdate(boardState());
    }

    function afterStudentMove(node) {
      stats.steps++;
      path.push(node);
      if (node.ch && node.ch.length) {
        // 棋谱自动应一手
        phase = "waiting";
        notify();
        setTimeout(() => {
          path.push(node.ch[0]);
          phase = options().length ? "student" : "done";
          lastFeedback = "";
          notify();
          if (phase === "done" && hooks.onDone) hooks.onDone({ ...stats });
        }, 450);
      } else {
        phase = "done";
        lastFeedback = "✔ 完成！";
        notify();
        if (hooks.onDone) hooks.onDone({ ...stats });
      }
    }

    const api = {
      load(data) {
        lesson = data;
        path = [];
        phase = options().length ? "student" : "done";
        stats = { steps: 0, wrong: 0 };
        lastFeedback = "";
        notify();
      },
      get lesson() { return lesson; },
      boardState,
      get turn() { return phase; },
      /* 当前正解集合（坐标文本） */
      expected() { return options().map(n => n.m); },
      expectedNodes() { return options(); },
      tryMove(f0, r0, f1, r1) {
        if (phase !== "student") return false;
        const text = X.moveToText([f0, r0, f1, r1]);
        const node = options().find(n => n.m === text);
        if (node) {
          lastFeedback = "";
          Sound.play("move");
          afterStudentMove(node);
          return true;
        }
        stats.wrong++;
        lastFeedback = "✘ 不是正着，再想想（可点「提示」或「显示答案」）";
        Sound.play("illegal");
        notify();
        return false;
      },
      showAnswer() {
        if (phase !== "student") return null;
        const node = options()[0];
        if (!node) return null;
        stats.wrong++;
        lastFeedback = "正着是：" + node.cn;
        Sound.play("click");
        afterStudentMove(node);
        return node;
      },
      reset() {
        if (lesson) api.load(lesson);
      }
    };
    return api;
  }

  window.Quiz = { create };
})();
