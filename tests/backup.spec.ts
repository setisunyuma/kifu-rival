import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKUP_FORMAT, MAX_BACKUP_BYTES, type SavedState,
  assertBackupCapacity, parseBackup, serializeBackup, validateSavedState,
} from "../lib/backup";
import {
  type Game, type Kind, type Side, declareEntering, fromSfen, initialGame,
  legalMoves, playMove, puzzleGame, toSfen, usi,
} from "../lib/shogi";

const NOW = new Date("2026-11-16T00:00:00.000Z");
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function play(game: Game, notation: string): Game {
  const move = legalMoves(game).find(move => usi(move) === notation);
  assert.ok(move, `test fixture move must be legal: ${notation}`);
  return playMove(game, move);
}

function opening(rule: "jsa" | "amateur27" = "jsa"): Game {
  return ["7g7f", "3c3d", "2g2f"].reduce(play, initialGame(rule));
}

function state(game: Game = opening()): SavedState {
  return {
    game,
    level: 3,
    declarationRule: "amateur27",
    completed: ["first-pawn", "future-lesson"],
    lessonAttempts: [
      { lessonId: "first-pawn", correct: true, at: "2026-11-15T13:00:00Z" },
      { lessonId: "future-lesson", correct: false, at: "2026-11-15T14:00:00Z", hinted: true, firstSeen: false },
    ],
    records: [{ id: "synthetic-1", date: "2026-11-15T12:00:00Z", result: "white", moves: ["7g7f", "3c3d"] }],
    messages: [{ role: "me", text: "この一局を振り返ろう。" }, { role: "rival", text: "棋譜から確認しよう。" }],
    cloudSyncPaused: true,
    seenLessons: ["first-pawn", "future-lesson"],
    pendingHints: ["another-lesson"],
  };
}

test("backup: versioned round-trip preserves all saved fields, optional evidence and independent rules", () => {
  const original = state();
  const before = copy(original);
  const output = serializeBackup(original, NOW);
  const envelope = JSON.parse(output);
  assert.equal(envelope.format, BACKUP_FORMAT);
  assert.equal(envelope.version, 1);
  assert.equal(envelope.exportedAt, NOW.toISOString());
  const restored = parseBackup(output);
  assert.equal(restored.source, "backup-v1");
  assert.deepEqual(restored.warnings, []);
  assert.deepEqual(restored.state, original);
  assert.deepEqual(original, before, "export and validation do not mutate the source");
  assert.equal(serializeBackup(original, NOW), output, "an explicit date makes export deterministic");
  restored.state.game.board[6][0] = null;
  restored.state.records[0].moves.push("2g2f");
  assert.deepEqual(original, before, "import returns detached objects and arrays");
});

test("backup: legacy raw data migrates missing additions without inventing first-seen evidence", () => {
  const old = copy(state()) as Partial<SavedState>;
  delete old.declarationRule;
  delete old.lessonAttempts;
  delete old.cloudSyncPaused;
  delete old.seenLessons;
  delete old.pendingHints;
  delete old.game!.positionLog;
  delete old.game!.declarationRule;
  const restored = parseBackup(JSON.stringify(old));
  assert.equal(restored.source, "legacy");
  assert.equal(restored.state.declarationRule, "jsa");
  assert.deepEqual(restored.state.lessonAttempts, []);
  assert.equal(restored.state.game.positionLog, undefined);
  assert.equal(restored.state.game.declarationRule, undefined);
  assert.equal(restored.state.cloudSyncPaused, undefined);
  assert.deepEqual(restored.state.records, old.records);
  assert.ok(restored.warnings.length);
  const unchangedAttempt = validateSavedState(state()).lessonAttempts[0];
  assert.equal(unchangedAttempt.firstSeen, undefined);
  assert.equal(unchangedAttempt.hinted, undefined);
});

