// 对局回顾的页面: 先让引擎分析, 再看总结, 再一步步看 (关键的步停下来、看最佳着法、看往下怎么走)。
// 教练 (头像和说的话) 以后再做, 现在讲话的框里只放好坏和分数。
import { useEffect, useMemo, useRef, useState } from "react";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Chess } from "chessops/chess";
import { normalizeMove } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
import type { NormalMove } from "chessops/types";
import { Board } from "./Board";
import { ClsIcon, CLS_COLOR } from "./ClsIcon";
import type { Color, Ply } from "./game";
import { analyseGame, type Analysis } from "./analysis";
import { BAD, CLS_NAME, CLS_ORDER, evalText, nextKey, whiteWins, type GameReview } from "./review";
import { chineseOpening, loadOpenings } from "./openings";
import { AREAS, AREA_NAME } from "./gameRating";
import { loadBook } from "./book";
import { playMoveSound } from "./sound";
import type { EngineEntry } from "./engines";
import {
  DELAYS,
  PRECISIONS,
  loadReviewSettings,
  saveReviewSettings,
  type ReviewSettings,
} from "./reviewSettings";

export interface ReviewSource {
  players: Record<Color, { name: string; avatar: string }>;
  plies: Ply[];
  positions: readonly Chess[];
  /** 每步用了多少毫秒 (没有就不显示) */
  moveTimes: number[];
  /** 人下的是哪一方 (只看自己的关键着法用) */
  humans: Color[];
}

/** 正在看的一段变化 (解析 = 这步之后会怎么走, 最佳 = 这步该怎么走) */
interface Line {
  kind: "explain" | "best";
  /** 从第几个局面开始 */
  base: number;
  ucis: string[];
  sans: string[];
  fens: string[];
  squares: [string, string][];
  captures: boolean[];
  checks: boolean[];
  /** 走到第几步了 (0 是还没走) */
  at: number;
}

const MAX_LINE = 8;

function playLine(base: Chess, ucis: string[]) {
  const pos = base.clone();
  const out = { ucis: [] as string[], sans: [] as string[], fens: [] as string[], squares: [] as [string, string][], captures: [] as boolean[], checks: [] as boolean[] };
  for (const u of ucis.slice(0, MAX_LINE)) {
    const m = parseUci(u) as NormalMove | undefined;
    if (!m || !("from" in m)) break;
    const move = normalizeMove(pos, m) as NormalMove;
    if (!pos.isLegal(move)) break;
    const san = makeSan(pos, move);
    pos.play(move);
    out.ucis.push(u);
    out.sans.push(san);
    out.fens.push(makeFen(pos.toSetup()));
    out.squares.push([u.slice(0, 2), u.slice(2, 4)]);
    out.captures.push(san.includes("x"));
    out.checks.push(pos.isCheck());
  }
  return out;
}

const moveNo = (ply: number) => Math.ceil(ply / 2);

/** 一段变化写成「1... e5 2. dxe5」 */
function lineWords(base: number, sans: string[]) {
  return sans.map((san, i) => {
    const ply = base + i + 1;
    const white = ply % 2 === 1;
    const prefix = white ? `${moveNo(ply)}. ` : i === 0 ? `${moveNo(ply)}... ` : "";
    return prefix + san;
  });
}

function pickEngine(engines: EngineEntry[], id: string): EngineEntry | undefined {
  return engines.find((e) => e.id === id) ?? engines.find((e) => /^stockfish/i.test(e.name)) ?? engines[0];
}

function reviewThreads() {
  const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
  return cores >= 8 ? 4 : 2;
}

