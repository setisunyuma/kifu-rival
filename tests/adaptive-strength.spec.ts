import assert from "node:assert/strict";
import test from "node:test";
import {
  ADAPTIVE_KEY, ADAPTIVE_VERSION, AdaptiveStore, CALIBRATION_GAMES, INITIAL_ADAPTIVE, MAX_HISTORY, MAX_LEVEL_CHANGE,
  MIN_RESIGN_PLIES, START_LEVEL, TOP_LEVEL, applyRatedGame, createMatchToken, levelNodes, parseAdaptiveState, ratedGameOf, stepSize, summarize,
} from "../lib/engine/adaptive-strength";
import type { AdaptiveState, GameEnd, RatedGame, RatedResult } from "../lib/engine/adaptive-strength";
import { STRENGTH_PROFILES } from "../lib/engine/rival-policy";
import { searchLimits } from "../lib/engine/engine-rival";
import { ENGINE_SETTINGS_KEY, parseMatchToken, parseStoredEngineSettings } from "../hooks/use-engine-rival";
import { restoreSavedState, STORAGE_KEY } from "../lib/persistence";
import { initialGame } from "../lib/shogi";
import type { SavedState } from "../lib/backup";

const AT = "2026-11-20T00:00:00.000Z";
const game = (id: string, result: RatedResult, level = START_LEVEL): RatedGame => ({ id, at: AT, result, level, plies: 80 });
const play = (results: RatedResult[], from: AdaptiveState = INITIAL_ADAPTIVE) => {
  let state = from; const levels: number[] = [];
  results.forEach((r, i) => { state = applyRatedGame(state, game(`g${i}-${state.rated}`, r, state.level)); levels.push(state.level); });
  return { state, levels };
};

/** Deterministic PRNG for synthetic players. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/**
 * Synthetic player: its "true level" θ is where it scores 50% against the rival; each level of
 * difference is worth `eloPerLevel` (the engine benchmark shows roughly 70-125 between engines;
 * people are unknown, so the tests use 50, 100 and 200). 5% of games are drawn.
 */
function simulate(theta: number | ((game: number) => number), eloPerLevel: number, games: number, seed: number) {
  const random = rng(seed); let state = INITIAL_ADAPTIVE; const levels: number[] = [];
  for (let i = 0; i < games; i++) {
    const t = typeof theta === "function" ? theta(i) : theta, level = state.level;
    const p = 1 / (1 + 10 ** ((level - t) * eloPerLevel / 400)), u = random();
    const result: RatedResult = u < 0.05 ? "draw" : u < 0.05 + 0.95 * p ? "win" : "loss";
    const next = applyRatedGame(state, game(`s${seed}-${i}`, result, level));
    assert.ok(Math.abs(next.level - state.level) <= MAX_LEVEL_CHANGE, "never more than two levels per game");
    assert.ok(next.level >= 0 && next.level <= TOP_LEVEL && next.estimate >= 0 && next.estimate <= TOP_LEVEL);
    state = next; levels.push(state.level);
  }
  return levels;
}
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const quantile = (values: number[], q: number) => [...values].sort((a, b) => a - b)[Math.floor(values.length * q)];

test("adaptive ladder: 16 levels from the practice to the strong budget, start at the old 40,000", () => {
  assert.equal(levelNodes(0), STRENGTH_PROFILES.practice.nodes);
  assert.equal(levelNodes(TOP_LEVEL), STRENGTH_PROFILES.strong.nodes);
  assert.equal(levelNodes(START_LEVEL), 40_000);
  for (let l = 1; l <= TOP_LEVEL; l++) {
    const ratio = levelNodes(l) / levelNodes(l - 1);
    assert.ok(ratio > 1.25 && ratio < 1.45, `level ${l} ratio ${ratio}`);
  }
  assert.equal(levelNodes(-3), levelNodes(0));
  assert.equal(levelNodes(99), levelNodes(TOP_LEVEL));
});

