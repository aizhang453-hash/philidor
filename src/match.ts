// 一场对局: 两边是谁 (人或引擎)、轮到引擎时让它想、棋钟、悔棋、暂停。界面只管显示。
import { Game, type Color } from "./game";
import { UciEngine } from "./uci";
import { playMoveSound } from "./sound";
import { pickBookMove, type Book } from "./book";

/** 限时: 每方几分钟, 每走一步加几秒。null 是不限时 */
export interface TimeControl {
  minutes: number;
  increment: number;
}

export type PlayerSetup =
  | { kind: "human"; time: TimeControl | null }
  | {
      kind: "engine";
      engine: string;
      movetime: number;
      level: number | null;
      time: TimeControl | null;
      /** 用几个线程 (几个核一起想) */
      threads: number;
      /** 哈希表多大 (MB) */
      hash: number;
    };

export type Player =
  | { kind: "human"; name: string; time: TimeControl | null }
  | {
      kind: "engine";
      name: string;
      path: string;
      /** 不限时的时候每步想多少毫秒 */
      movetime: number;
      level: number | null;
      time: TimeControl | null;
      threads: number;
      hash: number;
      /** 显示用的分: 限了棋力就是限的分, 满力就是引擎的等级分 */
      rating?: string;
    };

export type MatchStatus = "starting" | "playing" | "failed";

type Clock = Record<Color, number | null>;

const COLORS: Color[] = ["white", "black"];

/** 引擎对引擎时两步之间至少隔这么久, 看得清 */
const MIN_GAP = 350;
/** 引擎从开局库里走, 也稍等一下再走 */
const BOOK_DELAY = 400;

export class Match {
  readonly game = new Game();
  status: MatchStatus = "starting";
  thinking: Color | null = null;
  paused = false;
  error: string | null = null;

  private engines: Partial<Record<Color, UciEngine>> = {};
  private alive = true;
  private token = 0;
  private lastMoveAt = 0;
  private listeners = new Set<() => void>();

  /** 轮到的这一方开始想时还剩多少毫秒; null 是这一方不限时 */
  private clock: Clock;
  /** 每一步走之前的棋钟, 悔棋时退回去 */
  private clockBefore: Clock[] = [];
  private turnStart = 0;
  private flagTimer: ReturnType<typeof setTimeout> | undefined;
  /** 还在开局库里 (一出库就不再查) */
  private inBook = true;

