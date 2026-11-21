// 一场对局: 两边是谁 (人或引擎)、轮到引擎时让它想、悔棋、暂停。界面只管显示。
import { Game, type Color } from "./game";
import { UciEngine } from "./uci";
import { playMoveSound } from "./sound";

export type PlayerSetup =
  | { kind: "human" }
  | { kind: "engine"; engine: string; movetime: number; level: number | null };

export type Player =
  | { kind: "human"; name: string }
  | { kind: "engine"; name: string; path: string; movetime: number; level: number | null };

export type MatchStatus = "starting" | "playing" | "failed";

const COLORS: Color[] = ["white", "black"];

/** 引擎对引擎时两步之间至少隔这么久, 看得清 */
const MIN_GAP = 350;

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

  constructor(readonly players: Record<Color, Player>) {}

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

  /** 现在能用鼠标走的一方 */
  get movable(): Color | undefined {
    if (this.status !== "playing" || this.thinking || this.over) return undefined;
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
        e.configure(p.level);
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
    this.emit();
    this.next();
  }

  /** 人走一步, 走不了返回 false */
  humanMove(uci: string): boolean {
    if (this.movable !== this.game.turn) return false;
    const ply = this.game.play(uci);
    if (!ply) return false;
    this.lastMoveAt = Date.now();
    playMoveSound(ply.capture);
    this.emit();
    this.next();
    return true;
  }

  resign(color: Color) {
    if (this.status !== "playing" || this.over) return;
    this.token++;
    const thinking = this.thinking;
    this.thinking = null;
    if (thinking) this.engines[thinking]?.cancel();
    this.game.resign(color);
    this.emit();
  }

  pause() {
    this.paused = true;
    this.emit();
  }

  resume() {
    this.paused = false;
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
    this.error = null;
    this.emit();
    this.next();
  }

  close() {
    this.alive = false;
    this.token++;
    for (const c of COLORS) this.engines[c]?.quit();
    this.engines = {};
  }

  private next() {
    if (!this.alive || this.status !== "playing" || this.over || this.paused || this.thinking) return;
    const color = this.game.turn;
    if (this.players[color].kind === "engine") void this.think(color);
  }

  private async think(color: Color) {
    const engine = this.engines[color];
    const p = this.players[color];
    if (!engine || p.kind !== "engine") return;
    const token = ++this.token;
    this.thinking = color;
    this.emit();

    let best: string;
    try {
      best = await engine.search(this.game.moves, p.movetime);
    } catch (err) {
      if (token !== this.token || !this.alive) return;
      this.thinking = null;
      this.error = `${p.name}：${message(err)}`;
      this.game.forfeit(color);
      this.emit();
      return;
    }
    if (token !== this.token || !this.alive) return;

    const bothEngines = this.humans.length === 0;
    const wait = bothEngines ? MIN_GAP - (Date.now() - this.lastMoveAt) : 0;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (token !== this.token || !this.alive) return;

    this.thinking = null;
    const ply = this.game.play(best);
    if (!ply) {
      this.error = `${p.name}走了不合规的棋：${best || "（空）"}`;
      this.game.forfeit(color);
    } else {
      this.lastMoveAt = Date.now();
      playMoveSound(ply.capture);
    }
    this.emit();
    this.next();
  }
}

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
