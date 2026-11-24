// 教练在对局回顾里说的话 (不用 AI 的那一套, 见笔记 教练资料/教练说话的设计.md):
//   事实 —— 程序看引擎算的走法, 认出这步吃了什么、丢了什么、漏了什么, 套写好的句子, 一定照实说;
//   口气 —— 写好的句子, 按好坏挑, 轮着用;
//   往事、原话 —— 从有出处的清单里挑, 一字不改, 一盘最多两次。
// 说法按用户定的「晚年的斯坦尼茨」: 平和、宽厚、讲原则, 不挖苦人。
import { Chess, normalizeMove } from "chessops/chess";
import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
import type { NormalMove, Role } from "chessops/types";
import type { Color, Ply } from "./game";
import type { GameReview, MoveReview, PosEval } from "./review";

const VALUE: Record<Role, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };
const NAME: Record<Role, string> = { pawn: "兵", knight: "马", bishop: "象", rook: "车", queen: "后", king: "王" };

interface Step {
  san: string;
  mover: Color;
  captured?: Role;
  mate: boolean;
}

/** 从 start 照 ucis 走下去 (最多 max 步), 记下每步是谁走的、吃了什么 */
export function walk(start: Chess, ucis: string[], max = 8): Step[] {
  const pos = start.clone();
  const out: Step[] = [];
  for (const u of ucis.slice(0, max)) {
    const m = parseUci(u) as NormalMove | undefined;
    if (!m || !("from" in m)) break;
    const move = normalizeMove(pos, m) as NormalMove;
    if (!pos.isLegal(move)) break;
    const piece = pos.board.get(move.from);
    const target = pos.board.get(move.to);
    let captured: Role | undefined = target && target.color !== pos.turn ? target.role : undefined;
    if (!captured && piece?.role === "pawn" && (move.from & 7) !== (move.to & 7)) captured = "pawn"; // 吃过路兵
    const san = makeSan(pos, move);
    const mover = pos.turn;
    pos.play(move);
    out.push({ san, mover, captured, mate: pos.isCheckmate() });
  }
  return out;
}

/** 一串走法走下来, color 一方净赚多少子力 (兵 1、马象 3、车 5、后 9) */
function net(steps: Step[], color: Color): number {
  let n = 0;
  for (const s of steps) if (s.captured) n += s.mover === color ? VALUE[s.captured] : -VALUE[s.captured];
  return n;
}

/** 一串走法里 color 一方被吃掉的最大的子, 和吃它的那一步 */
function biggestLoss(steps: Step[], color: Color): { role: Role; san: string } | undefined {
  let best: { role: Role; san: string } | undefined;
  for (const s of steps) {
    if (!s.captured || s.mover === color) continue;
    if (!best || VALUE[s.captured] > VALUE[best.role]) best = { role: s.captured, san: s.san };
  }
  return best;
}

/** 双方的大子 (不算兵和王) 加起来多少, 小于等于 20 算残局 */
function heavy(pos: Chess): number {
  let n = 0;
  for (const sq of pos.board.occupied) {
    const p = pos.board.get(sq);
    if (p && p.role !== "pawn" && p.role !== "king") n += VALUE[p.role];
  }
  return n;
}

/** 走的一方能几步将死 (正数); 被将死是负数; 没有是 undefined */
function mateFor(e: PosEval | undefined, color: Color): number | undefined {
  if (!e || e.mate === undefined || e.mate === 0) return undefined;
  return color === "white" ? e.mate : -e.mate;
}

export interface MoveFacts {
  mover: Color;
  /** 这步吃了什么 */
  captured?: Role;
  /** 这步以后会丢的子, 和对方怎么吃 (照引擎往下走几步算的) */
  loses?: { role: Role; san: string };
  /** 这步以后对方几步能将死 */
  matedIn?: number;
  /** 最好的一步 (SAN) */
  best?: string;
  /** 走最好的一步能赚到的子, 或者几步将死 */
  bestWins?: Role;
  bestMate?: number;
  givesMate: boolean;
  check: boolean;
  castle: boolean;
  promote: boolean;
  /** 残局里走王 */
  kingInEndgame: boolean;
  /** 开局把马走出来 */
  knightOut: boolean;
  /** 没吃子、没将军的一步 */
  quiet: boolean;
  /** 中局 (过了开局、还不是残局) */
  middlegame: boolean;
}

