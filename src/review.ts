// 对局回顾: 按引擎的分数给每一步分好坏、算精度、挑出关键的步。不碰界面和引擎, 方便单独测试。
// 好坏照 chess.com 公开的说法 (这步让走的一方的胜算掉了多少): 最佳 0、很好 ≤0.02、不错 ≤0.05、欠准确 ≤0.10、错着 ≤0.20、败着 >0.20。
// 胜算用 Lichess 公开的换算 (分数 → 赢的机会); 精度也照 Lichess 公开的算法 (lichess.org/page/accuracy)。
import type { Chess } from "chessops/chess";
import { parseUci, parseSquare } from "chessops/util";
import type { Color, NormalMove, Role, Square } from "chessops/types";
import { areaGrades, gameRatingOf, type Area } from "./gameRating";

export type Cls =
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "book"
  | "inaccuracy"
  | "mistake"
  | "miss"
  | "blunder";

export const CLS_ORDER: Cls[] = [
  "brilliant",
  "great",
  "book",
  "best",
  "excellent",
  "good",
  "inaccuracy",
  "mistake",
  "miss",
  "blunder",
];

export const CLS_NAME: Record<Cls, string> = {
  brilliant: "妙着",
  great: "关键一着",
  best: "最佳",
  excellent: "很好",
  good: "不错",
  book: "开局库",
  inaccuracy: "欠准确",
  mistake: "错着",
  miss: "错失",
  blunder: "败着",
};

/** 回顾时停下来讲的步 */
const KEY: Cls[] = ["brilliant", "great", "inaccuracy", "mistake", "miss", "blunder"];
/** 走得不好的步: 给「最佳」按钮看该怎么走 */
export const BAD: Cls[] = ["inaccuracy", "mistake", "miss", "blunder"];

/** 一个局面的分析 (都从白方看) */
export interface PosEval {
  /** 分数: 百分之一个兵; 将死时没有 */
  cp?: number;
  /** 几步将死, 正数白方将死黑方; 0 是已经被将死了 */
  mate?: number;
  /** 引擎觉得最好的一步 */
  best?: string;
  /** 往下怎么走 (从这个局面开始) */
  pv: string[];
  /** 第二好的那步走了以后, 轮到走的一方的胜算 (0–1); 只有一步能走或没分析时没有 */
  second?: number;
}

/** 分数 → 白方赢的机会 (0–100), Lichess 的换算; 将死当成 ±1000 */
export function winPercent(e: Pick<PosEval, "cp" | "mate">): number {
  let cp: number;
  if (e.mate !== undefined) cp = e.mate > 0 ? 1000 : e.mate < 0 ? -1000 : 0;
  else cp = Math.max(-1000, Math.min(1000, e.cp ?? 0));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** 被将死的局面: 轮到走的一方输了 */
export function matedEval(turn: Color): PosEval {
  return { mate: 0, cp: turn === "white" ? -100000 : 100000, pv: [] };
}

function winFor(e: PosEval, color: Color): number {
  const w = e.mate === 0 && e.cp !== undefined ? (e.cp > 0 ? 100 : 0) : winPercent(e);
  return (color === "white" ? w : 100 - w) / 100;
}

/** 分数怎么写: 白方看, +1.34、-0.39、M3 (三步杀)、-M2 */
export function evalText(e: PosEval | undefined): string {
  if (!e) return "";
  if (e.mate !== undefined && e.mate !== 0) return e.mate > 0 ? `M${e.mate}` : `-M${-e.mate}`;
  if (e.mate === 0) return e.cp !== undefined && e.cp > 0 ? "1-0" : "0-1";
  const v = (e.cp ?? 0) / 100;
  return (v > 0 ? "+" : "") + v.toFixed(2);
}

export interface MoveReview {
  ply: number;
  color: Color;
  uci: string;
  cls: Cls;
  /** 这步让走的一方的胜算掉了多少 (0–1) */
  loss: number;
  /** 这步的精度 (0–100) */
  accuracy: number;
  key: boolean;
}

export interface GameReview {
  moves: MoveReview[];
  accuracy: Record<Color, number>;
  counts: Record<Color, Record<Cls, number>>;
  /** 棋局等级 (相当于 Lichess 多少分); 步太少没有 */
  rating: Record<Color, number | undefined>;
  /** 开局、战术、战略、残局的评分 (好坏图标); 这盘没有这一段是 null */
  areas: Record<Color, Record<Area, Cls | null>>;
  /** 开局名 (英文全名), 不在开局理论里就没有 */
  opening?: string;
  /** 开局名是在第几步认出来的 */
  openingPly?: number;
}

const VALUE: Record<Role, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };

