import { describe, expect, it } from "vitest";
import { classify, gameAccuracy, moveAccuracy, reviewGame, winPercent, evalText, nextKey, type PosEval } from "../src/review";
import { parseInfo } from "../src/uci";
import { evalFromLines, bookFlags } from "../src/analysis";
import { importPgn } from "../src/pgnImport";
import { parseOpenings, chineseOpening, openingNameOf } from "../src/openings";
import { makeFen } from "chessops/fen";

const e = (cp: number, best?: string, second?: number): PosEval => ({ cp, best, pv: best ? [best] : [], second });

describe("对局回顾", () => {
  it("分数换成胜算", () => {
    expect(winPercent({ cp: 0 })).toBeCloseTo(50);
    expect(winPercent({ cp: 134 })).toBeCloseTo(62.1, 0);
    expect(winPercent({ mate: 3 })).toBeGreaterThan(97);
    expect(evalText({ cp: 134, pv: [] })).toBe("+1.34");
    expect(evalText({ mate: -2, pv: [] })).toBe("-M2");
  });

  it("读引擎的 info 行", () => {
    const i = parseInfo("info depth 18 seldepth 25 multipv 2 score cp -39 nodes 1 nps 1 pv g1f3 b8c6 d4d5");
    expect(i).toEqual({ depth: 18, multipv: 2, score: { cp: -39 }, pv: ["g1f3", "b8c6", "d4d5"] });
    expect(parseInfo("info depth 5 score cp 10 lowerbound pv e2e4")).toBeUndefined();
    expect(parseInfo("info string hello")).toBeUndefined();
    // 黑方走时引擎说 +50, 从白方看是 -50
    expect(evalFromLines([{ depth: 1, multipv: 1, score: { cp: 50 }, pv: ["e7e5"] }], "black").cp).toBe(-50);
  });

  it("按胜算掉了多少分好坏, 错失, 开局库", () => {
    const g = importPgn("1. d4 e5 2. Nf3 d6 3. Bg5 *");
    const moves = g.plies.map((p) => p.uci);
    // 1.d4 +0.30; 1...e5 后 +1.34 (送兵); 2.Nf3 后 -0.39 (没吃兵)
    const evals = [e(30, "d2d4"), e(30, "d7d5"), e(134, "d4e5"), e(-39, "b8c6"), e(-30, "c1g5"), e(-30)];
    const book = bookFlags(moves, g.positions, null, null);
    expect(book.slice(1)).toEqual([false, false, false, false, false]);
    const input = { moves, positions: g.positions, evals, book };
    expect(classify(input, 1).cls).toBe("best");
    expect(classify(input, 2).cls).toBe("inaccuracy");
    expect(classify(input, 3).cls).toBe("miss");
    const r = reviewGame({ ...input, book: [false, true, true, false, false, false] });
    expect(r.moves[1].cls).toBe("book");
    expect(r.moves[1].key).toBe(true);
    expect(r.counts.white.miss).toBe(1);
    expect(nextKey(r, 0)).toBe(2);
    expect(nextKey(r, 0, "white")).toBe(3);
  });

  it("精度", () => {
    expect(moveAccuracy(60, 60)).toBe(100);
    expect(moveAccuracy(60, 20)).toBeLessThan(20);
    expect(gameAccuracy([50, 50, 50, 50, 50], "white")).toBe(100);
    expect(gameAccuracy([50, 50, 90, 90, 90], "black")).toBeLessThan(gameAccuracy([50, 50, 90, 90, 90], "white"));
  });

  it("妙着: 好的弃子", () => {
    // 白后在 h5 吃 f7 将军, 后没人保护; 引擎说这是最好的、走完局面很好
    const g = importPgn('[FEN "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4"]\n\n4. Qxf7# *');
    const moves = g.plies.map((p) => p.uci);
    const input = { moves, positions: g.positions, evals: [e(900, "h5f7", 0.6), { mate: 0, cp: 100000, pv: [] }], book: [false, false] };
    // 吃了兵还将死, 不是弃子
    expect(classify(input, 1).cls).not.toBe("brilliant");
  });

  it("棋谱: 名字、王车易位、用时", () => {
    const g = importPgn(
      '[White "Eason"]\n[Black "Coach"]\n[TimeControl "600+5"]\n\n1. e4 {[%clk 0:09:58]} 1... e5 {[%clk 0:09:55]} 2. Nf3 {[%clk 0:09:50]} 2... Nc6 {[%clk 0:09:40]} 3. Bc4 {[%clk 0:09:45]} 3... Nf6 {[%clk 0:09:41]} 4. O-O {[%clk 0:09:40]} *',
    );
    expect(g.white).toBe("Eason");
    expect(g.plies[6].uci).toBe("e1g1");
    expect(g.plies[6].san).toBe("O-O");
    expect(g.moveTimes[0]).toBe(2000);
    expect(g.moveTimes[2]).toBe(13000);
    expect(() => importPgn("随便写的字")).toThrow();
  });

  it("开局名", () => {
    const g = importPgn("1. d4 e5 *");
    const fen = makeFen(g.positions[2].toSetup());
    const key = (f: string) => f.split(" ").slice(0, 4).join(" ");
    const o = parseOpenings({ positions: { [key(makeFen(g.positions[1].toSetup()))]: "", [key(fen)]: "A40 Englund Gambit" } });
    expect(openingNameOf(o, fen)).toBe("Englund Gambit");
    expect(chineseOpening("Sicilian Defense: Najdorf Variation")).toBe("西西里防御");
    const flags = bookFlags(g.plies.map((p) => p.uci), g.positions, o, null);
    expect(flags).toEqual([false, true, true]);
  });
});

import { ratingFromAccuracy, gradeOf } from "../src/gameRating";
describe("棋局等级", () => {
  it("精度换成分 (插值、两头封顶)", () => {
    const t: [number, number, number][] = [[500, 60, 1], [1500, 75, 1], [2500, 85, 1]];
    expect(ratingFromAccuracy(75, t)).toBe(1500);
    expect(ratingFromAccuracy(80, t)).toBe(2000);
    expect(ratingFromAccuracy(10, t)).toBe(500);
    expect(ratingFromAccuracy(99, t)).toBe(2500);
    expect(gradeOf(95)).toBe("excellent");
    expect(gradeOf(50)).toBe("mistake");
  });
});
