// 生成开局库 public/book/book.json: 每个局面能走哪几步、各走过几盘 (对局时按盘数抽签)。
// 资料: Lichess 官方的公开棋局库 (https://database.lichess.org, CC0), 每月一个 lichess_db_standard_rated_YYYY-MM.pgn.zst。
// 只要: 双方都 2200 分以上 (Lichess 的分)、开局时间 3 分钟以上、不是机器人账号、正常下完的棋; 每盘只看开头 10 回合。
// 用法: node --max-old-space-size=6144 tools/make-book.mjs <月份文件.pgn.zst …>
//   BOOK_GAMES=收几盘就停 (默认 150 万)  BOOK_MIN_ELO=2200  BOOK_MIN_BASE=180 (秒)
import { createReadStream, writeFileSync, mkdirSync } from "node:fs";
import { createZstdDecompress } from "node:zlib";
import { createInterface } from "node:readline";
import { basename } from "node:path";
import { Chess, castlingSide } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { makeSquare, kingCastlesTo, parseUci } from "chessops/util";

const MAX_PLY = 20;
const MAX_GAMES = Number(process.env.BOOK_GAMES ?? 1_500_000);
const MIN_ELO = Number(process.env.BOOK_MIN_ELO ?? 2200);
const MIN_BASE = Number(process.env.BOOK_MIN_BASE ?? 180);
/** 局面至少这么多盘才进库 */
const MIN_POS = 100;
/** 一步至少走过这么多盘 */
const MIN_MOVE = 25;
/** 一步至少占这个局面的这么多 */
const MIN_SHARE = 0.03;
/** 走这一步的一方得分 (赢 1、和一半) 至少这么多 */
const MIN_SCORE = 0.45;
/** 每收这么多盘, 把只出现过一两次的局面扔掉 (省内存; 常见的局面不受影响) */
const PRUNE_EVERY = 100_000;

const files = process.argv.slice(2);
if (!files.length) {
  console.error("用法: node --max-old-space-size=6144 tools/make-book.mjs <lichess_db_standard_rated_YYYY-MM.pgn.zst …>");
  process.exit(1);
}

function fnv(s, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const fen4 = (pos) => makeFen(pos.toSetup()).split(" ").slice(0, 4).join(" ");
const keyOf = (f) => fnv(f, 0x811c9dc5).toString(36) + "." + fnv(f, 0x2b992ddf).toString(36);

/** 王车易位写成 e1g1 (引擎用的写法) */
function uciOf(pos, move) {
  const side = castlingSide(pos, move);
  const to = side ? kingCastlesTo(pos.turn, side) : move.to;
  return makeSquare(move.from) + makeSquare(to) + (move.promotion ? (move.promotion === "knight" ? "n" : move.promotion[0]) : "");
}

/** 钥匙 → Map(走法 → [盘数, 白赢, 黑赢]) */
const stats = new Map();
let scanned = 0;
let taken = 0;
const t0 = Date.now();

function addGame(tokens, result) {
  const pos = Chess.default();
  for (let i = 0; i < Math.min(tokens.length, MAX_PLY); i++) {
    const move = parseSan(pos, tokens[i]);
    if (!move) return;
    const k = keyOf(fen4(pos));
    let moves = stats.get(k);
    if (!moves) stats.set(k, (moves = new Map()));
    const u = uciOf(pos, move);
    let c = moves.get(u);
    if (!c) moves.set(u, (c = [0, 0, 0]));
    c[0]++;
    if (result === "1-0") c[1]++;
    else if (result === "0-1") c[2]++;
    pos.play(move);
  }
}

function prune() {
  for (const [k, moves] of stats) {
    let n = 0;
    for (const c of moves.values()) n += c[0];
    if (n < 3) stats.delete(k);
  }
}

/** 棋谱正文 → 前几步 SAN (去掉 {评注}、回合数、结果) */
function sanTokens(body) {
  const out = [];
  for (let t of body.replace(/\{[^}]*\}/g, " ").split(/\s+/)) {
    t = t.replace(/^\d+\.+/, "").replace(/[?!]+$/, "");
    if (!t || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) continue;
    out.push(t);
    if (out.length >= MAX_PLY) break;
  }
  return out;
}

const done = () => taken >= MAX_GAMES;

for (const file of files) {
  if (done()) break;
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
    if (
      Number(h.WhiteElo) >= MIN_ELO &&
      Number(h.BlackElo) >= MIN_ELO &&
      base >= MIN_BASE &&
      h.WhiteTitle !== "BOT" &&
      h.BlackTitle !== "BOT" &&
      (h.Termination === "Normal" || h.Termination === "Time forfeit")
    ) {
      addGame(sanTokens(line), h.Result);
      taken++;
      if (taken % PRUNE_EVERY === 0) {
        prune();
        const mb = Math.round(process.memoryUsage().heapUsed / 1e6);
        console.log(`${basename(file)}: 看了 ${scanned} 盘, 收了 ${taken} 盘, 局面 ${stats.size}, 内存 ${mb} MB, ${Math.round((Date.now() - t0) / 1000)} 秒`);
      }
      if (done()) break;
    }
    h = {};
  }
  rl.close();
}

// 从开局往下走, 只留够多人走、得分不差的步
const book = {};
let seen = new Set();
let frontier = [Chess.default()];
for (let ply = 0; ply < MAX_PLY && frontier.length; ply++) {
  const next = [];
  for (const pos of frontier) {
    const f = fen4(pos);
    if (seen.has(f)) continue;
    seen.add(f);
    const moves = stats.get(keyOf(f));
    if (!moves) continue;
    let total = 0;
    for (const c of moves.values()) total += c[0];
    if (total < MIN_POS) continue;
    const keep = [];
    for (const [u, [n, w, b]] of [...moves].sort((a, b) => b[1][0] - a[1][0])) {
      const score = ((pos.turn === "white" ? w : b) + (n - w - b) / 2) / n;
      if (n < MIN_MOVE || n / total < MIN_SHARE || score < MIN_SCORE) continue;
      const move = parseUci(u);
      if (!move || !pos.isLegal(move)) continue;
      keep.push([u, n]);
      const child = pos.clone();
      child.play(move);
      next.push(child);
    }
    if (keep.length) book[f] = keep;
  }
  frontier = next;
}

mkdirSync("public/book", { recursive: true });
writeFileSync(
  "public/book/book.json",
  JSON.stringify({
    source: `Lichess 官方公开棋局库 (database.lichess.org, CC0): ${files.map((f) => basename(f)).join("、")} 里双方 ${MIN_ELO} 分以上、${MIN_BASE / 60} 分钟以上的 ${taken} 盘`,
    maxPly: MAX_PLY,
    positions: book,
  }),
);
const n = Object.keys(book).length;
const moves = Object.values(book).reduce((s, m) => s + m.length, 0);
console.log(`看了 ${scanned} 盘, 收了 ${taken} 盘; 开局库 局面 ${n} 个, 走法 ${moves} 个; 用了 ${Math.round((Date.now() - t0) / 1000)} 秒`);
