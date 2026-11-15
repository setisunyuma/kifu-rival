/** Synthetic browser fixtures only. No browser profile, API, or user data is read. */
import assert from "node:assert/strict";
import { parseBackup, serializeBackup, type SavedState } from "../../lib/backup";
import { LESSONS } from "../../lib/lessons";
import { fromSfen, initialGame, legalMoves, playMove, toSfen, usi, type Game } from "../../lib/shogi";

const exportedAt = new Date("2026-11-15T12:00:00.000Z");

function play(game: Game, notation: string): Game {
  const move = legalMoves(game).find(candidate => usi(candidate) === notation);
  assert.ok(move, `Synthetic fixture move must be legal: ${notation}`);
  return playMove(game, move);
}

function normalized(state: SavedState): SavedState {
  return parseBackup(serializeBackup(state, exportedAt)).state;
}

const empty = normalized({
  game: initialGame(), level: 2, declarationRule: "jsa", completed: [],
  lessonAttempts: [], records: [], messages: [{ role: "rival", text: "合成データによるブラウザ受入試験です。" }],
  cloudSyncPaused: true, seenLessons: [], pendingHints: [],
});

const full = normalized({
  ...empty,
  game: play(play(initialGame("amateur27"), "7g7f"), "3c3d"),
  level: 3,
  // The next game's setting can differ from the in-progress game's rule.
  declarationRule: "jsa",
  completed: ["first-pawn", "synthetic-retired-lesson"],
  lessonAttempts: [
    { lessonId: "first-pawn", correct: true, at: "2026-11-12T01:00:00.000Z", hinted: false, firstSeen: true },
    { lessonId: "rook-mate-transfer-center", correct: false, at: "2026-11-13T01:00:00.000Z", hinted: true, firstSeen: true },
    // Unknown IDs and old attempts without the optional evidence fields must survive.
    { lessonId: "synthetic-retired-lesson", correct: true, at: "2026-11-14T01:00:00.000Z" },
  ],
  records: [
    { id: "synthetic-game-2", date: "2026-11-14T03:00:00.000Z", result: "white", moves: ["2g2f", "8c8d"], declarationRule: "amateur27" },
    { id: "synthetic-game-1", date: "2026-11-13T03:00:00.000Z", result: "black", moves: ["7g7f", "3c3d"] },
  ],
  messages: [
    { role: "rival", text: "これは公開可能な合成会話です。" },
    { role: "me", text: "途中の盤面と学習記録も戻せるかな。" },
    { role: "rival", text: "ブラウザ試験で全項目を確かめます。" },
  ],
  cloudSyncPaused: false,
  seenLessons: ["first-pawn", "rook-mate-transfer-center", "synthetic-retired-lesson", "synthetic-older-than-attempt-history"],
  pendingHints: ["double-rook-mate-3", "synthetic-retired-hint"],
});

const reviewStart = toSfen(fromSfen("8k/9/7G1/9/9/9/9/9/K8 b RG 1"));
assert.equal(reviewStart.split(" ").length, 3, "Backups use canonical SFEN without a move number");
const reviewOld = normalized({
  ...empty,
  records: [{
    id: "synthetic-same-id-and-length", date: "2026-11-15T00:00:00.000Z",
    result: "black", moves: ["9i9h"], startSfen: reviewStart, declarationRule: "jsa",
  }],
});
const reviewNew = normalized({
  ...reviewOld,
  records: [{ ...reviewOld.records[0], moves: ["R*1c"] }],
});
assert.equal(reviewOld.records[0].id, reviewNew.records[0].id);
assert.equal(reviewOld.records[0].moves.length, reviewNew.records[0].moves.length);

const gold = LESSONS.find(lesson => lesson.id === "double-gold-mate-3");
assert.ok(gold);
assert.equal(gold.answer, "G*5b");
assert.ok(gold.alsoMates?.includes("G*3b"));

process.stdout.write(JSON.stringify({
  empty, full, reviewOld, reviewNew,
  goldLesson: { id: gold.id, title: gold.title },
  reviewNewBackup: JSON.parse(serializeBackup(reviewNew, exportedAt)),
  emptyBackup: JSON.parse(serializeBackup(empty, exportedAt)),
}, null, 2));