test("adaptive: synthetic beginner, intermediate and advanced players converge to their level", () => {
  // θ relative to the ladder; below 0 or above 15 the rival stops at the practice or strong budget.
  for (const eloPerLevel of [50, 100, 200]) {
    for (const theta of [-5, 2, 7, 12, 25]) {
      const target = Math.min(TOP_LEVEL, Math.max(0, theta));
      const finals: number[] = [], errors: number[] = [];
      for (let seed = 1; seed <= 200; seed++) {
        const levels = simulate(theta, eloPerLevel, 60, seed * 7919 + theta * 31 + eloPerLevel);
        finals.push(levels.at(-1)!);
        const last = levels.slice(-20);
        errors.push(Math.abs(last.reduce((a, b) => a + b, 0) / last.length - target));
      }
      const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;
      assert.ok(Math.abs(median(finals) - target) <= 1, `θ=${theta} E=${eloPerLevel}: median final ${median(finals)}`);
      assert.ok(meanError <= (eloPerLevel === 50 ? 1.2 : 0.9), `θ=${theta} E=${eloPerLevel}: mean error ${meanError.toFixed(2)}`);
      assert.ok(quantile(errors, 0.95) <= 2.5, `θ=${theta} E=${eloPerLevel}: p95 error ${quantile(errors, 0.95)}`);
    }
  }
});

test("adaptive: stable once settled (few, single-level changes) and follows an improving player", () => {
  const changes: number[] = [];
  for (let seed = 1; seed <= 200; seed++) {
    const levels = simulate(8, 100, 60, seed);
    let c = 0; for (let i = 41; i < 60; i++) if (levels[i] !== levels[i - 1]) c++;
    changes.push(c);
  }
  assert.ok(median(changes) <= 3, `median changes in games 41-60: ${median(changes)}`);
  assert.ok(quantile(changes, 0.95) <= 6, `p95 changes: ${quantile(changes, 0.95)}`);
  // θ rises from 5 to 11 over games 20-80: the rival should keep up within about a level.
  const lags: number[] = [];
  for (let seed = 1; seed <= 200; seed++) {
    const theta = (i: number) => (i < 20 ? 5 : Math.min(11, 5 + (i - 20) * 0.1));
    const levels = simulate(theta, 100, 100, seed + 5000);
    lags.push(levels.slice(80).reduce((s, l, k) => s + (theta(80 + k) - l), 0) / 20);
  }
  assert.ok(Math.abs(median(lags)) <= 1, `median lag ${median(lags)}`);
});

test("adaptive: streaks move at most two levels per game and stop at the ladder's ends", () => {
  const wins = play(Array(20).fill("win"));
  wins.levels.reduce((prev, l) => { assert.ok(l >= prev && l - prev <= MAX_LEVEL_CHANGE); return l; }, START_LEVEL);
  assert.equal(wins.state.level, TOP_LEVEL);
  assert.equal(wins.state.estimate, TOP_LEVEL, "the estimate does not run past the top (no wind-up)");
  // A single loss after a winning streak does not throw the level down.
  const afterLoss = applyRatedGame(wins.state, game("after", "loss", TOP_LEVEL));
  assert.ok(afterLoss.level >= TOP_LEVEL - 1);
  const losses = play(Array(20).fill("loss"));
  assert.equal(losses.state.level, 0);
  // Recovers from the bottom as soon as the player starts winning.
  const recovery = play(Array(6).fill("win"), losses.state);
  assert.ok(recovery.state.level >= 1 && recovery.state.level <= 4);
});

test("adaptive: draws change nothing; alternating results do not make the level oscillate", () => {
  const draws = play(Array(10).fill("draw"));
  assert.equal(draws.state.level, START_LEVEL);
  assert.equal(draws.state.estimate, START_LEVEL);
  assert.equal(draws.state.rated, 10);
  const settled = play(Array(CALIBRATION_GAMES).fill("draw")).state;
  const alternating = play(Array(30).fill(0).map((_, i) => (i % 2 ? "loss" : "win")), settled);
  const changes = alternating.levels.filter((l, i) => l !== (i ? alternating.levels[i - 1] : START_LEVEL)).length;
  assert.ok(changes <= 1, `alternating results changed the level ${changes} times`);
});

