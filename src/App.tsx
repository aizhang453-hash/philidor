import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Board } from "./Board";
import { Game, colorText, outcomeText, type Color } from "./game";
import { Match, type Player, type PlayerSetup } from "./match";
import {
  addDownloaded,
  getLatestStockfish,
  loadEngines,
  probe,
  saveEngines,
  strengthLevels,
  type EngineEntry,
} from "./engines";
import { transport } from "./transport";

interface Setup {
  white: PlayerSetup;
  black: PlayerSetup;
}

const SETUP_KEY = "philidor:setup";

interface Notice {
  text: string;
  error: boolean;
}

const MOVETIMES = [
  { value: 500, label: "0.5 秒" },
  { value: 1000, label: "1 秒" },
  { value: 2000, label: "2 秒" },
  { value: 3000, label: "3 秒" },
  { value: 5000, label: "5 秒" },
  { value: 10000, label: "10 秒" },
  { value: 30000, label: "30 秒" },
];

function loadSetup(): Setup {
  try {
    const raw = localStorage.getItem(SETUP_KEY);
    if (raw) return JSON.parse(raw) as Setup;
  } catch {
    /* 用默认的 */
  }
  return { white: { kind: "human" }, black: { kind: "engine", engine: "", movetime: 1000, level: null } };
}

/** 选的引擎被删了或者还没有, 换成第一个; 一个引擎都没有就换成人 */
function fixPlayer(p: PlayerSetup, engines: EngineEntry[]): PlayerSetup {
  if (p.kind === "human") return p;
  if (engines.some((e) => e.id === p.engine)) return p;
  if (engines.length === 0) return { kind: "human" };
  return { ...p, engine: engines[0].id, level: null };
}

const idleGame = new Game();

export function App() {
  const [engines, setEngines] = useState<EngineEntry[] | null>(null);
  const [setup, setSetup] = useState<Setup>(loadSetup);
  const [match, setMatch] = useState<Match | null>(null);
  const [, redraw] = useReducer((x: number) => x + 1, 0);
  const [orientation, setOrientation] = useState<Color>("white");
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  const [sync, setSync] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [adding, setAdding] = useState(false);
  /** 下载 Stockfish: null 没在下, "checking" 在查最新版, 数字是百分之几 */
  const [downloading, setDownloading] = useState<null | "checking" | number>(null);

  useEffect(() => {
    loadEngines().then((list) => {
      setEngines(list);
      setSetup((s) => ({ white: fixPlayer(s.white, list), black: fixPlayer(s.black, list) }));
    });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SETUP_KEY, JSON.stringify(setup));
    } catch {
      /* 存不了就算了 */
    }
  }, [setup]);

  useEffect(() => match?.subscribe(redraw), [match]);
  useEffect(() => () => match?.close(), [match]);

  const game = match?.game ?? idleGame;
  const fen = game.fen;
  const last = game.lastPly;
  const lastMove = useMemo<[string, string] | undefined>(() => (last ? [last.from, last.to] : undefined), [last]);
  const dests = useMemo(() => game.dests(), [game, fen]);
  const movable = match?.movable;

  function start() {
    if (!engines) return;
    const players = {} as Record<Color, Player>;
    for (const color of ["white", "black"] as Color[]) {
      const p = setup[color];
      const entry = p.kind === "engine" ? engines.find((e) => e.id === p.engine) : undefined;
      players[color] =
        p.kind === "engine" && entry
          ? { kind: "engine", name: entry.name, path: entry.path, movetime: p.movetime, level: p.level }
          : { kind: "human", name: "玩家" };
    }
    setOrientation(players.white.kind === "human" || players.black.kind === "engine" ? "white" : "black");
    setPromotion(null);
    setNotice(null);
    const m = new Match(players);
    setMatch(m);
    void m.start();
  }

  function leave() {
    match?.close();
    setMatch(null);
    setPromotion(null);
  }

  function onMove(from: string, to: string) {
    if (!match) return;
    if (game.needsPromotion(from, to)) {
      setPromotion({ from, to });
      return;
    }
    if (!match.humanMove(from + to)) setSync((s) => s + 1);
  }

  function promote(role: string) {
    if (match && promotion) match.humanMove(promotion.from + promotion.to + (role === "knight" ? "n" : role[0]));
    setPromotion(null);
    setSync((s) => s + 1);
  }

  async function addEngine() {
    setNotice(null);
    const path = await transport.pickFile();
    if (!path) return;
    setAdding(true);
    try {
      const entry = await probe(path);
      const list = [...(engines ?? []), entry];
      setEngines(list);
      saveEngines(list);
      setSetup((s) => ({ white: fixPlayer(s.white, list), black: fixPlayer(s.black, list) }));
    } catch {
      setNotice({ text: "这个文件不是能用的引擎", error: true });
    } finally {
      setAdding(false);
    }
  }

  async function downloadStockfish() {
    setNotice(null);
    setDownloading("checking");
    try {
      const r = await getLatestStockfish(engines ?? [], (done, total) =>
        setDownloading(total > 0 ? Math.floor((done / total) * 100) : 0),
      );
      if (r.kind === "latest") {
        setNotice({ text: `已经是最新的 Stockfish ${r.version}`, error: false });
        return;
      }
      const list = addDownloaded(engines ?? [], r.entry);
      setEngines(list);
      saveEngines(list);
      setSetup((s) => ({ white: fixPlayer(s.white, list), black: fixPlayer(s.black, list) }));
    } catch (e) {
      setNotice({ text: `下载失败：${e instanceof Error ? e.message : String(e)}`, error: true });
    } finally {
      setDownloading(null);
    }
  }

  function removeEngine(id: string) {
    const list = (engines ?? []).filter((e) => e.id !== id);
    setEngines(list);
    saveEngines(list);
    setSetup((s) => ({ white: fixPlayer(s.white, list), black: fixPlayer(s.black, list) }));
  }

  const top: Color = orientation === "white" ? "black" : "white";
  const bottom: Color = orientation;

  return (
    <div className="app">
      <div className="board-col">
        <PlayerBar color={top} match={match} setup={setup} engines={engines} />
        <Board
          key={sync}
          fen={fen}
          orientation={orientation}
          turnColor={game.turn}
          movableColor={promotion ? undefined : movable}
          dests={dests}
          lastMove={lastMove}
          check={game.inCheck}
          onMove={onMove}
        >
          {promotion && (
            <Promotion
              to={promotion.to}
              color={game.turn}
              orientation={orientation}
              onPick={promote}
              onCancel={() => {
                setPromotion(null);
                setSync((s) => s + 1);
              }}
            />
          )}
        </Board>
        <PlayerBar color={bottom} match={match} setup={setup} engines={engines} />
      </div>

      <aside className="panel">
        {match ? (
          <PlayPanel match={match} onFlip={() => setOrientation((o) => (o === "white" ? "black" : "white"))} onLeave={leave} />
        ) : (
          <SetupPanel
            engines={engines}
            setup={setup}
            onChange={setSetup}
            onStart={start}
            onAdd={addEngine}
            onDownload={downloadStockfish}
            onRemove={removeEngine}
            adding={adding}
            downloading={downloading}
            notice={notice}
          />
        )}
      </aside>
    </div>
  );
}