/** 第 ply 步 (从 1 数) 是什么情况 */
export function moveFacts(ply: number, positions: readonly Chess[], plies: Ply[], evals: PosEval[]): MoveFacts {
  const before = positions[ply - 1];
  const after = positions[ply];
  const p = plies[ply - 1];
  const mover = before.turn;
  const own = walk(before, [p.uci], 1)[0];
  const facts: MoveFacts = {
    mover,
    captured: own?.captured,
    givesMate: after.isCheckmate(),
    check: p.check,
    castle: p.san.startsWith("O-O"),
    promote: p.san.includes("="),
    kingInEndgame: false,
    knightOut: false,
    quiet: !p.capture && !p.check,
    middlegame: ply > 16 && heavy(before) > 20,
  };
  const pm = parseUci(p.uci) as NormalMove | undefined;
  const piece = pm && "from" in pm ? before.board.get(pm.from) : undefined;
  facts.kingInEndgame = piece?.role === "king" && !facts.castle && heavy(before) <= 20;
  facts.knightOut = piece?.role === "knight" && ply <= 12 && !p.capture && /[18]$/.test(p.from);

  // 这步以后: 对方照引擎最好的走法走下去, 这边丢不丢子、会不会被将死
  const evAfter = evals[ply];
  if (!facts.givesMate && evAfter) {
    const m = mateFor(evAfter, mover);
    if (m !== undefined && m < 0) facts.matedIn = -m;
    const line = walk(after, evAfter.pv);
    const total = (own?.captured ? VALUE[own.captured] : 0) + net(line, mover);
    const lost = biggestLoss(line, mover);
    if (lost && VALUE[lost.role] >= 3 && total <= -2) facts.loses = lost;
  }

  // 最好的一步
  const evBefore = evals[ply - 1];
  if (evBefore?.best) {
    const bestLine = walk(before, evBefore.pv.length ? evBefore.pv : [evBefore.best]);
    if (bestLine[0]) facts.best = bestLine[0].san;
    const m = mateFor(evBefore, mover);
    if (m !== undefined && m > 0) facts.bestMate = m;
    else if (net(bestLine, mover) >= 2) {
      const won = biggestLoss(bestLine, mover === "white" ? "black" : "white");
      if (won && VALUE[won.role] >= 3) facts.bestWins = won.role;
    }
  }
  return facts;
}

/** 照好坏和情况写出事实那一句 */
export function factLine(m: MoveReview, f: MoveFacts, opening?: string): string {
  const best = f.best && f.best !== "" ? f.best : undefined;
  // 最好的一步能干什么 (几步将死、吃掉什么)
  const gain = f.bestMate ? `，能${f.bestMate}步将死` : f.bestWins ? `，能吃掉${NAME[f.bestWins]}` : "";
  switch (m.cls) {
    case "book":
      return opening ? `开局走得正，这是${opening}里常见的一步。` : "开局走得正，这是常见的一步。";
    case "brilliant":
      return "漂亮的弃子，而且是对的。";
    case "great":
      return f.givesMate ? "将死了，这一步找得准。" : "这里只有这一步好，找到了。";
    case "best":
    case "excellent":
    case "good":
      if (f.givesMate) return "将死了，干净利落。";
      if (f.captured && VALUE[f.captured] >= 3) return `好，吃掉了对方的${NAME[f.captured]}。`;
      if (f.promote) return "兵走到底升了变，走得好。";
      if (f.castle) return "易位，把王放稳了。";
      if (f.kingInEndgame) return "残局里把王走出来，用得好。";
      if (f.captured) return "这个兵吃得对。";
      if (f.check) return "将军，走得有力。";
      return m.cls === "best" ? "这就是最好的一步。" : m.cls === "excellent" ? "很好的一步。" : "不错，走得稳。";
    case "inaccuracy":
      return best ? `差了一点，${best} 更准。` : "差了一点。";
    case "mistake":
      if (f.loses) return `这步会丢${NAME[f.loses.role]}：对方能走 ${f.loses.san}。${best ? `好一点是 ${best}。` : ""}`;
      return best ? `这步不够好，该走 ${best}${gain}。` : "这步不够好。";
    case "miss":
      if (f.bestMate) return `对方刚才露了破绽，这里走 ${best} 能${f.bestMate}步将死。`;
      if (f.bestWins) return `对方刚才露了破绽，这里走 ${best} 能吃掉${NAME[f.bestWins]}。`;
      return best ? `对方刚才露了破绽，这里该走 ${best}。` : "对方刚才露了破绽，没抓住。";
    case "blunder":
      if (f.matedIn) return `这步以后，对方${f.matedIn}步就能将死。${best ? `该走 ${best}。` : ""}`;
      if (f.loses) return `这步把${NAME[f.loses.role]}送掉了：对方能用 ${f.loses.san} 吃它。${best ? `该走 ${best}。` : ""}`;
      return best ? `这一步让局面坏了很多。该走 ${best}${gain}。` : "这一步让局面坏了很多。";
  }
}

