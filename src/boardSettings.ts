// 棋盘设置 (棋子、棋盘、声音、坐标、记谱、动画……), 照 chess.com 设置里「棋盘」那一页。
// 下棋和对局回顾都用这一份, 存在这台电脑上 (localStorage)。
import { useSyncExternalStore } from "react";
import type { Color } from "./game";

export interface BoardSettings {
  /** 棋子 (public/pieces/<名字>.css) */
  pieces: string;
  /** 棋盘 (public/board/<文件>) */
  board: string;
  /** 声音 (public/sound/<名字>/) */
  sound: string;
  /** 坐标: 在棋盘里面写, 或者不写 */
  coords: "inside" | "off";
  /** 记谱用棋子小图 (♞f3) 还是字母 (Nf3) */
  figurine: boolean;
  /** 棋子动画多少毫秒 (0 是没有动画) */
  animation: number;
  /** 高亮上一步 */
  lastMove: boolean;
  /** 播放声音 */
  soundOn: boolean;
  /** 点了棋子显示能走到哪 */
  dests: boolean;
}

/** 棋子: 都是 Lichess 的 (经 En Croissant), 许可见 资源出处.md; 许可不清楚的几套没拷 */
export const PIECE_SETS: { id: string; name: string }[] = [
  { id: "staunty", name: "Staunty" },
  { id: "cburnett", name: "Cburnett" },
  { id: "merida", name: "Merida" },
  { id: "california", name: "California" },
  { id: "cardinal", name: "Cardinal" },
  { id: "chessnut", name: "Chessnut" },
  { id: "dubrovny", name: "Dubrovny" },
  { id: "fresca", name: "Fresca" },
  { id: "gioco", name: "Gioco" },
  { id: "governor", name: "Governor" },
  { id: "icpieces", name: "ICPieces" },
  { id: "kosal", name: "Kosal" },
  { id: "libra", name: "Libra" },
  { id: "maestro", name: "Maestro" },
  { id: "pirouetti", name: "Pirouetti" },
  { id: "tatiana", name: "Tatiana" },
  { id: "anarcandy", name: "Anarcandy" },
  { id: "horsey", name: "Horsey" },
  { id: "kiwen-suwi", name: "Kiwen-suwi" },
  { id: "fantasy", name: "奇幻" },
  { id: "spatial", name: "立体" },
  { id: "pixel", name: "像素" },
  { id: "shapes", name: "几何" },
  { id: "letter", name: "字母" },
];

export const BOARDS: { file: string; name: string }[] = [
  { file: "gray.svg", name: "灰色" },
  { file: "brown.png", name: "棕色" },
  { file: "green.png", name: "绿色" },
  { file: "blue.png", name: "蓝色" },
  { file: "blue2.jpg", name: "蓝色二" },
  { file: "blue3.jpg", name: "蓝色三" },
  { file: "blue4.svg", name: "蓝色四" },
  { file: "purple.png", name: "紫色" },
  { file: "ic.png", name: "浅绿" },
  { file: "wood.jpg", name: "木纹" },
  { file: "wood2.jpg", name: "木纹二" },
  { file: "wood3.jpg", name: "木纹三" },
  { file: "wood4.jpg", name: "木纹四" },
  { file: "maple.jpg", name: "枫木" },
  { file: "maple2.jpg", name: "枫木二" },
  { file: "marble.jpg", name: "大理石" },
  { file: "blue-marble.jpg", name: "蓝色大理石" },
  { file: "green-plastic.png", name: "绿色塑料" },
  { file: "grey.jpg", name: "灰色纹理" },
  { file: "olive.jpg", name: "橄榄" },
  { file: "leather.jpg", name: "皮革" },
  { file: "metal.jpg", name: "金属" },
  { file: "canvas2.jpg", name: "画布" },
  { file: "newspaper.svg", name: "报纸" },
  { file: "pink-pyramid.png", name: "粉色金字塔" },
  { file: "purple-diag.png", name: "紫色斜纹" },
  { file: "horsey.jpg", name: "小马" },
];

/** 声音: check 是这一套有没有单独的将军声 */
export const SOUNDS: { id: string; name: string; check: boolean }[] = [
  { id: "standard", name: "标准", check: false },
  { id: "piano", name: "钢琴", check: true },
  { id: "nes", name: "红白机", check: true },
  { id: "sfx", name: "音效", check: true },
  { id: "futuristic", name: "未来", check: true },
  { id: "lisp", name: "说话", check: true },
];

export const ANIMATIONS = [
  { value: 400, label: "慢" },
  { value: 200, label: "中" },
  { value: 100, label: "快" },
  { value: 0, label: "关" },
];

export const DEFAULT_BOARD: BoardSettings = {
  pieces: "staunty",
  board: "gray.svg",
  sound: "standard",
  coords: "inside",
  figurine: false,
  animation: 200,
  lastMove: true,
  soundOn: true,
  dests: true,
};

const KEY = "philidor:board";

function load(): BoardSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...DEFAULT_BOARD, ...JSON.parse(raw) } as BoardSettings;
      // 不认得的 (以后删掉的那几套) 换回默认的
      if (!PIECE_SETS.some((p) => p.id === s.pieces)) s.pieces = DEFAULT_BOARD.pieces;
      if (!BOARDS.some((b) => b.file === s.board)) s.board = DEFAULT_BOARD.board;
      if (!SOUNDS.some((x) => x.id === s.sound)) s.sound = DEFAULT_BOARD.sound;
      return s;
    }
  } catch {
    /* 用默认的 */
  }
  return { ...DEFAULT_BOARD };
}

let current: BoardSettings = typeof localStorage === "undefined" ? { ...DEFAULT_BOARD } : load();
const listeners = new Set<() => void>();

export function boardSettings(): BoardSettings {
  return current;
}

export function setBoardSettings(s: BoardSettings) {
  current = s;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 存不了就算了 */
  }
  applyBoardLook(s);
  for (const l of listeners) l();
}

export function useBoardSettings(): BoardSettings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/** 换棋子图和棋盘图 (整个程序都换) */
export function applyBoardLook(s: BoardSettings = current) {
  if (typeof document === "undefined") return;
  const link = document.getElementById("piece-css") as HTMLLinkElement | null;
  const href = `/pieces/${s.pieces}.css`;
  if (link && link.getAttribute("href") !== href) link.setAttribute("href", href);
  document.documentElement.style.setProperty("--board-image", `url("/board/${s.board}")`);
}

// 深色界面上, 白方的步用实心的图 (看着是白子), 黑方的用空心的, 跟 chess.com 一样
const FIGURINE: Record<Color, Record<string, string>> = {
  white: { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞" },
  black: { K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘" },
};

/** 一个棋子字母的小图 */
export function figurineChar(letter: string, color: Color): string {
  return FIGURINE[color][letter] ?? letter;
}

/** 记谱: 打开「棋子标志」时把 K Q R B N 换成棋子小图 (Nf3 → ♞f3, e8=Q → e8=♛) */
export function sanText(san: string, color: Color, figurine = current.figurine): string {
  if (!figurine) return san;
  return san.replace(/[KQRBN]/g, (c) => FIGURINE[color][c]);
}