test("backup: a legacy position-log suffix is preserved and validated against the matching history", () => {
  let game = play(initialGame(), "7g7f");
  game = play(game, "3c3d");
  delete game.positionLog; // An old save loaded before this field existed.
  game = play(game, "2g2f");
  game = play(game, "8c8d");
  assert.equal(game.positionLog!.length, 3);
  assert.equal(game.history.length, 4);
  const restored = parseBackup(serializeBackup(state(game), NOW));
  assert.deepEqual(restored.state.game, game);
});

test("backup: valid arbitrary snapshots and their full recorded continuations survive", () => {
  const start = fromSfen("k8/9/9/9/9/9/4P4/9/8K b - 1");
  assert.notEqual(toSfen(start), toSfen(initialGame()));
  assert.deepEqual(parseBackup(serializeBackup(state(start), NOW)).state.game, start);
  const continued = play(play(start, "5g5f"), "9a8a");
  assert.deepEqual(parseBackup(serializeBackup(state(continued), NOW)).state.game, continued);
});

test("backup: resignation is preserved even though replay still has legal moves", () => {
  const game = { ...opening(), result: "white" as const };
  assert.deepEqual(parseBackup(serializeBackup(state(game), NOW)).state.game, game);
});

test("backup: a finished game from an arbitrary start preserves its replay origin and rule", () => {
  const start = fromSfen("k8/9/9/9/9/9/4P4/9/8K b - 1");
  const finished = { ...play(play(start, "5g5f"), "9a8a"), result: "white" as const };
  const original = state(finished);
  original.records = [{
    id: "synthetic-custom-start", date: NOW.toISOString(), result: "white",
    moves: finished.history.map(usi), startSfen: toSfen(start), declarationRule: "amateur27",
  }];
  assert.deepEqual(parseBackup(serializeBackup(original, NOW)).state, original);

  const missingOrigin = copy(original);
  delete missingOrigin.records[0].startSfen;
  assert.throws(() => validateSavedState(missingOrigin), /棋譜が合法手ではありません/);

  const impossibleOrigin = copy(original);
  impossibleOrigin.records[0].startSfen = "9/9/9/9/9/9/4P4/9/8K b -";
  assert.throws(() => validateSavedState(impossibleOrigin), /局面条件/);

  const conflict = copy(original);
  conflict.records.push({ ...copy(conflict.records[0]), startSfen: toSfen(initialGame()) });
  assert.throws(() => validateSavedState(conflict), /同じIDに内容の異なる対局/);
});

test("backup: a terminal arbitrary snapshot cannot claim that play may continue", () => {
  const game = fromSfen("4k4/3GRG3/4G4/9/9/9/9/9/K8 w - 1");
  assert.equal(legalMoves(game).length, 0);
  assert.throws(() => validateSavedState(state(game)), /終局結果/);
  game.result = "black";
  assert.deepEqual(validateSavedState(state(game)).game, game);
});

test("backup: arbitrary entering-king declarations are checked against their actual position", () => {
  const entered = puzzleGame([
    { r: 1, c: 4, kind: "OU", owner: "black" },
    { r: 0, c: 0, kind: "HI", owner: "black" }, { r: 0, c: 8, kind: "KA", owner: "black" },
    { r: 0, c: 3, kind: "KI", owner: "black" }, { r: 0, c: 5, kind: "KI", owner: "black" },
    { r: 1, c: 3, kind: "GI", owner: "black" }, { r: 1, c: 5, kind: "GI", owner: "black" },
    ...[0, 1, 2, 6, 7, 8].map(c => ({ r: 2, c, kind: "FU" as Kind, owner: "black" as Side })),
    { r: 8, c: 4, kind: "OU", owner: "white" },
  ], { black: { KA: 1, FU: 3 } });
  const game = declareEntering(entered).game;
  assert.equal(game.result, "draw");
  assert.equal(game.declaration!.points, 28);
  assert.deepEqual(parseBackup(serializeBackup(state(game), NOW)).state.game, game);
  const forged = state(copy(game));
  forged.game.declaration!.points++;
  assert.throws(() => validateSavedState(forged), /入玉宣言/);
  const wrongResult = state(copy(game));
  wrongResult.game.result = "black";
  assert.throws(() => validateSavedState(wrongResult), /入玉宣言と勝敗/);
});

