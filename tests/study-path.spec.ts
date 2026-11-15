import test from "node:test";
import assert from "node:assert/strict";
import { replayRecord, studyPathForMissed, studyProgress } from "../lib/study-path";
import { LESSONS } from "../lib/lessons";
import type { LessonAttempt } from "../lib/lessons";
import { reviewGame, toSfen } from "../lib/shogi";

const at = (d: number) => new Date(Date.UTC(2026, 10, 16, 0, 0, d)).toISOString();

test("study path: replay returns every position and stops at the first unreadable move", () => {
  const ok = replayRecord({ id: "a", moves: ["7g7f", "3c3d", "8h2b+"] });
  assert.equal(ok.positions.length, 4);
  assert.equal(ok.error, undefined);
  const bad = replayRecord({ id: "b", moves: ["7g7f", "7g7f"] });
  assert.equal(bad.positions.length, 2);
  assert.deepEqual(bad.error, { ply: 1, move: "7g7f" });
  const custom = replayRecord({ id: "c", moves: ["G*5b"], startSfen: "4k4/9/4P4/9/9/9/9/9/4K4 b G 1" });
  assert.equal(custom.positions[1].result, "black");
  assert.equal(toSfen(custom.positions[0]), "4k4/9/4P4/9/9/9/9/9/4K4 b G");
});

test("study path: a lost 1-ply mate leads to the guarded-rook lesson and an unseen transfer", () => {
  const path = studyPathForMissed({ plies: 1, kind: "mate-not-continued" })!;
  assert.equal(path.base, "rook-mate");
  assert.equal(LESSONS.find(l => l.id === path.transfer)?.transfer, true);
  assert.equal(LESSONS.find(l => l.id === path.transfer)?.transferGroup, "guarded-rook");
  // A transfer already seen is skipped in favour of an unseen one.
  const seen: LessonAttempt[] = [{ lessonId: path.transfer!, correct: true, at: at(1), hinted: false, firstSeen: true }];
  assert.notEqual(studyPathForMissed({ plies: 1, kind: "mate-not-continued" }, seen)!.transfer, path.transfer);
});

test("study path: a lost 3-ply mate leads to a 3-ply lesson; a shorter-mate opportunity gets no path", () => {
  const path = studyPathForMissed({ plies: 3, kind: "mate-not-continued" })!;
  assert.ok(["double-rook-mate-3", "double-gold-mate-3"].includes(path.base));
  assert.equal(LESSONS.find(l => l.id === path.transfer)?.transferGroup, LESSONS.find(l => l.id === path.base)?.transferGroup);
  assert.equal(studyPathForMissed({ plies: 1, kind: "shorter-mate-available" }), undefined);
});

test("study path: progress moves base → transfer → done, counting only attempts after the start", () => {
  const path = { base: "rook-mate", transfer: "rook-mate-transfer-center", reason: "" };
  const old: LessonAttempt = { lessonId: "rook-mate", correct: true, at: at(0) };
  assert.equal(studyProgress(path, [old], at(1)).step, "base");
  const wrong: LessonAttempt = { lessonId: "rook-mate", correct: false, at: at(2), hinted: false, firstSeen: false };
  assert.equal(studyProgress(path, [old, wrong], at(1)).step, "base");
  // Solved on a later try in the same visit: the first (wrong) answer stays recorded.
  assert.equal(studyProgress(path, [old, wrong], at(1), ["rook-mate"]).step, "transfer");
  const hinted: LessonAttempt = { lessonId: path.transfer, correct: true, at: at(3), hinted: true, firstSeen: true };
  const p1 = studyProgress(path, [old, wrong, hinted], at(1), ["rook-mate"]);
  assert.equal(p1.step, "done");
  assert.equal(p1.transferConfirmed, false);
  const clean: LessonAttempt = { lessonId: path.transfer, correct: true, at: at(3), hinted: false, firstSeen: true };
  assert.equal(studyProgress(path, [old, clean], at(1), ["rook-mate"]).transferConfirmed, true);
});

test("study path: end to end from a real move list with a missed mate", () => {
  // Black has a gold in hand and misses G*5b mate, playing a quiet move instead.
  const start = "4k4/9/4P4/9/9/9/9/9/K8 b G 1";
  const record = { id: "x", moves: ["9i8i", "5a4a"], startSfen: start };
  const review = reviewGame(record.moves, "black", 3, replayRecord(record).positions[0]);
  assert.equal(review.missed.length, 1);
  const m = review.missed[0];
  assert.equal(m.ply, 0);
  assert.ok(m.solutions.includes("G*5b"));
  assert.equal(studyPathForMissed(m)!.base, "rook-mate");
});
