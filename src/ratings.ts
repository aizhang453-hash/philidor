// 引擎的等级分。这是电脑跟电脑下算出来的分, 跟人的分不能直接比。
// 数字照 En Croissant 网站上的引擎清单 (https://encroissant.org/engines.json, 2026-11-21 看的)。
const KNOWN: { name: RegExp; elo: number }[] = [
  { name: /^Stockfish 19\b/i, elo: 3635 },
  { name: /^RubiChess 20240817\b/i, elo: 3600 },
  { name: /^Dragon by Komodo\b/i, elo: 3533 },
  { name: /^Komodo 14(\.|\b)/i, elo: 3479 },
  { name: /^Lc0 v?0\.30\b/i, elo: 3440 },
];

export function knownElo(name: string): number | undefined {
  return KNOWN.find((k) => k.name.test(name))?.elo;
}
