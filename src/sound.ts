// 走子的声音, 用 En Croissant 的「standard」那套 (来自 Lichess)。
// 测试 (没有浏览器) 时没有 Audio
const pool = typeof Audio === "undefined" ? [] : Array.from({ length: 4 }, () => new Audio());
let next = 0;
let last = 0;
let muted = false;

export function setMuted(m: boolean) {
  muted = m;
}

export function playMoveSound(capture: boolean) {
  if (muted || pool.length === 0) return;
  const now = Date.now();
  if (now - last < 75) return;
  last = now;
  const a = pool[next];
  next = (next + 1) % pool.length;
  a.src = capture ? "/sound/standard/Capture.mp3" : "/sound/standard/Move.mp3";
  a.volume = 0.8;
  a.play().catch(() => {});
}
