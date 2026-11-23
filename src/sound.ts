// 走子的声音 (Lichess 的几套, 经 En Croissant); 用哪套、开不开照棋盘设置。
import { boardSettings, SOUNDS } from "./boardSettings";
// 测试 (没有浏览器) 时没有 Audio
const pool = typeof Audio === "undefined" ? [] : Array.from({ length: 4 }, () => new Audio());
let next = 0;
let last = 0;
let muted = false;

export function setMuted(m: boolean) {
  muted = m;
}

export function playMoveSound(capture: boolean, check = false) {
  const set = boardSettings();
  if (muted || !set.soundOn || pool.length === 0) return;
  const now = Date.now();
  if (now - last < 75) return;
  last = now;
  const a = pool[next];
  next = (next + 1) % pool.length;
  const hasCheck = SOUNDS.find((x) => x.id === set.sound)?.check;
  const name = check && hasCheck ? "Check" : capture ? "Capture" : "Move";
  a.src = `/sound/${set.sound}/${name}.mp3`;
  a.volume = 0.8;
  a.play().catch(() => {});
}