/** 口气那一句: 写好的句子, 按好坏挑 */
const TONE: Record<"bad" | "slip" | "miss" | "good" | "book", string[]> = {
  bad: [
    "先看清对方能吃什么，再想自己要干什么。",
    "走之前问问自己：这步以后，哪个子没人保护？",
    "别急，急着走常常就是这样丢东西的。",
    "不要紧，记住这个局面，下次一眼就认得。",
  ],
  slip: ["差得不多，可优势就是这样一点一点丢的。", "下次多想一步。", "不算大错，但能更好。"],
  miss: ["对方送来的机会，走之前先看一眼。", "对方走错的时候，先找找能不能罚他。"],
  good: ["就是这样，稳稳地走。", "这步有道理。", "局面又好了一点。", "不慌不忙，很好。"],
  book: ["开局先把子都走出来，再说别的。", "开局就照前人走熟的路走。"],
};

function toneKind(m: MoveReview): keyof typeof TONE {
  if (m.cls === "blunder" || m.cls === "mistake") return "bad";
  if (m.cls === "inaccuracy") return "slip";
  if (m.cls === "miss") return "miss";
  if (m.cls === "book") return "book";
  return "good";
}

/** 往事、原话: 每条都有出处 (见 教练资料/斯坦尼茨.md), 程序原样放, 一个字不改 */
export interface Quote {
  id: string;
  text: string;
  /** 什么时候用 */
  when: (m: MoveReview, f: MoveFacts) => boolean;
}

const GOOD = new Set(["best", "excellent", "good", "great", "brilliant"]);

export const QUOTES: Quote[] = [
  {
    id: "blunders",
    // 1899 年《格拉斯哥每周先驱报》采访, 《美国国际象棋杂志》1899 年 9 月第 123 页转载
    text: "1899 年有人采访我，我说过：没有哪位大棋手比我出错更多。",
    when: (m) => m.cls === "blunder",
  },
  {
    id: "king",
    // 《现代国际象棋教程》1889, 「现代学派和下棋原则」那一章
    text: "我在《现代国际象棋教程》里写过：王必须当作攻守都很强的一个子。",
    when: (m, f) => GOOD.has(m.cls) && f.kingInEndgame,
  },
  {
    id: "knight",
    // Napier 回忆小时候跟他上的第一课 (1934 年出的书)
    text: "我的学生纳皮尔记得我教过他：马该放哪你先知道，象还不一定；确定比怀疑好得多。",
    when: (m, f) => (GOOD.has(m.cls) || m.cls === "book") && f.knightOut,
  },
  {
    id: "small",
    // 《现代国际象棋教程》1889
    text: "我在《现代国际象棋教程》里写过：尽可能积累小的优势。",
    when: (m, f) => (m.cls === "best" || m.cls === "excellent") && f.quiet && f.middlegame,
  },
  {
    id: "vienna",
    // 英文维基: 1873 年维也纳大赛改下阵地型, 正式比赛最后 14 盘全赢
    text: "1873 年在维也纳，我从猛攻改成这样稳着下，那次最后十四盘全赢了。",
    when: (m, f) => (m.cls === "best" || m.cls === "excellent") && f.quiet && f.middlegame,
  },
  {
    id: "brilliance",
    // 《现代国际象棋教程》1889
    text: "我在《现代国际象棋教程》里写过：喜欢漂亮胜过正确，只说明品味原始。漂亮又正确，才难得。",
    when: (m) => m.cls === "brilliant",
  },
  {
    id: "simplest",
    // 《现代国际象棋教程》1889, 他赞成冯·德·拉萨的话
    text: "我在《现代国际象棋教程》里引过冯·德·拉萨的话：最简单、最短的赢法就是最好的。",
    when: (m, f) => GOOD.has(m.cls) && f.givesMate,
  },
];

