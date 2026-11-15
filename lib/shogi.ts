export type Side = "black" | "white";
export type Kind = "FU" | "KY" | "KE" | "GI" | "KI" | "KA" | "HI" | "OU";
export type HandKind = Exclude<Kind, "OU">;
export type Square = { r: number; c: number };
export type Piece = { owner: Side; kind: Kind; promoted: boolean };
export type Move = { from?: Square; to: Square; drop?: HandKind; promote?: boolean };
export type Hand = Record<HandKind, number>;

/** One position reached during a game, used for sennichite (fourfold repetition). */
export type PositionRecord = { key: string; check: boolean };

export type Game = {
  board: (Piece | null)[][];
  hands: Record<Side, Hand>;
  turn: Side;
  history: Move[];
  lastMove?: Move;
  result: "playing" | "black" | "white" | "draw";
  /**
   * Positions reached by playMove, oldest first, starting with the position the
   * game was started (or loaded) from. Optional so games saved before this field
   * existed still load; for those, counting starts from the loaded position.
   */
  positionLog?: PositionRecord[];
  /**
   * Entering-king declaration rule, fixed when the game starts so it cannot change
   * mid-game. Optional for games saved before it existed; those use "jsa".
   */
  declarationRule?: DeclarationRule;
  /** Set when the game ended by an entering-king declaration. */
  declaration?: DeclarationCheck;
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

export function initialGame(declarationRule: DeclarationRule = "jsa"): Game {
  const board = blankBoard();
  const rank: Kind[] = ["KY", "KE", "GI", "KI", "OU", "KI", "GI", "KE", "KY"];
  rank.forEach((piece, col) => { put(board, 0, col, piece, "white"); put(board, 8, col, piece, "black"); });
  for (let c = 0; c < 9; c++) { put(board, 2, c, "FU", "white"); put(board, 6, c, "FU", "black"); }
  put(board, 1, 1, "HI", "white"); put(board, 1, 7, "KA", "white");
  put(board, 7, 1, "KA", "black"); put(board, 7, 7, "HI", "black");
  return { board, hands: { black: blankHand(), white: blankHand() }, turn: "black", history: [], result: "playing", declarationRule };
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
  return { board, hands, turn: opponent(side), history: [...game.history, move], lastMove: move, result: "playing", ...(game.declarationRule ? { declarationRule: game.declarationRule } : {}) };
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

const SFEN_LETTERS: Record<Kind, string> = { FU: "P", KY: "L", KE: "N", GI: "S", KI: "G", KA: "B", HI: "R", OU: "K" };

/**
 * SFEN position string (board, side to move, hands). Black/sente is uppercase.
 * Pass moveNumber to append the move-count field; omit it to get a repetition key.
 */
export function toSfen(game: Game, moveNumber?: number): string {
  const ranks = game.board.map(row => {
    let out = "", empty = 0;
    for (const p of row) {
      if (!p) { empty++; continue; }
      if (empty) { out += empty; empty = 0; }
      const letter = SFEN_LETTERS[p.kind];
      out += (p.promoted ? "+" : "") + (p.owner === "black" ? letter : letter.toLowerCase());
    }
    return empty ? out + empty : out;
  });
  let hands = "";
  for (const side of ["black", "white"] as Side[]) for (const kind of HAND_ORDER) {
    const n = game.hands[side][kind];
    if (!n) continue;
    const letter = side === "black" ? SFEN_LETTERS[kind] : SFEN_LETTERS[kind].toLowerCase();
    hands += (n > 1 ? n : "") + letter;
  }
  const sfen = `${ranks.join("/")} ${game.turn === "black" ? "b" : "w"} ${hands || "-"}`;
  return moveNumber === undefined ? sfen : `${sfen} ${moveNumber}`;
}

const SFEN_KINDS: Record<string, Kind> = { P: "FU", L: "KY", N: "KE", S: "GI", G: "KI", B: "KA", R: "HI", K: "OU" };

/**
 * Parse an SFEN position (the move-count field is optional and ignored). Throws on
 * malformed input. This checks syntax only; it does not reject positions that are
 * syntactically valid but impossible in a real game (e.g. a pawn on the last rank).
 */
export function fromSfen(sfen: string): Game {
  const [boardPart, sidePart, handPart = "-"] = sfen.trim().split(/\s+/);
  const ranks = boardPart?.split("/") ?? [];
  if (ranks.length !== 9 || (sidePart !== "b" && sidePart !== "w")) throw new Error(`Invalid SFEN: ${sfen}`);
  const board = blankBoard();
  ranks.forEach((rank, r) => {
    let c = 0;
    for (let i = 0; i < rank.length; i++) {
      const ch = rank[i];
      if (/[1-9]/.test(ch)) { c += Number(ch); continue; }
      const promoted = ch === "+";
      const letter = promoted ? rank[++i] : ch;
      const kind = letter && SFEN_KINDS[letter.toUpperCase()];
      if (!kind || c > 8 || (promoted && !promotable(kind))) throw new Error(`Invalid SFEN rank ${r + 1}: ${rank}`);
      board[r][c++] = { kind, owner: letter === letter.toUpperCase() ? "black" : "white", promoted };
    }
    if (c !== 9) throw new Error(`Invalid SFEN rank ${r + 1}: ${rank}`);
  });
  const hands = { black: blankHand(), white: blankHand() };
  if (handPart !== "-") {
    for (const [, count, letter] of handPart.matchAll(/(\d*)([A-Za-z])/g)) {
      const kind = SFEN_KINDS[letter.toUpperCase()];
      if (!kind || kind === "OU") throw new Error(`Invalid SFEN hand: ${handPart}`);
      hands[letter === letter.toUpperCase() ? "black" : "white"][kind as HandKind] += count ? Number(count) : 1;
    }
    if (handPart.replace(/(\d*)([A-Za-z])/g, "") !== "") throw new Error(`Invalid SFEN hand: ${handPart}`);
  }
  return { board, hands, turn: sidePart === "b" ? "black" : "white", history: [], result: "playing" };
}

const PIECE_LIMITS: Record<Kind, number> = { FU: 18, KY: 4, KE: 4, GI: 4, KI: 4, KA: 2, HI: 2, OU: 2 };

/**
 * Problems that make a position impossible in a real game (JSA 対局規則 第10条:
 * 二歩, 行き所のない駒, leaving one's king in check), plus piece-count and king
 * sanity. An empty list means the position may be handed to search or an engine.
 * Missing pieces are allowed (handicap games, composed problems), but each side needs
 * exactly one king: USI engines require both, so a tsume problem without the
 * attacker's king must be adapted before it is analysed.
 */
export function validatePosition(game: Game): string[] {
  const problems: string[] = [];
  const counts: Record<Kind, number> = { FU: 0, KY: 0, KE: 0, GI: 0, KI: 0, KA: 0, HI: 0, OU: 0 };
  const kings: Record<Side, number> = { black: 0, white: 0 };
  const name = (side: Side) => (side === "black" ? "先手" : "後手");
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const p = game.board[r][c];
    if (!p) continue;
    counts[p.kind]++;
    if (p.kind === "OU") kings[p.owner]++;
    if (p.promoted && !promotable(p.kind)) problems.push(`${9 - c}${"abcdefghi"[r]}: ${p.kind} cannot be promoted`);
    if (!p.promoted && mustPromote(p.kind, p.owner, r)) problems.push(`${9 - c}${"abcdefghi"[r]}: ${name(p.owner)}の${PIECE_NAMES[p.kind]}に行き所がない`);
  }
  for (const side of ["black", "white"] as Side[]) {
    for (const kind of HAND_ORDER) counts[kind] += game.hands[side][kind];
    if (kings[side] !== 1) problems.push(`${name(side)}の玉が${kings[side]}枚`);
    for (let c = 0; c < 9; c++) {
      const pawns = game.board.filter(row => row[c]?.owner === side && row[c]?.kind === "FU" && !row[c]?.promoted).length;
      if (pawns > 1) problems.push(`${9 - c}筋: ${name(side)}の二歩`);
    }
  }
  for (const kind of Object.keys(PIECE_LIMITS) as Kind[]) {
    if (counts[kind] > PIECE_LIMITS[kind]) problems.push(`${PIECE_NAMES[kind]}が${counts[kind]}枚（上限${PIECE_LIMITS[kind]}）`);
  }
  if (kings.black === 1 && kings.white === 1 && isInCheck(game, opponent(game.turn))) {
    problems.push(`手番でない${name(opponent(game.turn))}に王手がかかっている`);
  }
  return problems;
}

function positionRecord(game: Game): PositionRecord {
  return { key: toSfen(game), check: isInCheck(game, game.turn) };
}

/**
 * Sennichite: the same position (board, hands, side to move) occurring for the
 * fourth time ends the game. It is a draw, unless one side gave check with every
 * one of its moves since the first occurrence (連続王手の千日手); that side loses.
 */
function repetitionResult(log: PositionRecord[]): Game["result"] {
  const current = log[log.length - 1];
  const first = log.findIndex(entry => entry.key === current.key);
  if (log.filter(entry => entry.key === current.key).length < 4) return "playing";
  const cycle = log.slice(first + 1);
  // A position with white to move was reached by a black move, and vice versa.
  const checkedEveryTime = (mover: Side) => {
    const reached = cycle.filter(entry => entry.key.split(" ")[1] === (mover === "black" ? "w" : "b"));
    return reached.length > 0 && reached.every(entry => entry.check);
  };
  const blackPerpetual = checkedEveryTime("black"), whitePerpetual = checkedEveryTime("white");
  if (blackPerpetual && !whitePerpetual) return "white";
  if (whitePerpetual && !blackPerpetual) return "black";
  return "draw";
}

/**
 * JSA 対局規則 第2章第9条第6項 (2024-06-07, rev. 2025-10-01): at 500 moves the game is
 * jishogi (no result, replayed). If the side to move is in check at that point, it
 * becomes jishogi once the run of checks is broken. The app records it as a draw.
 */
export const JISHOGI_MOVE_LIMIT = 500;

export function playMove(game: Game, move: Move): Game {
  const next = applyMove(game, move);
  next.positionLog = [...(game.positionLog ?? [positionRecord(game)]), positionRecord(next)];
  if (legalMoves(next, next.turn).length === 0) next.result = game.turn;
  else next.result = repetitionResult(next.positionLog);
  if (next.result === "playing" && next.history.length >= JISHOGI_MOVE_LIMIT && !isInCheck(next, next.turn)) next.result = "draw";
  return next;
}

/**
 * Entering-king (入玉) declaration rules.
 * - "jsa": JSA 対局規則 第9条第5項 (current official rule): win with 31+ points,
 *   no result (replay; recorded as a draw) with 24-30 points.
 * - "amateur27": the declaration method described in the JSA FAQ for amateur
 *   tournaments (and used by CSA computer shogi): sente needs 28+, gote 27+.
 * In both, failing any condition makes the declarer LOSE.
 */
export type DeclarationRule = "jsa" | "amateur27";

export type DeclarationCheck = {
  rule: DeclarationRule;
  side: Side;
  /** It is the declarer's turn (declaring replaces making a move). */
  onTurn: boolean;
  kingInCamp: boolean;
  /** Declarer's pieces, king excluded, within the enemy's three ranks. Needs 10+. */
  piecesInCamp: number;
  notInCheck: boolean;
  /** Major pieces (rook/bishop, promoted or not) 5, others 1; hand + pieces in camp only. */
  points: number;
  outcome: "win" | "draw" | "lose";
};

const piecePoints = (kind: HandKind | Kind) => (kind === "HI" || kind === "KA" ? 5 : 1);

/** 第9条第4項の一: every piece the side owns, on board and in hand, king excluded. */
export function materialPoints(game: Game, side: Side): number {
  let points = 0;
  for (const row of game.board) for (const p of row) if (p && p.owner === side && p.kind !== "OU") points += piecePoints(p.kind);
  for (const kind of HAND_ORDER) points += game.hands[side][kind] * piecePoints(kind);
  return points;
}

export function checkDeclaration(game: Game, side: Side = game.turn, rule: DeclarationRule = declarationRuleOf(game)): DeclarationCheck {
  let kingInCamp = false, piecesInCamp = 0, points = 0;
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const p = game.board[r][c];
    if (!p || p.owner !== side || !inZone(side, r)) continue;
    if (p.kind === "OU") { kingInCamp = true; continue; }
    piecesInCamp++;
    points += piecePoints(p.kind);
  }
  for (const kind of HAND_ORDER) points += game.hands[side][kind] * piecePoints(kind);
  const onTurn = game.turn === side && game.result === "playing";
  const notInCheck = !isInCheck(game, side);
  const conditions = onTurn && kingInCamp && piecesInCamp >= 10 && notInCheck;
  let outcome: DeclarationCheck["outcome"] = "lose";
  if (conditions && rule === "jsa") outcome = points >= 31 ? "win" : points >= 24 ? "draw" : "lose";
  if (conditions && rule === "amateur27") outcome = points >= (side === "black" ? 28 : 27) ? "win" : "lose";
  return { rule, side, onTurn, kingInCamp, piecesInCamp, notInCheck, points, outcome };
}

