// 粘贴进来的棋谱 (PGN) → 一盘棋: 双方名字、每一步、每个局面、每步用时 (棋谱里有 [%clk] 才有)。
import { parsePgn, startingPosition } from "chessops/pgn";
import { makeSan } from "chessops/san";
import { parseSan } from "chessops/san";
import { castlingSide, type Chess } from "chessops/chess";
import { makeSquare, kingCastlesTo } from "chessops/util";
import type { NormalMove } from "chessops/types";
import type { Ply } from "./game";

export interface ImportedGame {
  white: string;
  black: string;
  plies: Ply[];
  positions: Chess[];
  moveTimes: number[];
}

function clock(comments: string[] | undefined): number | undefined {
  for (const c of comments ?? []) {
    const m = c.match(/\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/);
    if (m) return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000;
  }
  return undefined;
}

/** 读第一盘棋; 读不了抛出说明 */
export function importPgn(text: string): ImportedGame {
  const games = parsePgn(text.trim());
  const g = games[0];
  if (!g) throw new Error("没有认出棋谱");
  const start = startingPosition(g.headers);
  if (start.isErr) throw new Error("开始的局面不对");
  const pos = start.value as Chess;
  if (pos.rules !== "chess") throw new Error("只能回顾普通国际象棋");
  const positions: Chess[] = [pos.clone()];
  const plies: Ply[] = [];
  const clocks: (number | undefined)[] = [];
  const base = Number((g.headers.get("TimeControl") ?? "").split("+")[0]) * 1000 || undefined;
  const inc = Number((g.headers.get("TimeControl") ?? "").split("+")[1] ?? 0) * 1000 || 0;
  for (const node of g.moves.mainline()) {
    const move = parseSan(pos, node.san) as NormalMove | undefined;
    if (!move || !("from" in move)) throw new Error(`第 ${Math.floor(plies.length / 2) + 1} 回合的 ${node.san} 走不了`);
    const side = castlingSide(pos, move);
    const capture = !side && (pos.board.occupied.has(move.to) || (pos.board.get(move.from)?.role === "pawn" && (move.from & 7) !== (move.to & 7)));
    const san = makeSan(pos, move);
    const to = side ? kingCastlesTo(pos.turn, side) : move.to;
    const promo = move.promotion ? (move.promotion === "knight" ? "n" : move.promotion[0]) : "";
    pos.play(move);
    plies.push({ uci: makeSquare(move.from) + makeSquare(to) + promo, san, from: makeSquare(move.from), to: makeSquare(to), capture, check: pos.isCheck() });
    positions.push(pos.clone());
    clocks.push(clock(node.comments));
  }
  if (plies.length === 0) throw new Error("棋谱里没有走法");
  // 每步用时 = 上一次自己的钟 − 这次的钟 + 每步加的秒数
  const moveTimes: number[] = [];
  if (clocks.every((c) => c !== undefined)) {
    for (let i = 0; i < clocks.length; i++) {
      const prev = i >= 2 ? clocks[i - 2] : base;
      moveTimes.push(prev === undefined ? 0 : Math.max(0, prev - clocks[i]! + (i >= 2 ? inc : 0)));
    }
  }
  const name = (k: string, d: string) => {
    const v = (g.headers.get(k) ?? "").trim();
    return v && v !== "?" ? v : d;
  };
  return { white: name("White", "白方"), black: name("Black", "黑方"), plies, positions, moveTimes };
}
