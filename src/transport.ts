// 引擎程序怎么开、怎么收发。
// 在 App 里走 Tauri (Rust 开引擎); 在普通浏览器里开发、测试时走 tools/dev-bridge.mjs (Node 开引擎)。
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface FoundEngine {
  name: string;
  path: string;
}

export interface Transport {
  start(id: string, path: string, onLine: (line: string) => void, onExit: () => void): Promise<void>;
  send(id: string, line: string): Promise<void>;
  stop(id: string): Promise<void>;
  /** 电脑上别的程序 (En Croissant) 装好的引擎 */
  findEngines(): Promise<FoundEngine[]>;
  /** 选一个引擎文件, 不选返回 null */
  pickFile(): Promise<string | null>;
}

type Handlers = { line: (l: string) => void; exit: () => void };
const handlers = new Map<string, Handlers>();

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function tauriTransport(): Transport {
  let listening: Promise<unknown> | undefined;
  const ensure = () =>
    (listening ??= Promise.all([
      listen<{ id: string; line: string }>("engine-line", (e) => handlers.get(e.payload.id)?.line(e.payload.line)),
      listen<string>("engine-exit", (e) => {
        const h = handlers.get(e.payload);
        handlers.delete(e.payload);
        h?.exit();
      }),
    ]));
  return {
    async start(id, path, onLine, onExit) {
      await ensure();
      handlers.set(id, { line: onLine, exit: onExit });
      try {
        await invoke("engine_start", { id, path });
      } catch (e) {
        handlers.delete(id);
        throw new Error(String(e));
      }
    },
    async send(id, line) {
      await invoke("engine_send", { id, line });
    },
    async stop(id) {
      handlers.delete(id);
      await invoke("engine_stop", { id });
    },
    async findEngines() {
      return invoke<FoundEngine[]>("encroissant_engines");
    },
    async pickFile() {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ multiple: false, directory: false, title: "选引擎程序" });
      return typeof picked === "string" ? picked : null;
    },
  };
}

const BRIDGE = "http://127.0.0.1:17890";

function bridgeTransport(): Transport {
  let source: EventSource | undefined;
  const ensure = () =>
    new Promise<void>((resolve, reject) => {
      if (source && source.readyState === EventSource.OPEN) return resolve();
      source ??= new EventSource(`${BRIDGE}/events`);
      source.addEventListener("line", (ev) => {
        const { id, line } = JSON.parse((ev as MessageEvent).data);
        handlers.get(id)?.line(line);
      });
      source.addEventListener("exit", (ev) => {
        const { id } = JSON.parse((ev as MessageEvent).data);
        const h = handlers.get(id);
        handlers.delete(id);
        h?.exit();
      });
      source.addEventListener("open", () => resolve(), { once: true });
      source.addEventListener("error", () => reject(new Error("连不上 dev-bridge")), { once: true });
    });
  const post = async (body: object) => {
    const r = await fetch(`${BRIDGE}/cmd`, { method: "POST", body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "dev-bridge 出错");
    return data;
  };
  return {
    async start(id, path, onLine, onExit) {
      await ensure();
      handlers.set(id, { line: onLine, exit: onExit });
      try {
        await post({ op: "start", id, path });
      } catch (e) {
        handlers.delete(id);
        throw e;
      }
    },
    async send(id, line) {
      await post({ op: "send", id, line });
    },
    async stop(id) {
      handlers.delete(id);
      await post({ op: "stop", id });
    },
    async findEngines() {
      return (await post({ op: "find" })).engines;
    },
    async pickFile() {
      return window.prompt("引擎程序的路径") || null;
    },
  };
}

export const transport: Transport = isTauri ? tauriTransport() : bridgeTransport();
