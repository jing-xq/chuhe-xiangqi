/* fairy-stockfish WASM 引擎 Web Worker 加载器。
 * 页面通过 Engine.hint(fen) 获取推荐着。 */
"use strict";

/* 兜底：emscripten 在搜索时动态扩 pthread 线程池，个别构建传参不是字符串/Blob，
 * 会导致 pthread worker 里 createObjectURL 抛错。这里把任意入参归一化为可用形式。 */
const _createObjectURL = URL.createObjectURL.bind(URL);
URL.createObjectURL = function (obj) {
  if (obj instanceof Blob) return _createObjectURL(obj);
  if (obj instanceof ArrayBuffer || ArrayBuffer.isView(obj)) return _createObjectURL(new Blob([obj]));
  return "stockfish.js"; // pthread load 命令需要 importScripts 主脚本
};

importScripts("stockfish.js");

let sf = null;

Stockfish().then(instance => {
  sf = instance;
  sf.addMessageListener(line => postMessage(line));
  postMessage("__loaded");
});

self.onmessage = e => {
  const d = e.data;
  if (d && typeof d === "object" && d.cmd === "loadnnue") {
    // 把 NNUE 网络写入 emscripten 虚拟文件系统并加载
    try {
      sf.FS.writeFile("/" + d.name, new Uint8Array(d.buffer));
      sf.postMessage("setoption name EvalFile value /" + d.name);
      sf.postMessage("isready");
    } catch (err) {
      postMessage("__nnue-error " + err.message);
    }
    return;
  }
  if (sf) sf.postMessage(d);
};