export function ReviewScreen(props: {
  source: ReviewSource;
  engines: EngineEntry[];
  cached: Analysis | null;
  onAnalysed: (a: Analysis | null) => void;
  onBack: () => void;
}) {
  const { source, engines } = props;
  const n = source.plies.length;
  const [settings, setSettingsState] = useState<ReviewSettings>(loadReviewSettings);
  const [analysis, setAnalysis] = useState<Analysis | null>(props.cached);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const [mode, setMode] = useState<"summary" | "step">("summary");
  const [ply, setPly] = useState(0);
  const [line, setLine] = useState<Line | null>(null);
  const [orientation, setOrientation] = useState<Color>(source.humans.length === 1 ? source.humans[0] : "white");
  const [autoplay, setAutoplay] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const engine = pickEngine(engines, settings.engine);

  function setSettings(s: ReviewSettings) {
    setSettingsState(s);
    saveReviewSettings(s);
  }

  // 分析
  useEffect(() => {
    if (analysis || !engine) return;
    let stop = false;
    setError(null);
    setProgress({ done: 0, total: n + 1 });
    (async () => {
      const [openings, book] = await Promise.all([loadOpenings().catch(() => null), loadBook().catch(() => null)]);
      const a = await analyseGame(
        engine.path,
        source.plies.map((p) => p.uci),
        source.positions,
        { movetime: settings.movetime, threads: reviewThreads(), hash: 256 },
        { openings, book },
        (done, total) => !stop && setProgress({ done, total }),
        () => stop,
      );
      if (stop || !a) return;
      setAnalysis(a);
      props.onAnalysed(a);
      setProgress(null);
    })().catch((e) => {
      if (stop) return;
      setError(`分析出错：${e instanceof Error ? e.message : String(e)}`);
      setProgress(null);
    });
    return () => {
      stop = true;
    };
  }, [run, analysis === null]);

  const review = analysis?.review;
  const wins = useMemo(() => (analysis ? whiteWins(analysis.evals) : []), [analysis]);
  const only: Color | undefined = settings.mineOnly && source.humans.length === 1 ? source.humans[0] : undefined;

  function reanalyse() {
    setAnalysis(null);
    props.onAnalysed(null);
    setMode("summary");
    setLine(null);
    setRun((r) => r + 1);
  }

  // 看的局面
  const shown = line && line.at > 0 ? line.fens[line.at - 1] : makeFen(source.positions[ply].toSetup());
  const shownPos = line && line.at > 0 ? null : source.positions[ply];
  const lastMove: [string, string] | undefined =
    line && line.at > 0 ? line.squares[line.at - 1] : ply > 0 ? [source.plies[ply - 1].from, source.plies[ply - 1].to] : undefined;
  const turn: Color = shown.split(" ")[1] === "w" ? "white" : "black";
  const mr = review && ply > 0 && !(line && line.at > 0) ? review.moves[ply - 1] : undefined;

  const shapes = useMemo<DrawShape[]>(() => {
    if (!analysis || !mr || !settings.arrows || mode !== "step") return [];
    if (!BAD.includes(mr.cls) && mr.cls !== "good") return [];
    const best = analysis.evals[ply - 1].best;
    if (!best || best === mr.uci) return [];
    return [{ orig: best.slice(0, 2), dest: best.slice(2, 4), brush: "green" } as DrawShape];
  }, [analysis, mr, settings.arrows, mode, ply]);

  function go(p: number, sound = false) {
    const target = Math.max(0, Math.min(n, p));
    if (sound && target === ply + 1) playMoveSound(source.plies[target - 1].capture);
    setLine(null);
    setPly(target);
  }

  function stepLine(at: number) {
    if (!line) return;
    const target = Math.max(0, Math.min(line.ucis.length, at));
    if (target === line.at + 1) playMoveSound(line.captures[target - 1]);
    setLine({ ...line, at: target });
  }

  function startLine(kind: Line["kind"]) {
    if (!analysis) return;
    const base = kind === "explain" ? ply : ply - 1;
    if (base < 0) return;
    // 「最佳」只摆最好的那一步, 「解析」才往下摆好几步
    const pv = kind === "best" ? analysis.evals[base].pv.slice(0, 1) : analysis.evals[base].pv;
    if (!pv.length) return;
    setAutoplay(false);
    setLine({ kind, base, ...playLine(source.positions[base], pv), at: kind === "best" ? 1 : 0 });
  }

  function nextKeyMove() {
    if (!review) return;
    const k = nextKey(review, ply, only);
    if (k === undefined) setMode("summary");
    else go(k);
  }

  // 解析时自己一步步走
  useEffect(() => {
    if (!line || !settings.autoLine || line.at >= line.ucis.length) return;
    const t = setTimeout(() => stepLine(line.at + 1), line.at === 0 ? 500 : 1000);
    return () => clearTimeout(t);
  }, [line, settings.autoLine]);

  // 自动播放
  useEffect(() => {
    if (!autoplay) return;
    if (ply >= n) {
      setAutoplay(false);
      return;
    }
    const t = setTimeout(() => go(ply + 1, true), settings.delay * 1000);
    return () => clearTimeout(t);
  }, [autoplay, ply, settings.delay]);

  // 方向键翻步
  useEffect(() => {
    if (mode !== "step") return;
    const onKey = (e: KeyboardEvent) => {
      if (showSettings) return;
      if (e.key === "ArrowRight") line ? stepLine(line.at + 1) : go(ply + 1, true);
      else if (e.key === "ArrowLeft") line ? (line.at > 0 ? stepLine(line.at - 1) : setLine(null)) : go(ply - 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(n);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const icon = mr && settings.onBoard && mode === "step" ? { cls: mr.cls, square: source.plies[ply - 1].to } : undefined;
  const boardClass = mr && mode === "step" ? `mark-${mr.cls}` : undefined;
  const shownEval = analysis ? (line && line.at > 0 ? analysis.evals[line.base] : analysis.evals[ply]) : undefined;
  const top: Color = orientation === "white" ? "black" : "white";

  return (
    <div className="app review">
      <EvalBar win={shownEval ? wins[line && line.at > 0 ? line.base : ply] : 50} text={evalText(shownEval)} orientation={orientation} />
      <div className="board-col">
        <ReviewBar player={source.players[top]} color={top} />
        <Board
          fen={shown}
          orientation={orientation}
          turnColor={turn}
          dests={EMPTY}
          lastMove={lastMove}
          check={shownPos ? shownPos.isCheck() : !!line && line.checks[line.at - 1]}
          onMove={() => {}}
          shapes={shapes}
          className={boardClass}
        >
          {icon && <BoardIcon cls={icon.cls} square={icon.square} orientation={orientation} />}
        </Board>
        <ReviewBar player={source.players[orientation]} color={orientation} />
      </div>
      <div className="board-tools">
        <button className="tool" title="设置" onClick={() => setShowSettings(true)}>
          <GearIcon />
        </button>
        <button className="tool" title="翻转棋盘" onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))}>
          <FlipIcon />
        </button>
      </div>

      <aside className="panel review-panel">
        <div className="head">
          <h2>对局回顾</h2>
          <button onClick={props.onBack}>返回</button>
        </div>

        {!engine && <p className="error">没有引擎，先在「引擎」里添加一个</p>}
        {error && (
          <>
            <p className="error">{error}</p>
            <button onClick={reanalyse}>再试一次</button>
          </>
        )}
        {progress && (
          <div className="analysing">
            <p>正在分析</p>
            <div className="progress">
              <div style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
            </div>
            <p className="muted">
              {engine?.name}　{progress.done} / {progress.total}
            </p>
          </div>
        )}

        {review && analysis && mode === "summary" && (
          <Summary
            review={review}
            wins={wins}
            players={source.players}
            onPick={(p) => {
              setMode("step");
              go(p);
            }}
            onStart={() => {
              setMode("step");
              const k = nextKey(review, 0, only);
              go(k ?? 1);
            }}
          />
        )}

        {review && analysis && mode === "step" && (
          <>
            <Bubble review={review} ply={ply} line={line} evals={analysis.evals} positions={source.positions} />
            <div className="review-actions">
              {line ? (
                <>
                  <button onClick={() => (line.at > 0 ? stepLine(line.at - 1) : setLine(null))}>‹</button>
                  <button onClick={() => stepLine(line.at + 1)} disabled={line.at >= line.ucis.length}>
                    ›
                  </button>
                  <button className="primary" onClick={() => setLine(null)}>
                    好了
                  </button>
                </>
              ) : (
                <>
                  {mr && BAD.includes(mr.cls) && (
                    <button onClick={() => startLine("best")} title="该怎么走">
                      <ClsIcon cls="best" size={18} /> 最佳
                    </button>
                  )}
                  {ply > 0 && analysis.evals[ply].pv.length > 0 && (
                    <button onClick={() => startLine("explain")} title="往下会怎么走">
                      <BulbIcon /> 解析
                    </button>
                  )}
                  <button className="primary" onClick={nextKeyMove}>
                    {nextKey(review, ply, only) === undefined ? "回到总结" : "下一个 →"}
                  </button>
                </>
              )}
            </div>
            <MoveList
              plies={source.plies}
              review={review}
              ply={ply}
              line={line}
              settings={settings}
              moveTimes={source.moveTimes}
              onPick={go}
              onPickLine={stepLine}
            />
            <Graph wins={wins} review={review} ply={line ? line.base : ply} onPick={(p) => go(p)} />
            <div className="nav">
              <button title="开头" onClick={() => go(0)}>⏮</button>
              <button title="上一步" onClick={() => go(ply - 1)}>◀</button>
              <button title={autoplay ? "停" : "自动播放"} onClick={() => setAutoplay((a) => !a)}>
                {autoplay ? "⏸" : "▶︎"}
              </button>
              <button title="下一步" onClick={() => go(ply + 1, true)}>▶</button>
              <button title="最后" onClick={() => go(n)}>⏭</button>
            </div>
          </>
        )}
      </aside>

      {showSettings && (
        <SettingsDialog
          settings={settings}
          engines={engines}
          engine={engine}
          onChange={(s) => {
            const redo = s.movetime !== settings.movetime || pickEngine(engines, s.engine)?.id !== engine?.id;
            setSettings(s);
            if (redo && analysis) reanalyse();
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

const EMPTY = new Map<string, string[]>();

function ReviewBar({ player, color }: { player: { name: string; avatar: string }; color: Color }) {
  return (
    <div className="player-bar">
      <span className={`avatar ${color}`}>
        <img src={player.avatar} alt="" draggable={false} />
      </span>
      <span className="player-name">{player.name}</span>
    </div>
  );
}

function EvalBar({ win, text, orientation }: { win: number; text: string; orientation: Color }) {
  const whiteBottom = orientation === "white";
  const whiteAhead = win >= 50;
  return (
    <div className={`eval-bar${whiteBottom ? "" : " flipped"}`}>
      <div className="eval-white" style={{ height: `${win}%` }} />
      <span className={`eval-text ${whiteAhead === whiteBottom ? "bottom" : "top"} ${whiteAhead ? "on-white" : "on-black"}`}>
        {barText(text)}
      </span>
    </div>
  );
}

/** 评估条上的字: 不带正负号 (颜色就看得出谁好), 一位小数 */
function barText(t: string) {
  if (/M/.test(t)) return t.replace("-", "");
  const v = Math.abs(Number(t));
  return Number.isFinite(v) ? (v >= 10 ? v.toFixed(0) : v.toFixed(1)) : t;
}

function BoardIcon({ cls, square, orientation }: { cls: GameReview["moves"][number]["cls"]; square: string; orientation: Color }) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const col = orientation === "white" ? file : 7 - file;
  const row = orientation === "white" ? 7 - rank : rank;
  return (
    <span className="board-icon" style={{ left: `${(col + 1) * 12.5}%`, top: `${row * 12.5}%` }}>
      <ClsIcon cls={cls} size={100} />
    </span>
  );
}

function Summary(props: {
  review: GameReview;
  wins: number[];
  players: ReviewSource["players"];
  onPick: (ply: number) => void;
  onStart: () => void;
}) {
  const { review } = props;
  return (
    <div className="summary">
      <Graph wins={props.wins} review={review} onPick={props.onPick} />
      <div className="sum-grid">
        <span />
        <span className="sum-player">
          <img src={props.players.white.avatar} alt="" draggable={false} />
          <span className="sum-name">{props.players.white.name}</span>
        </span>
        <span />
        <span className="sum-player">
          <img src={props.players.black.avatar} alt="" draggable={false} />
          <span className="sum-name">{props.players.black.name}</span>
        </span>
        <span className="sum-label">精度</span>
        <span className="acc white">{review.accuracy.white.toFixed(1)}</span>
        <span />
        <span className="acc black">{review.accuracy.black.toFixed(1)}</span>
        {CLS_ORDER.map((c) => (
          <Row key={c} c={c} review={review} />
        ))}
        <span className="sum-sep" />
        <span className="sum-label">棋局等级</span>
        <span className="acc white">{review.rating.white ?? "—"}</span>
        <span />
        <span className="acc black">{review.rating.black ?? "—"}</span>
        {AREAS.map((a) => (
          <Area key={a} name={AREA_NAME[a]} w={review.areas.white[a]} b={review.areas.black[a]} />
        ))}
      </div>
      <button className="primary start-review" onClick={props.onStart}>
        开始回顾
      </button>
    </div>
  );
}

function Row({ c, review }: { c: (typeof CLS_ORDER)[number]; review: GameReview }) {
  const w = review.counts.white[c];
  const b = review.counts.black[c];
  return (
    <>
      <span className="sum-label">{CLS_NAME[c]}</span>
      <span className="count" style={{ color: w ? CLS_COLOR[c] : undefined }}>
        {w}
      </span>
      <ClsIcon cls={c} size={20} />
      <span className="count" style={{ color: b ? CLS_COLOR[c] : undefined }}>
        {b}
      </span>
    </>
  );
}

function Area({ name, w, b }: { name: string; w: GameReview["areas"]["white"]["opening"]; b: GameReview["areas"]["white"]["opening"] }) {
  return (
    <>
      <span className="sum-label">{name}</span>
      <span className="count">{w ? <ClsIcon cls={w} size={22} title={CLS_NAME[w]} /> : "—"}</span>
      <span />
      <span className="count">{b ? <ClsIcon cls={b} size={22} title={CLS_NAME[b]} /> : "—"}</span>
    </>
  );
}

function Bubble(props: {
  review: GameReview;
  ply: number;
  line: Line | null;
  evals: Analysis["evals"];
  positions: readonly Chess[];
}) {
  const { review, ply, line, evals } = props;
  if (line) {
    const e = line.at > 0 ? evals[line.base] : evals[line.base];
    return (
      <div className="bubble">
        <div className="bubble-head">
          {line.kind === "best" ? <ClsIcon cls="best" size={22} /> : <BulbIcon />}
          <span className="bubble-title">{line.kind === "best" ? `最佳是 ${line.sans[0]}` : "解析"}</span>
          <span className={`eval-chip ${(e.cp ?? 0) < 0 || (e.mate ?? 0) < 0 ? "dark" : ""}`}>{evalText(e)}</span>
        </div>
      </div>
    );
  }
  if (ply === 0)
    return (
      <div className="bubble">
        <div className="bubble-head">
          <span className="bubble-title">开局</span>
        </div>
      </div>
    );
  const m = review.moves[ply - 1];
  const e = evals[ply];
  const opening = m.cls === "book" && review.opening && review.openingPly !== undefined && review.openingPly <= ply ? chineseOpening(review.opening) : undefined;
  return (
    <div className="bubble">
      <div className="bubble-head">
        <ClsIcon cls={m.cls} size={22} />
        <span className="bubble-title" style={{ color: CLS_COLOR[m.cls] }}>
          {CLS_NAME[m.cls]}
        </span>
        <span className={`eval-chip ${(e.cp ?? 0) < 0 || (e.mate ?? 0) < 0 ? "dark" : ""}`}>{evalText(e)}</span>
      </div>
      {opening && <p className="bubble-text">{opening}</p>}
    </div>
  );
}

function MoveList(props: {
  plies: Ply[];
  review: GameReview;
  ply: number;
  line: Line | null;
  settings: ReviewSettings;
  moveTimes: number[];
  onPick: (ply: number) => void;
  onPickLine: (at: number) => void;
}) {
  const { plies, review, ply, line, settings } = props;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector(".current")?.scrollIntoView({ block: "nearest" });
  }, [ply, line?.at]);
  const rows: number[] = [];
  for (let i = 1; i <= plies.length; i += 2) rows.push(i);
  const lineRow = line ? Math.max(1, line.base % 2 === 0 ? line.base - 1 : line.base) : -1;

  const cell = (p: number) => {
    if (p > plies.length) return <span className="rmove" />;
    const m = review.moves[p - 1];
    const mark = settings.markAll || m.key || m.cls === "book" ? m.cls : undefined;
    const bad = BAD.includes(m.cls);
    const t = props.moveTimes[p - 1];
    return (
      <span className={`rmove${p === ply && !line ? " current" : ""}`} onClick={() => props.onPick(p)}>
        {mark && (settings.markAll || mark !== "book" || p === review.openingPly || m.key) && <ClsIcon cls={mark} size={15} />}
        <span style={bad ? { color: CLS_COLOR[m.cls] } : undefined}>{plies[p - 1].san}</span>
        {settings.showTime && t !== undefined && <span className="spent">{(t / 1000).toFixed(1)}秒</span>}
      </span>
    );
  };

  return (
    <div className="moves review-moves" ref={ref}>
      {rows.map((w) => (
        <div key={w}>
          <div className="move-row">
            <span className="move-no">{moveNo(w)}.</span>
            {cell(w)}
            {cell(w + 1)}
          </div>
          {line && lineRow === w && (
            <div className="line-row">
              {lineWords(line.base, line.sans).map((word, i) => (
                <span key={i} className={line.at === i + 1 ? "current" : ""} onClick={() => props.onPickLine(i + 1)}>
                  {word}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Graph(props: { wins: number[]; review: GameReview; ply?: number; onPick: (ply: number) => void }) {
  const { wins, review } = props;
  const n = wins.length - 1;
  const ref = useRef<HTMLDivElement>(null);
  if (n < 1) return null;
  const pts = wins.map((w, i) => `${(i / n) * 100},${100 - w}`).join(" ");
  return (
    <div
      className="graph"
      ref={ref}
      onClick={(e) => {
        const r = ref.current!.getBoundingClientRect();
        props.onPick(Math.round(((e.clientX - r.left) / r.width) * n));
      }}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <polygon points={`0,100 ${pts} 100,100`} fill="#e9e6e1" />
        <line x1="0" y1="50" x2="100" y2="50" stroke="#888" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
      </svg>
      {props.ply !== undefined && <span className="graph-cursor" style={{ left: `${(props.ply / n) * 100}%` }} />}
      {review.moves
        .filter((m) => m.key && m.cls !== "book")
        .map((m) => (
          <span
            key={m.ply}
            className="graph-dot"
            style={{ left: `${(m.ply / n) * 100}%`, top: `${100 - wins[m.ply]}%`, background: CLS_COLOR[m.cls] }}
          />
        ))}
    </div>
  );
}

function SettingsDialog(props: {
  settings: ReviewSettings;
  engines: EngineEntry[];
  engine: EngineEntry | undefined;
  onChange: (s: ReviewSettings) => void;
  onClose: () => void;
}) {
  const { settings: s } = props;
  const [tab, setTab] = useState<"engine" | "view">("engine");
  const set = (patch: Partial<ReviewSettings>) => props.onChange({ ...s, ...patch });
  return (
    <div className="dialog-back" onClick={props.onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="head">
          <h2>设置</h2>
          <button className="icon" onClick={props.onClose}>
            ×
          </button>
        </div>
        <div className="tabs">
          <button className={tab === "engine" ? "on" : ""} onClick={() => setTab("engine")}>
            引擎
          </button>
          <button className={tab === "view" ? "on" : ""} onClick={() => setTab("view")}>
            查看
          </button>
        </div>
        {tab === "engine" ? (
          <div className="opts">
            <label className="opt">
              <span>引擎</span>
              <select value={props.engine?.id ?? ""} onChange={(e) => set({ engine: e.target.value })}>
                {props.engines.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="opt">
              <span>精度</span>
              <select value={s.movetime} onChange={(e) => set({ movetime: Number(e.target.value) })}>
                {PRECISIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}（每步 {p.value / 1000} 秒）
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <div className="opts">
            <Toggle label="最佳着法的箭头" on={s.arrows} onChange={(v) => set({ arrows: v })} />
            <label className="opt">
              <span>关键着法</span>
              <select value={s.mineOnly ? "me" : "both"} onChange={(e) => set({ mineOnly: e.target.value === "me" })}>
                <option value="both">双方</option>
                <option value="me">只看我的</option>
              </select>
            </label>
            <Toggle label="棋盘上显示好坏" on={s.onBoard} onChange={(v) => set({ onBoard: v })} />
            <label className="opt">
              <span>走子记录的标记</span>
              <select value={s.markAll ? "all" : "key"} onChange={(e) => set({ markAll: e.target.value === "all" })}>
                <option value="key">关键着法</option>
                <option value="all">所有走法</option>
              </select>
            </label>
            <Toggle label="解析时自动走" on={s.autoLine} onChange={(v) => set({ autoLine: v })} />
            <label className="opt">
              <span>自动播放每步隔</span>
              <select value={s.delay} onChange={(e) => set({ delay: Number(e.target.value) })}>
                {DELAYS.map((d) => (
                  <option key={d} value={d}>
                    {d} 秒
                  </option>
                ))}
              </select>
            </label>
            <Toggle label="显示每步用时" on={s.showTime} onChange={(v) => set({ showTime: v })} />
          </div>
        )}
      </div>
    </div>
  );
}

function Toggle(props: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="opt">
      <span>{props.label}</span>
      <button className={`switch${props.on ? " on" : ""}`} onClick={() => props.onChange(!props.on)} role="switch" aria-checked={props.on}>
        <span />
      </button>
    </label>
  );
}

export function FlipIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4v14M7 18l-3-3M7 18l3-3M17 20V6M17 6l-3 3M17 6l3 3" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

function BulbIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f0c43c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" />
    </svg>
  );
}

