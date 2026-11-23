// 棋盘: 用 Lichess 的 chessground 画, 样子照 En Croissant。
import { useEffect, useRef } from "react";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Key } from "@lichess-org/chessground/types";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Color } from "./game";
import { useBoardSettings } from "./boardSettings";

export interface BoardProps {
  fen: string;
  orientation: Color;
  turnColor: Color;
  /** 哪一方能用鼠标走; undefined 是谁都不能走 */
  movableColor?: Color;
  dests: Map<string, string[]>;
  lastMove?: [string, string];
  check: boolean;
  onMove: (from: string, to: string) => void;
  /** 棋盘上画的箭头 */
  shapes?: DrawShape[];
  className?: string;
  children?: React.ReactNode;
}

export function Board(props: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMove = useRef(props.onMove);
  onMove.current = props.onMove;
  const look = useBoardSettings();

  useEffect(() => {
    api.current = Chessground(el.current!, {
      animation: { enabled: look.animation > 0, duration: look.animation },
      highlight: { lastMove: look.lastMove, check: true },
      premovable: { enabled: false },
      draggable: { enabled: true, showGhost: true },
      coordinates: look.coords !== "off",
      movable: {
        free: false,
        showDests: look.dests,
        events: { after: (from, to) => onMove.current(from, to) },
      },
    });
    return () => {
      api.current?.destroy();
      api.current = null;
    };
  }, []);

  useEffect(() => {
    api.current?.set({
      fen: props.fen,
      orientation: props.orientation,
      turnColor: props.turnColor,
      lastMove: props.lastMove as Key[] | undefined,
      check: props.check,
      movable: {
        color: props.movableColor,
        dests: props.movableColor ? (props.dests as Map<Key, Key[]>) : new Map(),
      },
    });
  }, [props.fen, props.orientation, props.turnColor, props.movableColor, props.dests, props.lastMove, props.check]);

  useEffect(() => {
    api.current?.setAutoShapes(props.shapes ?? []);
  }, [props.shapes]);

  // 棋盘设置改了 (动画、高亮上一步、坐标、能走到哪)
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const a = api.current;
    if (!a) return;
    a.set({
      animation: { enabled: look.animation > 0, duration: look.animation },
      highlight: { lastMove: look.lastMove, check: true },
      coordinates: look.coords !== "off",
      movable: { showDests: look.dests },
    });
    a.redrawAll();
  }, [look.animation, look.lastMove, look.coords, look.dests]);

  return (
    <div className={`board${props.className ? " " + props.className : ""}`}>
      <div ref={el} className="cg-host" />
      {props.children}
    </div>
  );
}
