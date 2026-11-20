import { STRENGTH_PROFILES } from "./rival-policy";

/**
 * KIF-022 stage 2: "互角を目指す" adapts how much the rival reads to the player's results.
 *
 * - Strength stays a node budget (no deliberate bad moves): 16 steps from the practice budget
 *   (level 0, 4,000) to the strong budget (level 15, 300,000), each about 1.33x the previous.
 * - After each rated game the estimate moves toward the level where the player scores 50%:
 *   up after a win, down after a loss, unchanged after a draw. The step shrinks with the number of
 *   rated games (smoothing), the applied level changes only when the estimate is a whole level
 *   away (hysteresis), by at most two levels per game, and always within the ladder (bounds).
 * - A game is rated only through a token created when it starts (see `createMatchToken`), so old
 *   records, games against the built-in AI, interrupted or restored games are never counted, and
 *   the same game is never counted twice.
 * Levels are relative engine settings, not ranks or ratings against people.
 *
 * Storage: its own key, versioned and validated, separate from `kifu-rival.v1` and from backups,
 * so existing records, backups and older app versions are unaffected.
 */
export const ADAPTIVE_KEY = "kifu-rival.rival-adapt.v1";
export const ADAPTIVE_VERSION = 1;
export const TOP_LEVEL = 15;
export const START_LEVEL = 8;
/** Rated games before the level is shown as settled ("調整中" until then). */
export const CALIBRATION_GAMES = 5;
/** Kept history (older entries are dropped, their effect stays in the estimate). */
export const MAX_HISTORY = 100;
export const MAX_LEVEL_CHANGE = 2;
const HYSTERESIS = 1;
const MIN_STEP = 0.35;
const FIRST_STEP = 2;
/** A resignation this early is treated as a restart, not as a result. */
export const MIN_RESIGN_PLIES = 12;

export type RatedResult = "win" | "loss" | "draw";
export type RatedGame = { id: string; at: string; result: RatedResult; level: number; plies: number };
export type AdaptiveState = {
  version: typeof ADAPTIVE_VERSION;
  /** false = stopped: the current level is kept and results are not counted. */
  enabled: boolean;
  /** Continuous estimate of the level where the player scores about half. */
  estimate: number;
  /** The level applied to the next game. */
  level: number;
  /** Rated games so far, including those dropped from `games`. */
  rated: number;
  games: RatedGame[];
  /** Increased by every reset; a game started before a reset is not counted after it. */
  generation: number;
};
/** Fixed for one game when it starts; the game's strength never changes while it is played. */
export type MatchToken = { id: string; level: number; nodes: number; counts: boolean; generation: number };

export const INITIAL_ADAPTIVE: AdaptiveState = { version: ADAPTIVE_VERSION, enabled: true, estimate: START_LEVEL, level: START_LEVEL, rated: 0, games: [], generation: 0 };

/** Node budget of a level: practice × (strong/practice)^(level/15), rounded to hundreds. */
export function levelNodes(level: number): number {
  const low = STRENGTH_PROFILES.practice.nodes, high = STRENGTH_PROFILES.strong.nodes;
  const l = Math.min(TOP_LEVEL, Math.max(0, Math.round(level)));
  if (l === 0) return low;
  if (l === TOP_LEVEL) return high;
  return Math.round(low * (high / low) ** (l / TOP_LEVEL) / 100) * 100;
}

/** Step size for the next result: large while calibrating, never below half a level. */
export function stepSize(ratedBefore: number): number {
  return Math.max(MIN_STEP, FIRST_STEP / Math.sqrt(ratedBefore + 1));
}

const clampLevel = (value: number) => Math.min(TOP_LEVEL, Math.max(0, value));

