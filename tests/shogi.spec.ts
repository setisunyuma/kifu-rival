import assert from "node:assert/strict";
import test from "node:test";
import { applyMove, opponent, checkDeclaration, declareEntering, explainDeclaration, fromSfen, shouldDeclare, Game, initialGame, JISHOGI_MOVE_LIMIT, materialPoints, validatePosition, isInCheck, Kind, legalMoves, playMove, puzzleGame, Side, toSfen, usi } from "../lib/shogi";
import { LESSONS, SKILLS, SkillId } from "../lib/lessons";

test("starting position has the right number of pieces and legal pawn moves", () => {
  const g = initialGame();
  const pieces = g.board.flat().filter(Boolean);
  assert.equal(pieces.length, 40);
  const options = legalMoves(g).map(usi);
  assert.ok(options.includes("7g7f"));
  assert.ok(options.includes("2g2f"));
  assert.ok(!options.includes("7g7e"));
  assert.equal(g.turn, "black");
});

test("all authored lesson answers are legal moves", () => {
  for (const lesson of LESSONS) {
    const moves = legalMoves(lesson.setup()).map(usi);
    assert.ok(moves.includes(lesson.answer), `${lesson.title}: ${lesson.answer} not legal`);
  }
});

test("the one-move mate lesson actually ends the game", () => {
  const mate = LESSONS.find(l => l.id === "rook-mate")!;
  const g = mate.setup();
  const move = legalMoves(g).find(m => usi(m) === mate.answer)!;
  const next = playMove(g, move);
  assert.equal(next.result, "black");
});

test("a captured piece becomes the capturer's hand piece", () => {
  const capture = LESSONS.find(l => l.id === "capture-pawn")!;
  const g = capture.setup();
  const move = legalMoves(g).find(m => usi(m) === capture.answer)!;
  const next = playMove(g, move);
  assert.equal(next.hands.black.FU, 1);
  assert.equal(next.board[4][4]?.owner, "black");
});

test("nifu prohibits dropping two unpromoted pawns on one file", () => {
  const g = puzzleGame([
    { r: 8, c: 8, kind: "OU", owner: "black" },
    { r: 0, c: 0, kind: "OU", owner: "white" },
    { r: 5, c: 4, kind: "FU", owner: "black" },
  ], { black: { FU: 1 } });
  const options = legalMoves(g).map(usi);
  assert.ok(!options.includes("P*5e"));
  assert.ok(options.includes("P*6e"));
});

test("king cannot move into check", () => {
  const g = puzzleGame([
    { r: 8, c: 4, kind: "OU", owner: "black" },
    { r: 0, c: 4, kind: "OU", owner: "white" },
    { r: 6, c: 5, kind: "HI", owner: "white" },
  ]);
  assert.ok(!isInCheck(g, "black"));
  assert.ok(!legalMoves(g).some(m => usi(m) === "5i4i"));
});

// ---------------------------------------------------------------------------
// KIF-010 rule regression tests. Coordinates: r=0 is rank "a" (一), c=0 is file 9.
// Every position below is synthetic test data, not a real player's game.
// ---------------------------------------------------------------------------

type Placement = { r: number; c: number; kind: Kind; owner: Side };
const kingsApart: Placement[] = [
  { r: 8, c: 0, kind: "OU", owner: "black" },
  { r: 0, c: 0, kind: "OU", owner: "white" },
];
const legalUsi = (g: Game) => legalMoves(g).map(usi).sort();
const play = (g: Game, notation: string) => {
  const move = legalMoves(g).find(m => usi(m) === notation);
  assert.ok(move, `${notation} should be legal in ${toSfen(g)}`);
  return playMove(g, move!);
};
function perft(g: Game, depth: number): number {
  const moves = legalMoves(g);
  if (depth === 1) return moves.length;
  return moves.reduce((n, m) => n + perft(applyMove(g, m), depth - 1), 0);
}

test("perft from the starting position matches the published counts (30 / 900 / 25470)", () => {
  assert.equal(perft(initialGame(), 1), 30);
  assert.equal(perft(initialGame(), 2), 900);
  assert.equal(perft(initialGame(), 3), 25470);
});

