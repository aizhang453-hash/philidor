// 棋钟显示: 1:05:00、14:59, 不到 10 秒带十分之一秒 (0:09.8)
export function formatClock(ms: number): string {
  const t = Math.max(0, ms);
  const s = Math.floor(t / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = String(sec).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  if (t < 10_000) return `${m}:${ss}.${Math.floor((t % 1000) / 100)}`;
  return `${m}:${ss}`;
}