export function declarationRuleOf(game: Game): DeclarationRule { return game.declarationRule ?? "jsa"; }

/** The rival declares only when the declaration wins under the game's fixed rule (ADR-011). */
export function shouldDeclare(game: Game): boolean {
  return game.result === "playing" && checkDeclaration(game, game.turn).outcome === "win";
}

export const DECLARATION_RULE_LABELS: Record<DeclarationRule, string> = {
  jsa: "連盟規則（31点で勝ち・24〜30点は引き分け）",
  amateur27: "27点法（先手28点・後手27点で勝ち）",
};

/** One line per condition, so the player can see exactly why a declaration succeeds or fails. */
export function explainDeclaration(check: DeclarationCheck): { ok: boolean; text: string }[] {
  const need = check.rule === "jsa" ? "31点以上で勝ち、24〜30点で引き分け" : `${check.side === "black" ? 28 : 27}点以上で勝ち`;
  return [
    { ok: check.onTurn, text: check.onTurn ? "自分の手番である" : "自分の手番でない（宣言は手番で行う）" },
    { ok: check.kingInCamp, text: check.kingInCamp ? "玉が敵陣（相手側の3段）に入っている" : "玉が敵陣（相手側の3段）に入っていない" },
    { ok: check.piecesInCamp >= 10, text: `敵陣にある自分の駒（玉を除く）: ${check.piecesInCamp}枚（10枚以上が必要）` },
    { ok: check.notInCheck, text: check.notInCheck ? "王手がかかっていない" : "王手がかかっている（王手中は宣言できない）" },
    { ok: check.outcome !== "lose", text: `点数（持ち駒＋敵陣の駒。飛・角5点、他1点）: ${check.points}点（${need}）` },
  ];
}

