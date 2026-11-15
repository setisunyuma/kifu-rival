import { LESSONS, lessonsForSkills, skillsForMissedMates } from "./lessons";
import type { Lesson, LessonAttempt } from "./lessons";
import { fromSfen, initialGame, legalMoves, playMove, usi } from "./shogi";
import type { DeclarationRule, Game, MissedMate } from "./shogi";

/**
 * KIF-032 P3: one continuous path from a real game to learning.
 *   record → replay → missed position → matching lesson → transfer problem → saved attempts.
 * Pure functions only: the app state and storage stay in the UI, and attempts are the
 * existing LessonAttempt records (first answer, hint use, first sight).
 */

export type ReplayableRecord = { id: string; moves: string[]; startSfen?: string; declarationRule?: DeclarationRule };
export type Replay = { positions: Game[]; error?: { ply: number; move: string } };

/** positions[0] is the start; positions[i] is the position after i moves. Stops at the first unreadable move. */
export function replayRecord(record: ReplayableRecord): Replay {
  let game = record.startSfen ? { ...fromSfen(record.startSfen), declarationRule: record.declarationRule ?? "jsa" } : initialGame(record.declarationRule);
  const positions: Game[] = [game];
  for (const [ply, notation] of record.moves.entries()) {
    const move = game.result === "playing" ? legalMoves(game).find(m => usi(m) === notation) : undefined;
    if (!move) return { positions, error: { ply, move: notation } };
    game = playMove(game, move);
    positions.push(game);
  }
  return { positions };
}

export type StudyPath = {
  /** Same theme as the missed position, answered on the original lesson position. */
  base: string;
  /** A different position of the same theme, used to check transfer rather than memory. */
  transfer?: string;
  /** Mates the player could have used in the game, for the explanation on the replay board. */
  reason: string;
};

function latest(attempts: readonly LessonAttempt[], lessonId: string): LessonAttempt | undefined {
  return attempts.filter(a => a.lessonId === lessonId).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
}

/**
 * Pick the lesson for a missed mate. A mate kept by a different correct move
 * ("shorter-mate-available") is a learning opportunity, not a weakness: it gets no path.
 */
export function studyPathForMissed(missed: Pick<MissedMate, "plies" | "kind">, attempts: readonly LessonAttempt[] = [], lessons: Lesson[] = LESSONS): StudyPath | undefined {
  const skills = skillsForMissedMates([missed]);
  if (!skills.length) return;
  const ids = lessonsForSkills(skills, lessons);
  const byId = new Map(lessons.map(l => [l.id, l]));
  const bases = ids.map(id => byId.get(id)!).filter(l => l && !l.transfer);
  if (!bases.length) return;
  // Prefer a base whose theme has an unseen transfer position, then one not yet answered correctly.
  const unseenTransfer = (l: Lesson) => lessons.find(t => t.transfer && t.transferGroup && t.transferGroup === l.transferGroup && !attempts.some(a => a.lessonId === t.id));
  const ranked = [...bases].sort((a, b) =>
    Number(!!unseenTransfer(b)) - Number(!!unseenTransfer(a))
    || Number(latest(attempts, a.id)?.correct === true) - Number(latest(attempts, b.id)?.correct === true));
  const base = ranked[0];
  const transfer = unseenTransfer(base) ?? lessons.find(t => t.transfer && t.transferGroup && t.transferGroup === base.transferGroup);
  const reason = missed.plies === 1 ? "1手で詰む局面を見逃しました。同じ考え方の1手詰で確かめます。" : "3手で詰む局面を見逃しました。王手を続けて詰ます3手詰で確かめます。";
  return { base: base.id, transfer: transfer?.id, reason };
}

export type StudyStep = "base" | "transfer" | "done";
export type StudyProgress = {
  step: StudyStep;
  base?: LessonAttempt; transfer?: LessonAttempt;
  /** True only for a correct, unhinted first sight of the transfer position. */
  transferConfirmed: boolean;
};

/**
 * Progress of a study path, counting only attempts made after it started (`since`).
 * `solved` lists lessons answered correctly in this path even after a wrong first answer
 * (only the first answer per visit is recorded as an attempt).
 */
export function studyProgress(path: StudyPath, attempts: readonly LessonAttempt[], since: string, solved: readonly string[] = []): StudyProgress {
  const after = attempts.filter(a => Date.parse(a.at) >= Date.parse(since));
  const base = after.filter(a => a.lessonId === path.base).at(-1);
  const transfer = path.transfer ? after.filter(a => a.lessonId === path.transfer).at(-1) : undefined;
  const baseDone = base?.correct === true || solved.includes(path.base);
  const transferDone = !path.transfer || transfer?.correct === true || solved.includes(path.transfer);
  const step: StudyStep = !baseDone ? "base" : !transferDone ? "transfer" : "done";
  return { step, base, transfer, transferConfirmed: !!transfer && transfer.correct && transfer.hinted === false && transfer.firstSeen === true };
}