/** 一盘棋里哪几步讲往事、原话: 只在关键的步讲, 一盘最多两次, 隔开至少三个关键步, 每条只讲一次 */
export function planQuotes(review: GameReview, facts: (ply: number) => MoveFacts, max = 2): Map<number, Quote> {
  const plan = new Map<number, Quote>();
  const used = new Set<string>();
  let lastKey = -99;
  let keyIndex = 0;
  for (const m of review.moves) {
    if (!m.key && m.cls !== "book") continue;
    keyIndex++;
    if (plan.size >= max || keyIndex - lastKey < 3) continue;
    const f = facts(m.ply);
    const q = QUOTES.find((x) => !used.has(x.id) && x.when(m, f));
    if (!q) continue;
    plan.set(m.ply, q);
    used.add(q.id);
    lastKey = keyIndex;
  }
  return plan;
}

export interface Talk {
  /** 事实: 程序照实写的 */
  fact: string;
  /** 口气一句, 或者往事、原话 (原样) */
  tone: string;
  quote: boolean;
}

/** 第 ply 步教练说什么; 同一步每次说的一样 (往回翻不会变) */
export function coachTalk(m: MoveReview, f: MoveFacts, quote: Quote | undefined, opening?: string): Talk {
  const fact = factLine(m, f, opening);
  if (quote) return { fact, tone: quote.text, quote: true };
  const list = TONE[toneKind(m)];
  return { fact, tone: list[m.ply % list.length], quote: false };
}

/** 总结页教练说的话: 哪边下得准、转折在哪一步 (程序照实写) */
export function summaryFact(review: GameReview, plies: Ply[], facts: (ply: number) => MoveFacts): string {
  const side = (c: Color) => (c === "white" ? "白方" : "黑方");
  const { white, black } = review.accuracy;
  const who = Math.abs(white - black) < 3 ? "这盘两边下得差不多准。" : `这盘${side(white > black ? "white" : "black")}下得更准。`;
  const bad = review.moves.filter((m) => m.cls === "blunder" || m.cls === "mistake" || m.cls === "miss");
  if (!bad.length) return `${who}两边都没有大错。`;
  const turn = bad.reduce((a, b) => (b.loss > a.loss ? b : a));
  const f = facts(turn.ply);
  const what = f.loses
    ? `把${NAME[f.loses.role]}送掉了`
    : f.matedIn
      ? "让对方有了杀棋"
      : turn.cls === "miss" && f.bestWins
        ? `没吃掉${NAME[f.bestWins]}`
        : turn.cls === "miss"
          ? "没抓住对方的破绽"
          : "局面坏了很多";
  return `${who}转折在第 ${Math.ceil(turn.ply / 2)} 回合：${side(turn.color)}走 ${plies[turn.ply - 1].san}，${what}。`;
}

/** 总结页口气那一句 (写好的; 千问开着时由千问写) */
export const SUMMARY_TONE = "一盘一盘复盘，就是这样长进的。";

/** 分析时教练讲的小知识: 斯坦尼茨自己的事, 都有出处 (英文维基、Edward Winter, 见 教练资料/斯坦尼茨.md), 原样放 */
export const LOADING_FACTS = [
  "我 1836 年生在布拉格，是裁缝的儿子，家里十三个儿子我最小。",
  "我 12 岁才学会下棋。",
  "1866 年我赢了安德森，从那以后大家都说我是最强的。",
  "1886 年我赢了祖克托特，成了第一位正式的世界冠军。",
  "从 1862 年到 1894 年，一对一的比赛我 32 年没输过。",
  "1885 年我在纽约办了《国际象棋杂志》，自己当主编。",
  "1889 年纽约大赛的书，432 盘棋都是我一盘一盘注的。",
  "1894 年我输给了拉斯克，他比我小 32 岁。",
  "1895 年在黑斯廷斯，我 59 岁，赢巴德勒本那盘还得了最佳对局奖。",
  "在俄国我跟拉斯克一起下车轮战，两个人当场演了一出双簧。",
];