/** Pure update. A known id or a stopped state leaves the state unchanged (the same object). */
export function applyRatedGame(state: AdaptiveState, game: RatedGame): AdaptiveState {
  if (!state.enabled || state.games.some(g => g.id === game.id)) return state;
  const score = game.result === "win" ? 1 : game.result === "draw" ? 0.5 : 0;
  const estimate = clampLevel(state.estimate + stepSize(state.rated) * (score - 0.5) * 2);
  let level = state.level;
  if (estimate >= level + HYSTERESIS) level = Math.floor(estimate);
  else if (estimate <= level - HYSTERESIS) level = Math.ceil(estimate);
  level = Math.min(state.level + MAX_LEVEL_CHANGE, Math.max(state.level - MAX_LEVEL_CHANGE, level));
  const games = [...state.games, game].slice(-MAX_HISTORY);
  return { ...state, estimate: Math.round(estimate * 1000) / 1000, level: clampLevel(level), rated: state.rated + 1, games };
}

export const calibrating = (state: AdaptiveState) => state.enabled && state.rated < CALIBRATION_GAMES;

export function summarize(state: AdaptiveState) {
  const recent = state.games.slice(-10);
  const count = (r: RatedResult) => recent.filter(g => g.result === r).length;
  return {
    calibrating: calibrating(state), remaining: Math.max(0, CALIBRATION_GAMES - state.rated),
    level: state.level, nodes: levelNodes(state.level), rated: state.rated,
    recent: { games: recent.length, win: count("win"), loss: count("loss"), draw: count("draw") },
  };
}

export function createMatchToken(state: AdaptiveState, id: string): MatchToken {
  return { id, level: state.level, nodes: levelNodes(state.level), counts: state.enabled, generation: state.generation };
}

export type GameEnd = {
  /** Fixed settings of the game that ended. */
  opponent: "builtin" | "engine"; strength: string; token?: MatchToken;
  /** From the player's side (the player is black). */
  result: "black" | "white" | "draw"; plies: number; customStart: boolean; resigned: boolean; at: string;
};

/** Decides whether a finished game counts. Only games started with a counting token are rated. */
export function ratedGameOf(end: GameEnd, generation = 0): RatedGame | { skip: string } {
  if (end.opponent !== "engine" || end.strength !== "balanced") return { skip: "互角を目指す以外の対局" };
  if (!end.token) return { skip: "開始時の記録がない対局（以前の対局・途中で相手を変えた対局・復元した対局）" };
  if (!end.token.counts) return { skip: "自動調整を止めていた対局" };
  if (end.token.generation !== generation) return { skip: "調整をやり直す前に始めた対局" };
  if (end.customStart) return { skip: "任意の局面から始めた対局" };
  if (end.resigned && end.result === "white" && end.plies < MIN_RESIGN_PLIES) return { skip: `${MIN_RESIGN_PLIES}手未満の投了（指し直し扱い）` };
  return { id: end.token.id, at: end.at, result: end.result === "black" ? "win" : end.result === "white" ? "loss" : "draw", level: end.token.level, plies: end.plies };
}

// ---------------------------------------------------------------------------------------------
// Parsing: never throws; damaged data falls back to the initial state and says so.

export type ParsedAdaptive = { state: AdaptiveState; readOnly: boolean; warning?: string };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown, fallback: number) => typeof v === "number" && Number.isFinite(v) ? v : fallback;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function ratedGame(value: unknown): RatedGame | undefined {
  if (!isRecord(value)) return;
  const { id, at, result, level, plies } = value;
  if (typeof id !== "string" || !id || id.length > 100) return;
  if (typeof at !== "string" || !ISO.test(at) || Number.isNaN(Date.parse(at))) return;
  if (result !== "win" && result !== "loss" && result !== "draw") return;
  if (!Number.isInteger(level) || (level as number) < 0 || (level as number) > TOP_LEVEL) return;
  if (!Number.isInteger(plies) || (plies as number) < 0 || (plies as number) > 2000) return;
  return { id, at, result, level: level as number, plies: plies as number };
}

