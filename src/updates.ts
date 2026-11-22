// 没有官方苹果版、程序不能自己下载的引擎: 出了新版就提醒 (再自己从源代码编)。现在只看 RubiChess。
// 打开程序时问一次 GitHub 的发布页。
import type { EngineEntry } from "./engines";

interface Watched {
  /** 引擎自己报的名字, 括号里是版本号 */
  name: RegExp;
  /** GitHub 上的仓库 */
  repo: string;
}

const WATCHED: Watched[] = [{ name: /^RubiChess (\d{8})\b/i, repo: "Matthies/RubiChess" }];

/** 仓库最新正式发布的标签, 像 20240817 */
export type FetchLatest = (repo: string) => Promise<string>;

async function githubLatest(repo: string): Promise<string> {
  const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return String(((await r.json()) as { tag_name?: string }).tag_name ?? "");
}

/** latest 比 current 新 (版本号都是数字, 像日期 20240817, 按数字比) */
export function isNewer(latest: string, current: string): boolean {
  if (!/^\d+$/.test(latest) || !/^\d+$/.test(current)) return false;
  return Number(latest) > Number(current);
}

/** 有新版的引擎: 编号 → 新版的版本号。上不了网就当没有 */
export async function findUpdates(list: EngineEntry[], fetchLatest: FetchLatest = githubLatest): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const asked = new Map<string, Promise<string | null>>();
  for (const e of list) {
    for (const w of WATCHED) {
      const m = e.name.match(w.name);
      if (!m) continue;
      if (!asked.has(w.repo)) asked.set(w.repo, fetchLatest(w.repo).catch(() => null));
      const tag = await asked.get(w.repo);
      if (tag && isNewer(tag, m[1])) out[e.id] = tag;
    }
  }
  return out;
}
