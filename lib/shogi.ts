export type Side = "black" | "white";
export type Kind = "FU" | "KY" | "KE" | "GI" | "KI" | "KA" | "HI" | "OU";
export type HandKind = Exclude<Kind, "OU">;
export type Square = { r: number; c: number };
export type Piece = { owner: Side; kind: Kind; promoted: boolean };
export type Move = { from?: Square; to: Square; drop?: HandKind; promote?: boolean };
export type Hand = Record<HandKind, number>;

export type Game = {
  board: (Piece | null)[][];
  hands: Record<Side, Hand>;
  turn: Side;
  history: Move[];
  lastMove?: Move;
  result: "playing" | "black" | "white" | "draw";
};

export const PIECE_NAMES: Record<Kind, string> = {
  FU: "歩", KY: "香", KE: "桂", GI: "銀", KI: "金", KA: "角", HI: "飛", OU: "玉",
};

export const PROMOTED_NAMES: Record<Kind, string> = {
  FU: "と", KY: "杏", KE: "圭", GI: "全", KI: "金", KA: "馬", HI: "龍", OU: "玉",
};

export const HAND_ORDER: HandKind[] = ["HI", "KA", "KI", "GI", "KE", "KY", "FU"];
const VALUES: Record<Kind, number> = {
  FU: 100, KY: 280, KE: 320, GI: 460, KI: 540, KA: 780, HI: 920, OU: 25000,
};

export function opponent(side: Side): Side { return side === "black" ? "white" : "black"; }

function blankHand(): Hand { return { FU: 0, KY: 0, KE: 0, GI: 0, KI: 0, KA: 0, HI: 0 }; }
function blankBoard(): (Piece | null)[][] { return Array.from({ length: 9 }, () => Array<Piece | null>(9).fill(null)); }
function put(board: Game["board"], r: number, c: number, kind: Kind, owner: Side) {
  board[r][c] = { kind, owner, promoted: false };
}

export function initialGame(): Game {
  const board = blankBoard();
  const rank: Kind[] = ["KY", "KE", "GI", "KI", "OU", "KI", "GI", "KE", "KY"];
  rank.forEach((piece, col) => { put(board, 0, col, piece, "white"); put(board, 8, col, piece, "black"); });
  for (let c = 0; c < 9; c++) { put(board, 2, c, "FU", "white"); put(board, 6, c, "FU", "black"); }
  put(board, 1, 1, "HI", "white"); put(board, 1, 7, "KA", "white");
  put(board, 7, 1, "KA", "black"); put(board, 7, 7, "HI", "black");
  return { board, hands: { black: blankHand(), white: blankHand() }, turn: "black", history: [], result: "playing" };
}

export function puzzleGame(placements: Array<{ r: number; c: number; kind: Kind; owner: Side }>, hands?: Partial<Record<Side, Partial<Hand>>>): Game {
  const game = initialGame();
  game.board = blankBoard();
  for (const p of placements) put(game.board, p.r, p.c, p.kind, p.owner);
  game.hands = { black: { ...blankHand(), ...hands?.black }, white: { ...blankHand(), ...hands?.white } };
  return game;
}

const inside = (r: number, c: number) => r >= 0 && r < 9 && c >= 0 && c < 9;
const vectors = (kind: Kind, promoted: boolean, f: number) => {
  if (promoted && (kind === "FU" || kind === "KY" || kind === "KE" || kind === "GI")) kind = "KI";
  switch (kind) {
    case "FU": return { step: [[f, 0]], slide: [] };
    case "KY": return { step: [], slide: [[f, 0]] };
    case "KE": return { step: [[2 * f, -1], [2 * f, 1]], slide: [] };
    case "GI": return { step: [[f, -1], [f, 0], [f, 1], [-f, -1], [-f, 1]], slide: [] };
    case "KI": return { step: [[f, -1], [f, 0], [f, 1], [0, -1], [0, 1], [-f, 0]], slide: [] };
    case "OU": return { step: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]], slide: [] };
    case "KA": return { step: promoted ? [[-1, 0], [0, -1], [0, 1], [1, 0]] : [], slide: [[-1, -1], [-1, 1], [1, -1], [1, 1]] };
    case "HI": return { step: promoted ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : [], slide: [[-1, 0], [0, -1], [0, 1], [1, 0]] };
  }
};