test("backup: board, hands, turn, final move and position history must agree with the moves", () => {
  const altered = state();
  altered.game.board[5][0] = altered.game.board[6][0];
  altered.game.board[6][0] = null;
  assert.throws(() => validateSavedState(altered), /棋譜を再生した局面/);

  const handChanged = state();
  handChanged.game.hands.black.FU++;
  assert.throws(() => validateSavedState(handChanged), /局面条件/);

  const turnChanged = state();
  turnChanged.game.turn = "black";
  assert.throws(() => validateSavedState(turnChanged), /棋譜を再生した局面/);

  const lastChanged = state();
  lastChanged.game.lastMove = lastChanged.game.history[0];
  assert.throws(() => validateSavedState(lastChanged), /最後の一手/);

  const logChanged = state();
  logChanged.game.positionLog![1].check = true;
  assert.throws(() => validateSavedState(logChanged), /局面履歴/);
});

test("backup: malformed moves and impossible positions fail before replay", () => {
  const invalidCoordinate = state();
  invalidCoordinate.game.history[0].to.r = 9;
  assert.throws(() => validateSavedState(invalidCoordinate), /整数/);

  const mixedMove = state();
  mixedMove.game.history[0].drop = "FU";
  assert.throws(() => validateSavedState(mixedMove), /どちらか一方/);

  const invalidShape = state();
  invalidShape.game.board.pop();
  assert.throws(() => validateSavedState(invalidShape), /9行9列/);

  const missingKing = state();
  missingKing.game.board[8][4] = null;
  assert.throws(() => validateSavedState(missingKing), /局面条件/);

  const negativeHand = state();
  negativeHand.game.hands.white.FU = -1;
  assert.throws(() => validateSavedState(negativeHand), /整数/);
});

test("backup: archived games are legally replayed and terminal moves cannot be followed by more moves", () => {
  const cycle = ["5i6h", "5a6b", "6h5i", "6b5a"];
  const moves = [...cycle, ...cycle, ...cycle];
  const ended = moves.reduce(play, initialGame());
  assert.equal(ended.result, "draw");
  const valid = state(ended);
  valid.records = [{ id: "synthetic-draw", date: NOW.toISOString(), result: "draw", moves }];
  assert.deepEqual(parseBackup(serializeBackup(valid, NOW)).state, valid);

  const extra = copy(valid);
  extra.records[0].moves.push(cycle[0]);
  assert.throws(() => validateSavedState(extra), /終局した後の余分な指し手/);

  const illegal = state();
  illegal.records[0].moves = ["7g7e"];
  assert.throws(() => validateSavedState(illegal), /合法手/);

  const wrongResult = copy(valid);
  wrongResult.records[0].result = "black";
  assert.throws(() => validateSavedState(wrongResult), /終局結果と勝敗/);

  const extraCurrent = copy(valid);
  const moveAfterEnd = legalMoves(initialGame()).find(move => usi(move) === cycle[0])!;
  extraCurrent.game = playMove(ended, moveAfterEnd); // Deliberately bypass the engine caller's check.
  assert.throws(() => validateSavedState(extraCurrent), /終局した後の余分な指し手/);
});

test("backup: identical duplicate IDs are coalesced with notice; conflicting IDs never overwrite", () => {
  const duplicate = state();
  duplicate.records.push(copy(duplicate.records[0]));
  const parsed = parseBackup(JSON.stringify(duplicate));
  assert.equal(parsed.state.records.length, 1);
  assert.ok(parsed.warnings.some(warning => /重複/.test(warning)));
  assert.equal(duplicate.records.length, 2, "input stays intact");

  const conflict = copy(duplicate);
  conflict.records[1].result = "black";
  const before = copy(conflict);
  assert.throws(() => validateSavedState(conflict), /同じIDに内容の異なる対局/);
  assert.deepEqual(conflict, before);
});