test("SFEN export matches the standard starting position and encodes hands and promotions", () => {
  assert.equal(toSfen(initialGame(), 1), "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1");
  const g = puzzleGame([...kingsApart, { r: 4, c: 4, kind: "FU", owner: "black" }], { black: { HI: 1, FU: 2 }, white: { KA: 1 } });
  g.board[4][4]!.promoted = true;
  assert.equal(toSfen(g), "k8/9/9/9/4+P4/9/9/9/K8 b R2Pb");
});

test("SFEN import round-trips and rejects malformed input", () => {
  const start = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
  assert.deepEqual(fromSfen(start).board, initialGame().board);
  assert.equal(toSfen(fromSfen(start), 1), start);
  const midgame = "ln1g1gsnl/1r1s2k2/p1pppp1pp/6p2/1p7/2P6/PPSPPPPPP/7R1/LN1GKGSNL w Bb2p 12";
  assert.equal(toSfen(fromSfen(midgame), 12), midgame);
  for (const bad of ["", "9/9/9 b -", "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSN b -", "9/9/9/9/9/9/9/9/9 x -", "9/9/9/9/9/9/9/9/+G8 b -", "9/9/9/9/9/9/9/9/9 b 2K"]) {
    assert.throws(() => fromSfen(bad), `${JSON.stringify(bad)} should be rejected`);
  }
});

test("the published maximum-mobility position has exactly 593 legal moves", () => {
  // Widely cited composed position (drops of every piece type plus many promotion choices).
  const g = fromSfen("R8/2K1S1SSk/4B4/9/9/9/9/9/1L1L1L3 b RBGSNLP3g3n17p 1");
  assert.equal(legalMoves(g).length, 593);
});

test("check evasion: only king moves, interpositions and captures of the checker are legal", () => {
  const blockable = puzzleGame([
    { r: 8, c: 4, kind: "OU", owner: "black" },
    { r: 7, c: 5, kind: "KI", owner: "black" },
    { r: 0, c: 4, kind: "HI", owner: "white" },
    { r: 0, c: 0, kind: "OU", owner: "white" },
  ]);
  assert.ok(isInCheck(blockable, "black"));
  assert.deepEqual(legalUsi(blockable), ["4h5g", "4h5h", "5i4i", "5i6h", "5i6i"]);

  const captureOnly = puzzleGame([
    { r: 8, c: 4, kind: "OU", owner: "black" },
    { r: 7, c: 4, kind: "KI", owner: "white" },
    { r: 0, c: 0, kind: "OU", owner: "white" },
  ]);
  assert.deepEqual(legalUsi(captureOnly), ["5i5h"]);
});

test("double check can only be answered by a king move", () => {
  const g = puzzleGame([
    { r: 8, c: 4, kind: "OU", owner: "black" },
    { r: 8, c: 6, kind: "KI", owner: "black" },
    { r: 0, c: 4, kind: "HI", owner: "white" },
    { r: 4, c: 8, kind: "KA", owner: "white" },
    { r: 0, c: 0, kind: "OU", owner: "white" },
  ]);
  assert.deepEqual(legalUsi(g), ["5i4i", "5i6h", "5i6i"]);
});

test("a pinned piece may only move along the pin line", () => {
  const g = puzzleGame([
    { r: 8, c: 4, kind: "OU", owner: "black" },
    { r: 7, c: 4, kind: "GI", owner: "black" },
    { r: 0, c: 4, kind: "HI", owner: "white" },
    { r: 0, c: 0, kind: "OU", owner: "white" },
  ]);
  assert.deepEqual(legalUsi(g).filter(m => m.startsWith("5h")), ["5h5g"]);
});

