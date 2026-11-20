import type { LessonAttempt } from "./lessons";
import type { RivalGameRecord, RivalMessage } from "./rival-chat";
import {
  type DeclarationCheck, type DeclarationRule, type Game, type Hand,
  type Kind, type Move, type Piece, type PositionRecord, type Square,
  HAND_ORDER, checkDeclaration, fromSfen, initialGame, isInCheck, legalMoves,
  matchMove, opponent, playMove, toSfen, usi, validatePosition,
} from "./shogi";

/** KIF-050: this module only validates/copies data; it never reads or writes storage. */
export const BACKUP_FORMAT = "kiyu-backup";
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const MAX_MOVES = 2_000;
const MAX_TOTAL_MOVES = 100_000;
const MAX_RECORDS = 1_000;
const MAX_ATTEMPTS = 20_000;
const MAX_MESSAGES = 2_000;
// Supported export dates use this fixed-width ISO representation.
const CAPACITY_EXPORTED_AT = "2000-01-01T00:00:00.000Z";
const PIECE_LIMITS: Record<Kind, number> = { FU: 18, KY: 4, KE: 4, GI: 4, KI: 4, KA: 2, HI: 2, OU: 2 };

export type SavedState = {
  game: Game;
  level: number;
  declarationRule: DeclarationRule;
  completed: string[];
  lessonAttempts: LessonAttempt[];
  records: RivalGameRecord[];
  messages: RivalMessage[];
  cloudSyncPaused?: boolean;
  seenLessons?: string[];
  pendingHints?: string[];
};

export type BackupEnvelope = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  data: SavedState;
};

export type ParsedBackup = {
  state: SavedState;
  source: "backup-v1" | "legacy";
  exportedAt?: string;
  warnings: string[];
};

type ObjectData = Record<string, unknown>;
type Context = { warnings: string[]; totalMoves: number };

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function object(value: unknown, path: string, allowed: readonly string[]): ObjectData {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path, "データの形式が正しくありません。");
  const data = value as ObjectData;
  if (Object.keys(data).some(key => !allowed.includes(key))) {
    fail(path, "未対応の項目があります。元のファイルを保管し、対応する版で開いてください。");
  }
  return data;
}

function list(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(path, "一覧の形式が正しくありません。");
  if (value.length > max) fail(path, `件数が上限（${max}件）を超えています。内容は省略していません。`);
  return value;
}

function text(value: unknown, path: string, max: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim())) {
    fail(path, "文字列の形式または長さが正しくありません。");
  }
  return value;
}

function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail(path, `${min}から${max}までの整数が必要です。`);
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "真偽値の形式が正しくありません。");
  return value;
}

function choice<const T extends string>(value: unknown, path: string, choices: readonly T[]): T {
  if (typeof value !== "string" || !choices.includes(value as T)) fail(path, "値が対応する選択肢にありません。");
  return value as T;
}

function date(value: unknown, path: string): string {
  const result = text(value, path, 64);
  if (!/^\d{4}-\d{2}-\d{2}(?:$|T| )/.test(result) || !Number.isFinite(Date.parse(result))) {
    fail(path, "日時の形式が正しくありません。");
  }
  const [year, month, day] = result.slice(0, 10).split("-").map(Number);
  const calendar = new Date(`${result.slice(0, 10)}T00:00:00Z`);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() + 1 !== month || calendar.getUTCDate() !== day) {
    fail(path, "存在しない日付です。");
  }
  return result;
}

function ids(value: unknown, path: string): string[] {
  // Unknown lesson IDs are retained: a later app may supply that lesson again.
  return [...new Set(list(value, path, MAX_ATTEMPTS).map((id, i) => text(id, `${path}[${i + 1}]`, 200)))];
}

function square(value: unknown, path: string): Square {
  const data = object(value, path, ["r", "c"]);
  return { r: integer(data.r, path, 0, 8), c: integer(data.c, path, 0, 8) };
}

function move(value: unknown, path: string): Move {
  const data = object(value, path, ["from", "to", "drop", "promote"]);
  const result: Move = { to: square(data.to, `${path}.to`) };
  if ((data.from === undefined) === (data.drop === undefined)) fail(path, "移動元と持ち駒の指定は、どちらか一方だけ必要です。");
  if (data.from !== undefined) result.from = square(data.from, `${path}.from`);
  if (data.drop !== undefined) result.drop = choice(data.drop, `${path}.drop`, HAND_ORDER);
  if (data.promote !== undefined) result.promote = boolean(data.promote, `${path}.promote`);
  if (result.drop && result.promote) fail(path, "持ち駒を成った状態で打つことはできません。");
  return result;
}