function targets(board: Game["board"], from: Square, piece: Piece): Square[] {
  const f = piece.owner === "black" ? -1 : 1;
  const { step, slide } = vectors(piece.kind, piece.promoted, f);
  const out: Square[] = [];
  for (const [dr, dc] of step) {
    const r = from.r + dr, c = from.c + dc;
    if (inside(r, c)) out.push({ r, c });
  }
  for (const [dr, dc] of slide) {
    let r = from.r + dr, c = from.c + dc;
    while (inside(r, c)) {
      out.push({ r, c });
      if (board[r][c]) break;
      r += dr; c += dc;
    }
  }
  return out;
}

export function isInCheck(game: Game, side: Side): boolean {
  let king: Square | undefined;
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const p = game.board[r][c];
    if (p?.kind === "OU" && p.owner === side) king = { r, c };
  }
  if (!king) return true;
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const p = game.board[r][c];
    if (p && p.owner !== side && targets(game.board, { r, c }, p).some(s => s.r === king!.r && s.c === king!.c)) return true;
  }
  return false;
}

function promotable(kind: Kind) { return !(["KI", "OU"] as Kind[]).includes(kind); }
function inZone(side: Side, r: number) { return side === "black" ? r <= 2 : r >= 6; }
function mustPromote(kind: Kind, side: Side, r: number) {
  const last = side === "black" ? 0 : 8;
  const secondLast = side === "black" ? 1 : 7;
  return ((kind === "FU" || kind === "KY") && r === last) || (kind === "KE" && (r === last || r === secondLast));
}

function pseudoMoves(game: Game, side: Side): Move[] {
  const moves: Move[] = [];
  const board = game.board;
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const piece = board[r][c];
    if (!piece || piece.owner !== side) continue;
    for (const to of targets(board, { r, c }, piece)) {
      const target = board[to.r][to.c];
      if (target?.owner === side || target?.kind === "OU") continue;
      const from = { r, c };
      if (!piece.promoted && promotable(piece.kind) && (inZone(side, r) || inZone(side, to.r))) {
        moves.push({ from, to, promote: true });
        if (!mustPromote(piece.kind, side, to.r)) moves.push({ from, to });
      } else moves.push({ from, to });
    }
  }
  for (const kind of HAND_ORDER) {
    if (!game.hands[side][kind]) continue;
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      if (board[r][c] || mustPromote(kind, side, r)) continue;
      if (kind === "FU" && board.some(row => row[c]?.owner === side && row[c]?.kind === "FU" && !row[c]?.promoted)) continue;
      moves.push({ to: { r, c }, drop: kind });
    }
  }
  return moves;
}

export function applyMove(game: Game, move: Move): Game {
  const board = game.board.map(row => row.map(p => p ? { ...p } : null));
  const hands = { black: { ...game.hands.black }, white: { ...game.hands.white } };
  const side = game.turn;
  if (move.drop) {
    board[move.to.r][move.to.c] = { owner: side, kind: move.drop, promoted: false };
    hands[side][move.drop] -= 1;
  } else if (move.from) {
    const moving = board[move.from.r][move.from.c];
    if (!moving) throw new Error("The selected square has no piece");
    const captured = board[move.to.r][move.to.c];
    if (captured && captured.kind !== "OU") hands[side][captured.kind as HandKind] += 1;
    board[move.from.r][move.from.c] = null;
    board[move.to.r][move.to.c] = { ...moving, promoted: moving.promoted || !!move.promote };
  }
  return { board, hands, turn: opponent(side), history: [...game.history, move], lastMove: move, result: "playing" };
}

