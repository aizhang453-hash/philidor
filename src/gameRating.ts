// 棋局等级: 这盘的精度相当于多少分的人一般能下出来的 (对照表见 ratingTable.ts, 是 Lichess 的分)。
// 四项评分: 开局、战术、战略、残局各自的步平均精度, 换成好坏图标。
import type { Chess } from "chessops/chess";
import type { Color } from "chessops/types";
import { RATING_TABLE } from "./ratingTable";
import type { Cls, MoveReview, PosEval } from "./review";

/** 少于这么多步不算棋局等级 */
const MIN_MOVES = 8;

/** 精度 → 分 (按对照表插值, 取到 50 分) */
export function ratingFromAccuracy(acc: number, table: [number, number, number][] = RATING_TABLE): number | undefined {
  if (table.length < 2) return undefined;
  // 对照表应该是分越高精度越高, 万一有起伏, 拉平
  const pts: [number, number][] = [];
  let top = -Infinity;
  for (const [r, a] of table) {
    top = Math.max(top, a);
    pts.push([r, top]);
  }
  let r: number;
  if (acc <= pts[0][1]) r = pts[0][0];
  else if (acc >= pts[pts.length - 1][1]) r = pts[pts.length - 1][0];
  else {
    const i = pts.findIndex(([, a]) => a >= acc);
    const [r0, a0] = pts[i - 1];
    const [r1, a1] = pts[i];
    r = a1 === a0 ? r1 : r0 + ((acc - a0) / (a1 - a0)) * (r1 - r0);
  }
  return Math.round(r / 50) * 50;
}

export type Area = "opening" | "tactics" | "strategy" | "endgame";
export const AREAS: Area[] = ["opening", "tactics", "strategy", "endgame"];
export const AREA_NAME: Record<Area, string> = { opening: "开局", tactics: "战术", strategy: "战略", endgame: "残局" };

const VALUE: Record<string, number> = { knight: 3, bishop: 3, rook: 5, queen: 9 };

/** 双方大子加起来几分 (不算兵和王) */
function material(pos: Chess): number {
  let s = 0;
  for (const [, p] of pos.board) s += VALUE[p.role] ?? 0;
  return s;
}

/** 平均精度 → 图标 */
export function gradeOf(acc: number): Cls {
  if (acc >= 90) return "excellent";
  if (acc >= 75) return "good";
  if (acc >= 60) return "inaccuracy";
  if (acc >= 45) return "mistake";
  return "blunder";
}

export function areaGrades(moves: MoveReview[], positions: readonly Chess[], evals: PosEval[], color: Color, win: (e: PosEval, c: Color) => number) {
  const sets: Record<Area, number[]> = { opening: [], tactics: [], strategy: [], endgame: [] };
  for (const m of moves) {
    if (m.color !== color) continue;
    const pos = positions[m.ply - 1];
    const before = evals[m.ply - 1];
    const best = win(before, color);
    // 局面尖锐: 只有一步好棋, 或者对方上一步送了机会
    const sharp =
      (before.second !== undefined && best - before.second >= 0.1) ||
      (m.ply >= 2 && best - win(evals[m.ply - 2], color) >= 0.1);
    if (sharp) sets.tactics.push(m.accuracy);
    if (material(pos) <= 20) sets.endgame.push(m.accuracy);
    else if (m.ply <= 20 || m.cls === "book") sets.opening.push(m.accuracy);
    else if (!sharp) sets.strategy.push(m.accuracy);
  }
  const out = {} as Record<Area, Cls | null>;
  for (const a of AREAS) {
    const xs = sets[a];
    out[a] = xs.length ? gradeOf(xs.reduce((s, x) => s + x, 0) / xs.length) : null;
  }
  return out;
}

export function gameRatingOf(moves: MoveReview[], color: Color, accuracy: number): number | undefined {
  return moves.filter((m) => m.color === color).length >= MIN_MOVES ? ratingFromAccuracy(accuracy) : undefined;
}