function piece(value: unknown, path: string): Piece | null {
  if (value === null) return null;
  const data = object(value, path, ["owner", "kind", "promoted"]);
  const result: Piece = {
    owner: choice(data.owner, `${path}.owner`, ["black", "white"]),
    kind: choice(data.kind, `${path}.kind`, Object.keys(PIECE_LIMITS) as Kind[]),
    promoted: boolean(data.promoted, `${path}.promoted`),
  };
  if (result.promoted && (result.kind === "KI" || result.kind === "OU")) fail(path, "金と玉は成れません。");
  return result;
}

function hand(value: unknown, path: string): Hand {
  const data = object(value, path, HAND_ORDER);
  return Object.fromEntries(HAND_ORDER.map(kind => [kind, integer(data[kind], `${path}.${kind}`, 0, PIECE_LIMITS[kind])])) as Hand;
}

function validPosition(game: Game, path: string): void {
  if (validatePosition(game).length) fail(path, "駒数・玉・二歩・王手などの局面条件が正しくありません。");
}

function position(value: unknown, path: string): PositionRecord {
  const data = object(value, path, ["key", "check"]);
  const key = text(data.key, `${path}.key`, 200);
  const check = boolean(data.check, `${path}.check`);
  let game: Game;
  try { game = fromSfen(key); } catch { fail(path, "局面履歴の形式が正しくありません。"); }
  validPosition(game, path);
  if (toSfen(game) !== key || isInCheck(game, game.turn) !== check) fail(path, "局面履歴の内容が一致しません。");
  return { key, check };
}

function declaration(value: unknown, path: string): DeclarationCheck {
  const data = object(value, path, ["rule", "side", "onTurn", "kingInCamp", "piecesInCamp", "notInCheck", "points", "outcome"]);
  return {
    rule: choice(data.rule, `${path}.rule`, ["jsa", "amateur27"]),
    side: choice(data.side, `${path}.side`, ["black", "white"]),
    onTurn: boolean(data.onTurn, `${path}.onTurn`),
    kingInCamp: boolean(data.kingInCamp, `${path}.kingInCamp`),
    piecesInCamp: integer(data.piecesInCamp, `${path}.piecesInCamp`, 0, 38),
    notInCheck: boolean(data.notInCheck, `${path}.notInCheck`),
    points: integer(data.points, `${path}.points`, 0, 54),
    outcome: choice(data.outcome, `${path}.outcome`, ["win", "draw", "lose"]),
  };
}

function addMoves(context: Context, count: number): void {
  context.totalMoves += count;
  if (context.totalMoves > MAX_TOTAL_MOVES) fail("棋譜", "手数の合計が検証できる上限を超えています。元のファイルは変更していません。");
}