/**
 * Declare entering-king for the side to move.
 * - "match": the result follows the rule; a declaration that fails any condition loses.
 * - "practice": the game continues unchanged and the caller shows `reasons` as feedback.
 */
export function declareEntering(game: Game, mode: "match" | "practice" = "match"): { game: Game; check: DeclarationCheck; reasons: { ok: boolean; text: string }[] } {
  const check = checkDeclaration(game, game.turn);
  const reasons = explainDeclaration(check);
  if (mode === "practice" || game.result !== "playing") return { game, check, reasons };
  const result: Game["result"] = check.outcome === "win" ? game.turn : check.outcome === "draw" ? "draw" : opponent(game.turn);
  return { game: { ...game, result, declaration: check }, check, reasons };
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

// ---------------------------------------------------------------------------
// Tsume (mating problem) solver for lesson verification (KIF-031, quality layer L2).
// Tsume conventions: the attacker (side to move) must give check on every move,
// the defender plays any legal move, uchifuzume is illegal (legalMoves already
// excludes it). Exhaustive search: intended for short problems (1/3/5 plies).
// ---------------------------------------------------------------------------

/** True if the side to move can force mate within `plies` (odd) giving check every move. */
export function forcesMate(game: Game, plies: number): boolean {
  if (plies < 1 || game.result !== "playing") return false;
  for (const move of legalMoves(game)) {
    const next = applyMove(game, move);
    if (!isInCheck(next, next.turn)) continue;
    const replies = legalMoves(next);
    if (replies.length === 0) return true;
    if (plies >= 3 && replies.every(reply => forcesMate(applyMove(next, reply), plies - 2))) return true;
  }
  return false;
}

/**
 * Every first move (USI) that forces mate within `plies` plies under tsume rules.
 * More than one entry means the problem has alternative solutions (別解) at move 1.
 */
export function mateMoves(game: Game, plies: number): string[] {
  if (plies < 1 || game.result !== "playing") return [];
  const out: string[] = [];
  for (const move of legalMoves(game)) {
    const next = applyMove(game, move);
    if (!isInCheck(next, next.turn)) continue; // tsume: every attacking move is a check
    const replies = legalMoves(next);
    if (replies.length === 0) { out.push(usi(move)); continue; }
    if (plies < 3) continue;
    if (replies.every(reply => forcesMate(applyMove(next, reply), plies - 2))) out.push(usi(move));
  }
  return out;
}

/**
 * Tsume convention: the defender holds every piece not on the board and not in the
 * attacker's hand (玉方持駒は残り全部). Returns a copy with the defender's hand filled.
 */
export function withRemainingPiecesToDefender(game: Game): Game {
  const defender = opponent(game.turn);
  const used: Record<HandKind, number> = { FU: 0, KY: 0, KE: 0, GI: 0, KI: 0, KA: 0, HI: 0 };
  for (const row of game.board) for (const p of row) if (p && p.kind !== "OU") used[p.kind as HandKind]++;
  for (const kind of HAND_ORDER) used[kind] += game.hands[game.turn][kind];
  const hand = { ...game.hands[defender] };
  for (const kind of HAND_ORDER) hand[kind] = Math.max(0, PIECE_LIMITS[kind] - used[kind]);
  return { ...game, hands: { ...game.hands, [defender]: hand } };
}

// ---------------------------------------------------------------------------
// Game review: mates the player could have played but did not (KIF-032 P2).
// ---------------------------------------------------------------------------

export type MissedMate = {
  /** 0-based index into the move list of the position where the mate was available. */
  ply: number;
  /** Shortest forced mate length found (tsume rules): 1 or 3 plies. */
  plies: 1 | 3;
  played: string;
  solutions: string[];
  /** Japanese notation of the solutions in that position, e.g. "▲１二香打". */
  solutionNames: string[];
};

/**
 * Replay a recorded game (USI moves) and list positions where `side` had a forced mate
 * within 1 or 3 plies (every attacking move a check) but played something else.
 * Stops quietly at the first illegal or unknown move (corrupt or foreign record).
 * Cost: about 2 ms per position for mate-in-1 and 20 ms on average for mate-in-3.
 */
export function findMissedMates(moves: string[], side: Side = "black", maxPlies: 1 | 3 = 3, start: Game = initialGame()): MissedMate[] {
  const out: MissedMate[] = [];
  let game = start;
  for (let ply = 0; ply < moves.length && game.result === "playing"; ply++) {
    const legal = legalMoves(game);
    const move = legal.find(m => usi(m) === moves[ply]);
    if (!move) break;
    if (game.turn === side) {
      const in1 = mateMoves(game, 1);
      const names = (list: string[]) => list.map(u => moveName(game, legal.find(m => usi(m) === u)!));
      if (in1.length) { if (!in1.includes(moves[ply])) out.push({ ply, plies: 1, played: moves[ply], solutions: in1, solutionNames: names(in1) }); }
      else if (maxPlies >= 3) {
        const in3 = mateMoves(game, 3);
        if (in3.length && !in3.includes(moves[ply])) out.push({ ply, plies: 3, played: moves[ply], solutions: in3, solutionNames: names(in3) });
      }
    }
    game = playMove(game, move);
  }
  return out;
}