test("promotion is optional in the zone, forced where the piece could never move again, and never offered to gold or promoted pieces", () => {
  const g = puzzleGame([
    ...kingsApart,
    { r: 3, c: 7, kind: "FU", owner: "black" },
    { r: 1, c: 5, kind: "FU", owner: "black" },
    { r: 3, c: 3, kind: "KE", owner: "black" },
    { r: 4, c: 1, kind: "KE", owner: "black" },
    { r: 2, c: 4, kind: "GI", owner: "black" },
    { r: 2, c: 6, kind: "KI", owner: "black" },
    { r: 2, c: 8, kind: "FU", owner: "black" },
  ]);
  g.board[2][8]!.promoted = true;
  const moves = legalUsi(g);
  for (const m of ["2d2c+", "2d2c", "4b4a+", "6d7b+", "6d5b+", "8e9c+", "8e9c", "8e7c+", "8e7c", "5c4d+", "5c4d"]) assert.ok(moves.includes(m), `${m} missing`);
  for (const m of ["4b4a", "6d7b", "6d5b"]) assert.ok(!moves.includes(m), `${m} must promote`);
  assert.ok(!moves.some(m => (m.startsWith("3c") || m.startsWith("1c")) && m.endsWith("+")), "gold / tokin cannot promote");

  const white = puzzleGame([...kingsApart, { r: 5, c: 4, kind: "FU", owner: "white" }, { r: 7, c: 8, kind: "FU", owner: "white" }]);
  white.turn = "white";
  const whiteMoves = legalUsi(white);
  assert.ok(whiteMoves.includes("5f5g+") && whiteMoves.includes("5f5g"));
  assert.ok(whiteMoves.includes("1h1i+") && !whiteMoves.includes("1h1i"));
});

test("drops: no pawn/lance on the last rank, no knight on the last two ranks (both sides)", () => {
  const g = puzzleGame(kingsApart, { black: { FU: 1, KY: 1, KE: 1 }, white: { FU: 1, KY: 1, KE: 1 } });
  const black = legalUsi(g);
  assert.ok(!black.some(m => /^[PLN]\*\da$/.test(m) || /^N\*\db$/.test(m)));
  assert.ok(black.includes("P*5b") && black.includes("L*5b") && black.includes("N*5c"));
  g.turn = "white";
  const white = legalUsi(g);
  assert.ok(!white.some(m => /^[PLN]\*\di$/.test(m) || /^N\*\dh$/.test(m)));
  assert.ok(white.includes("P*5h") && white.includes("L*5h") && white.includes("N*5g"));
});

test("nifu ignores a tokin on the same file", () => {
  const g = puzzleGame([...kingsApart, { r: 5, c: 4, kind: "FU", owner: "black" }], { black: { FU: 1 } });
  g.board[5][4]!.promoted = true;
  assert.ok(legalUsi(g).includes("P*5e"));
});

test("capturing a promoted piece puts the unpromoted piece in hand", () => {
  const g = puzzleGame([...kingsApart, { r: 7, c: 4, kind: "HI", owner: "black" }, { r: 4, c: 4, kind: "FU", owner: "white" }]);
  g.board[4][4]!.promoted = true;
  const next = play(g, "5h5e");
  assert.equal(next.hands.black.FU, 1);
  assert.deepEqual(next.board[4][4], { owner: "black", kind: "HI", promoted: false });
});

// White king 1a boxed in by its own lance (2a) and pawn (2b); black gold on 1c guards 1b.
const boxedKing: Placement[] = [
  { r: 0, c: 8, kind: "OU", owner: "white" },
  { r: 0, c: 7, kind: "KY", owner: "white" },
  { r: 1, c: 7, kind: "FU", owner: "white" },
  { r: 2, c: 8, kind: "KI", owner: "black" },
  { r: 8, c: 0, kind: "OU", owner: "black" },
];

test("uchifuzume: a pawn drop that mates is illegal", () => {
  const g = puzzleGame(boxedKing, { black: { FU: 1 } });
  assert.ok(!legalUsi(g).includes("P*1b"));
});

test("uchifuzume does not forbid a pawn drop check with an escape, a pushed-pawn mate, or a mating drop of another piece", () => {
  const escape = puzzleGame(boxedKing.filter(p => p.kind !== "KY"), { black: { FU: 1 } });
  assert.ok(legalUsi(escape).includes("P*1b"));

  const lance = puzzleGame(boxedKing, { black: { KY: 1 } });
  assert.equal(play(lance, "L*1b").result, "black");

  const pushed = puzzleGame([
    ...boxedKing.filter(p => p.kind !== "KI"),
    { r: 2, c: 8, kind: "FU", owner: "black" },
    { r: 2, c: 7, kind: "KI", owner: "black" },
  ]);
  assert.equal(play(pushed, "1c1b").result, "black");
});

