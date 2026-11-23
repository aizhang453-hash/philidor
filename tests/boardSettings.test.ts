import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { BOARDS, PIECE_SETS, SOUNDS, sanText } from "../src/boardSettings";

describe("棋盘设置", () => {
  it("记谱换成棋子图", () => {
    expect(sanText("Nf3", "white", false)).toBe("Nf3");
    expect(sanText("Nf3", "white", true)).toBe("♞f3");
    expect(sanText("Qxd8+", "black", true)).toBe("♕xd8+");
    expect(sanText("e8=Q#", "white", true)).toBe("e8=♛#");
    expect(sanText("O-O", "white", true)).toBe("O-O");
  });

  it("清单里的棋子、棋盘、声音文件都在", () => {
    for (const p of PIECE_SETS) expect(existsSync(`public/pieces/${p.id}.css`), p.id).toBe(true);
    for (const b of BOARDS) expect(existsSync(`public/board/${b.file}`), b.file).toBe(true);
    for (const s of SOUNDS) {
      expect(existsSync(`public/sound/${s.id}/Move.mp3`), s.id).toBe(true);
      expect(existsSync(`public/sound/${s.id}/Capture.mp3`), s.id).toBe(true);
      if (s.check) expect(existsSync(`public/sound/${s.id}/Check.mp3`), s.id).toBe(true);
    }
  });
});