test("adaptive: calibration is shown for the first games, with larger steps that then shrink", () => {
  assert.equal(summarize(INITIAL_ADAPTIVE).calibrating, true);
  assert.equal(summarize(INITIAL_ADAPTIVE).remaining, CALIBRATION_GAMES);
  const s = play(Array(CALIBRATION_GAMES).fill("draw")).state;
  assert.equal(summarize(s).calibrating, false);
  assert.ok(stepSize(0) > stepSize(CALIBRATION_GAMES) && stepSize(1000) === stepSize(10_000));
  assert.ok(stepSize(10_000) < 1, "late games move the estimate by less than a level");
});

test("adaptive: only games started with a counting token are rated, and never twice", () => {
  const token = createMatchToken(INITIAL_ADAPTIVE, "match-1");
  const end = (change: Partial<GameEnd> = {}): GameEnd => ({ opponent: "engine", strength: "balanced", token, result: "black", plies: 60, customStart: false, resigned: false, at: AT, ...change });
  assert.deepEqual(ratedGameOf(end()), { id: "match-1", at: AT, result: "win", level: START_LEVEL, plies: 60 });
  assert.equal((ratedGameOf(end({ result: "white" })) as RatedGame).result, "loss");
  assert.equal((ratedGameOf(end({ result: "draw" })) as RatedGame).result, "draw");
  for (const skipped of [end({ opponent: "builtin" }), end({ strength: "strong" }), end({ strength: "practice" }), end({ token: undefined }),
    end({ token: { ...token, counts: false } }), end({ customStart: true }), end({ result: "white", resigned: true, plies: MIN_RESIGN_PLIES - 1 })]) {
    assert.ok("skip" in ratedGameOf(skipped));
  }
  // An early mate or the rival's resignation still counts; only the player's early resignation is a restart.
  assert.ok(!("skip" in ratedGameOf(end({ result: "white", plies: 9 }))));
  assert.ok(!("skip" in ratedGameOf(end({ result: "white", resigned: true, plies: MIN_RESIGN_PLIES }))));
  const once = applyRatedGame(INITIAL_ADAPTIVE, ratedGameOf(end()) as RatedGame);
  assert.equal(applyRatedGame(once, ratedGameOf(end()) as RatedGame), once, "the same game is not counted twice");
  // A game started before "調整をやり直す" does not count into the fresh calibration.
  assert.ok("skip" in ratedGameOf(end(), 1));
  assert.ok(!("skip" in ratedGameOf(end({ token: { ...token, generation: 1 } }), 1)));
  // Stopped: nothing changes and the token says so.
  const stopped = { ...INITIAL_ADAPTIVE, enabled: false };
  assert.equal(applyRatedGame(stopped, game("x", "win")), stopped);
  assert.equal(createMatchToken(stopped, "m").counts, false);
});

test("adaptive: the game's strength is fixed by its token; results only change the next game", () => {
  const token = createMatchToken(INITIAL_ADAPTIVE, "fixed");
  const policy = { strength: "balanced" as const, style: "balanced" as const, nodes: token.nodes };
  const before = searchLimits(policy);
  const after = applyRatedGame(INITIAL_ADAPTIVE, game("fixed", "win"));
  assert.ok(after.level > INITIAL_ADAPTIVE.level);
  assert.deepEqual(searchLimits(policy), before, "the running game keeps its budget");
  assert.equal(before.nodes, 40_000);
  assert.equal(createMatchToken(after, "next").nodes, levelNodes(after.level));
  // Budgets outside the ladder are clamped; large budgets get the strong time cap.
  assert.equal(searchLimits({ ...policy, nodes: 1 }).nodes, STRENGTH_PROFILES.practice.nodes);
  assert.equal(searchLimits({ ...policy, nodes: 9e9 }).nodes, STRENGTH_PROFILES.strong.nodes);
  assert.equal(searchLimits({ ...policy, nodes: levelNodes(TOP_LEVEL) }).movetimeMs, STRENGTH_PROFILES.strong.movetimeMs);
  assert.equal(searchLimits({ ...policy, nodes: Number.NaN }).nodes, STRENGTH_PROFILES.balanced.nodes);
  assert.deepEqual(searchLimits({ strength: "strong", style: "solid" }), { nodes: 300_000, movetimeMs: 4000, multiPv: 2 });
});