test("backup: unknown fields and future versions are rejected instead of silently discarded", () => {
  const envelope = JSON.parse(serializeBackup(state(), NOW));
  envelope.version = 2;
  assert.throws(() => parseBackup(JSON.stringify(envelope)), /読めないバックアップ/);
  envelope.version = 1;
  envelope.data.newProgress = { value: 5 };
  assert.throws(() => parseBackup(JSON.stringify(envelope)), /未対応の項目/);

  const nested = copy(state()) as SavedState & { game: Game & { futureField?: string } };
  nested.game.futureField = "preserve me";
  assert.throws(() => validateSavedState(nested), /未対応の項目/);
  assert.throws(() => parseBackup('{"__proto__":{"x":1}}'), /未対応の項目/);
  assert.throws(() => parseBackup(JSON.stringify({ ...state(), cloudSyncPaused: "yes" })), /真偽値/);
});

test("backup: type guards validate dates, message roles and optional learning evidence", () => {
  assert.throws(() => validateSavedState({ ...state(), level: 1.5 }), /整数/);
  const wrongDate = state();
  wrongDate.lessonAttempts[0].at = "2026-02-30T00:00:00Z";
  assert.throws(() => validateSavedState(wrongDate), /存在しない日付/);
  assert.throws(() => validateSavedState({ ...state(), messages: [{ role: "system", text: "x" }] }), /選択肢/);
  assert.throws(() => validateSavedState({ ...state(), lessonAttempts: [{ lessonId: "x", correct: true, at: NOW.toISOString(), hinted: "yes" }] }), /真偽値/);
  assert.throws(() => validateSavedState({ ...state(), lessonAttempts: [{ lessonId: "x", correct: "true", at: NOW.toISOString() }] }), /真偽値/);
});

test("backup: incomplete JSON, incomplete versioned files and oversized files cannot replace data", () => {
  assert.throws(() => parseBackup('{"game":'), /JSONを読み込めません/);
  const incomplete = JSON.parse(serializeBackup(state(), NOW));
  delete incomplete.data.records;
  assert.throws(() => parseBackup(JSON.stringify(incomplete)), /必要な項目が足りません/);
  assert.throws(() => parseBackup(" ".repeat(MAX_BACKUP_BYTES + 1)), /5 MiB/);
  assert.throws(() => parseBackup("あ".repeat(Math.ceil(MAX_BACKUP_BYTES / 3))), /5 MiB/, "UTF-8 bytes, not just JS character count");
  assert.throws(() => serializeBackup(state(), new Date("invalid")), /日時/);
});

test("backup: BOM-prefixed JSON imports without changing message content", () => {
  const input = state();
  input.messages[0].text = " // この空白と文字を保存する /* そのまま */ ";
  assert.deepEqual(parseBackup("\uFEFF" + serializeBackup(input, NOW)).state, input);
});

test("backup: capacity guards every collection at the same import limits without dropping entries", () => {
  const cases: { key: keyof Pick<SavedState, "records" | "lessonAttempts" | "messages" | "completed" | "seenLessons" | "pendingHints">; limit: number; entry: (i: number) => unknown }[] = [
    { key: "records", limit: 1_000, entry: i => ({ id: `synthetic-${i}`, date: NOW.toISOString(), result: "white", moves: [] }) },
    { key: "lessonAttempts", limit: 20_000, entry: i => ({ lessonId: `synthetic-${i}`, at: NOW.toISOString(), correct: true }) },
    { key: "messages", limit: 2_000, entry: () => ({ role: "me", text: "対局を振り返ろう。" }) },
    ...(["completed", "seenLessons", "pendingHints"] as const).map(key => ({ key, limit: 20_000, entry: (i: number) => `synthetic-${i}` })),
  ];
  for (const { key, limit, entry } of cases) {
    const input = { ...state(initialGame()), [key]: Array.from({ length: limit }, (_, i) => entry(i)) } as SavedState;
    assert.doesNotThrow(() => assertBackupCapacity(input), `${key} exactly at limit`);
    const before = JSON.stringify(input);
    const over = { ...input, [key]: [...input[key]!, entry(limit)] } as SavedState;
    assert.throws(() => assertBackupCapacity(over), /件数が上限/, `${key} one over limit`);
    assert.equal(JSON.stringify(input), before, "the last accepted state remains intact");
  }
});

