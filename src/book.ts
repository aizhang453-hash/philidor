// 开局库: 局面 → 能走哪几步 (各走过几盘)。引擎前几步从这里按盘数抽签, 每盘开局就不一样。
// 资料见 tools/make-book.mjs。

export interface Book {
  maxPly: number;
  positions: Map<string, [string, number][]>;
}

/** 局面的钥匙: FEN 的前四段 (棋子、谁走、易位权、吃过路兵的格子) */
export function bookKey(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

export function parseBook(data: { maxPly?: number; positions?: Record<string, [string, number][]> }): Book {
  return { maxPly: data.maxPly ?? 16, positions: new Map(Object.entries(data.positions ?? {})) };
}

let loading: Promise<Book> | undefined;

export function loadBook(): Promise<Book> {
  loading ??= fetch("/book/book.json")
    .then((r) => {
      if (!r.ok) throw new Error("读不到开局库");
      return r.json();
    })
    .then(parseBook)
    .catch((e) => {
      loading = undefined;
      throw e;
    });
  return loading;
}

/** 按盘数抽一步; 不在库里返回 undefined */
export function pickBookMove(book: Book, fen: string, ply: number, rand: () => number = Math.random): string | undefined {
  if (ply >= book.maxPly) return undefined;
  const moves = book.positions.get(bookKey(fen));
  if (!moves || moves.length === 0) return undefined;
  const total = moves.reduce((s, [, n]) => s + n, 0);
  let r = rand() * total;
  for (const [uci, n] of moves) {
    r -= n;
    if (r < 0) return uci;
  }
  return moves[moves.length - 1][0];
}