function validateGame(value: unknown, path: string, context: Context): Game {
  const data = object(value, path, ["board", "hands", "turn", "history", "lastMove", "result", "positionLog", "declarationRule", "declaration"]);
  const rows = list(data.board, `${path}.board`, 9);
  if (rows.length !== 9) fail(path, "盤は9行9列である必要があります。");
  const board = rows.map((row, r) => {
    const cells = list(row, `${path}.board[${r + 1}]`, 9);
    if (cells.length !== 9) fail(path, "盤は9行9列である必要があります。");
    return cells.map((cell, c) => piece(cell, `${path}.board[${r + 1}][${c + 1}]`));
  });
  const hands = object(data.hands, `${path}.hands`, ["black", "white"]);
  const history = list(data.history, `${path}.history`, MAX_MOVES).map((entry, i) => move(entry, `${path}.history[${i + 1}]`));
  addMoves(context, history.length);
  const game: Game = {
    board,
    hands: { black: hand(hands.black, `${path}.hands.black`), white: hand(hands.white, `${path}.hands.white`) },
    turn: choice(data.turn, `${path}.turn`, ["black", "white"]),
    history,
    result: choice(data.result, `${path}.result`, ["playing", "black", "white", "draw"]),
  };
  if (data.declarationRule !== undefined) game.declarationRule = choice(data.declarationRule, `${path}.declarationRule`, ["jsa", "amateur27"]);
  if (data.lastMove !== undefined) {
    game.lastMove = move(data.lastMove, `${path}.lastMove`);
    if (!history.length || !matchMove(game.lastMove, history[history.length - 1])) fail(path, "最後の一手と棋譜が一致しません。");
  }
  if (data.positionLog !== undefined) {
    game.positionLog = list(data.positionLog, `${path}.positionLog`, history.length + 1).map((entry, i) => position(entry, `${path}.positionLog[${i + 1}]`));
    if (!game.positionLog.length) fail(path, "局面履歴が空です。旧形式ではこの項目を省略します。");
  }
  if (data.declaration !== undefined) game.declaration = declaration(data.declaration, `${path}.declaration`);
  validPosition(game, path);

  const rule = game.declarationRule ?? "jsa";
  const log = game.positionLog;
  // A complete log identifies an arbitrary starting position. A legacy suffix
  // starts counting repetitions only where that app started keeping the log.
  const logOffset = log ? history.length + 1 - log.length : history.length;
  let replay = log && logOffset === 0 ? fromSfen(log[0].key)
    : history.length ? initialGame(rule) : { ...game, history: [], result: "playing" as const, declaration: undefined };
  replay = { ...replay, declarationRule: rule, positionLog: undefined };
  const seen: PositionRecord[] = [{ key: toSfen(replay), check: isInCheck(replay, replay.turn) }];
  for (let i = 0; i < history.length; i++) {
    if (replay.result !== "playing") fail(path, `${i + 1}手目は終局した後の余分な指し手です。`);
    const candidate = legalMoves(replay).find(legal => matchMove(legal, history[i]));
    if (!candidate) fail(path, `${i + 1}手目が合法手ではないか、開始局面の記録が足りません。`);
    if (i <= logOffset) replay = { ...replay, positionLog: undefined };
    replay = playMove(replay, history[i]);
    seen.push({ key: toSfen(replay), check: isInCheck(replay, replay.turn) });
  }
  if (toSfen(replay) !== toSfen(game)) fail(path, "棋譜を再生した局面と、保存された盤・持ち駒・手番が一致しません。");
  if (log && log.some((entry, i) => entry.key !== seen[logOffset + i].key || entry.check !== seen[logOffset + i].check)) {
    fail(path, "棋譜と局面履歴が一致しません。");
  }
  const replayResult = !history.length && legalMoves(replay).length === 0 ? opponent(replay.turn) : replay.result;
  if (game.declaration) {
    if (replayResult !== "playing" || game.result === "playing") fail(path, "終局状態と入玉宣言が一致しません。");
    const expected = checkDeclaration({ ...game, result: "playing" }, game.turn, rule);
    if ((Object.keys(expected) as (keyof DeclarationCheck)[]).some(key => expected[key] !== game.declaration![key])) {
      fail(path, "入玉宣言の判定が盤面と一致しません。");
    }
    const outcome = expected.outcome === "win" ? game.turn : expected.outcome === "draw" ? "draw" : opponent(game.turn);
    if (game.result !== outcome) fail(path, "入玉宣言と勝敗が一致しません。");
  } else if (replayResult !== "playing" && game.result !== replayResult) {
    fail(path, "棋譜による終局結果と保存された勝敗が一致しません。");
  }
  // A nonterminal replay may have ended by resignation/agreement; the old format
  // has no reason field, so its explicit result is retained rather than invented.
  return game;
}

function attempts(value: unknown): LessonAttempt[] {
  return list(value, "教材の回答記録", MAX_ATTEMPTS).map((entry, i) => {
    const path = `教材の回答記録[${i + 1}]`;
    const data = object(entry, path, ["lessonId", "correct", "at", "hinted", "firstSeen"]);
    const attempt: LessonAttempt = {
      lessonId: text(data.lessonId, `${path}.lessonId`, 200),
      correct: boolean(data.correct, `${path}.correct`),
      at: date(data.at, `${path}.at`),
    };
    if (data.hinted !== undefined) Object.assign(attempt, { hinted: boolean(data.hinted, `${path}.hinted`) });
    if (data.firstSeen !== undefined) Object.assign(attempt, { firstSeen: boolean(data.firstSeen, `${path}.firstSeen`) });
    return attempt;
  });
}