test("sennichite: the fourth occurrence of a position is a draw", () => {
  let g = puzzleGame([{ r: 8, c: 0, kind: "OU", owner: "black" }, { r: 0, c: 8, kind: "OU", owner: "white" }]);
  const cycle = ["9i9h", "1a1b", "9h9i", "1b1a"];
  for (let ply = 0; ply < 12; ply++) {
    assert.equal(g.result, "playing", `ended early at ply ${ply}`);
    g = play(g, cycle[ply % 4]);
  }
  assert.equal(g.result, "draw");
  assert.equal(legalMoves(g).length, 0);
});

test("perpetual check sennichite: the side giving every check loses", () => {
  let g = puzzleGame([
    { r: 8, c: 0, kind: "OU", owner: "black" },
    { r: 5, c: 7, kind: "HI", owner: "black" },
    { r: 0, c: 8, kind: "OU", owner: "white" },
  ]);
  const cycle = ["2f1f", "1a2a", "1f2f", "2a1a"];
  for (let ply = 0; ply < 12; ply++) {
    assert.equal(g.result, "playing", `ended early at ply ${ply}`);
    g = play(g, cycle[ply % 4]);
    if (ply % 2 === 0) assert.ok(isInCheck(g, "white"), `ply ${ply} should be check`);
  }
  assert.equal(g.result, "white");
});

test("games saved before positionLog existed keep working and count repetitions from the loaded position", () => {
  const legacy = puzzleGame([{ r: 8, c: 0, kind: "OU", owner: "black" }, { r: 0, c: 8, kind: "OU", owner: "white" }]);
  delete legacy.positionLog;
  const next = play(legacy, "9i9h");
  assert.equal(next.positionLog?.length, 2);
  assert.equal(next.positionLog?.[0].key, toSfen(legacy));
});

// ---------------------------------------------------------------------------
// KIF-010 jishogi / entering king. Source: JSA 対局規則 第2章第9条
// (制定 2024-06-07, 改定 2025-10-01) and the JSA FAQ amateur declaration method.
// ---------------------------------------------------------------------------

/** Rotate the position 180° and swap colours, so a black test also covers white. */
function mirrored(g: Game): Game {
  const board = g.board.map((_, r) => g.board[8 - r].map((_, c) => {
    const p = g.board[8 - r][8 - c];
    return p ? { ...p, owner: p.owner === "black" ? "white" as const : "black" as const } : null;
  }));
  return { ...g, board, hands: { black: { ...g.hands.white }, white: { ...g.hands.black } }, turn: g.turn === "black" ? "white" : "black" };
}

// Black king entered on 5b with 12 pieces in camp worth 20 points; hand adds the rest.
const enteredKing: Placement[] = [
  { r: 1, c: 4, kind: "OU", owner: "black" },
  { r: 0, c: 0, kind: "HI", owner: "black" }, { r: 0, c: 8, kind: "KA", owner: "black" },
  { r: 0, c: 3, kind: "KI", owner: "black" }, { r: 0, c: 5, kind: "KI", owner: "black" },
  { r: 1, c: 3, kind: "GI", owner: "black" }, { r: 1, c: 5, kind: "GI", owner: "black" },
  ...[0, 1, 2, 6, 7, 8].map(c => ({ r: 2, c, kind: "FU" as Kind, owner: "black" as Side })),
  { r: 8, c: 4, kind: "OU", owner: "white" },
];

test("material points: rook and bishop 5, every other piece 1, king excluded (27 each at the start)", () => {
  assert.equal(materialPoints(initialGame(), "black"), 27);
  assert.equal(materialPoints(initialGame(), "white"), 27);
  const g = puzzleGame(enteredKing, { black: { HI: 1, KA: 1, FU: 3 } });
  g.board[0][0]!.promoted = true; // a dragon still counts 5
  assert.equal(materialPoints(g, "black"), 33);
});

