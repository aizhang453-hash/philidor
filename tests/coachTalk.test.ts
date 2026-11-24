import { describe, expect, it } from "vitest";
import { importPgn } from "../src/pgnImport";
import { coachTalk, moveFacts, planQuotes } from "../src/coachTalk";
import type { GameReview, MoveReview, PosEval } from "../src/review";

// 用户那盘: 1.d4 e5 2.Nf3 d6 3.Bg5 c6?? (送后) 4.e3? (没吃后) … 8.Bxd8 (吃后)
const g = importPgn("1. d4 e5 2. Nf3 d6 3. Bg5 c6 4. e3 b5 5. Nbd2 Nf6 6. Bd3 Nbd7 7. dxe5 Ng4 8. Bxd8 *");
const ev = (best?: string, pv: string[] = best ? [best] : []): PosEval => ({ cp: 0, best, pv });
const evals: PosEval[] = g.positions.map(() => ev());
evals[5] = ev("f8e7"); // 3.Bg5 以后黑方该走 Be7
evals[6] = ev("g5d8", ["g5d8", "e8d8"]); // 3...c6 以后白方能 Bxd8 吃后, 黑方再 Kxd8
const mr = (ply: number, cls: MoveReview["cls"], key = true): MoveReview => ({
  ply,
  color: ply % 2 ? "white" : "black",
  uci: g.plies[ply - 1].uci,
  cls,
  loss: 0,
  accuracy: 50,
  key,
});

describe("教练说的话 (不用 AI)", () => {
  it("送后的败着: 说出丢了后、对方怎么吃、该怎么走", () => {
    const f = moveFacts(6, g.positions, g.plies, evals);
    expect(f.loses).toEqual({ role: "queen", san: "Bxd8" });
    expect(f.best).toBe("Be7");
    expect(coachTalk(mr(6, "blunder"), f, undefined).fact).toBe("这步把后送掉了：对方能用 Bxd8 吃它。该走 Be7。");
  });

  it("错失: 说出该吃后", () => {
    const f = moveFacts(7, g.positions, g.plies, evals);
    expect(f.bestWins).toBe("queen");
    expect(coachTalk(mr(7, "miss"), f, undefined).fact).toBe("对方刚才露了破绽，这里走 Bxd8 能吃掉后。");
  });

  it("吃后的最佳: 夸, 不说坏话", () => {
    const t = coachTalk(mr(15, "best"), moveFacts(15, g.positions, g.plies, evals), undefined);
    expect(t.fact).toBe("好，吃掉了对方的后。");
    expect(t.tone).not.toMatch(/错|贪|失误/);
  });

  it("往事、原话: 一字不改, 一盘最多两次, 隔开三个关键步", () => {
    const moves = [mr(1, "book"), mr(2, "book"), mr(3, "book"), mr(4, "book"), mr(5, "mistake"), mr(6, "blunder"), mr(7, "miss")];
    const review = { moves } as unknown as GameReview;
    const plan = planQuotes(review, (p) => moveFacts(p, g.positions, g.plies, evals));
    expect(plan.get(3)?.id).toBe("knight"); // 2.Nf3 开局出马
    expect(plan.get(6)?.id).toBe("blunders"); // 送后的败着
    expect(plan.size).toBeLessThanOrEqual(2);
    const t = coachTalk(moves[5], moveFacts(6, g.positions, g.plies, evals), plan.get(6));
    expect(t.quote).toBe(true);
    expect(t.tone).toBe("1899 年有人采访我，我说过：没有哪位大棋手比我出错更多。");
  });
});