/** 对方现在能白吃 (或用更小的子换) 我们的大子, 最多能赚几个兵 */
function hanging(pos: Chess, me: Color): number {
  let best = 0;
  for (const [from, dests] of pos.allDests()) {
    const attacker = pos.board.get(from);
    if (!attacker) continue;
    for (const sq of dests) {
      const victim = pos.board.get(sq);
      if (!victim || victim.color !== me || VALUE[victim.role] < 3) continue;
      const defended = pos.kingAttackers(sq as Square, me, pos.board.occupied.without(sq)).nonEmpty();
      best = Math.max(best, defended ? VALUE[victim.role] - VALUE[attacker.role] : VALUE[victim.role]);
    }
  }
  return best;
}

/** 这步是弃子: 走完以后对方能白吃 (或用更小的子换) 我们一个大子, 比这步吃到的多两个兵以上, 而且是这步才送上去的 */
export function isSacrifice(before: Chess, after: Chess, uci: string): boolean {
  const move = parseUci(uci) as NormalMove | undefined;
  if (!move || !("from" in move)) return false;
  const me = before.turn;
  const captured = before.board.get(move.to);
  const took = captured && captured.color !== me ? VALUE[captured.role] : 0;
  const offered = hanging(after, me);
  if (offered - took < 2) return false;
  // 走之前假如轮到对方, 能吃到的
  const was = before.clone();
  was.turn = after.turn;
  was.epSquare = undefined;
  return offered > hanging(was, me);
}

function recapture(prevUci: string | undefined, uci: string, before: Chess): boolean {
  if (!prevUci) return false;
  const to = uci.slice(2, 4);
  const sq = parseSquare(to);
  return prevUci.slice(2, 4) === to && sq !== undefined && before.board.has(sq);
}

export interface ReviewInput {
  /** 每一步 (UCI 写法) */
  moves: string[];
  /** 每个局面 (第 0 个是开局, 共 moves.length + 1 个) */
  positions: readonly Chess[];
  /** 每个局面的分析 (跟 positions 一样多) */
  evals: PosEval[];
  /** 第几步 (从 1 数) 还在开局理论里: 一出来就不算了 */
  book: boolean[];
}

/** 一步的好坏 */
export function classify(input: ReviewInput, ply: number): { cls: Cls; loss: number } {
  const { moves, positions, evals } = input;
  const uci = moves[ply - 1];
  const before = evals[ply - 1];
  const after = evals[ply];
  const pos = positions[ply - 1];
  const me = pos.turn;
  const epBefore = winFor(before, me);
  const epAfter = winFor(after, me);
  const isBest = before.best === uci;
  const loss = isBest ? 0 : Math.max(0, epBefore - epAfter);
  if (input.book[ply]) return { cls: "book", loss };

  let cls: Cls;
  if (isBest || loss < 0.002) cls = "best";
  else if (loss <= 0.02) cls = "excellent";
  else if (loss <= 0.05) cls = "good";
  else if (loss <= 0.1) cls = "inaccuracy";
  else if (loss <= 0.2) cls = "mistake";
  else cls = "blunder";

  // 错失: 对方上一步送了机会 (我们的胜算涨了), 这步又还回去了
  if (BAD.includes(cls) && ply >= 2) {
    const epPrev = winFor(evals[ply - 2], me);
    if (epBefore - epPrev >= 0.08 && epAfter <= epPrev + 0.02 && epAfter >= epPrev - 0.1) cls = "miss";
  }

  const legal = [...pos.allDests().values()].reduce((s, d) => s + d.size(), 0);
  if (loss <= 0.02 && legal > 1) {
    const second = before.second;
    // 妙着: 弃子, 走完局面不差, 换别的走法也不是轻松就赢
    if (epBefore < 0.95 && epAfter >= 0.5 && (second === undefined || second < 0.85) && isSacrifice(pos, positions[ply], uci))
      return { cls: "brilliant", loss };
    // 关键一着: 这一步是唯一的好棋 (第二好的差很多), 不是简单的吃回
    if (
      cls === "best" &&
      second !== undefined &&
      epBefore - second >= 0.15 &&
      epBefore < 0.97 &&
      !recapture(moves[ply - 2], uci, pos)
    )
      return { cls: "great", loss };
  }
  return { cls, loss };
}

