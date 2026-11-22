// 装了哪些引擎。App 里存在程序文件夹的 engines.json, 浏览器里开发时存在 localStorage。
import { transport, type Downloaded } from "./transport";
import { UciEngine, type Strength } from "./uci";
import { ccrlElo, listedElo, type ListedEngine } from "./ratings";

export interface EngineEntry {
  id: string;
  name: string;
  path: string;
  strength: Strength;
  /** CCRL 榜上没有时, 从 En Croissant 清单里找到的等级分; 不知道就没有 */
  elo?: number;
}

/** 显示用的等级分: 先看 CCRL 榜 (按用几个线程), 没有再用 En Croissant 清单里的 */
export function engineElo(e: EngineEntry, threads = 1): number | undefined {
  return ccrlElo(e.name, threads) ?? e.elo;
}

function parse(raw: string | null): EngineEntry[] | null {
  if (!raw) return null;
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? (list as EngineEntry[]) : null;
  } catch {
    return null;
  }
}

/** 0.1 版的清单存在网页的 localStorage 里 */
function readOld(): EngineEntry[] | null {
  try {
    return parse(localStorage.getItem("philidor:engines"));
  } catch {
    return null;
  }
}

export function saveEngines(list: EngineEntry[]) {
  transport.saveEngineList(JSON.stringify(list, null, 2)).catch(() => {});
}

/** 打开一下引擎, 问它叫什么、能不能调弱 */
export async function probe(path: string): Promise<EngineEntry> {
  const e = await UciEngine.open(path);
  try {
    return {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: e.displayName,
      path,
      strength: e.strength,
    };
  } finally {
    e.quit();
  }
}

/** 第一次打开: 把 En Croissant 里装好的引擎拿过来 */
export async function loadEngines(): Promise<EngineEntry[]> {
  let saved: EngineEntry[] | null = null;
  try {
    saved = parse(await transport.loadEngineList());
  } catch {
    saved = null;
  }
  if (saved) return saved;
  const old = readOld();
  if (old) {
    saveEngines(old);
    return old;
  }
  const list: EngineEntry[] = [];
  let found: { name: string; path: string; elo?: number | null }[] = [];
  try {
    found = await transport.findEngines();
  } catch {
    found = [];
  }
  for (const f of found) {
    try {
      const entry = await probe(f.path);
      if (f.elo) entry.elo = Math.round(f.elo);
      list.push(entry);
    } catch {
      /* 打不开的不要 */
    }
  }
  saveEngines(list);
  return list;
}

/** 名字里的 Stockfish 版本, 像「Stockfish 19」→「19」 */
export function stockfishVersion(name: string): string | null {
  const m = name.match(/^Stockfish\s+(\d+(?:\.\d+)?)\b/i);
  return m ? m[1] : null;
}

/** 菲利多尔自己下载的 Stockfish (放在程序文件夹的 engines/stockfish-sf_xx 里) */
export function isDownloadedStockfish(e: EngineEntry): boolean {
  return /[\\/]stockfish-sf_[^\\/]+[\\/]/.test(e.path);
}

/** 下载好以后: 新版换掉以前自己下载的旧版 (还是原来那一条, 选它的对局设置不用重选); 以前没下载过就加在最后 */
export function addDownloaded(list: EngineEntry[], entry: EngineEntry): EngineEntry[] {
  const old = list.findIndex(isDownloadedStockfish);
  if (old < 0) return [...list, entry];
  const replaced = { ...entry, id: list[old].id };
  return list.flatMap((e, i) => (i === old ? [replaced] : isDownloadedStockfish(e) ? [] : [e]));
}

/** En Croissant 网站上的引擎清单 (有每个引擎的等级分, 出了新版它会更新) */
const RATINGS_URL = "https://encroissant.org/engines.json";

async function fetchListed(): Promise<ListedEngine[]> {
  const r = await fetch(RATINGS_URL, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as ListedEngine[];
}

/** 还不知道等级分的引擎 (像刚下载的新版 Stockfish), 去 En Croissant 的清单里找; 找到了返回新清单, 没变返回 null */
export async function fillRatings(
  list: EngineEntry[],
  fetchList: () => Promise<ListedEngine[]> = fetchListed,
): Promise<EngineEntry[] | null> {
  if (list.every((e) => engineElo(e) !== undefined)) return null;
  let listed: ListedEngine[];
  try {
    listed = await fetchList();
  } catch {
    return null;
  }
  let changed = false;
  const out = list.map((e) => {
    if (engineElo(e) !== undefined) return e;
    const elo = listedElo(e.name, listed);
    if (elo === undefined) return e;
    changed = true;
    return { ...e, elo };
  });
  return changed ? out : null;
}

export type StockfishResult = { kind: "latest"; version: string } | { kind: "installed"; entry: EngineEntry };

/** 「下载最新 Stockfish」: 已经有最新版就不下载 */
export async function getLatestStockfish(
  list: EngineEntry[],
  onProgress: (done: number, total: number) => void,
): Promise<StockfishResult> {
  const latest = await transport.stockfishLatest();
  if (list.some((e) => stockfishVersion(e.name) === latest.version)) return { kind: "latest", version: latest.version };
  const got: Downloaded = await transport.stockfishDownload(onProgress);
  return { kind: "installed", entry: await probe(got.path) };
}

/** 棋力的选项: null 是满力 */
export function strengthLevels(s: Strength): { value: number | null; label: string }[] {
  const out: { value: number | null; label: string }[] = [{ value: null, label: "满力" }];
  if (!s) return out;
  if (s.kind === "elo") {
    const values = new Set<number>([s.min]);
    for (let v = Math.ceil(s.min / 100) * 100; v < s.max; v += 100) values.add(v);
    for (const v of [...values].sort((a, b) => a - b)) out.push({ value: v, label: `${v} 分` });
  } else {
    for (let v = s.min; v < s.max; v++) out.push({ value: v, label: `等级 ${v}` });
  }
  return out;
}