test("entering-king declaration (JSA rule): 31+ wins, 24-30 is no result, counted from hand and camp only", () => {
  const win = puzzleGame(enteredKing, { black: { KA: 1, HI: 1, FU: 3 } });
  const result = checkDeclaration(win, "black", "jsa");
  assert.deepEqual({ ...result, rule: undefined }, { rule: undefined, side: "black", onTurn: true, kingInCamp: true, piecesInCamp: 12, notInCheck: true, points: 33, outcome: "win" });

  const outsideCamp = puzzleGame([...enteredKing, { r: 4, c: 0, kind: "HI", owner: "black" }], { black: { KA: 1, FU: 3 } });
  assert.equal(checkDeclaration(outsideCamp, "black", "jsa").points, 28, "the rook on 9e is outside the camp and does not count");
  assert.equal(checkDeclaration(outsideCamp, "black", "jsa").outcome, "draw");
});

test("JSA declaration boundaries: 23 loses, 24 and 30 are no result, 31 wins", () => {
  // 20 points in camp; add pawns in hand to reach each boundary.
  const at = (pawns: number) => checkDeclaration(puzzleGame(enteredKing, { black: { FU: pawns } }), "black", "jsa");
  assert.deepEqual([3, 4, 10, 11].map(n => [at(n).points, at(n).outcome]), [[23, "lose"], [24, "draw"], [30, "draw"], [31, "win"]]);
});

test("the same 28-point position is a JSA no-result but an amateur-27 win; 27 points wins only for gote", () => {
  const p28 = puzzleGame(enteredKing, { black: { KA: 1, FU: 3 } });
  assert.equal(checkDeclaration(p28, "black", "jsa").outcome, "draw");
  assert.equal(checkDeclaration(p28, "black", "amateur27").outcome, "win");

  const p27 = puzzleGame(enteredKing, { black: { KA: 1, FU: 2 } });
  assert.equal(checkDeclaration(p27, "black", "amateur27").points, 27);
  assert.equal(checkDeclaration(p27, "black", "amateur27").outcome, "lose", "sente needs 28");
  const gote = checkDeclaration(mirrored(p27), "white", "amateur27");
  assert.equal(gote.points, 27);
  assert.equal(gote.outcome, "win", "gote needs 27");
});

test("a declaration that misses any condition loses, however many points", () => {
  const rich = { black: { HI: 1, KA: 1, KI: 2, GI: 2, FU: 9 } };
  const ninePieces = puzzleGame(enteredKing.map(p => p.r === 2 && p.c <= 2 ? { ...p, r: 3 } : p), rich);
  assert.equal(checkDeclaration(ninePieces, "black").piecesInCamp, 9);
  assert.equal(checkDeclaration(ninePieces, "black").outcome, "lose");

  const kingOutside = puzzleGame(enteredKing.map(p => p.kind === "OU" && p.owner === "black" ? { ...p, r: 3 } : p), rich);
  assert.equal(checkDeclaration(kingOutside, "black").kingInCamp, false);
  assert.equal(checkDeclaration(kingOutside, "black").outcome, "lose");

  const inCheck = puzzleGame([...enteredKing, { r: 0, c: 4, kind: "KI", owner: "white" }], rich);
  assert.equal(checkDeclaration(inCheck, "black").notInCheck, false);
  assert.equal(checkDeclaration(inCheck, "black").outcome, "lose");

  const notOnTurn = puzzleGame(enteredKing, rich);
  notOnTurn.turn = "white";
  assert.equal(checkDeclaration(notOnTurn, "black").outcome, "lose");
  assert.equal(checkDeclaration(puzzleGame(enteredKing, rich), "black").outcome, "win");
});

test("500 moves without a result is jishogi (draw), postponed while a run of checks continues", () => {
  const filler = Array.from({ length: JISHOGI_MOVE_LIMIT - 1 }, () => ({ to: { r: 0, c: 0 } }));
  const quiet = puzzleGame([{ r: 8, c: 0, kind: "OU", owner: "black" }, { r: 0, c: 8, kind: "OU", owner: "white" }]);
  quiet.history = [...filler];
  assert.equal(play(quiet, "9i9h").result, "draw");

  const checking = puzzleGame([
    { r: 8, c: 0, kind: "OU", owner: "black" },
    { r: 5, c: 7, kind: "HI", owner: "black" },
    { r: 0, c: 8, kind: "OU", owner: "white" },
  ]);
  checking.history = [...filler];
  const atLimit = play(checking, "2f1f"); // 500th move gives check
  assert.equal(atLimit.history.length, JISHOGI_MOVE_LIMIT);
  assert.equal(atLimit.result, "playing");
  assert.equal(play(atLimit, "1a2a").result, "draw", "the reply escapes and gives no check");
});