test("backup: 2,000 messages remain exportable and the next chat exchange cannot pass capacity", () => {
  const input = state(initialGame());
  input.messages = Array.from({ length: 2_000 }, () => ({ role: "me" as const, text: "記録" }));
  assertBackupCapacity(input);
  assert.deepEqual(parseBackup(serializeBackup(input, NOW)).state, input);
  const proposed = { ...input, messages: [...input.messages, { role: "rival" as const, text: "次の返信" }] };
  assert.throws(() => assertBackupCapacity(proposed), /会話.*2000/);
  assert.equal(input.messages.length, 2_000);
});

test("backup: capacity counts current and archived moves without legally replaying them", () => {
  const input = state(initialGame());
  // These repetitions are intentionally not a legal game: this API must only
  // count them. Full import/export validation is tested separately above.
  input.records = Array.from({ length: 50 }, (_, i) => ({
    id: `synthetic-budget-${i}`, date: NOW.toISOString(), result: "white",
    moves: Array.from({ length: 2_000 }, () => "7g7f"),
  }));
  assert.doesNotThrow(() => assertBackupCapacity(input)); // 100,000 total moves.
  const oneMove = legalMoves(initialGame())[0];
  const overTotal = { ...input, game: { ...input.game, history: [oneMove] } };
  assert.throws(() => assertBackupCapacity(overTotal), /手数の合計/);
  const overRecord = { ...input, records: [{ ...input.records[0], moves: [...input.records[0].moves, "3c3d"] }] };
  assert.throws(() => assertBackupCapacity(overRecord), /moves.*2000/);
  const current = { ...input, records: [], game: { ...input.game, history: Array.from({ length: 2_000 }, () => oneMove) } };
  assert.doesNotThrow(() => assertBackupCapacity(current));
  assert.throws(() => assertBackupCapacity({ ...current, game: { ...current.game, history: [...current.game.history, oneMove] } }), /history.*2000/);
});

test("backup: capacity and compact export agree at the UTF-8 byte boundary including the envelope", () => {
  const input = state(initialGame());
  input.messages = Array.from({ length: 100 }, () => ({ role: "me" as const, text: "" }));
  const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
  let remaining = MAX_BACKUP_BYTES - byteLength(serializeBackup(input, NOW));
  for (const message of input.messages) {
    const characters = Math.min(20_000, Math.floor(remaining / 3));
    message.text = "あ".repeat(characters);
    remaining -= characters * 3;
  }
  assert.ok(remaining < 3, "the fixture has enough text capacity");
  input.messages.at(-1)!.text += "x".repeat(remaining);

  assert.doesNotThrow(() => assertBackupCapacity(input));
  const output = serializeBackup(input, NOW);
  assert.equal(byteLength(output), MAX_BACKUP_BYTES);
  assert.deepEqual(parseBackup(output).state, input, "exact-limit exports can be restored");
  assert.equal(output, JSON.stringify(JSON.parse(output)), "export uses the same compact representation as the guard");

  const below = copy(input);
  below.messages[0].text = "aa" + below.messages[0].text.slice(1); // One UTF-8 byte less.
  assert.doesNotThrow(() => assertBackupCapacity(below));
  const above = copy(input);
  above.messages.at(-1)!.text += "a";
  assert.throws(() => assertBackupCapacity(above), /5 MiB/);
  assert.throws(() => serializeBackup(above, NOW), /5 MiB/);
  assert.equal(byteLength(output), MAX_BACKUP_BYTES, "rejected proposals do not alter the accepted export");
});
