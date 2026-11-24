// 千问写教练口气那一句 (教练资料/教练说话的设计.md 第二步)。
// 事实还是程序写的 (coachTalk.ts), 往事、原话还是原样放; 千问只写一小句口气,
// 程序一条条查规矩, 不合格让它再写一次, 还不行就用写好的句子。没装、没开 Ollama 也用写好的句子。
import { chat, llmStatus, type ChatMessage } from "./llm";
import { CLS_NAME, type Cls } from "./review";

export type ToneKind = "praise" | "encourage" | "plain" | "remind" | "comfort" | "ask";

const KIND_TEXT: Record<ToneKind, string> = {
  praise: "夸一句",
  encourage: "鼓励一句",
  plain: "平平地接一句",
  remind: "提醒一条下棋的道理",
  comfort: "安慰一句",
  ask: "反问一句，让他自己想",
};

const BAD: Cls[] = ["blunder", "mistake", "miss", "inaccuracy"];

/** 这一步该说哪种话; 按步数轮着来, 连着几步不会是同一种 */
export function toneKind(cls: Cls, ply: number): ToneKind {
  const kinds: ToneKind[] =
    cls === "blunder" || cls === "mistake"
      ? ["remind", "comfort", "ask"]
      : cls === "inaccuracy"
        ? ["remind", "ask", "plain"]
        : cls === "miss"
          ? ["remind", "ask"]
          : cls === "book"
            ? ["plain", "remind"]
            : ["praise", "encourage", "plain"];
  return kinds[ply % kinds.length];
}

const SYSTEM = `你是威廉·斯坦尼茨，第一位国际象棋世界冠军，现在是用户的教练，陪他看下完的棋。你说话像你晚年：平和、宽厚、讲原则（局面的平衡、一点一点攒小优势、正确比漂亮要紧、先看清对方能吃什么），学生走得好会真心夸，走错了不挖苦。
程序已经把这一步的事实说过了，你只说一句态度、心情、习惯上的话（像别急、静下心、多想一想、这份耐心难得），一点都不说棋本身。
规矩：
1. 只说一句中文，不超过二十个字。
2. 不说任何跟棋有关的字眼：不提棋子、吃、送、贪、局面、优势、攻守、输赢、对手，也不提「棋」字；不提数字、年份、人名、地名。
3. 不讲你自己的往事，不引用任何人说过的话，不用引号。
4. 不说「你知道为什么吗」，不说「你」。
5. 好的一步就真心夸，不要用「虽然……但是」挑毛病。
6. 直接说这句话，前面不加名字。说法每次都换，不要照抄下面的例子。`;

/** 每种话给几句例子 (只是让它知道口气, 不许照抄) */
const EXAMPLES: Record<ToneKind, string[]> = {
  praise: ["这份耐心难得。", "不慌不忙，很好。", "心定了，手就稳。"],
  encourage: ["照这样，一步一步来。", "沉得住气，就是本事。", "保持这份清醒。"],
  plain: ["嗯，就是这样。", "慢慢来，不着急。", "这一步，平平稳稳。"],
  remind: ["慢一点，多想一想。", "动手之前，先停一停。", "心急的时候，最要小心。"],
  comfort: ["不要紧，记住这一回，下次就认得。", "谁都有手快的时候。"],
  ask: ["刚才是不是急了一点？", "下回动手前，能不能再看一眼？"],
};

/** 跟棋有关的字眼: 口气那一句一个都不许有 (千问一说棋就容易说错) */
const CHESS =
  /棋|吃|贪|送|丢|兵|(?<!马)马(?!上)|(?<![现印形对气景想])象|车|(?<![以之然最往背落今前])后(?![来面])|王|皇|将军|将死|杀|攻|守|局|势|优|劣|赢|输|胜|败|平衡|对手|对方|代价|诱饵|中心|兑|捉|弃|子力|棋子|格/;