test("adaptive storage: missing, damaged, unknown, newer and tampered data are handled without throwing", () => {
  assert.deepEqual(parseAdaptiveState(null), { state: INITIAL_ADAPTIVE, readOnly: false });
  for (const raw of ["{", "[]", "42", '"x"', JSON.stringify({ version: 0 }), JSON.stringify({ version: "1" })]) {
    const parsed = parseAdaptiveState(raw);
    assert.deepEqual(parsed.state, INITIAL_ADAPTIVE); assert.equal(parsed.readOnly, false); assert.ok(parsed.warning);
  }
  const newer = parseAdaptiveState(JSON.stringify({ version: ADAPTIVE_VERSION + 1, level: 11, anything: [1, 2] }));
  assert.equal(newer.readOnly, true); assert.equal(newer.state.level, 11); assert.equal(newer.state.enabled, false);
  const tampered = parseAdaptiveState(JSON.stringify({
    version: 1, enabled: "yes", estimate: Infinity, level: 99, rated: -5,
    games: [game("ok", "win"), game("ok", "loss"), { ...game("bad", "win"), level: 40 }, { ...game("bad2", "win"), at: "yesterday" }, { id: "x" }, null, "g",
      ...Array.from({ length: MAX_HISTORY + 20 }, (_, i) => game(`h${i}`, "draw"))],
  }));
  assert.equal(tampered.state.level, TOP_LEVEL);
  assert.equal(tampered.state.estimate, TOP_LEVEL);
  assert.equal(tampered.state.enabled, true);
  assert.equal(tampered.state.games.length, MAX_HISTORY);
  assert.equal(new Set(tampered.state.games.map(g => g.id)).size, MAX_HISTORY);
  assert.ok(tampered.state.rated >= tampered.state.games.length);
  assert.ok(tampered.warning);
  // A normal save reads back exactly and silently.
  const settled = play(["win", "loss", "draw", "win", "win", "loss"]).state;
  assert.deepEqual(parseAdaptiveState(JSON.stringify(settled)), { state: settled, readOnly: false });
});

function memory(fail: { set?: boolean; get?: boolean } = {}) {
  const items = new Map<string, string>(); let writes = 0;
  return {
    items, get writes() { return writes; }, fail,
    getItem: (k: string) => { if (fail.get) throw new Error("denied"); return items.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (fail.set) throw new Error("QuotaExceededError"); writes++; items.set(k, v); },
    removeItem: (k: string) => { items.delete(k); },
  };
}

test("adaptive storage: a failed save keeps the result in memory, a retry saves it once, a restart continues", () => {
  const storage = memory({ set: true });
  const store = new AdaptiveStore(storage);
  assert.equal(store.record(game("a", "win")), true);
  assert.ok(store.saveError);
  assert.equal(store.state.rated, 1);
  assert.equal(storage.items.has(ADAPTIVE_KEY), false, "nothing half-written");
  assert.equal(store.record(game("a", "win")), false, "the same game is not counted again while unsaved");
  storage.fail.set = false;
  assert.equal(store.flush(), true);
  assert.equal(store.saveError, undefined);
  assert.equal(JSON.parse(storage.items.get(ADAPTIVE_KEY)!).rated, 1);
  // Restart: a new store reads the same state and keeps de-duplicating.
  const restarted = new AdaptiveStore(storage);
  assert.deepEqual(restarted.state, store.state);
  assert.equal(restarted.record(game("a", "win")), false);
  assert.equal(restarted.record(game("b", "loss")), true);
  // Unreadable storage: starts fresh and says why, without throwing.
  const blocked = new AdaptiveStore(memory({ get: true }));
  assert.deepEqual(blocked.state, INITIAL_ADAPTIVE); assert.ok(blocked.warning);
});

