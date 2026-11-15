import assert from "node:assert/strict";
import test from "node:test";
import { initialGame, isInCheck, legalMoves, playMove, puzzleGame, usi } from "../lib/shogi";
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
