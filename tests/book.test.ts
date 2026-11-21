import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { bookKey, parseBook, pickBookMove } from "../src/book";
import { Game } from "../src/game";

const book = parseBook(JSON.parse(readFileSync("public/book/book.json", "utf8")));
const START = new Game().fen;

describe("开局库", () => {
  it("开局第一步在库里, 抽签按盘数", () => {
    const moves = book.positions.get(bookKey(START))!;
    expect(moves.map(([u]) => u)).toContain("e2e4");
    expect(pickBookMove(book, START, 0, () => 0)).toBe(moves[0][0]);
    expect(pickBookMove(book, START, 0, () => 0.999999)).toBe(moves[moves.length - 1][0]);
  });

  it("超过步数、不在库里的局面不给", () => {
    expect(pickBookMove(book, START, book.maxPly)).toBeUndefined();
    expect(pickBookMove(book, "8/8/8/4k3/8/8/8/4K3 w - - 0 1", 0)).toBeUndefined();
  });

  it("库里每一步都是合规的", () => {
    let n = 0;
    for (const [key, moves] of book.positions) {
      const pos = Chess.fromSetup(parseFen(`${key} 0 1`).unwrap()).unwrap();
      for (const [uci] of moves) {
        const m = parseUci(uci);
        expect(m && pos.isLegal(m), `${key} ${uci}`).toBe(true);
        n++;
      }
    }
    expect(n).toBeGreaterThan(5000);
  });

  it("顺着库走, 每一步都能在棋盘上走", () => {
    for (let t = 0; t < 50; t++) {
      const g = new Game();
      for (let ply = 0; ply < book.maxPly; ply++) {
        const uci = pickBookMove(book, g.fen, ply);
        if (!uci) break;
        expect(g.play(uci), uci).toBeDefined();
      }
    }
  });
});