function records(value: unknown, context: Context): RivalGameRecord[] {
  const result: RivalGameRecord[] = [];
  const byId = new Map<string, RivalGameRecord>();
  let duplicates = 0;
  for (const [i, entry] of list(value, "対局記録", MAX_RECORDS).entries()) {
    const path = `対局記録[${i + 1}]`;
    const data = object(entry, path, ["id", "date", "result", "moves", "startSfen", "declarationRule"]);
    const record: RivalGameRecord = {
      id: text(data.id, `${path}.id`, 200),
      date: date(data.date, `${path}.date`),
      result: choice(data.result, `${path}.result`, ["black", "white", "draw"]),
      moves: list(data.moves, `${path}.moves`, MAX_MOVES).map((value, j) => text(value, `${path}.moves[${j + 1}]`, 5)),
    };
    if (data.declarationRule !== undefined) record.declarationRule = choice(data.declarationRule, `${path}.declarationRule`, ["jsa", "amateur27"]);
    let game = initialGame(record.declarationRule);
    if (data.startSfen !== undefined) {
      record.startSfen = text(data.startSfen, `${path}.startSfen`, 200);
      try { game = fromSfen(record.startSfen); } catch { fail(path, "開始局面の形式が正しくありません。"); }
      validPosition(game, `${path}.startSfen`);
      if (toSfen(game) !== record.startSfen) fail(path, "開始局面の内容が一致しません。");
      game = { ...game, declarationRule: record.declarationRule ?? "jsa" };
    }
    const existing = byId.get(record.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(record)) fail(path, "同じIDに内容の異なる対局があるため、上書きせずに復元を中止しました。");
      duplicates++;
      continue;
    }
    addMoves(context, record.moves.length);
    for (const [ply, notation] of record.moves.entries()) {
      if (game.result !== "playing") fail(path, `${ply + 1}手目は終局した後の余分な指し手です。`);
      const candidate = legalMoves(game).find(candidate => usi(candidate) === notation);
      if (!candidate) fail(path, `${ply + 1}手目の棋譜が合法手ではありません。`);
      game = playMove(game, candidate);
    }
    const replayResult = !record.moves.length && legalMoves(game).length === 0 ? opponent(game.turn) : game.result;
    if (replayResult !== "playing" && replayResult !== record.result) fail(path, "棋譜による終局結果と勝敗が一致しません。");
    byId.set(record.id, record);
    result.push(record);
  }
  if (duplicates) context.warnings.push(`IDと内容が同じ対局記録${duplicates}件を、重複させずにまとめました。内容の異なる同一IDは取り込みません。`);
  return result;
}

const STATE_KEYS = ["game", "level", "declarationRule", "completed", "lessonAttempts", "records", "messages", "cloudSyncPaused", "seenLessons", "pendingHints"];
const REQUIRED_KEYS = ["game", "level", "declarationRule", "completed", "lessonAttempts", "records", "messages"];

function savedState(value: unknown, context: Context, complete: boolean): SavedState {
  const data = object(value, "保存データ", STATE_KEYS);
  if (complete && REQUIRED_KEYS.some(key => data[key] === undefined)) fail("保存データ", "バックアップに必要な項目が足りません。");
  const game = validateGame(data.game, "現在の対局", context);
  const result: SavedState = {
    game,
    level: data.level === undefined ? 2 : integer(data.level, "対局レベル", 1, 4),
    declarationRule: data.declarationRule === undefined ? "jsa" : choice(data.declarationRule, "次の対局の規則", ["jsa", "amateur27"]),
    completed: data.completed === undefined ? [] : ids(data.completed, "修了レッスン"),
    lessonAttempts: data.lessonAttempts === undefined ? [] : attempts(data.lessonAttempts),
    records: data.records === undefined ? [] : records(data.records, context),
    messages: data.messages === undefined ? [] : list(data.messages, "会話", MAX_MESSAGES).map((entry, i) => {
      const path = `会話[${i + 1}]`;
      const message = object(entry, path, ["role", "text"]);
      return { role: choice(message.role, `${path}.role`, ["me", "rival"]), text: text(message.text, `${path}.text`, 20_000, true) };
    }),
  };
  if (data.cloudSyncPaused !== undefined) result.cloudSyncPaused = boolean(data.cloudSyncPaused, "クラウド同期の一時停止");
  if (data.seenLessons !== undefined) result.seenLessons = ids(data.seenLessons, "既に取り組んだレッスン");
  if (data.pendingHints !== undefined) result.pendingHints = ids(data.pendingHints, "回答前に使ったヒント");
  if (!complete && REQUIRED_KEYS.some(key => data[key] === undefined)) {
    context.warnings.push("旧形式にない追加項目は初期値に移行しました。元からある対局・教材・会話は保持しています。");
  }
  return result;
}

