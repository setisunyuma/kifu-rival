"use client";

import type { Game, HandKind, Move, Side, Square } from "../lib/shogi";
import { HAND_ORDER, PIECE_NAMES, PROMOTED_NAMES } from "../lib/shogi";

function ShogiPiece({ name, owner, promoted }: { name: string; owner: Side; promoted: boolean }) {
  return (
    <svg className={`shogi-piece ${owner === "white" ? "piece-opponent" : ""} ${promoted ? "piece-promoted" : ""}`}
      viewBox="0 0 100 110" aria-hidden="true" focusable="false">
      <path className="piece-outline" d="M50 2 L92 19 L86 106 L14 106 L8 19 Z" />
      <path className="piece-inset" d="M50 8 L86 23 L81 101 L19 101 L14 23 Z" />
      <path className="piece-grain" d="M21 94 L25 37 M77 89 L75 39" />
      <text x="50" y="79" textAnchor="middle" className="piece-glyph">{name}</text>
    </svg>
  );
}

function HandDisplay({ game, side, active, selected, onChoose }: {
  game: Game; side: Side; active: boolean; selected?: HandKind | null; onChoose?: (kind: HandKind) => void;
}) {
  const owned = HAND_ORDER.filter(kind => game.hands[side][kind] > 0);
  return (
    <div className={`hand-area ${side === "white" ? "hand-opponent" : ""}`}>
      <span className="hand-label">{side === "black" ? "あなたの持ち駒" : "棋友の持ち駒"}</span>
      <div className="hand-pieces">
        {owned.length ? owned.map(kind => (
          <button
            key={kind} type="button" disabled={!active || !onChoose}
            onClick={() => onChoose?.(kind)}
            className={`hand-piece ${selected === kind ? "hand-piece-selected" : ""}`}
            aria-label={`${PIECE_NAMES[kind]} ${game.hands[side][kind]}枚`}
          >{PIECE_NAMES[kind]}<span className="piece-count">×{game.hands[side][kind]}</span></button>
        )) : <span className="hand-empty">まだありません</span>}
      </div>
    </div>
  );
}

export function ShogiBoard({ game, selected, selectedDrop, legal, onSquare, onHand, disabled = false }: {
  game: Game; selected: Square | null; selectedDrop: HandKind | null; legal: Move[];
  onSquare: (r: number, c: number) => void; onHand: (kind: HandKind) => void; disabled?: boolean;
}) {
  const possible = (r: number, c: number) => legal.some(move => move.to.r === r && move.to.c === c &&
    (selectedDrop ? move.drop === selectedDrop : selected ? move.from?.r === selected.r && move.from?.c === selected.c : false));
  const last = game.lastMove;
  return (
    <div className="board-component">
      <HandDisplay game={game} side="white" active={false} />
      <div className="board-frame">
        <div className="board-top-coords">{"９８７６５４３２１".split("").map(x => <span key={x}>{x}</span>)}</div>
        <div className="board-position">
          <div className="shogi-board" role="grid" aria-label="将棋盤。先手が下側です">
            {game.board.map((row, r) => row.map((piece, c) => {
              const active = selected?.r === r && selected?.c === c;
              const highlighted = last && ((last.to.r === r && last.to.c === c) || (last.from?.r === r && last.from?.c === c));
              return (
                <button
                  key={`${r}-${c}`} role="gridcell" type="button" disabled={disabled} onClick={() => onSquare(r, c)}
                  aria-label={`${9 - c}${"一二三四五六七八九"[r]} ${piece ? `${piece.owner === "black" ? "先手" : "後手"}${piece.promoted ? PROMOTED_NAMES[piece.kind] : PIECE_NAMES[piece.kind]}` : "空きマス"}`}
                  className={`board-square ${active ? "square-selected" : ""} ${possible(r, c) ? "square-possible" : ""} ${highlighted ? "square-last" : ""}`}
                >
                  {piece && <ShogiPiece name={piece.kind === "OU" && piece.owner === "white" ? "王" : piece.promoted ? PROMOTED_NAMES[piece.kind] : PIECE_NAMES[piece.kind]} owner={piece.owner} promoted={piece.promoted} />}
                  {possible(r, c) && !piece && <span className="move-dot" />}
                </button>
              );
            }))}
          </div>
          <div className="board-side-coords">{"一二三四五六七八九".split("").map(x => <span key={x}>{x}</span>)}</div>
        </div>
      </div>
      <HandDisplay game={game} side="black" active={!disabled && game.turn === "black" && game.result === "playing"} selected={selectedDrop} onChoose={onHand} />
    </div>
  );
}