function PlayerBar(props: { color: Color; match: Match | null; setup: Setup; engines: EngineEntry[] | null }) {
  const { color, match } = props;
  let name: string;
  if (match) name = match.players[color].name;
  else {
    const p = props.setup[color];
    name = p.kind === "engine" ? (props.engines?.find((e) => e.id === p.engine)?.name ?? "引擎") : "玩家";
  }
  const thinking = match?.thinking === color;
  const toMove = match && match.status === "playing" && !match.over && match.game.turn === color;
  return (
    <div className={`player-bar${toMove ? " to-move" : ""}`}>
      <span className={`chip ${color}`} />
      <span className="player-name">{name}</span>
      {thinking && <span className="thinking">在想</span>}
    </div>
  );
}

function Promotion(props: {
  to: string;
  color: Color;
  orientation: Color;
  onPick: (role: string) => void;
  onCancel: () => void;
}) {
  const file = props.to.charCodeAt(0) - 97;
  const rank = Number(props.to[1]) - 1;
  const col = props.orientation === "white" ? file : 7 - file;
  const atTop = (props.orientation === "white") === (rank === 7);
  const roles = ["queen", "knight", "rook", "bishop"];
  return (
    <div className="promotion" onClick={props.onCancel}>
      {roles.map((role, i) => (
        <button
          key={role}
          className="promotion-square"
          style={{ left: `${col * 12.5}%`, ...(atTop ? { top: `${i * 12.5}%` } : { bottom: `${i * 12.5}%` }) }}
          onClick={(e) => {
            e.stopPropagation();
            props.onPick(role);
          }}
        >
          <span className={`piece ${props.color} ${role}`} />
        </button>
      ))}
    </div>
  );
}

function SetupPanel(props: {
  engines: EngineEntry[] | null;
  setup: Setup;
  onChange: (s: Setup) => void;
  onStart: () => void;
  onAdd: () => void;
  onDownload: () => void;
  onRemove: (id: string) => void;
  adding: boolean;
  downloading: null | "checking" | number;
  notice: Notice | null;
}) {
  const { engines, setup } = props;
  return (
    <div className="setup">
      <h2>新对局</h2>
      {(["white", "black"] as Color[]).map((color) => (
        <PlayerPicker
          key={color}
          color={color}
          value={setup[color]}
          engines={engines ?? []}
          onChange={(p) => props.onChange({ ...setup, [color]: p })}
        />
      ))}
      <button className="primary" disabled={!engines} onClick={props.onStart}>
        开始
      </button>

      <h3>引擎</h3>
      {engines === null ? (
        <p className="muted">正在找引擎</p>
      ) : (
        <ul className="engine-list">
          {engines.map((e) => (
            <li key={e.id}>
              <span className="engine-name" title={e.path}>
                {e.name}
              </span>
              <button className="icon" title="删掉" onClick={() => props.onRemove(e.id)}>
                ×
              </button>
            </li>
          ))}
          {engines.length === 0 && <li className="muted">还没有引擎</li>}
        </ul>
      )}
      <div className="engine-buttons">
        <button onClick={props.onAdd} disabled={props.adding || !engines}>
          {props.adding ? "正在打开" : "添加引擎"}
        </button>
        <button onClick={props.onDownload} disabled={props.downloading !== null || !engines}>
          {props.downloading === null
            ? "下载最新 Stockfish"
            : props.downloading === "checking"
              ? "正在查最新版"
              : `正在下载 ${props.downloading}%`}
        </button>
      </div>
      {props.notice && <p className={props.notice.error ? "error" : "note"}>{props.notice.text}</p>}
    </div>
  );
}

