// 跟引擎说话 (UCI 协议)。引擎程序由 Rust 那边开, 这里只收发一行一行的字。
import { transport } from "./transport";

export interface UciOption {
  name: string;
  type: string;
  default?: string;
  min?: number;
  max?: number;
  vars: string[];
}

export function parseOption(line: string): UciOption | undefined {
  const m = line.match(/^option\s+name\s+(.+?)\s+type\s+(\S+)(.*)$/);
  if (!m) return undefined;
  const opt: UciOption = { name: m[1], type: m[2], vars: [] };
  const rest = m[3];
  const re = /\s(default|min|max|var)(?:\s+(.*?))?(?=\s(?:default|min|max|var)(?:\s|$)|$)/g;
  let g: RegExpExecArray | null;
  while ((g = re.exec(rest))) {
    const value = (g[2] ?? "").trim();
    if (g[1] === "default") opt.default = value;
    else if (g[1] === "min") opt.min = Number(value);
    else if (g[1] === "max") opt.max = Number(value);
    else opt.vars.push(value);
  }
  return opt;
}

/** 引擎能怎么调弱 */
export type Strength =
  | { kind: "elo"; min: number; max: number }
  | { kind: "skill"; option: string; min: number; max: number }
  | null;

export function strengthOf(options: UciOption[]): Strength {
  const elo = options.find((o) => o.name === "UCI_Elo" && o.type === "spin");
  const limit = options.find((o) => o.name === "UCI_LimitStrength");
  if (elo && limit && elo.min !== undefined && elo.max !== undefined) {
    return { kind: "elo", min: elo.min, max: elo.max };
  }
  const skill = options.find((o) => /^skill( level)?$/i.test(o.name) && o.type === "spin");
  if (skill && skill.min !== undefined && skill.max !== undefined) {
    return { kind: "skill", option: skill.name, min: skill.min, max: skill.max };
  }
  return null;
}

/** 引擎自己报的名字, 去掉多余的空格和「64-bit」 */
export function cleanName(name: string): string {
  return name.replace(/\s+64-bit\s*$/i, "").replace(/\s+/g, " ").trim();
}

type Waiter = { test: (line: string) => boolean; resolve: (line: string) => void; reject: (e: Error) => void };

let counter = 0;

export class UciEngine {
  readonly id = `engine-${Date.now().toString(36)}-${++counter}`;
  name = "";
  options: UciOption[] = [];
  private waiters: Waiter[] = [];
  private searching: Promise<string> | null = null;
  private closed = false;
  private exitError?: Error;

  private constructor(readonly path: string) {}

  /** 打开引擎, 等它说 uciok */
  static async open(path: string): Promise<UciEngine> {
    const e = new UciEngine(path);
    await transport.start(
      e.id,
      path,
      (line) => e.handle(line),
      () => e.handleExit(),
    );
    try {
      e.send("uci");
      await e.waitFor((l) => l === "uciok", 15000, "引擎没有回应");
    } catch (err) {
      e.quit();
      throw err;
    }
    return e;
  }

  get strength(): Strength {
    return strengthOf(this.options);
  }

  get displayName(): string {
    return cleanName(this.name) || this.path.split(/[\\/]/).pop() || "引擎";
  }

  has(option: string) {
    return this.options.some((o) => o.name === option);
  }

  send(line: string) {
    if (this.closed) return;
    transport.send(this.id, line).catch(() => {});
  }

  setOption(name: string, value: string | number | boolean) {
    this.send(`setoption name ${name} value ${value}`);
  }

  /** 设线程数、哈希 (MB) 和棋力 (null 是满力; 有 UCI_Elo 的给分数, 有 Skill 的给等级) */
  configure(level: number | null, threads?: number, hash?: number) {
    if (this.has("Ponder")) this.setOption("Ponder", false);
    if (threads !== undefined) this.setSpin("Threads", threads);
    if (hash !== undefined) this.setSpin("Hash", hash);
    const s = this.strength;
    if (!s) return;
    if (s.kind === "elo") {
      if (level === null) this.setOption("UCI_LimitStrength", false);
      else {
        this.setOption("UCI_LimitStrength", true);
        this.setOption("UCI_Elo", Math.min(s.max, Math.max(s.min, level)));
      }
    } else {
      this.setOption(s.option, level === null ? s.max : Math.min(s.max, Math.max(s.min, level)));
    }
  }

  /** 设一个数字选项, 超出引擎允许的范围就取边上的值; 引擎没有这个选项就不设 */
  private setSpin(name: string, value: number) {
    const o = this.options.find((x) => x.name === name);
    if (!o) return;
    let v = value;
    if (o.min !== undefined) v = Math.max(o.min, v);
    if (o.max !== undefined) v = Math.min(o.max, v);
    this.setOption(name, v);
  }

  async ready() {
    this.send("isready");
    await this.waitFor((l) => l === "readyok", 30000, "引擎没有准备好");
  }

  async newGame() {
    this.send("ucinewgame");
    await this.ready();
  }

  /** 让引擎想, go 是 go 后面那一段 (像「movetime 1000」或「wtime 60000 btime 60000 winc 0 binc 0」), 返回它走的棋 (UCI 写法) */
  search(moves: string[], go: string, timeout: number): Promise<string> {
    if (this.searching) throw new Error("引擎还在想上一步");
    this.send(`position startpos${moves.length ? " moves " + moves.join(" ") : ""}`);
    this.send(`go ${go}`);
    const p = this.waitFor((l) => /^bestmove\b/.test(l), timeout, "引擎想太久没出棋").then(
      (line) => line.split(/\s+/)[1] ?? "",
    );
    this.searching = p;
    const clear = () => {
      if (this.searching === p) this.searching = null;
    };
    p.then(clear, clear);
    return p;
  }

  /** 叫正在想的引擎停下, 等它把那步交出来 (扔掉) */
  async cancel() {
    const p = this.searching;
    if (!p) return;
    this.send("stop");
    await p.catch(() => {});
  }

  quit() {
    if (this.closed) return;
    this.closed = true;
    transport.stop(this.id).catch(() => {});
    this.failAll(new Error("引擎关了"));
  }

  private handle(line: string) {
    line = line.trim();
    if (line.startsWith("id name ")) this.name = line.slice(8).trim();
    else if (line.startsWith("option ")) {
      const o = parseOption(line);
      if (o) this.options.push(o);
    }
    const hit = this.waiters.filter((w) => w.test(line));
    if (hit.length === 0) return;
    this.waiters = this.waiters.filter((w) => !hit.includes(w));
    for (const w of hit) w.resolve(line);
  }

  private handleExit() {
    this.exitError = new Error("引擎退出了");
    this.closed = true;
    this.failAll(this.exitError);
  }

  private failAll(err: Error) {
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) w.reject(err);
  }

  private waitFor(test: (line: string) => boolean, timeout: number, message: string): Promise<string> {
    if (this.closed) return Promise.reject(this.exitError ?? new Error("引擎关了"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(message));
      }, timeout);
      const waiter: Waiter = {
        test,
        resolve: (l) => {
          clearTimeout(timer);
          resolve(l);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      this.waiters.push(waiter);
    });
  }
}