/** Validate and clone a local saved state. No array is truncated on failure. */
export function validateSavedState(input: unknown): SavedState {
  return savedState(input, { warnings: [], totalMoves: 0 }, false);
}

function checkSize(value: string): void {
  if (value.length > MAX_BACKUP_BYTES || new TextEncoder().encode(value).byteLength > MAX_BACKUP_BYTES) {
    throw new Error("保存データが5 MiBを超えています。内容を省略せずに処理を中止しました。");
  }
}

function envelope(data: SavedState, exportedAt: string): BackupEnvelope {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt, data };
}

/**
 * Check a proposed in-app state before changing it or saving it. This checks
 * capacity only: it never generates legal moves, replays games, or mutates data.
 * Import still requires parseBackup's full validation.
 */
export function assertBackupCapacity(state: SavedState): void {
  list(state.records, "対局記録", MAX_RECORDS);
  list(state.lessonAttempts, "教材の回答記録", MAX_ATTEMPTS);
  list(state.messages, "会話", MAX_MESSAGES);
  list(state.completed, "修了レッスン", MAX_ATTEMPTS);
  if (state.seenLessons !== undefined) list(state.seenLessons, "既に取り組んだレッスン", MAX_ATTEMPTS);
  if (state.pendingHints !== undefined) list(state.pendingHints, "回答前に使ったヒント", MAX_ATTEMPTS);

  const context: Context = { warnings: [], totalMoves: 0 };
  addMoves(context, list(state.game.history, "現在の対局.history", MAX_MOVES).length);
  for (const [i, record] of state.records.entries()) {
    addMoves(context, list(record.moves, `対局記録[${i + 1}].moves`, MAX_MOVES).length);
  }
  checkSize(JSON.stringify(envelope(state, CAPACITY_EXPORTED_AT)));
}

/** Validate the whole file before the caller considers replacing any local state. */
export function parseBackup(input: string): ParsedBackup {
  if (typeof input !== "string") throw new Error("バックアップはJSONテキストで読み込んでください。");
  checkSize(input);
  let value: unknown;
  try { value = JSON.parse(input.replace(/^\uFEFF/, "")); }
  catch { throw new Error("JSONを読み込めません。ファイルが途中で切れていないか確認してください。"); }
  const context: Context = { warnings: [], totalMoves: 0 };
  if (value && typeof value === "object" && !Array.isArray(value) && ("format" in value || "version" in value || "data" in value)) {
    const envelope = object(value, "バックアップ", ["format", "version", "exportedAt", "data"]);
    if (envelope.format !== BACKUP_FORMAT) fail("バックアップ", "棋友のバックアップ形式ではありません。");
    if (envelope.version !== BACKUP_VERSION) fail("バックアップ", "この版では読めないバックアップです。対応する新しい版で開いてください。");
    const exportedAt = date(envelope.exportedAt, "書き出した日時");
    return { state: savedState(envelope.data, context, true), source: "backup-v1", exportedAt, warnings: context.warnings };
  }
  const state = savedState(value, context, false);
  context.warnings.unshift("以前の端末保存形式を読み込みました。今後は棋友のバックアップ形式で書き出せます。");
  return { state, source: "legacy", warnings: context.warnings };
}

/** Keep every supported field; export never trims records or changes the input. */
export function serializeBackup(state: SavedState, exportedAt = new Date()): string {
  if (!(exportedAt instanceof Date) || !Number.isFinite(exportedAt.getTime())) throw new Error("書き出す日時が正しくありません。");
  const timestamp = date(exportedAt.toISOString(), "書き出す日時");
  const data = savedState(state, { warnings: [], totalMoves: 0 }, true);
  assertBackupCapacity(data);
  return JSON.stringify(envelope(data, timestamp));
}
