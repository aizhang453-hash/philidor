// 生成开局名表 public/book/openings.json: 有名字的开局走到的每个局面 → 那个局面的开局名 (走到半路、本身没名字的局面记成 "")。
// 对局回顾用它认「开局库」的着法, 再说出这盘棋下的是什么开局。
// 资料: Lichess 的开局名清单 https://github.com/lichess-org/chess-openings (CC0), 五个文件 a.tsv … e.tsv (每行: ECO 编号、英文名、走法)。
// 用法: node tools/make-openings.mjs <放 a.tsv … e.tsv 的文件夹> [提交编号]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";

const dir = process.argv[2];
const commit = process.argv[3] ?? "";
if (!dir) {
  console.error("用法: node tools/make-openings.mjs <放 a.tsv … e.tsv 的文件夹> [提交编号]");
  process.exit(1);
}

const epd = (pos) => makeFen(pos.toSetup()).split(" ").slice(0, 4).join(" ");

/** 局面 → 开局名 ("" 是走到半路、本身没有名字) */
const positions = {};
let lines = 0;
for (const f of ["a", "b", "c", "d", "e"]) {
  const rows = readFileSync(join(dir, `${f}.tsv`), "utf8").split("\n").slice(1);
  for (const row of rows) {
    if (!row.trim()) continue;
    const [eco, name, pgn] = row.split("\t");
    const pos = Chess.default();
    const sans = pgn.split(/\s+/).filter((t) => t && !/^\d+\.+$/.test(t));
    for (let i = 0; i < sans.length; i++) {
      const move = parseSan(pos, sans[i]);
      if (!move) throw new Error(`走不了: ${eco} ${name} ${pgn} (${sans[i]})`);
      pos.play(move);
      const k = epd(pos);
      if (i === sans.length - 1) {
        // 同一个局面有好几个名字 (走法顺序不同), 留第一个
        if (!positions[k]) positions[k] = `${eco} ${name}`;
      } else if (!(k in positions)) positions[k] = "";
    }
    lines++;
  }
}

mkdirSync("public/book", { recursive: true });
writeFileSync(
  "public/book/openings.json",
  JSON.stringify({
    source: `Lichess 开局名清单 (github.com/lichess-org/chess-openings${commit ? ` 提交 ${commit.slice(0, 7)}` : ""}, CC0)`,
    positions,
  }),
);
const named = Object.values(positions).filter(Boolean).length;
console.log(`${lines} 条开局, 局面 ${Object.keys(positions).length} 个 (有名字的 ${named} 个)`);
