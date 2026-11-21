// 走子的声音, 用 En Croissant 的「standard」那套 (来自 Lichess)。
const pool = Array.from({ length: 4 }, () => new Audio());
let next = 0;
let last = 0;
let muted = false;

export function setMuted(m: boolean) {
  muted = m;
}

export function playMoveSound(capture: boolean) {
  if (muted) return;
  const now = Date.now();
  if (now - last < 75) return;
  last = now;
  const a = pool[next];
  next = (next + 1) % pool.length;
  a.src = capture ? "/sound/standard/Capture.mp3" : "/sound/standard/Move.mp3";
  a.volume = 0.8;
  a.play().catch(() => {});
}
