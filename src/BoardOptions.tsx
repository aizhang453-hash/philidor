// 设置里「棋盘」那一页 (对局回顾的设置里一页, 下棋时棋盘旁边的齿轮也打开它)。
import {
  ANIMATIONS,
  BOARDS,
  PIECE_SETS,
  SOUNDS,
  setBoardSettings,
  useBoardSettings,
  type BoardSettings,
} from "./boardSettings";
import { playMoveSound } from "./sound";
import { figurineChar } from "./boardSettings";
import type { Color } from "./game";

/** 一步棋的写法: 「记谱」选了棋子图就把 N、B…画成棋子小图 (字体里的棋子图偏小, 单独放大) */
export function San({ san, color }: { san: string; color: Color }) {
  const { figurine } = useBoardSettings();
  if (!figurine) return <>{san}</>;
  return (
    <>
      {san.split(/([KQRBN])/).map((x, i) =>
        i % 2 === 1 ? (
          <span key={i} className="fig">
            {figurineChar(x, color)}
          </span>
        ) : (
          x
        ),
      )}
    </>
  );
}

export function BoardOptions() {
  const s = useBoardSettings();
  const set = (patch: Partial<BoardSettings>) => setBoardSettings({ ...s, ...patch });
  return (
    <div className="opts">
      <label className="opt">
        <span>棋子</span>
        <select value={s.pieces} onChange={(e) => set({ pieces: e.target.value })}>
          {PIECE_SETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="opt">
        <span>棋盘</span>
        <select value={s.board} onChange={(e) => set({ board: e.target.value })}>
          {BOARDS.map((b) => (
            <option key={b.file} value={b.file}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="opt">
        <span>声音</span>
        <select
          value={s.sound}
          onChange={(e) => {
            set({ sound: e.target.value });
            // 换了就响一下听听
            playMoveSound(false);
          }}
        >
          {SOUNDS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <label className="opt">
        <span>坐标</span>
        <select value={s.coords} onChange={(e) => set({ coords: e.target.value as BoardSettings["coords"] })}>
          <option value="inside">棋盘里</option>
          <option value="off">不显示</option>
        </select>
      </label>
      <label className="opt">
        <span>记谱</span>
        <select value={s.figurine ? "figurine" : "letter"} onChange={(e) => set({ figurine: e.target.value === "figurine" })}>
          <option value="letter">字母（Nf3）</option>
          <option value="figurine">棋子图（♞f3）</option>
        </select>
      </label>
      <label className="opt">
        <span>棋子动画</span>
        <select value={s.animation} onChange={(e) => set({ animation: Number(e.target.value) })}>
          {ANIMATIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <Toggle label="高亮上一步" on={s.lastMove} onChange={(v) => set({ lastMove: v })} />
      <Toggle label="播放声音" on={s.soundOn} onChange={(v) => set({ soundOn: v })} />
      <Toggle label="显示能走到哪" on={s.dests} onChange={(v) => set({ dests: v })} />
    </div>
  );
}

export function Toggle(props: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="opt">
      <span>{props.label}</span>
      <button className={`switch${props.on ? " on" : ""}`} onClick={() => props.onChange(!props.on)} role="switch" aria-checked={props.on}>
        <span />
      </button>
    </label>
  );
}

/** 下棋时棋盘旁边齿轮打开的设置 (只有棋盘这一页) */
export function BoardSettingsDialog(props: { onClose: () => void }) {
  return (
    <div className="dialog-back" onClick={props.onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="head">
          <h2>设置</h2>
          <button className="icon" onClick={props.onClose}>
            ×
          </button>
        </div>
        <BoardOptions />
      </div>
    </div>
  );
}

export function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}
