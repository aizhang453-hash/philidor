import { describe, expect, it } from "vitest";
import { Game, outcomeText, resultTag } from "../src/game";

function playAll(g: Game, moves: string) {
  for (const m of moves.split(" ")) {
    const ply = g.play(m);
    if (!ply) throw new Error(`走不了 ${m}`);
  }
}

describe("走子", () => {
  it("开局走法和 SAN", () => {
    const g = new Game();
    const p = g.play("e2e4")!;
    expect(p.san).toBe("e4");
    expect(p.capture).toBe(false);
    expect(g.turn).toBe("black");
    expect(g.fen).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
  });

  it("不合规的棋不改局面", () => {
    const g = new Game();
    expect(g.play("e2e5")).toBeUndefined();
    expect(g.play("e7e5")).toBeUndefined();
    expect(g.play("xyz")).toBeUndefined();
    expect(g.plies.length).toBe(0);
  });

  it("吃子", () => {
    const g = new Game();
    playAll(g, "e2e4 d7d5");
    const p = g.play("e4d5")!;
    expect(p.capture).toBe(true);
    expect(p.san).toBe("exd5");
  });

  it("吃过路兵算吃子", () => {
    const g = new Game();
    playAll(g, "e2e4 a7a6 e4e5 d7d5");
    const p = g.play("e5d6")!;
    expect(p.capture).toBe(true);
    expect(p.san).toBe("exd6");
  });

  it("王车易位: 拖到 g1 和拖到车上都认, 记成 e1g1", () => {
    for (const castle of ["e1g1", "e1h1"]) {
      const g = new Game();
      playAll(g, "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6");
      const p = g.play(castle)!;
      expect(p.san).toBe("O-O");
      expect(p.uci).toBe("e1g1");
      expect(p.to).toBe("g1");
      expect(p.capture).toBe(false);
    }
  });

  it("长易位", () => {
    const g = new Game();
    playAll(g, "d2d4 d7d5 b1c3 b8c6 c1f4 c8f5 d1d2 d8d7");
    const p = g.play("e1c1")!;
    expect(p.san).toBe("O-O-O");
    expect(p.uci).toBe("e1c1");
  });

  it("升变要选子, 选了才能走", () => {
    const g = new Game();
    playAll(g, "a2a4 b7b5 a4b5 a7a6 b5a6 c8b7 a6a7 b7c6");
    expect(g.needsPromotion("a7", "b8")).toBe(true);
    expect(g.needsPromotion("e2", "e4")).toBe(false);
    expect(g.play("a7b8")).toBeUndefined();
    const p = g.play("a7b8n")!;
    expect(p.san).toBe("axb8=N");
    expect(p.uci).toBe("a7b8n");
  });

  it("将军", () => {
    const g = new Game();
    playAll(g, "e2e4 f7f6");
    expect(g.play("d1h5")!.check).toBe(true);
    expect(g.inCheck).toBe(true);
  });

  it("悔棋", () => {
    const g = new Game();
    playAll(g, "e2e4 e7e5 g1f3");
    g.undo(2);
    expect(g.plies.length).toBe(1);
    expect(g.turn).toBe("black");
    g.undo(5);
    expect(g.plies.length).toBe(0);
    expect(g.turn).toBe("white");
  });
});

describe("结束", () => {
  it("愚人杀", () => {
    const g = new Game();
    playAll(g, "f2f3 e7e5 g2g4 d8h4");
    const o = g.outcome()!;
    expect(o).toEqual({ winner: "black", reason: "checkmate" });
    expect(outcomeText(o)).toBe("将死，黑方胜");
    expect(resultTag(o)).toBe("0-1");
    expect(g.play("a2a3")).toBeUndefined();
  });

  it("三次重复", () => {
    const g = new Game();
    playAll(g, "g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1");
    expect(g.outcome()).toBeUndefined();
    g.play("f6g8");
    expect(g.outcome()).toEqual({ reason: "threefold" });
    expect(outcomeText(g.outcome()!)).toBe("三次重复，和棋");
  });

  it("认输", () => {
    const g = new Game();
    g.play("e2e4");
    g.resign("black");
    expect(outcomeText(g.outcome()!)).toBe("黑方认输，白方胜");
    g.undo(1);
    expect(g.outcome()).toBeUndefined();
  });

  it("逼和", () => {
    const g = new Game();
    // 最快的逼和 (Sam Loyd, 10 步)
    playAll(g, "e2e3 a7a5 d1h5 a8a6 h5a5 h7h5 h2h4 a6h6 a5c7 f7f6 c7d7 e8f7 d7b7 d8d3 b7b8 d3h7 b8c8 f7g6 c8e6");
    expect(g.outcome()).toEqual({ reason: "stalemate" });
    expect(outcomeText(g.outcome()!)).toBe("逼和，和棋");
  });
});