export function toneMessages(cls: Cls, fact: string, kind: ToneKind): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM + "\n口气的例子：\n" + EXAMPLES[kind].join("\n") },
    { role: "user", content: `这一步：${CLS_NAME[cls]}。程序说的事实：${fact}\n请你${KIND_TEXT[kind]}。` },
  ];
}

/** 去掉前后的空白、名字、引号以外的杂东西 */
export function cleanTone(text: string): string {
  return text
    .trim()
    .replace(/^(斯坦尼茨|教练)\s*[:：]\s*/, "")
    .split("\n")[0]
    .trim();
}

/** 查规矩: 合格返回 null, 不合格返回原因 */
export function checkTone(text: string, cls: Cls, recent: string[]): string | null {
  const t = text.trim();
  if (!t) return "空的";
  if (t.replace(/[，。！？、；：,.!?\s]/g, "").length > 24) return "太长";
  if ((t.match(/[。！？!?]/g) ?? []).length > 1) return "不止一句";
  if (/[A-Za-z0-9０-９]/.test(t)) return "有字母或数字 (棋步、年份)";
  if (/[「」『』“”"《》‘’']/.test(t)) return "有引号或书名号";
  if (/当年|那年|那次|那时|年轻|小时候|曾经|我曾|以前我|我以前|记得|说过|写过|书里|那句|名言|有人说|常言|古人/.test(t)) return "讲往事或引原话";
  if (/斯坦尼茨|拉斯克|莫菲|安德森|祖克托特|奇戈林|菲利多尔|维也纳|伦敦|纽约|布拉格|巴黎|莫斯科/.test(t)) return "有人名或地名";
  if (/你知道为什么/.test(t)) return "用了「你知道为什么」";
  if (CHESS.test(t)) return "说到了棋";
  if (/你/.test(t)) return "叫了「你」";
  if (BAD.includes(cls)) {
    if (/好棋|漂亮|妙|精彩|很好|不错|完美|高明|厉害/.test(t)) return "坏棋夸了";
  } else {
    if (/错|失误|大忌|糟|坏|可惜|不该|贪|丢|漏|险|遗憾/.test(t)) return "好棋说了坏话";
    if (/但|不过|可是|虽|只是/.test(t)) return "好棋又转折挑毛病";
  }
  const bare = (x: string) => x.replace(/[，。！？、；：,.!?\s]/g, "");
  const b = bare(t);
  for (const ex of Object.values(EXAMPLES).flat()) if (b.includes(bare(ex))) return "照抄了例子";
  for (const r of recent) {
    const rb = bare(r);
    if (rb === b || rb.includes(b) || b.includes(rb)) return "跟前面一样";
    if (rb.slice(0, 3) === b.slice(0, 3)) return "跟前面开头一样";
  }
  return null;
}

let ready: Promise<string | null> | null = null;

/** 能用的千问模型 (Ollama 开着、装了千问), 没有是 null; 问一次就记住 */
export function voiceModel(): Promise<string | null> {
  ready ??= llmStatus()
    .then((s) => (s.running ? (s.models.find((m) => /^qwen/i.test(m)) ?? null) : null))
    .catch(() => null);
  return ready;
}

let queue: Promise<unknown> = Promise.resolve();

/** 千问写一句口气 (一句一句排队写); 写不出合格的返回 null; 轮到时已经不需要了 (翻走了) 返回 undefined */
export function aiTone(
  cls: Cls,
  fact: string,
  ply: number,
  recent: string[],
  wanted: () => boolean = () => true,
): Promise<string | null | undefined> {
  const job = queue.then(async () => {
    if (!wanted()) return undefined;
    const model = await voiceModel();
    if (!model) return null;
    const kind = toneKind(cls, ply);
    for (let i = 0; i < 2; i++) {
      try {
        const out = cleanTone(await chat(toneMessages(cls, fact, kind), { model, temperature: 0.6, maxTokens: 60, timeoutMs: 30_000 }));
        if (checkTone(out, cls, recent) === null) return out;
      } catch {
        return null;
      }
    }
    return null;
  });
  queue = job.catch(() => null);
  return job;
}