test("validatePosition accepts real positions, including every lesson and the 593-move position", () => {
  assert.deepEqual(validatePosition(initialGame()), []);
  for (const lesson of LESSONS) assert.deepEqual(validatePosition(lesson.setup()), [], lesson.title);
  assert.deepEqual(validatePosition(fromSfen("R8/2K1S1SSk/4B4/9/9/9/9/9/1L1L1L3 b RBGSNLP3g3n17p 1")), []);
  assert.deepEqual(validatePosition(fromSfen("lnsgkgsnl/1r5b1/ppppppppp/9/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL w - 2")), []);
});

test("validatePosition reports nifu, dead pieces, impossible counts, kings and a king left in check", () => {
  const issues = (sfen: string) => validatePosition(fromSfen(sfen));
  assert.match(issues("4k4/9/9/9/4P4/9/4P4/9/4K4 b - 1").join(), /二歩/);
  assert.match(issues("P3k4/9/9/9/9/9/9/9/4K4 b - 1").join(), /歩に行き所がない/);
  assert.match(issues("4k4/N8/9/9/9/9/9/9/4K4 b - 1").join(), /桂に行き所がない/);
  assert.match(issues("4k4/9/9/9/9/9/9/9/l3K4 b - 1").join(), /後手の香に行き所がない/);
  assert.deepEqual(issues("4k4/9/9/9/9/9/9/+P8/4K4 b - 1"), [], "a tokin on the last ranks is fine");
  assert.match(issues("4k4/9/9/9/9/9/9/9/4K4 b 19P 1").join(), /歩が19枚/);
  assert.match(issues("4k4/9/9/9/9/9/9/9/9 b - 1").join(), /先手の玉が0枚/);
  assert.match(issues("4k4/9/9/9/9/9/9/9/3KK4 b - 1").join(), /先手の玉が2枚/);
  assert.match(issues("4k4/9/9/9/9/9/9/9/4R3K b - 1").join(), /手番でない後手に王手/);
  assert.deepEqual(issues("4k4/9/9/9/9/9/9/9/4R3K w - 1"), [], "the side to move may be in check");
});

// ---------------------------------------------------------------------------
// ADR-011: entering-king declaration in play (rule fixed at game start).
// ---------------------------------------------------------------------------

test("the declaration rule is fixed when the game starts and survives every move", () => {
  let g = initialGame("amateur27");
  for (const m of ["7g7f", "3c3d", "2g2f"]) g = play(g, m);
  assert.equal(g.declarationRule, "amateur27");
  assert.equal(initialGame().declarationRule, "jsa", "default is the JSA rule");
  const legacy = initialGame(); delete legacy.declarationRule;
  assert.equal(checkDeclaration(legacy).rule, "jsa", "games saved before the field existed use the JSA rule");
});

test("a match declaration ends the game by the fixed rule; a failed one loses", () => {
  const p28 = (rule: "jsa" | "amateur27") => { const g = puzzleGame(enteredKing, { black: { KA: 1, FU: 3 } }); g.declarationRule = rule; return g; };
  const jsa = declareEntering(p28("jsa"));
  assert.equal(jsa.game.result, "draw");
  assert.equal(jsa.game.declaration?.points, 28);
  assert.equal(legalMoves(jsa.game).length, 0, "the game is over");
  assert.equal(declareEntering(p28("amateur27")).game.result, "black");

  const short = puzzleGame(enteredKing.map(p => p.r === 2 && p.c <= 2 ? { ...p, r: 3 } : p), { black: { HI: 2, KA: 2 } });
  const lost = declareEntering(short);
  assert.equal(lost.game.result, "white", "declaring without 10 pieces in camp loses");
  assert.ok(lost.reasons.some(r => !r.ok && r.text.includes("9枚")));
});

