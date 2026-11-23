// 一盘棋: 走子、判断合不合规、什么时候结束。不碰界面, 方便单独测试。
import { Chess, castlingSide } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { chessgroundDests } from "chessops/compat";
import { parseUci, makeSquare, parseSquare, squareRank, kingCastlesTo, opposite } from "chessops/util";
import type { Color, NormalMove } from "chessops/types";

export type { Color };

export type Reason =
  | "checkmate"
  | "stalemate"
  | "insufficient"
  | "threefold"
  | "fifty"
  | "resign"
  | "timeout"
  | "engine-error";

export interface Outcome {
  winner?: Color;
  reason: Reason;
  /** 超时的是哪一方 */
  by?: Color;
}

export interface Ply {
  /** 引擎用的写法, 王车易位写成 e1g1 */
  uci: string;
  san: string;
  from: string;
  to: string;
  capture: boolean;
  check: boolean;
}

const repetitionKey = (pos: Chess) => makeFen(pos.toSetup()).split(" ").slice(0, 4).join(" ");

export class Game {
  readonly plies: Ply[] = [];
  private positions: Chess[] = [Chess.default()];
  private ended?: Outcome;

  get pos(): Chess {
    return this.positions[this.positions.length - 1];
  }

  get turn(): Color {
    return this.pos.turn;
  }

  /** 每一步之后的局面 (第 0 个是开局) */
  get history(): readonly Chess[] {
    return this.positions;
  }

  get fen(): string {
    return makeFen(this.pos.toSetup());
  }

  get moves(): string[] {
    return this.plies.map((p) => p.uci);
  }

  get lastPly(): Ply | undefined {
    return this.plies[this.plies.length - 1];
  }

  get inCheck(): boolean {
    return this.pos.isCheck();
  }

  dests() {
    return chessgroundDests(this.pos);
  }

  /** 兵走到底线要选升变成什么 */
  needsPromotion(from: string, to: string): boolean {
    const f = parseSquare(from);
    const t = parseSquare(to);
    if (f === undefined || t === undefined) return false;
    const piece = this.pos.board.get(f);
    if (!piece || piece.role !== "pawn") return false;
    const rank = squareRank(t);
    return rank === 0 || rank === 7;
  }

  /** 走一步 (e2e4、e7e8q、e1g1 或 e1h1 都认)。不合规就返回 undefined, 什么也不改。 */
  play(uci: string): Ply | undefined {
    if (this.outcome()) return undefined;
    const parsed = parseUci(uci);
    if (!parsed || !("from" in parsed)) return undefined;
    const move = parsed as NormalMove;
    const pos = this.pos;
    if (!pos.isLegal(move)) return undefined;

    const piece = pos.board.get(move.from)!;
    const side = castlingSide(pos, move);
    const enPassant = piece.role === "pawn" && (move.from & 7) !== (move.to & 7) && !pos.board.occupied.has(move.to);
    const capture = !side && (pos.board.occupied.has(move.to) || enPassant);
    const san = makeSan(pos, move);
    const next = pos.clone();
    next.play(move);

    const to = side ? kingCastlesTo(pos.turn, side) : move.to;
    const standard = makeSquare(move.from) + makeSquare(to) + (move.promotion ? promotionChar(move.promotion) : "");
    const ply: Ply = {
      uci: standard,
      san,
      from: makeSquare(move.from),
      to: makeSquare(to),
      capture,
      check: next.isCheck(),
    };
    this.plies.push(ply);
    this.positions.push(next);
    return ply;
  }

  /** 结束了就返回结果 */
  outcome(): Outcome | undefined {
    if (this.ended) return this.ended;
    const pos = this.pos;
    if (pos.isCheckmate()) return { winner: opposite(pos.turn), reason: "checkmate" };
    if (pos.isStalemate()) return { reason: "stalemate" };
    if (pos.isInsufficientMaterial()) return { reason: "insufficient" };
    if (pos.halfmoves >= 100) return { reason: "fifty" };
    const key = repetitionKey(pos);
    let same = 0;
    for (const p of this.positions) if (repetitionKey(p) === key) same++;
    if (same >= 3) return { reason: "threefold" };
    return undefined;
  }

  resign(color: Color) {
    if (!this.outcome()) this.ended = { winner: opposite(color), reason: "resign" };
  }

  /** 时间用完: 对方有子力将死就算输, 对方子力不够将死就和棋 */
  timeout(color: Color) {
    if (this.outcome()) return;
    const other = opposite(color);
    this.ended = this.pos.hasInsufficientMaterial(other)
      ? { reason: "timeout", by: color }
      : { winner: other, reason: "timeout", by: color };
  }

  /** 引擎出错 (走了不合规的棋、没反应、退出了), 算它输 */
  forfeit(color: Color) {
    if (!this.outcome()) this.ended = { winner: opposite(color), reason: "engine-error" };
  }

  /** 退回 n 步 */
  undo(n = 1) {
    this.ended = undefined;
    for (let i = 0; i < n && this.plies.length > 0; i++) {
      this.plies.pop();
      this.positions.pop();
    }
  }
}

const promotionChar = (role: string) => (role === "knight" ? "n" : role[0]);

const REASON_TEXT: Record<Reason, string> = {
  checkmate: "将死",
  stalemate: "逼和",
  insufficient: "子力不足",
  threefold: "三次重复",
  fifty: "五十步",
  resign: "认输",
  timeout: "超时",
  "engine-error": "引擎出错",
};

const COLOR_TEXT: Record<Color, string> = { white: "白方", black: "黑方" };

export function colorText(color: Color) {
  return COLOR_TEXT[color];
}

export function outcomeText(o: Outcome): string {
  const reason = REASON_TEXT[o.reason];
  if (o.reason === "timeout" && o.by) {
    return o.winner ? `${COLOR_TEXT[o.by]}超时，${COLOR_TEXT[o.winner]}胜` : `${COLOR_TEXT[o.by]}超时，和棋`;
  }
  if (!o.winner) return `${reason}，和棋`;
  if (o.reason === "resign") return `${COLOR_TEXT[opposite(o.winner)]}认输，${COLOR_TEXT[o.winner]}胜`;
  return `${reason}，${COLOR_TEXT[o.winner]}胜`;
}

export function resultTag(o: Outcome | undefined): string {
  if (!o) return "*";
  if (!o.winner) return "1/2-1/2";
  return o.winner === "white" ? "1-0" : "0-1";
}
