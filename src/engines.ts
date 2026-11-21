// 装了哪些引擎。存在本机 (localStorage)。
import { transport } from "./transport";
import { UciEngine, type Strength } from "./uci";

export interface EngineEntry {
  id: string;
  name: string;
  path: string;
  strength: Strength;
}

const KEY = "philidor:engines";

function read(): EngineEntry[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as EngineEntry[]) : null;
  } catch {
    return null;
  }
}

export function saveEngines(list: EngineEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 存不了就算了 */
  }
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
  const saved = read();
  if (saved) return saved;
  const list: EngineEntry[] = [];
  let found: { name: string; path: string }[] = [];
  try {
    found = await transport.findEngines();
  } catch {
    found = [];
  }
  for (const f of found) {
    try {
      list.push(await probe(f.path));
    } catch {
      /* 打不开的不要 */
    }
  }
  saveEngines(list);
  return list;
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