function PlayerPicker(props: {
  color: Color;
  value: PlayerSetup;
  engines: EngineEntry[];
  onChange: (p: PlayerSetup) => void;
}) {
  const { value, engines } = props;
  const entry = value.kind === "engine" ? engines.find((e) => e.id === value.engine) : undefined;
  const levels = entry ? strengthLevels(entry.strength) : [];
  return (
    <div className="picker">
      <label className="row">
        <span className="label">
          <span className={`chip ${props.color}`} />
          {colorText(props.color)}
        </span>
        <select
          value={value.kind === "engine" ? value.engine : "human"}
          onChange={(ev) => {
            const v = ev.target.value;
            if (v === "human") props.onChange({ kind: "human" });
            else
              props.onChange({
                kind: "engine",
                engine: v,
                movetime: value.kind === "engine" ? value.movetime : 1000,
                level: null,
              });
          }}
        >
          <option value="human">玩家</option>
          {engines.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      {value.kind === "engine" && (
        <>
          <label className="row sub">
            <span className="label">每步想</span>
            <select
              value={value.movetime}
              onChange={(ev) => props.onChange({ ...value, movetime: Number(ev.target.value) })}
            >
              {MOVETIMES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {levels.length > 1 && (
            <label className="row sub">
              <span className="label">棋力</span>
              <select
                value={value.level === null ? "" : String(value.level)}
                onChange={(ev) =>
                  props.onChange({ ...value, level: ev.target.value === "" ? null : Number(ev.target.value) })
                }
              >
                {levels.map((l) => (
                  <option key={l.label} value={l.value === null ? "" : String(l.value)}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
    </div>
  );
}

function PlayPanel(props: { match: Match; onFlip: () => void; onLeave: () => void }) {
  const { match } = props;
  const game = match.game;
  const outcome = game.outcome();
  const humans = match.humans;
  const [confirmResign, setConfirmResign] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [game.plies.length]);

  useEffect(() => {
    if (!confirmResign) return;
    const t = setTimeout(() => setConfirmResign(false), 3000);
    return () => clearTimeout(t);
  }, [confirmResign]);

  const rows: { n: number; white?: string; black?: string }[] = [];
  game.plies.forEach((p, i) => {
    if (i % 2 === 0) rows.push({ n: i / 2 + 1, white: p.san });
    else rows[rows.length - 1].black = p.san;
  });

  const resignColor: Color = humans.length === 1 ? humans[0] : game.turn;
  const playing = match.status === "playing";

  return (
    <div className="play">
      <div className="moves" ref={listRef}>
        {rows.map((r) => (
          <div className="move-row" key={r.n}>
            <span className="move-no">{r.n}.</span>
            <span className={`move${r.n * 2 - 1 === game.plies.length ? " current" : ""}`}>{r.white}</span>
            <span className={`move${r.n * 2 === game.plies.length ? " current" : ""}`}>{r.black ?? ""}</span>
          </div>
        ))}
      </div>

      {match.status === "starting" && <p className="status">正在打开引擎</p>}
      {outcome && <p className="status result">{outcomeText(outcome)}</p>}
      {playing && !outcome && match.paused && <p className="status">暂停了</p>}
      {match.error && <p className="error">{match.error}</p>}

      <div className="buttons">
        {playing && !outcome && humans.length === 0 && (
          <button onClick={() => (match.paused ? match.resume() : match.pause())}>{match.paused ? "继续" : "暂停"}</button>
        )}
        {match.canUndo && <button onClick={() => void match.undo()}>悔棋</button>}
        {playing && !outcome && humans.length > 0 && (
          <button
            className={confirmResign ? "danger" : ""}
            onClick={() => {
              if (!confirmResign) return setConfirmResign(true);
              setConfirmResign(false);
              match.resign(resignColor);
            }}
          >
            {confirmResign ? "确定认输" : "认输"}
          </button>
        )}
        <button onClick={props.onFlip}>翻转棋盘</button>
        <button className={outcome || match.status === "failed" ? "primary" : ""} onClick={props.onLeave}>
          新对局
        </button>
      </div>
    </div>
  );
}
