import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Match, type Player, type TimeControl } from "../src/match";
import { outcomeText } from "../src/game";
import { formatClock } from "../src/clock";

const human = (time: TimeControl | null): Player => ({ kind: "human", name: "玩家", time });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("棋钟", () => {
  it("扣掉用的时间, 走完加秒", async () => {
    const tc = { minutes: 1, increment: 2 };
    const m = new Match({ white: human(tc), black: human(tc) });
    await m.start();
    expect(m.hasClock).toBe(true);
    expect(m.remaining("white")).toBe(60_000);
    vi.advanceTimersByTime(5_000);
    expect(m.remaining("white")).toBe(55_000);
    expect(m.remaining("black")).toBe(60_000);
    expect(m.humanMove("e2e4")).toBe(true);
    expect(m.remaining("white")).toBe(57_000);
    vi.advanceTimersByTime(3_000);
    expect(m.remaining("black")).toBe(57_000);
    expect(m.remaining("white")).toBe(57_000);
    m.close();
  });

  it("时间用完判负", async () => {
    const tc = { minutes: 1, increment: 0 };
    const m = new Match({ white: human(tc), black: human(tc) });
    await m.start();
    vi.advanceTimersByTime(59_000);
    expect(m.over).toBe(false);
    vi.advanceTimersByTime(1_100);
    expect(m.over).toBe(true);
    expect(outcomeText(m.game.outcome()!)).toBe("白方超时，黑方胜");
    expect(m.remaining("white")).toBe(0);
    expect(m.movable).toBeUndefined();
    m.close();
  });

  it("悔棋把棋钟也退回去", async () => {
    const tc = { minutes: 1, increment: 2 };
    const m = new Match({ white: human(tc), black: human(tc) });
    await m.start();
    vi.advanceTimersByTime(5_000);
    m.humanMove("e2e4");
    vi.advanceTimersByTime(3_000);
    await m.undo();
    expect(m.game.plies.length).toBe(0);
    expect(m.remaining("white")).toBe(60_000);
    expect(m.remaining("black")).toBe(60_000);
    m.close();
  });

  it("认输以后棋钟停住", async () => {
    const tc = { minutes: 1, increment: 0 };
    const m = new Match({ white: human(tc), black: human(tc) });
    await m.start();
    vi.advanceTimersByTime(4_000);
    m.resign("white");
    vi.advanceTimersByTime(10_000);
    expect(m.remaining("white")).toBe(56_000);
    m.close();
  });

  it("不限时没有棋钟; 也可以只有一方限时", async () => {
    const a = new Match({ white: human(null), black: human(null) });
    await a.start();
    expect(a.hasClock).toBe(false);
    expect(a.remaining("white")).toBeNull();
    a.close();
    const b = new Match({ white: human({ minutes: 5, increment: 0 }), black: human(null) });
    await b.start();
    vi.advanceTimersByTime(1_000);
    b.humanMove("d2d4");
    vi.advanceTimersByTime(10 * 60_000);
    expect(b.over).toBe(false);
    expect(b.remaining("white")).toBe(299_000);
    expect(b.remaining("black")).toBeNull();
    b.close();
  });
});

it("棋钟的样子", () => {
  expect(formatClock(15 * 60_000)).toBe("15:00");
  expect(formatClock(65_400)).toBe("1:05");
  expect(formatClock(9_870)).toBe("0:09.8");
  expect(formatClock(-5)).toBe("0:00.0");
  expect(formatClock(3_600_000 + 61_000)).toBe("1:01:01");
});
