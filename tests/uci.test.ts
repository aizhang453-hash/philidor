import { describe, expect, it } from "vitest";
import { cleanName, parseOption, strengthOf } from "../src/uci";
import { strengthLevels } from "../src/engines";

describe("读引擎的设置项", () => {
  it("数字", () => {
    expect(parseOption("option name Skill Level type spin default 20 min 0 max 20")).toEqual({
      name: "Skill Level",
      type: "spin",
      default: "20",
      min: 0,
      max: 20,
      vars: [],
    });
  });

  it("名字里有空格、默认值是 <empty>", () => {
    const o = parseOption("option name Hash File Name type string default <empty>")!;
    expect(o.name).toBe("Hash File Name");
    expect(o.default).toBe("<empty>");
  });

  it("下拉选项", () => {
    const o = parseOption("option name Style type combo default Normal var Solid var Normal var Risky")!;
    expect(o.default).toBe("Normal");
    expect(o.vars).toEqual(["Solid", "Normal", "Risky"]);
  });

  it("按钮", () => {
    expect(parseOption("option name Clear Hash type button")).toEqual({ name: "Clear Hash", type: "button", vars: [] });
  });
});

describe("棋力", () => {
  const sf = [
    "option name Skill Level type spin default 20 min 0 max 20",
    "option name UCI_LimitStrength type check default false",
    "option name UCI_Elo type spin default 1320 min 1320 max 3190",
  ].map((l) => parseOption(l)!);
  const komodo = ["option name Skill type spin default 25 min 0 max 25"].map((l) => parseOption(l)!);

  it("Stockfish 用分数", () => {
    expect(strengthOf(sf)).toEqual({ kind: "elo", min: 1320, max: 3190 });
    const levels = strengthLevels(strengthOf(sf));
    expect(levels[0]).toEqual({ value: null, label: "满力" });
    expect(levels[1]).toEqual({ value: 1320, label: "1320 分" });
    expect(levels[2].value).toBe(1400);
    expect(levels[levels.length - 1].value).toBe(3100);
  });

  it("Komodo 用等级", () => {
    expect(strengthOf(komodo)).toEqual({ kind: "skill", option: "Skill", min: 0, max: 25 });
    const levels = strengthLevels(strengthOf(komodo));
    expect(levels.length).toBe(26);
    expect(levels[1]).toEqual({ value: 0, label: "等级 0" });
  });

  it("调不了的只有满力", () => {
    expect(strengthLevels(strengthOf([]))).toEqual([{ value: null, label: "满力" }]);
  });
});

it("引擎名字", () => {
  expect(cleanName("Komodo 14.1 64-bit ")).toBe("Komodo 14.1");
  expect(cleanName("Dragon by Komodo Chess  64-bit ")).toBe("Dragon by Komodo Chess");
  expect(cleanName("Stockfish 19")).toBe("Stockfish 19");
  expect(cleanName("RubiChess 20240817 (dotprod)")).toBe("RubiChess 20240817");
  expect(cleanName("RubiChess 20240817 (avx2)")).toBe("RubiChess 20240817");
});