test("adaptive storage: stop, restart and reset; data from a newer version is never overwritten", () => {
  const storage = memory(); const store = new AdaptiveStore(storage);
  store.record(game("1", "win")); store.record(game("2", "win"));
  const level = store.state.level;
  store.setEnabled(false);
  assert.equal(store.record(game("3", "win")), false);
  assert.equal(store.state.level, level, "stopped keeps the level");
  store.setEnabled(true); store.reset();
  assert.deepEqual(store.state, { ...INITIAL_ADAPTIVE, generation: 1 });
  assert.deepEqual(JSON.parse(storage.items.get(ADAPTIVE_KEY)!), { ...INITIAL_ADAPTIVE, generation: 1 });
  assert.equal(createMatchToken(store.state, "after-reset").generation, 1);
  assert.deepEqual(new AdaptiveStore(storage).state, store.state, "the reset survives a restart");
  const newerBytes = JSON.stringify({ version: ADAPTIVE_VERSION + 1, level: 3, future: true });
  const future = memory(); future.items.set(ADAPTIVE_KEY, newerBytes);
  const readOnly = new AdaptiveStore(future);
  assert.equal(readOnly.readOnly, true);
  assert.equal(readOnly.record(game("z", "win")), false);
  readOnly.reset(); readOnly.setEnabled(true); readOnly.flush();
  assert.equal(future.items.get(ADAPTIVE_KEY), newerBytes);
  assert.equal(future.writes, 0);
});

test("adaptive tokens: stored with the engine settings, damaged tokens mean 'not rated', old settings still load", () => {
  const token = createMatchToken(INITIAL_ADAPTIVE, "abc");
  const stored = { next: { opponent: "engine", strength: "balanced", style: "solid", purpose: "win" }, match: { opponent: "engine", strength: "balanced", style: "solid", purpose: "win" }, rated: token };
  assert.deepEqual(parseStoredEngineSettings(JSON.stringify(stored)).rated, token);
  for (const bad of [{ ...token, nodes: 41_000 }, { ...token, level: 16 }, { ...token, level: 2.5 }, { ...token, id: "" }, { ...token, counts: "yes" }, { ...token, generation: -1 }, { ...token, generation: undefined }, [], "abc", null]) {
    assert.equal(parseMatchToken(bad), undefined);
    assert.equal(parseStoredEngineSettings(JSON.stringify({ ...stored, rated: bad })).rated, undefined);
  }
  // Settings saved before this feature (no token) load as before and are simply not rated.
  const legacy = parseStoredEngineSettings(JSON.stringify({ next: stored.next, match: stored.match }));
  assert.equal(legacy.rated, undefined);
  assert.equal(legacy.match.strength, "balanced");
});

test("adaptive data is outside the saved record and backups: restoring a backup leaves it untouched", () => {
  const items = new Map<string, string>([[ADAPTIVE_KEY, JSON.stringify(play(["win", "win"]).state)], [ENGINE_SETTINGS_KEY, '{"next":{}}']]);
  const before = new Map(items);
  const storage = { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => { items.set(k, v); } };
  const state = (): SavedState => ({ game: initialGame(), level: 2, declarationRule: "jsa", records: [], completed: [], lessonAttempts: [], messages: [] });
  restoreSavedState(storage, state(), state());
  assert.equal(items.get(ADAPTIVE_KEY), before.get(ADAPTIVE_KEY));
  assert.equal(items.get(ENGINE_SETTINGS_KEY), before.get(ENGINE_SETTINGS_KEY));
  assert.ok(items.has(STORAGE_KEY));
  assert.notEqual(ADAPTIVE_KEY, STORAGE_KEY);
});
