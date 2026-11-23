// 让引擎把一盘棋从头到尾每个局面都看一遍, 再交给 review.ts 分好坏。
import type { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { UciEngine, type InfoLine, type Score } from "./uci";
import { matedEval, reviewGame, winPercent, type GameReview, type PosEval } from "./review";
import { bookKey, type Book } from "./book";
import { isOpeningPosition, openingNameOf, type Openings } from "./openings";
import type { Color } from "./game";

export interface AnalysisOptions {
  /** 每个局面想多少毫秒 */
  movetime: number;
  threads: number;
  hash: number;
}

export interface Analysis {
  evals: PosEval[];
  review: GameReview;
}

/** 引擎报的分数是从轮到走的一方看的, 换成从白方看 */
export function toWhite(score: Score, turn: Color): Pick<PosEval, "cp" | "mate"> {
  const sign = turn === "white" ? 1 : -1;
  return "mate" in score ? { mate: score.mate * sign } : { cp: score.cp * sign };
}

/** 引擎的几条线 → 这个局面的分析 */
export function evalFromLines(lines: InfoLine[], turn: Color): PosEval {
  const first = lines[0];
  if (!first) return { cp: 0, pv: [] };
  const e: PosEval = { ...toWhite(first.score, turn), best: first.pv[0], pv: first.pv };
  const second = lines[1];
  if (second) {
    const w = winPercent(toWhite(second.score, turn));
    e.second = (turn === "white" ? w : 100 - w) / 100;
  }
  return e;
}

/** 每一步还在不在开局理论里 (下标从 1 数; 一出来就不算了) */
export function bookFlags(moves: string[], positions: readonly Chess[], openings: Openings | null, book: Book | null): boolean[] {
  const flags = [false];
  let inBook = true;
  for (let ply = 1; ply <= moves.length; ply++) {
    if (inBook) {
      const fen = makeFen(positions[ply].toSetup());
      const known = openings ? isOpeningPosition(openings, fen) : false;
      const fromBook = book?.positions.get(bookKey(makeFen(positions[ply - 1].toSetup())))?.some(([u]) => u === moves[ply - 1]);
      inBook = known || !!fromBook;
    }
    flags.push(inBook);
  }
  return flags;
}

/** 这盘棋的开局名: 开局理论里走到的最深的、有名字的局面 */
export function findOpening(positions: readonly Chess[], book: boolean[], openings: Openings | null) {
  if (!openings) return undefined;
  let found: { name: string; ply: number } | undefined;
  for (let ply = 1; ply < positions.length && book[ply]; ply++) {
    const name = openingNameOf(openings, makeFen(positions[ply].toSetup()));
    if (name) found = { name, ply };
  }
  return found;
}

/** 结束的局面不用问引擎 */
function terminal(pos: Chess): PosEval | undefined {
  if (pos.isCheckmate()) return matedEval(pos.turn);
  if (pos.isStalemate() || pos.isInsufficientMaterial()) return { cp: 0, pv: [] };
  return undefined;
}

export async function analyseGame(
  enginePath: string,
  moves: string[],
  positions: readonly Chess[],
  opts: AnalysisOptions,
  extra: { openings: Openings | null; book: Book | null },
  onProgress: (done: number, total: number) => void,
  cancelled: () => boolean,
): Promise<Analysis | null> {
  const engine = await UciEngine.open(enginePath);
  try {
    engine.configure(null, opts.threads, opts.hash);
    await engine.newGame();
    const evals: PosEval[] = [];
    const total = positions.length;
    const startFen = makeFen(positions[0].toSetup());
    const fen = startFen === "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" ? undefined : startFen;
    for (let i = 0; i < total; i++) {
      if (cancelled()) return null;
      onProgress(i, total);
      const pos = positions[i];
      const end = terminal(pos);
      if (end) {
        evals.push(end);
        continue;
      }
      const lines = await engine.analyse(moves.slice(0, i), `movetime ${opts.movetime}`, i < total - 1 ? 2 : 1, opts.movetime + 20_000, fen);
      evals.push(evalFromLines(lines, pos.turn));
    }
    if (cancelled()) return null;
    onProgress(total, total);
    const book = bookFlags(moves, positions, extra.openings, extra.book);
    const review = reviewGame({ moves, positions, evals, book }, findOpening(positions, book, extra.openings));
    return { evals, review };
  } finally {
    engine.quit();
  }
}