export function parseAdaptiveState(raw: string | null): ParsedAdaptive {
  if (raw === null) return { state: INITIAL_ADAPTIVE, readOnly: false };
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return { state: INITIAL_ADAPTIVE, readOnly: false, warning: "自動調整の記録が壊れていたため、初めから調整します。" }; }
  if (!isRecord(data)) return { state: INITIAL_ADAPTIVE, readOnly: false, warning: "自動調整の記録が壊れていたため、初めから調整します。" };
  if (typeof data.version === "number" && data.version > ADAPTIVE_VERSION) {
    // Written by a newer app: use the level it chose but never overwrite it.
    const level = Number.isInteger(data.level) ? clampLevel(data.level as number) : START_LEVEL;
    return { state: { ...INITIAL_ADAPTIVE, level, estimate: level, enabled: false }, readOnly: true, warning: "新しい版で保存された自動調整の記録のため、この版では変更しません。" };
  }
  if (data.version !== ADAPTIVE_VERSION) return { state: INITIAL_ADAPTIVE, readOnly: false, warning: "自動調整の記録の形式が分からないため、初めから調整します。" };
  const seen = new Set<string>();
  const entries = Array.isArray(data.games) ? data.games : [];
  const games = entries.map(ratedGame).filter((g): g is RatedGame => !!g && !seen.has(g.id) && !!seen.add(g.id)).slice(-MAX_HISTORY);
  const dropped = entries.length - games.length;
  const level = Number.isInteger(data.level) ? clampLevel(data.level as number) : START_LEVEL;
  const state: AdaptiveState = {
    version: ADAPTIVE_VERSION,
    enabled: typeof data.enabled === "boolean" ? data.enabled : true,
    estimate: clampLevel(finite(data.estimate, level)),
    level,
    rated: Math.max(games.length, Math.min(1_000_000, Math.floor(finite(data.rated, games.length)))),
    games,
    generation: Number.isSafeInteger(data.generation) && (data.generation as number) >= 0 ? data.generation as number : 0,
  };
  const repaired = dropped > 0 || level !== data.level || state.estimate !== data.estimate || state.enabled !== data.enabled
    || (data.generation !== undefined && state.generation !== data.generation);
  return { state, readOnly: false, ...(repaired ? { warning: "自動調整の記録の一部が読めなかったため、読める範囲で続けます。" } : {}) };
}

/** Storage wrapper: a failed write keeps the state in memory and reports it; it never double counts. */
export class AdaptiveStore {
  state: AdaptiveState;
  readOnly: boolean;
  warning?: string;
  saveError?: string;

  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
    let raw: string | null = null;
    try { raw = storage.getItem(ADAPTIVE_KEY); } catch { this.warning = "自動調整の記録を読めません（この端末の保存領域が使えません）。"; }
    const parsed = parseAdaptiveState(raw);
    this.state = parsed.state; this.readOnly = parsed.readOnly; this.warning ??= parsed.warning;
  }

  private save(next: AdaptiveState): boolean {
    this.state = next;
    if (this.readOnly) return false;
    try { this.storage.setItem(ADAPTIVE_KEY, JSON.stringify(next)); this.saveError = undefined; return true; }
    catch (error) { this.saveError = `自動調整の記録を保存できませんでした。この画面を閉じるまでは反映されます。${error instanceof Error ? ` ${error.message}` : ""}`; return false; }
  }

  /** Returns true when the result changed the state (a new, counting game). */
  record(game: RatedGame): boolean {
    if (this.readOnly) return false;
    const next = applyRatedGame(this.state, game);
    if (next === this.state) return false;
    this.save(next);
    return true;
  }

  /** Retry a write that failed earlier (same content, so nothing is counted twice). */
  flush(): boolean { return this.saveError ? this.save(this.state) : true; }

  setEnabled(enabled: boolean) { if (!this.readOnly && enabled !== this.state.enabled) this.save({ ...this.state, enabled }); }

  /** Forget every rated game and start calibrating again from the middle of the ladder. */
  reset() {
    if (this.readOnly) return;
    this.save({ ...INITIAL_ADAPTIVE, enabled: this.state.enabled, generation: this.state.generation + 1 });
  }
}
