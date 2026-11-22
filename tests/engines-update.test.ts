import { describe, expect, it, vi } from "vitest";

vi.mock("../src/transport", () => ({ transport: {} }));

import { addDownloaded, fillRatings, type EngineEntry } from "../src/engines";
import { listedElo } from "../src/ratings";

const sf19: EngineEntry = {
  id: "sf",
  name: "Stockfish 19",
  path: "/app/engines/stockfish-sf_19/stockfish/stockfish-macos-universal",
  strength: { kind: "elo", min: 1320, max: 3190 },
};
const komodo: EngineEntry = { id: "ko", name: "Komodo 14.1", path: "/app/engines/komodo-14.1/OSX/komodo", strength: null };
const sf20: EngineEntry = {
  id: "new",
  name: "Stockfish 20",
  path: "/app/engines/stockfish-sf_20/stockfish/stockfish-macos-universal",
  strength: { kind: "elo", min: 1320, max: 3190 },
};

describe("下载新版 Stockfish", () => {
  it("换掉旧版, 还是原来那一条 (位置和编号不变)", () => {
    const list = addDownloaded([sf19, komodo], sf20);
    expect(list.map((e) => e.name)).toEqual(["Stockfish 20", "Komodo 14.1"]);
    expect(list[0].id).toBe("sf");
    expect(list[0].path).toBe(sf20.path);
  });

  it("以前没下载过就加在最后", () => {
    const list = addDownloaded([komodo], sf20);
    expect(list.map((e) => e.id)).toEqual(["ko", "new"]);
  });

  it("自己添加的 Stockfish 不换", () => {
    const mine: EngineEntry = { ...sf19, id: "mine", path: "/Users/x/stockfish" };
    const list = addDownloaded([mine, sf19], sf20);
    expect(list.map((e) => e.id)).toEqual(["mine", "sf"]);
  });
});

describe("等级分", () => {
  const listed = [
    { name: "Stockfish", version: "19", elo: 3635 },
    { name: "Stockfish", version: "20", elo: 3660 },
    { name: "Komodo", version: "14", elo: 3479 },
  ];

  it("按名字和版本在清单里找", () => {
    expect(listedElo("Stockfish 20", listed)).toBe(3660);
    expect(listedElo("Komodo 14.1", listed)).toBe(3479);
    expect(listedElo("Stockfish 200", listed)).toBeUndefined();
    expect(listedElo("Stockfish 21", listed)).toBeUndefined();
  });

  it("新版不认得就去清单里补上", async () => {
    const filled = await fillRatings([sf20, komodo], async () => listed);
    expect(filled?.find((e) => e.id === "new")?.elo).toBe(3660);
  });

  it("都认得就不去问", async () => {
    const ask = vi.fn(async () => listed);
    expect(await fillRatings([sf19, komodo], ask)).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });

  it("清单里也没有、或者上不了网, 就先空着", async () => {
    const sf21 = { ...sf20, name: "Stockfish 21" };
    expect(await fillRatings([sf21], async () => listed)).toBeNull();
    expect(
      await fillRatings([sf21], async () => {
        throw new Error("断网");
      }),
    ).toBeNull();
  });
});

describe("CCRL 的分", () => {
  it("按线程数挑 1 个核或 4 个核的分", async () => {
    const { ccrlElo } = await import("../src/ratings");
    expect(ccrlElo("Stockfish 19")).toBe(3629);
    expect(ccrlElo("Stockfish 19", 4)).toBe(3650);
    expect(ccrlElo("Stockfish 19", 8)).toBe(3650);
    expect(ccrlElo("Stockfish 19", 2)).toBe(3629);
    expect(ccrlElo("Komodo 14.1")).toBe(3403);
    expect(ccrlElo("Dragon by Komodo Chess", 4)).toBe(3568);
    expect(ccrlElo("Dragon by Komodo 3.3")).toBeUndefined();
    expect(ccrlElo("RubiChess 20240817")).toBe(3568);
    expect(ccrlElo("Lc0 v0.32.1")).toBeUndefined();
  });

  it("CCRL 有就用 CCRL 的, 没有才用清单里的", async () => {
    const { engineElo } = await import("../src/engines");
    expect(engineElo({ ...komodo, elo: 3479 })).toBe(3403);
    expect(engineElo({ ...sf20, elo: 3660 }, 4)).toBe(3660);
  });
});
