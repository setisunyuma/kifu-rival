import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptsLessonMove, createLessonAttempt, dailyPlan, LessonAttempt, lessonStates,
  LESSONS, lessonsForSkills, masteredSkills, practisedSkills,
} from "../lib/lessons";
import { applyMove, isInCheck, legalMoves, mateMoves, moveName, usi, validatePosition } from "../lib/shogi";

const DAY = 24 * 60 * 60 * 1000;
const date = (day: number) => new Date(Date.UTC(2026, 10, 16) + day * DAY).toISOString();
const answer = (lessonId: string, day: number, overrides: Partial<LessonAttempt> = {}): LessonAttempt => ({
  lessonId, at: date(day), correct: true, hinted: false, firstSeen: true, ...overrides,
});
const c1 = ["rook-mate-transfer-center", "rook-mate-transfer-edge"];
const c2 = ["double-rook-mate-3-transfer", "double-gold-mate-3-transfer"];
const byId = (id: string) => {
  const lesson = LESSONS.find(l => l.id === id);
  assert.ok(lesson, id);
  return lesson;
};
const foundations = (): LessonAttempt[] => [
  "first-pawn", "rook-pawn", "gold-step", "capture-pawn", "rook-check", "rook-mate",
].flatMap(id => [0, 1].map(day => ({ lessonId: id, correct: true, at: date(day) })));

test("new first-move lessons are original, legal, exact-length mates with every first-move solution listed", () => {
  const added = LESSONS.filter(l => l.transfer || l.verify === "mate-in-3");
  assert.equal(added.length, 6);
  for (const lesson of added) {
    assert.equal(lesson.source.kind, "original");
    assert.equal(lesson.review.status, "draft", `${lesson.id}: machine checks are not a human review`);
    assert.ok(!lesson.review.reviewedBy && !lesson.review.reviewedOn);
    const game = lesson.setup();
    assert.deepEqual(validatePosition(game), [], lesson.id);
    const plies = lesson.verify === "mate-in-3" ? 3 : 1;
    if (plies === 3) assert.deepEqual(mateMoves(game, 1), [], `${lesson.id}: must require three moves`);
    assert.deepEqual(mateMoves(game, plies).sort(), [lesson.answer, ...(lesson.alsoMates ?? [])].sort(), lesson.id);
    assert.ok(lesson.variations?.length, `${lesson.id}: no explanation line`);
    for (const line of lesson.variations!) {
      assert.equal(line.moves.length, plies);
      assert.ok(acceptsLessonMove(lesson, line.moves[0]));
      let position = game;
      for (let i = 0; i < line.moves.length; i++) {
        const move = legalMoves(position).find(m => usi(m) === line.moves[i]);
        assert.ok(move, `${lesson.id}: illegal explanation move ${line.moves[i]}`);
        assert.ok(line.explanation.normalize("NFKC").includes(moveName(position, move).normalize("NFKC")),
          `${lesson.id}: the Japanese explanation must name its verified moves`);
        position = applyMove(position, move);
        if (i % 2 === 0) assert.ok(isInCheck(position, position.turn), `${lesson.id}: every attacking move checks`);
      }
      assert.equal(legalMoves(position).length, 0, `${lesson.id}: explanation does not end in mate`);
    }
    // The short lesson explains every defender reply to every accepted first move.
    for (const first of [lesson.answer, ...(lesson.alsoMates ?? [])]) {
      const move = legalMoves(game).find(m => usi(m) === first)!;
      const replies = legalMoves(applyMove(game, move)).map(usi).sort();
      const explained = lesson.variations!.filter(v => v.moves[0] === first).map(v => v.moves[1]).filter(Boolean).sort();
      assert.deepEqual(explained, replies, `${lesson.id}: an accepted first move has an unexplained reply`);
    }
  }
});

test("first-move scoring accepts legal alternative solutions and rejects an unrelated move", () => {
  const lesson = byId("double-gold-mate-3");
  assert.equal(acceptsLessonMove(lesson, "G*5b"), true);
  assert.equal(acceptsLessonMove(lesson, "G*3b"), true);
  assert.equal(acceptsLessonMove(lesson, "G*4b"), false);
  assert.equal(acceptsLessonMove(byId("first-pawn"), "7g7f"), true);
  assert.equal(acceptsLessonMove(byId("first-pawn"), "2g2f"), false, "an instructed move remains a specific task");
});