export function legalMoves(game: Game, side: Side = game.turn, skipDropMate = false): Move[] {
  if (game.result !== "playing") return [];
  const sideGame = side === game.turn ? game : { ...game, turn: side };
  const moves: Move[] = [];
  for (const move of pseudoMoves(sideGame, side)) {
    const next = applyMove(sideGame, move);
    if (isInCheck(next, side)) continue;
    if (!skipDropMate && move.drop === "FU" && isInCheck(next, opponent(side)) && legalMoves(next, opponent(side), true).length === 0) continue;
    moves.push(move);
  }
  return moves;
}

export function playMove(game: Game, move: Move): Game {
  const next = applyMove(game, move);
  if (legalMoves(next, next.turn).length === 0) next.result = game.turn;
  return next;
}

export function matchMove(a: Move, b: Move) {
  return a.to.r === b.to.r && a.to.c === b.to.c && a.drop === b.drop && a.from?.r === b.from?.r && a.from?.c === b.from?.c && !!a.promote === !!b.promote;
}

export function usi(move: Move): string {
  const coord = (p: Square) => `${9 - p.c}${"abcdefghi"[p.r]}`;
  const handNotation: Record<HandKind, string> = { FU: "P", KY: "L", KE: "N", GI: "S", KI: "G", KA: "B", HI: "R" };
  return move.drop ? `${handNotation[move.drop]}*${coord(move.to)}` : `${coord(move.from!)}${coord(move.to)}${move.promote ? "+" : ""}`;
}

export function moveName(game: Game, move: Move): string {
  const player = game.turn === "black" ? "▲" : "△";
  const file = "９８７６５４３２１"[move.to.c];
  const rank = "一二三四五六七八九"[move.to.r];
  const piece = move.drop ? { kind: move.drop, promoted: false } : game.board[move.from!.r][move.from!.c]!;
  return `${player}${file}${rank}${piece.promoted ? PROMOTED_NAMES[piece.kind] : PIECE_NAMES[piece.kind]}${move.drop ? "打" : move.promote ? "成" : ""}`;
}

function evaluate(game: Game, perspective: Side): number {
  let score = 0;
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const p = game.board[r][c];
    if (!p) continue;
    const sign = p.owner === perspective ? 1 : -1;
    const advanced = p.owner === "black" ? 8 - r : r;
    const center = 4 - Math.abs(4 - c);
    score += sign * (VALUES[p.kind] + (p.promoted ? (p.kind === "KA" || p.kind === "HI" ? 180 : 220) : 0)
      + (p.kind === "OU" ? -advanced * 6 : advanced * 5 + center * 3));
  }
  for (const side of ["black", "white"] as Side[]) {
    for (const kind of HAND_ORDER) score += (side === perspective ? 1 : -1) * game.hands[side][kind] * (VALUES[kind] + 20);
  }
  return score;
}

// A lightweight, legal-move sparring partner. This is intentionally NOT a grandmaster engine.
export function chooseRivalMove(game: Game, level = 2): Move | undefined {
  const side = game.turn;
  const choices = legalMoves(game);
  if (choices.length === 0) return undefined;
  const scored = choices.map(move => {
    const next = applyMove(game, move);
    const check = isInCheck(next, next.turn) ? 22 : 0;
    return { move, next, score: evaluate(next, side) + check + Math.random() * 16 };
  }).sort((a, b) => b.score - a.score);
  if (level <= 1) return scored[Math.floor(Math.random() * Math.min(10, scored.length))].move;
  const shortlist = scored.slice(0, Math.min(level >= 4 ? 14 : 9, scored.length));
  const deeper = shortlist.map(candidate => {
    const replies = legalMoves(candidate.next);
    if (!replies.length) return { move: candidate.move, score: 100000 };
    let worst = Infinity;
    for (const reply of replies) {
      const after = applyMove(candidate.next, reply);
      worst = Math.min(worst, evaluate(after, side));
    }
    return { move: candidate.move, score: worst * .87 + candidate.score * .13 + Math.random() * Math.max(4, (5 - level) * 18) };
  }).sort((a, b) => b.score - a.score);
  const viable = deeper.slice(0, level >= 4 ? 1 : level === 3 ? 2 : 4);
  return viable[Math.floor(Math.random() * viable.length)].move;
}
