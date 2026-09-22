/* 引擎封装（fairy-stockfish WASM）。
 * Engine.init() -> Promise<bool>          需要 crossOriginIsolated，否则返回 false
 * Engine.hint(fen, ms) -> Promise<"h2e2"|null>
 * Engine.evalCp(fen, ms) -> Promise<number|null>   局面分（走子方视角，单位分）
 * Engine.candidates(fen, ms) -> Promise<[{mv, cp}]>  MultiPV 候选着（走子方视角，好→差）
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
    return new Promise(resolve => {
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
      const mt = movetime || 800;
      send("stop");   // 取消可能残留的搜索
      if (pvCount && pvCount !== multipv) {
        multipv = pvCount;
        send("setoption name MultiPV value " + pvCount);
        send("isready");
      }
      // stop 会触发引擎回送旧局面的 bestmove；稍等再挂接新会话，避免误结算
      setTimeout(() => {
        session = mySession;
        send("position fen " + fen);
        send("go movetime " + mt);
        setTimeout(() => {
          if (session === mySession) {
            session = null;
            mySession.resolve({ best: null, cands: [], via: "timeout" });
          }
        }, mt + 6000);
      }, 80);
    });
  }

  window.Engine = {
    init,
    get ready() { return ready; },
    hint(fen, movetime) { return go(fen, movetime, 1).then(r => r.best); },
    async evalCp(fen, movetime) {
      const { best, cands } = await go(fen, movetime || 400, 1);
      const c = cands.find(x => x.mv === best) || cands[0];
      return c ? c.cp : null;
    },
    candidates(fen, movetime, pvCount) {
      return go(fen, movetime, pvCount || 4).then(r => r.cands);
    },
    _go: go,
    get log() { return debugLog.slice(); }
  };
})();