test("attempt creation records hint use and never calls a previously answered position unseen", () => {
  assert.deepEqual(createLessonAttempt(c1[0], true, date(0), [], true), answer(c1[0], 0, { hinted: true }));
  assert.equal(createLessonAttempt(c1[0], true, date(1), [answer(c1[0], 0)]).firstSeen, false);
  assert.equal(createLessonAttempt(c1[0], true, date(1), [], false, [c1[0]]).firstSeen, false,
    "the persistent seen-ID list survives attempt-window truncation");
  assert.equal(createLessonAttempt(c1[1], true, date(1), [answer(c1[0], 0)], false, [c1[0]]).firstSeen, true);
});

test("transfer mastery requires distinct first answers, no hints, and a full day of separation", () => {
  assert.deepEqual([...masteredSkills([answer(c1[0], 0), answer(c1[1], 1)])], ["C1"]);
  assert.deepEqual([...masteredSkills([answer(c2[0], 0), answer(c2[1], 1)])], ["C2"]);
  const insufficient: LessonAttempt[][] = [
    [answer(c1[0], 0), answer(c1[1], 1 - 1 / DAY)],
    [answer(c1[0], 0), answer(c1[0], 1)],
    [answer(c1[0], 0), answer(c1[1], 1, { hinted: true })],
    [answer(c1[0], 0), answer(c1[1], 1, { firstSeen: false })],
    [answer(c1[0], 0), answer(c1[1], 1, { correct: false })],
    [answer(c1[0], 0), { lessonId: c1[1], at: date(1), correct: true }],
    [answer(c1[0], 0, { correct: false }), answer(c1[0], 1), answer(c1[1], 2)],
    [answer("rook-mate", 0), answer("rook-mate", 1)],
  ];
  for (const attempts of insufficient) assert.equal(masteredSkills(attempts).size, 0, JSON.stringify(attempts));
});

test("legacy practice still works, assisted answers do not advance it, and unknown records are preserved", () => {
  const legacy = foundations();
  assert.ok(practisedSkills(lessonStates(legacy)).has("C1"));
  assert.equal(masteredSkills(legacy).size, 0, "practice is not proof of transfer");
  const assisted = [answer("first-pawn", 0), answer("first-pawn", 1, { firstSeen: false, hinted: true })];
  assert.equal(lessonStates(assisted).get("first-pawn")!.box, 1);
  assert.equal(lessonStates([answer("first-pawn", 0, { hinted: true })]).get("first-pawn")!.box, 0);
  const records = [...legacy, answer("future-lesson-id", 2), { lessonId: "first-pawn", at: "old-invalid-date", correct: true }];
  const before = structuredClone(records);
  assert.doesNotThrow(() => dailyPlan(records, new Date(date(3))));
  assert.deepEqual(records, before, "calculation must not filter or rewrite the persisted history");
});

test("the daily plan spaces unseen transfer tasks and keeps a practice path to later lessons", () => {
  const attempts = foundations();
  const first = dailyPlan(attempts, new Date(date(2)));
  assert.equal(first.filter(p => byId(p.lessonId).transfer).length, 1, "only one unseen transfer task per plan");
  assert.ok(first.some(p => byId(p.lessonId).verify === "mate-in-3"), "practice readiness can open C2 before transfer mastery");
  const attempted = [...attempts, answer(c1[0], 2, { correct: false })];
  const sameDay = dailyPlan(attempted, new Date(date(2.5)));
  assert.ok(!sameDay.some(p => p.lessonId === c1[1]), "do not spend another unseen transfer position on the same day");
  const nextDay = dailyPlan(attempted, new Date(date(3)));
  assert.ok(nextDay.some(p => p.lessonId === c1[1]), "another transfer position becomes available after a day");
  assert.ok(sameDay.some(p => byId(p.lessonId).verify === "mate-in-3"), "an initial transfer mistake is not a permanent lock");
});

test("game recommendations use actual C2 lessons when ready and fall back to foundations when needed", () => {
  const c2Lessons = lessonsForSkills(["C2"]);
  assert.equal(c2Lessons.length, 4);
  assert.ok(c2Lessons.every(id => byId(id).verify === "mate-in-3"));
  const ready = dailyPlan(foundations(), new Date(date(2)), LESSONS, ["C2"]);
  assert.ok(ready.some(p => p.reason === "game" && byId(p.lessonId).skills.includes("C2")));
  const beginner = dailyPlan([], new Date(date(0)), LESSONS, ["C2"]);
  assert.ok(beginner.some(p => p.reason === "game" && p.lessonId === "first-pawn"));
  assert.ok(!beginner.some(p => byId(p.lessonId).skills.includes("C2")));
  assert.equal(new Set(beginner.map(p => p.lessonId)).size, beginner.length);
});
