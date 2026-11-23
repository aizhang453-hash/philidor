// 生成「精度 → 棋局等级」对照表 src/ratingTable.ts: 每个分数段的人, 一盘棋的精度一般 (中位数) 是多少。
// 资料: Lichess 官方公开棋局库 (database.lichess.org, CC0) 里 Lichess 服务器用 Stockfish 分析过、每步带 [%eval] 的棋。
// 只要: 不是机器人账号、开局时间 3 分钟以上、正常下完、至少 20 步; 精度用跟对局回顾一样的算法 (src/review.ts)。
// 分数是 Lichess 的分 (比 chess.com 的高一些, 低分段差得多)。
// 用法: node tools/make-rating.mjs <lichess_db_standard_rated_YYYY-MM.pgn.zst>   RATING_GAMES=收几盘 (默认 20 万)
import { createReadStream, writeFileSync } from "node:fs";
import { createZstdDecompress } from "node:zlib";
import { createInterface } from "node:readline";
import { basename } from "node:path";
import { gameAccuracy, winPercent } from "../src/review.ts";

const file = process.argv[2];
if (!file) {
  console.error("用法: node tools/make-rating.mjs <lichess_db_standard_rated_YYYY-MM.pgn.zst>");
  process.exit(1);
}
const MAX = Number(process.env.RATING_GAMES ?? 200_000);
const STEP = 100;

/** 分数段 → 这一段的人每盘的精度 */
const buckets = new Map();
let scanned = 0;
let taken = 0;
const t0 = Date.now();

function evalsOf(line) {
  const out = [];
  const re = /\[%eval (#?-?[\d.]+)\]/g;
  let m;
  while ((m = re.exec(line))) {
    const v = m[1];
    out.push(v.startsWith("#") ? { mate: Number(v.slice(1)) || 0 } : { cp: Math.round(Number(v) * 100) });
  }
  return out;
}

const rl = createInterface({ input: createReadStream(file).pipe(createZstdDecompress()), crlfDelay: Infinity });
let h = {};
for await (const line of rl) {
  if (line.startsWith("[")) {
    const m = line.match(/^\[(\w+) "(.*)"\]$/);
    if (m) h[m[1]] = m[2];
    continue;
  }
  if (!line.startsWith("1.")) continue;
  scanned++;
  const base = Number((h.TimeControl ?? "").split("+")[0]);
  if (line.includes("[%eval") && base >= 180 && h.WhiteTitle !== "BOT" && h.BlackTitle !== "BOT" && h.Termination === "Normal") {
    const evals = evalsOf(line);
    const moves = (line.match(/\d+\.\.\. |\d+\. /g) ?? []).length;
    // 每一步后面都要有分数 (最后一步将死时没有, 去掉)
    if (evals.length >= 40 && evals.length >= moves - 1) {
      const wins = [winPercent({ cp: 20 }), ...evals.map((e) => winPercent(e))];
      for (const color of ["white", "black"]) {
        const elo = Number(color === "white" ? h.WhiteElo : h.BlackElo);
        if (!elo) continue;
        const b = Math.floor(elo / STEP) * STEP;
        if (!buckets.has(b)) buckets.set(b, []);
        buckets.get(b).push(gameAccuracy(wins, color));
      }
      taken++;
      if (taken % 20000 === 0) console.log(`看了 ${scanned} 盘, 收了 ${taken} 盘, ${Math.round((Date.now() - t0) / 1000)} 秒`);
      if (taken >= MAX) break;
    }
  }
  h = {};
}
rl.close();

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const rows = [...buckets.entries()]
  .filter(([, xs]) => xs.length >= 200)
  .sort((a, b) => a[0] - b[0])
  .map(([b, xs]) => [b + STEP / 2, Math.round(median(xs) * 10) / 10, xs.length]);
writeFileSync(
  "src/ratingTable.ts",
  `// 由 tools/make-rating.mjs 生成, 别手改。资料: Lichess 官方公开棋局库 ${basename(file)} 里带引擎分析的 ${taken} 盘 (CC0)。\n` +
    `// 每行: [Lichess 分数段的中间, 这一段的人一盘棋精度的中位数, 有几个人次]\n` +
    `export const RATING_TABLE: [number, number, number][] = ${JSON.stringify(rows)};\n`,
);
console.log(`看了 ${scanned} 盘, 收了 ${taken} 盘, ${rows.length} 个分数段, ${Math.round((Date.now() - t0) / 1000)} 秒`);
for (const r of rows) console.log(r.join("\t"));
