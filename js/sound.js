/* 音效播放。Sound.play("move" | "capture" | "check" | "illegal" | "click" | "draw") */
(function () {
  "use strict";
  const cache = {};
  const files = {
    move: "assets/sound/move.wav",
    capture: "assets/sound/capture.wav",
    check: "assets/sound/check.wav",
    illegal: "assets/sound/illegal.wav",
    click: "assets/sound/click.wav",
    draw: "assets/sound/draw.wav"
  };
  function play(name) {
    const src = files[name];
    if (!src) return;
    try {
      if (!cache[name]) cache[name] = new Audio(src);
      const a = cache[name].cloneNode();
      a.volume = 0.6;
      a.play().catch(() => {});
    } catch (e) { /* 无音频环境时静默 */ }
  }
  window.Sound = { play };
})();
