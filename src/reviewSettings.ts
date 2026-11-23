// 对局回顾的设置, 存在这台电脑上 (localStorage)。

export interface ReviewSettings {
  /** 用哪个引擎分析 (引擎清单里的编号); "" 是自动挑 (先挑 Stockfish) */
  engine: string;
  /** 每个局面想多少毫秒 */
  movetime: number;
  /** 棋盘上画最佳着法的箭头 */
  arrows: boolean;
  /** 关键着法只看自己的 (有人下的时候) */
  mineOnly: boolean;
  /** 棋盘上显示好坏图标 */
  onBoard: boolean;
  /** 走子记录里每步都标好坏 (关掉只标关键的) */
  markAll: boolean;
  /** 解析时自己一步步走 */
  autoLine: boolean;
  /** 自动播放每步隔几秒 */
  delay: number;
  /** 显示每步用了多久 */
  showTime: boolean;
}

export const PRECISIONS = [
  { value: 200, label: "快速" },
  { value: 600, label: "标准" },
  { value: 2000, label: "深入" },
];

export const DELAYS = [1, 3, 5, 7, 10];

export const DEFAULT_REVIEW: ReviewSettings = {
  engine: "",
  movetime: 600,
  arrows: true,
  mineOnly: false,
  onBoard: true,
  markAll: false,
  autoLine: true,
  delay: 1,
  showTime: false,
};

const KEY = "philidor:review";

export function loadReviewSettings(): ReviewSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_REVIEW, ...JSON.parse(raw) };
  } catch {
    /* 用默认的 */
  }
  return { ...DEFAULT_REVIEW };
}

export function saveReviewSettings(s: ReviewSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 存不了就算了 */
  }
}
