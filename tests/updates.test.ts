import { describe, expect, it, vi } from "vitest";
import { findUpdates, isNewer } from "../src/updates";
import type { EngineEntry } from "../src/engines";

const rubi: EngineEntry = { id: "rubi", name: "RubiChess 20240817", path: "/e/rubichess/RubiChess", strength: null };
const sf: EngineEntry = { id: "sf", name: "Stockfish 19", path: "/e/sf/stockfish", strength: null };

describe("查新版", () => {
  it("按数字比版本号", () => {
    expect(isNewer("20261201", "20240817")).toBe(true);
    expect(isNewer("20240817", "20240817")).toBe(false);
    expect(isNewer("20240112", "20240817")).toBe(false);
    expect(isNewer("v2.0", "20240817")).toBe(false);
  });

  it("RubiChess 出了新版就记下来, 别的引擎不问", async () => {
    const ask = vi.fn(async () => "20261201");
    expect(await findUpdates([sf, rubi], ask)).toEqual({ rubi: "20261201" });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith("Matthies/RubiChess");
  });

  it("已经是最新的、或者上不了网, 就没有提醒", async () => {
    expect(await findUpdates([rubi], async () => "20240817")).toEqual({});
    expect(
      await findUpdates([rubi], async () => {
        throw new Error("断网");
      }),
    ).toEqual({});
  });
});
