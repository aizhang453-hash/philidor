// 引擎的等级分。这是电脑跟电脑下算出来的分, 跟人的分不能直接比。
// 数字照 CCRL 40/15 榜 (https://computerchess.org.uk/4040/rating_list_all.html, 2026-11-21 的榜;
// 每方 40 步 15 分钟, 时间按 i7-4770k 折算)。同一个引擎有用 1 个核和用 4 个核两个分,
// 按对局里设的线程数挑: 4 个以上用 4 个核的分, 不到 4 个用 1 个核的分。
const CCRL: { name: RegExp; one: number; four: number }[] = [
  { name: /^Stockfish 19\b/i, one: 3629, four: 3650 },
  { name: /^Stockfish 18\b/i, one: 3628, four: 3649 },
  { name: /^RubiChess 20240817\b/i, one: 3568, four: 3603 },
  // 2020 年免费的第 1 版, 它自己报的名字是 Dragon by Komodo Chess
  { name: /^Dragon by Komodo( Chess)?$/i, one: 3527, four: 3568 },
  // CCRL 只测了 14; 14.1 是修小毛病的版本, 用 14 的分
  { name: /^Komodo 14(\.1)?$/i, one: 3403, four: 3481 },
];

export function ccrlElo(name: string, threads = 1): number | undefined {
  const k = CCRL.find((k) => k.name.test(name.trim()));
  if (!k) return undefined;
  return threads >= 4 ? k.four : k.one;
}

/** En Croissant 网站引擎清单里的一条 (名字和版本分开写, 像 Stockfish、20) */
export interface ListedEngine {
  name: string;
  version: string;
  elo?: number | null;
}

/** 在 En Croissant 的清单里找这个引擎的分: 引擎自己报的名字以「名字 版本」开头就算 */
export function listedElo(name: string, list: ListedEngine[]): number | undefined {
  const n = name.trim().toLowerCase();
  for (const e of list) {
    if (!e.elo) continue;
    const key = `${e.name} ${e.version}`.toLowerCase();
    if (n === key || (n.startsWith(key) && !/[0-9a-z]/.test(n[key.length]))) return Math.round(e.elo);
  }
  return undefined;
}
