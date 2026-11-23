// 棋盘: 用 Lichess 的 chessground 画, 样子照 En Croissant。
import { useEffect, useRef } from "react";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Key } from "@lichess-org/chessground/types";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Color } from "./game";

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

  useEffect(() => {
    api.current = Chessground(el.current!, {
      animation: { enabled: true, duration: 200 },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: false },
      draggable: { enabled: true, showGhost: true },
      coordinates: true,
      movable: {
        free: false,
        showDests: true,
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

  return (
    <div className={`board${props.className ? " " + props.className : ""}`}>
      <div ref={el} className="cg-host" />
      {props.children}
    </div>
  );
}