  constructor(
    readonly players: Record<Color, Player>,
    private book: Book | null = null,
  ) {
    this.clock = {
      white: players.white.time ? players.white.time.minutes * 60_000 : null,
      black: players.black.time ? players.black.time.minutes * 60_000 : null,
    };
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  get humans(): Color[] {
    return COLORS.filter((c) => this.players[c].kind === "human");
  }

  get over() {
    return !!this.game.outcome();
  }

  get hasClock() {
    return this.clock.white !== null || this.clock.black !== null;
  }

  /** 棋钟在走 */
  get clockRunning() {
    return this.status === "playing" && !this.over && !this.paused;
  }

  /** 这一方还剩多少毫秒; null 是不限时 */
  remaining(color: Color): number | null {
    const c = this.clock[color];
    if (c === null) return null;
    if (this.clockRunning && color === this.game.turn) return Math.max(0, c - (Date.now() - this.turnStart));
    return c;
  }

  /** 现在能用鼠标走的一方 */
  get movable(): Color | undefined {
    if (this.status !== "playing" || this.thinking || this.over || this.paused) return undefined;
    const turn = this.game.turn;
    return this.players[turn].kind === "human" ? turn : undefined;
  }

  get canUndo(): boolean {
    if (this.status !== "playing") return false;
    return this.game.plies.some((_, i) => this.players[i % 2 === 0 ? "white" : "black"].kind === "human");
  }

  async start() {
    for (const color of COLORS) {
      const p = this.players[color];
      if (p.kind !== "engine") continue;
      try {
        const e = await UciEngine.open(p.path);
        if (!this.alive) {
          e.quit();
          return;
        }
        this.engines[color] = e;
        e.configure(p.level, p.threads, p.hash);
        await e.newGame();
      } catch (err) {
        if (!this.alive) return;
        this.error = `${p.name}打不开：${message(err)}`;
        this.status = "failed";
        this.close();
        this.emit();
        return;
      }
    }
    if (!this.alive) return;
    this.status = "playing";
    this.startTurn();
    this.emit();
    this.next();
  }

  /** 人走一步, 走不了返回 false */
  humanMove(uci: string): boolean {
    if (this.movable !== this.game.turn) return false;
    const color = this.game.turn;
    const used = Date.now() - this.turnStart;
    const before = { ...this.clock };
    const ply = this.game.play(uci);
    if (!ply) return false;
    this.afterMove(color, used, before);
    playMoveSound(ply.capture);
    this.emit();
    this.next();
    return true;
  }

  resign(color: Color) {
    if (this.status !== "playing" || this.over) return;
    this.stopThinking();
    this.freezeClock();
    this.game.resign(color);
    this.emit();
  }

  pause() {
    if (this.paused) return;
    this.freezeClock();
    this.paused = true;
    this.emit();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.startTurn();
    this.emit();
    this.next();
  }

  /** 退回到上一次轮到人走的时候 */
  async undo() {
    if (!this.canUndo) return;
    this.token++;
    const thinking = this.thinking;
    if (thinking) {
      await this.engines[thinking]?.cancel();
      this.thinking = null;
    }
    if (!this.alive) return;
    this.game.undo(1);
    while (this.game.plies.length > 0 && this.players[this.game.turn].kind === "engine") this.game.undo(1);
    const n = this.game.plies.length;
    if (this.clockBefore[n]) this.clock = { ...this.clockBefore[n] };
    this.clockBefore.length = n;
    this.error = null;
    this.inBook = true;
    this.startTurn();
    this.emit();
    this.next();
  }

  close() {
    this.alive = false;
    this.token++;
    this.clearFlag();
    for (const c of COLORS) this.engines[c]?.quit();
    this.engines = {};
  }

  /** 轮到下一方: 棋钟从现在开始走 */
  private startTurn() {
    this.turnStart = Date.now();
    this.clearFlag();
    if (!this.clockRunning) return;
    const color = this.game.turn;
    const left = this.clock[color];
    if (left === null) return;
    this.flagTimer = setTimeout(() => this.flag(color), left + 5);
  }

  private clearFlag() {
    if (this.flagTimer !== undefined) clearTimeout(this.flagTimer);
    this.flagTimer = undefined;
  }

  /** 把轮到的这一方用掉的时间记下来, 棋钟停住 */
  private freezeClock() {
    const color = this.game.turn;
    const left = this.remaining(color);
    if (left !== null) this.clock[color] = left;
    this.clearFlag();
  }

  /** 走完一步: 扣掉用的时间, 加上每步加的秒数, 轮到对方 */
  private afterMove(color: Color, used: number, before: Clock) {
    this.clockBefore.push(before);
    const left = this.clock[color];
    const tc = this.players[color].time;
    if (left !== null && tc) {
      const spent = this.paused ? 0 : used;
      this.clock[color] = Math.max(0, left - spent) + tc.increment * 1000;
    }
    this.lastMoveAt = Date.now();
    this.startTurn();
  }

  private flag(color: Color) {
    if (!this.alive || !this.clockRunning || this.game.turn !== color) return;
    const left = this.remaining(color);
    if (left === null) return;
    if (left > 0) {
      this.startTurn();
      return;
    }
    this.stopThinking();
    this.clock[color] = 0;
    this.game.timeout(color);
    this.clearFlag();
    this.emit();
  }

  private stopThinking() {
    this.token++;
    const thinking = this.thinking;
    this.thinking = null;
    if (thinking) void this.engines[thinking]?.cancel();
  }

  private next() {
    if (!this.alive || this.status !== "playing" || this.over || this.paused || this.thinking) return;
    const color = this.game.turn;
    if (this.players[color].kind === "engine") void this.think(color);
  }

  /** 给引擎的 go 后面那一段: 限时就告诉它双方还剩多少, 不限时就叫它想几秒 */
  private goArgs(color: Color): { args: string; limit: number } {
    const p = this.players[color];
    if (p.kind !== "engine") return { args: "", limit: 0 };
    const mine = this.remaining(color);
    if (mine === null) return { args: `movetime ${Math.round(p.movetime)}`, limit: p.movetime };
    const parts: string[] = [];
    for (const c of COLORS) {
      const left = this.remaining(c);
      const tc = this.players[c].time;
      if (left === null || !tc) continue;
      const k = c === "white" ? "w" : "b";
      parts.push(`${k}time ${Math.round(left)}`, `${k}inc ${tc.increment * 1000}`);
    }
    return { args: parts.join(" "), limit: mine };
  }

  private async think(color: Color) {
    const engine = this.engines[color];
    const p = this.players[color];
    if (!engine || p.kind !== "engine") return;
    const token = ++this.token;
    this.thinking = color;
    this.emit();

    let best = this.book && this.inBook ? pickBookMove(this.book, this.game.fen, this.game.plies.length) : undefined;
    const fromBook = !!best;
    if (!best) {
      this.inBook = false;
      const { args, limit } = this.goArgs(color);
      try {
        best = await engine.search(this.game.moves, args, limit + 20_000);
      } catch (err) {
        if (token !== this.token || !this.alive) return;
        this.thinking = null;
        this.error = `${p.name}：${message(err)}`;
        this.freezeClock();
        this.game.forfeit(color);
        this.emit();
        return;
      }
    }
    if (token !== this.token || !this.alive) return;
    const used = Date.now() - this.turnStart;

    const bothEngines = this.humans.length === 0;
    const gap = Math.max(bothEngines ? MIN_GAP : 0, fromBook ? BOOK_DELAY : 0);
    const wait = gap - (Date.now() - this.lastMoveAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (token !== this.token || !this.alive) return;

    this.thinking = null;
    const before = { ...this.clock };
    const ply = this.game.play(best);
    if (!ply) {
      this.error = `${p.name}走了不合规的棋：${best || "（空）"}`;
      this.freezeClock();
      this.game.forfeit(color);
    } else {
      this.afterMove(color, used, before);
      playMoveSound(ply.capture);
    }
    this.emit();
    this.next();
  }
}

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