test("practice declarations never end the game and explain every failed condition", () => {
  const g = puzzleGame([...enteredKing, { r: 0, c: 4, kind: "KI", owner: "white" }]);
  const r = declareEntering(g, "practice");
  assert.equal(r.game, g, "game unchanged");
  assert.equal(r.game.result, "playing");
  const failed = r.reasons.filter(x => !x.ok).map(x => x.text);
  assert.ok(failed.some(t => t.includes("王手")), "in check is explained");
  assert.ok(failed.some(t => t.includes("20点")), "points are explained");
  assert.deepEqual(explainDeclaration(checkDeclaration(puzzleGame(enteredKing, { black: { HI: 1, KA: 1, FU: 3 } }))).map(x => x.ok), [true, true, true, true, true]);
});

test("the rival declares only when the declaration wins", () => {
  const win = puzzleGame(enteredKing, { black: { HI: 1, KA: 1, FU: 3 } });
  assert.equal(shouldDeclare(win), true);
  assert.equal(shouldDeclare(puzzleGame(enteredKing, { black: { KA: 1, FU: 3 } })), false, "28 points is only a JSA draw");
  const amateur = puzzleGame(enteredKing, { black: { KA: 1, FU: 3 } }); amateur.declarationRule = "amateur27";
  assert.equal(shouldDeclare(amateur), true);
  assert.equal(shouldDeclare(mirrored(win)), true, "works for gote (the rival's side)");
  assert.equal(shouldDeclare(initialGame()), false);
});

// ---------------------------------------------------------------------------
// KIF-031 lesson quality gate (docs/CURRICULUM.md §4, layers L0-L2).
// ---------------------------------------------------------------------------

test("skill map: every prerequisite exists and the graph has no cycles", () => {
  const ids = Object.keys(SKILLS) as SkillId[];
  for (const id of ids) for (const req of SKILLS[id].requires) assert.ok(req in SKILLS, `${id} requires unknown ${req}`);
  const state = new Map<SkillId, "visiting" | "done">();
  const visit = (id: SkillId, path: SkillId[]) => {
    if (state.get(id) === "done") return;
    assert.notEqual(state.get(id), "visiting", `cycle: ${[...path, id].join(" -> ")}`);
    state.set(id, "visiting");
    for (const req of SKILLS[id].requires) visit(req, [...path, id]);
    state.set(id, "done");
  };
  for (const id of ids) visit(id, []);
});

test("L0: every lesson has a unique id, known skills and original provenance", () => {
  assert.equal(new Set(LESSONS.map(l => l.id)).size, LESSONS.length);
  for (const l of LESSONS) {
    assert.ok(l.skills.length > 0, `${l.id}: no skill`);
    for (const s of l.skills) assert.ok(s in SKILLS, `${l.id}: unknown skill ${s}`);
    assert.equal(l.source.kind, "original", `${l.id}: only original problems are allowed`);
    assert.ok(l.source.author && l.source.method, `${l.id}: provenance incomplete`);
  }
});

test("L1/L2: every lesson position is valid and its answer does what the lesson claims", () => {
  for (const l of LESSONS) {
    const g = l.setup();
    assert.deepEqual(validatePosition(g), [], `${l.id}: invalid position`);
    const move = legalMoves(g).find(m => usi(m) === l.answer);
    assert.ok(move, `${l.id}: answer ${l.answer} is not legal`);
    const next = playMove(g, move!);
    if (l.verify === "capture") assert.ok(g.board[move!.to.r][move!.to.c]?.owner === opponent(g.turn), `${l.id}: answer does not capture`);
    if (l.verify === "check") assert.ok(isInCheck(next, next.turn), `${l.id}: answer does not give check`);
    if (l.verify === "mate-in-1") {
      assert.equal(next.result, g.turn, `${l.id}: answer does not mate`);
      const mates = legalMoves(g).filter(m => playMove(g, m).result === g.turn).map(usi).sort();
      assert.deepEqual(mates, [l.answer, ...(l.alsoMates ?? [])].sort(), `${l.id}: unlisted alternative mates`);
    }
  }
});
