import assert from "node:assert/strict";
import test from "node:test";
import { applyMove, fromSfen, Game, initialGame, isInCheck, Kind, legalMoves, playMove, puzzleGame, Side, toSfen, usi } from "../lib/shogi";
import { LESSONS } from "../lib/lessons";

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
