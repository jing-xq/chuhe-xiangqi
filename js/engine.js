/* 引擎封装（fairy-stockfish WASM）。
 * Engine.init() -> Promise<bool>          需要 crossOriginIsolated，否则返回 false
 * Engine.hint(fen, ms[, priority]) -> Promise<"h2e2"|null>
 * Engine.evalCp(fen, ms[, priority]) -> Promise<number|null>   局面分（走子方视角，单位分）
 * Engine.candidates(fen, ms, pvCount[, priority]) -> Promise<[{mv, cp}]>  MultiPV 候选着（走子方视角，好→差）
 * 所有请求经内部优先级队列串行执行（见下方 PRIORITY），不会互相 clobber；
 * Engine.setBackgroundPaused(true/false) 暂停/恢复后台批处理，Engine.cancel/cancelAll 取消排队任务。
 * 坐标：对外统一内部格式（file a-i，rank 0-9）。 */
(function () {
  "use strict";

  let worker = null;
  let ready = false;
  let initPromise = null;
  let lineWaiters = [];       // {prefix, resolve}
  let multipv = 1;
  let session = null;         // 当前 go 会话 {infos: Map<pvIdx, {mv,cp,depth,mate}>, maxDepth, resolve}

  function send(cmd) { if (worker) worker.postMessage(cmd); }

  function waitFor(prefix, timeoutMs) {
    return new Promise(resolve => {
      const w = { prefix, resolve };
      lineWaiters.push(w);
      setTimeout(() => {
        const i = lineWaiters.indexOf(w);
        if (i >= 0) { lineWaiters.splice(i, 1); resolve(null); }
      }, timeoutMs || 8000);
    });
  }

  /* fairy-stockfish 输出 rank 为 1-10（可能两位数字），本软件内部为 0-9 */
  const MV_RE = "[a-i](?:10|[0-9])[a-i](?:10|[0-9])";
  function toInternal(mv) {
    const m = new RegExp("^([a-i])(10|[0-9])([a-i])(10|[0-9])$").exec(mv || "");
    if (!m) return null;
    return m[1] + (Number(m[2]) - 1) + m[3] + (Number(m[4]) - 1);
  }

  function onLine(line) {
    debugLog.push(line);
    if (debugLog.length > 300) debugLog.shift();
    if (session && line.startsWith("info ") && line.indexOf(" multipv ") >= 0) {
      const depthM = /depth (\d+)/.exec(line);
      const pvM = / multipv (\d+)/.exec(line);
      const cpM = /score cp (-?\d+)/.exec(line);
      const mateM = /score mate (-?\d+)/.exec(line);
      const mvM = new RegExp(" pv ((?:" + MV_RE + ")(?: (?:" + MV_RE + "))*)").exec(line);
      if (pvM && mvM) {
        const depth = depthM ? Number(depthM[1]) : 0;
        const k = Number(pvM[1]);
        const prev = session.infos.get(k);
        if (!prev || depth >= prev.depth) {
          let cp;
          if (mateM) cp = (Number(mateM[1]) > 0 ? 1 : -1) * (100000 - Math.abs(Number(mateM[1])));
          else cp = cpM ? Number(cpM[1]) : 0;
          const lineMoves = mvM[1].split(" ").map(toInternal).filter(Boolean);
          session.infos.set(k, { mv: lineMoves[0] || null, line: lineMoves, cp, depth });
          if (depth > session.maxDepth) session.maxDepth = depth;
        }
      }
    }
    for (let i = lineWaiters.length - 1; i >= 0; i--) {
      if (line.indexOf(lineWaiters[i].prefix) === 0) {
        lineWaiters[i].resolve(line);
        lineWaiters.splice(i, 1);
      }
    }
    if (session && line.startsWith("bestmove")) {
      const s = session;
      session = null;
      const m = new RegExp("bestmove (" + MV_RE + ")").exec(line);
      const best = m ? toInternal(m[1]) : null;
      // 各 multipv 线路深度不一，不按 maxDepth 过滤，按评分排序输出
      const cands = Array.from(s.infos.values())
        .filter(info => info.mv)
        .sort((a, b) => b.cp - a.cp);
      if (best && !cands.some(c => c.mv === best)) {
        cands.unshift({ mv: best, line: [best], cp: cands.length ? cands[0].cp : 0, depth: s.maxDepth });
      }
      s.resolve({ best, cands, via: "bestmove", raw: line });
    }
  }

  let debugLog = [];

  function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (typeof SharedArrayBuffer === "undefined") return false;
      try {
        worker = new Worker("engine/engine-worker.js");
        const loaded = new Promise((res, rej) => {
          worker.onmessage = e => {
            if (e.data === "__loaded") res();
            else onLine(e.data);
          };
          worker.onerror = rej;
          setTimeout(() => rej(new Error("timeout")), 15000);
        });
        await loaded;
        send("uci");
        await waitFor("uciok", 8000);
        send("setoption name UCI_Variant value xiangqi");
        send("setoption name Ponder value false");
        send("isready");
        await waitFor("readyok", 8000);
        // 加载 NNUE 网络（本地 engine/nnue/xiangqi.nnue，失败则退回经典评估）
        try {
          const buf = await fetch("engine/nnue/xiangqi.nnue").then(r => {
            if (!r.ok) throw new Error("http " + r.status);
            return r.arrayBuffer();
          });
          worker.postMessage({ cmd: "loadnnue", name: "xiangqi.nnue", buffer: buf }, [buf]);
          const rok = await waitFor("readyok", 20000);
          if (rok) console.log("NNUE 网络已加载");
        } catch (e) {
          console.warn("NNUE 网络加载失败，使用经典评估：", e);
        }
        ready = true;
      } catch (e) {
        console.warn("引擎初始化失败，已降级：", e);
        ready = false;
        if (worker) { worker.terminate(); worker = null; }
      }
      return ready;
    })();
    return initPromise;
  }

  function go(fen, movetime, pvCount) {
    if (!ready) return Promise.resolve({ best: null, cands: [], via: "not-ready" });
    return (async () => {
      const mt = movetime || 800;
      // 上一局搜索仍在进行时：先发 stop 并等它结算。等待期间旧会话仍挂在
      // session 上，它自己的 bestmove（或超时兜底）会完成结算——避免旧 bestmove
      // 迟到后算到新会话头上、或旧调用永久挂起。
      if (session) {
        send("stop");
        await waitFor("bestmove", 2500);
      }
      if (pvCount && pvCount !== multipv) {
        multipv = pvCount;
        send("setoption name MultiPV value " + pvCount);
      }
      // stop 后引擎迟迟不结算（异常状态）：强制清掉旧会话，绝不让调用方挂死
      if (session) {
        const s = session;
        session = null;
        s.resolve({ best: null, cands: [], via: "clobbered" });
      }
      return await new Promise(resolve => {
        // 校验候选着是否属于当前局面：快速连续 go 时，上一局面的残留 info 行可能混入
        let posLegal = null;
        try {
          const pos = window.Xiangqi.parseFen(fen);
          posLegal = mv => {
            try { return window.Xiangqi.isLegal(pos.board, pos.side, window.Xiangqi.parseMove(mv)); }
            catch (e) { return false; }
          };
        } catch (e) { posLegal = () => true; }
        const mySession = { infos: new Map(), maxDepth: 0, resolve: r => {
          if (posLegal) {
            r.cands = r.cands.filter(c => c.mv && posLegal(c.mv));
            if (r.best && !posLegal(r.best)) r.best = r.cands.length ? r.cands[0].mv : null;
          }
          resolve(r);
        } };
        session = mySession;
        send("position fen " + fen);
        send("go movetime " + mt);
        setTimeout(() => {
          if (session === mySession) {
            session = null;
            mySession.resolve({ best: null, cands: [], via: "timeout" });
          }
        }, mt + 6000);
      });
    })();
  }

  /* ---------- 任务调度（单引擎串行 + 优先级 + 取消 + 后台暂停） ----------
   * 单 WASM worker 同一时间只能跑一个搜索；此前各模块直接竞争同一会话，
   * 并发时后发请求会把先发请求 clobber 掉（返回空结果）。
   * 现在所有搜索请求排入优先级队列逐个执行（同优先级先来先服务）：
   *   PLAY       100  当前对局必须完成的电脑应着
   *   USER        80  用户主动请求：提示 / 当前题目判分 / 私教推荐
   *   REVIEW      60  用户发起的复盘分析、私教逐手拆解
   *   AMBIENT     40  形势条等低优先刷新
   *   BACKGROUND  20  后台批处理（飞刀分类等），可暂停
   * setBackgroundPaused(true) 时 BACKGROUND 任务暂不执行，恢复后继续；
   * 已在搜索中的任务不受影响（movetime 有界，前台最多等一个搜索）。
   * 取消/超时/不可用分别以 via:"cancelled"/"timeout"/"not-ready" 明确返回。 */
  const PRIORITY = { PLAY: 100, USER: 80, REVIEW: 60, AMBIENT: 40, BACKGROUND: 20 };
  let queue = [];           // 待执行任务
  let running = false;      // 当前是否有搜索在执行
  let bgPaused = false;     // 后台批处理暂停开关
  let seqCounter = 0;
  let rawSearch = go;       // 实际搜索函数（测试可替换，不影响调度逻辑）

  function pump() {
    if (running) return;
    queue.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    const idx = queue.findIndex(t => !bgPaused || t.priority > PRIORITY.BACKGROUND);
    if (idx < 0) return;
    const task = queue.splice(idx, 1)[0];
    running = true;
    rawSearch(task.fen, task.movetime, task.pv).then(r => {
      running = false;
      task.resolve(r);
      pump();
    });
  }

  function submit(fen, movetime, pv, priority) {
    return new Promise(resolve => {
      if (!ready) { resolve({ best: null, cands: [], via: "not-ready" }); return; }
      queue.push({
        fen, movetime, pv: pv || 1,
        priority: priority == null ? PRIORITY.USER : priority,
        seq: seqCounter++, resolve
      });
      pump();
    });
  }

  /* 取消仍在排队、且 fn(task) 为真的任务（立即以 via:"cancelled" 结算） */
  function cancel(fn) {
    let n = 0;
    queue = queue.filter(t => {
      if (!fn(t)) return true;
      n++;
      t.resolve({ best: null, cands: [], via: "cancelled" });
      return false;
    });
    return n;
  }

  function cancelAll() { return cancel(() => true); }

  function setBackgroundPaused(v) {
    bgPaused = !!v;
    if (!bgPaused) pump();
  }

  window.Engine = {
    init,
    get ready() { return ready; },
    PRIORITY,
    hint(fen, movetime, priority) { return submit(fen, movetime, 1, priority).then(r => r.best); },
    async evalCp(fen, movetime, priority) {
      const r = await submit(fen, movetime || 400, 1, priority);
      const c = r.cands.find(x => x.mv === r.best) || r.cands[0];
      return c ? c.cp : null;
    },
    candidates(fen, movetime, pvCount, priority) {
      return submit(fen, movetime, pvCount || 4, priority).then(r => r.cands);
    },
    setBackgroundPaused,
    cancel,
    cancelAll,
    _go: go,
    get log() { return debugLog.slice(); },
    /* 无头测试钩子：替换底层搜索 / 观察调度状态 */
    _test: {
      setRawSearch(fn) { rawSearch = fn; },
      setReady(v) { ready = !!v; },
      reset() { queue = []; running = false; bgPaused = false; rawSearch = go; ready = false; },
      get queue() { return queue.map(t => ({ fen: t.fen, priority: t.priority, seq: t.seq })); },
      get busy() { return running; },
      get bgPaused() { return bgPaused; },
      submit
    }
  };
})();