/** 一步的精度 (Lichess 的算法): 走的一方赢的机会掉得越多越低 */
export function moveAccuracy(before: number, after: number): number {
  const diff = Math.max(0, before - after);
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * diff) - 3.166924740191411;
  return Math.max(0, Math.min(100, raw + 1));
}

function stddev(xs: number[]): number {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

/** 整盘的精度 (Lichess 的算法): 按局面起伏加权的平均, 跟调和平均再平均 */
export function gameAccuracy(wins: number[], color: Color): number {
  const n = wins.length - 1;
  if (n < 1) return 100;
  const size = Math.max(2, Math.min(8, Math.floor(n / 10)));
  const windows: number[][] = [];
  for (let i = 0; i < Math.max(0, size - 2); i++) windows.push(wins.slice(0, size));
  for (let i = 0; i + size <= wins.length; i++) windows.push(wins.slice(i, i + size));
  const weights = windows.map((w) => Math.max(0.5, Math.min(12, stddev(w))));
  let wsum = 0;
  let wacc = 0;
  let inv = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const mover: Color = i % 2 === 0 ? "white" : "black";
    if (mover !== color) continue;
    const before = mover === "white" ? wins[i] : 100 - wins[i];
    const after = mover === "white" ? wins[i + 1] : 100 - wins[i + 1];
    const acc = moveAccuracy(before, after);
    const w = weights[i] ?? 1;
    wsum += w;
    wacc += acc * w;
    inv += 1 / Math.max(acc, 0.1);
    count++;
  }
  if (count === 0) return 100;
  return (wacc / wsum + count / inv) / 2;
}

const emptyCounts = (): Record<Cls, number> =>
  Object.fromEntries(CLS_ORDER.map((c) => [c, 0])) as Record<Cls, number>;

/** 整盘回顾 */
export function reviewGame(input: ReviewInput, opening?: { name: string; ply: number }): GameReview {
  const wins = input.evals.map((e) => winFor(e, "white") * 100);
  const moves: MoveReview[] = [];
  const counts = { white: emptyCounts(), black: emptyCounts() };
  let lastBook = 0;
  for (let ply = 1; ply <= input.moves.length; ply++) if (input.book[ply]) lastBook = ply;
  for (let ply = 1; ply <= input.moves.length; ply++) {
    const color: Color = ply % 2 === 1 ? "white" : "black";
    const { cls, loss } = classify(input, ply);
    const b = color === "white" ? wins[ply - 1] : 100 - wins[ply - 1];
    const a = color === "white" ? wins[ply] : 100 - wins[ply];
    counts[color][cls]++;
    moves.push({
      ply,
      color,
      uci: input.moves[ply - 1],
      cls,
      loss,
      accuracy: moveAccuracy(b, a),
      key: KEY.includes(cls) || (cls === "book" && ply === lastBook),
    });
  }
  const accuracy = { white: gameAccuracy(wins, "white"), black: gameAccuracy(wins, "black") };
  return {
    moves,
    accuracy,
    counts,
    rating: { white: gameRatingOf(moves, "white", accuracy.white), black: gameRatingOf(moves, "black", accuracy.black) },
    areas: {
      white: areaGrades(moves, input.positions, input.evals, "white", winFor),
      black: areaGrades(moves, input.positions, input.evals, "black", winFor),
    },
    opening: opening?.name,
    openingPly: opening?.ply,
  };
}

/** 从这步往后, 下一个要讲的步 (只看某一方时跳过另一方的) */
export function nextKey(review: GameReview, ply: number, only?: Color): number | undefined {
  return review.moves.find((m) => m.ply > ply && m.key && (!only || m.color === only))?.ply;
}

/** 白方胜算 (0–100), 画曲线和评估条用 */
export function whiteWins(evals: PosEval[]): number[] {
  return evals.map((e) => winFor(e, "white") * 100);
}
