import assert from "node:assert/strict";
import test from "node:test";
import { initialGame, fromSfen, reviewGame } from "../lib/shogi";
import { restoreSavedState, STORAGE_KEY, RECOVERY_KEY } from "../lib/persistence";
import type { SavedState } from "../lib/backup";

const state = (): SavedState => ({ game: initialGame(), level: 2, declarationRule: "jsa", records: [], completed: [], lessonAttempts: [], messages: [] });

test("restore keeps the exact previous bytes and pauses cloud merging across reloads", () => {
  const old = '{ "original" : "retained exactly" }';
  const items = new Map([[STORAGE_KEY, old]]);
  const storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); } };
  const restored = restoreSavedState(storage, { ...state(), level: 4 }, state());
  assert.equal(items.get(RECOVERY_KEY), old);
  assert.equal(JSON.parse(items.get(STORAGE_KEY)!).level, 4);
  assert.equal(JSON.parse(items.get(STORAGE_KEY)!).cloudSyncPaused, true);
  assert.equal(restored.cloudSyncPaused, true);
});

test("quota failures in either restore write leave the live record unchanged", () => {
  for (const failingKey of [RECOVERY_KEY, STORAGE_KEY]) {
    const original = JSON.stringify(state());
    const items = new Map([[STORAGE_KEY, original]]);
    const storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => {
      if (key === failingKey) throw new Error("quota");
      items.set(key, value);
    } };
    assert.throws(() => restoreSavedState(storage, { ...state(), level: 4 }, state()), /quota/);
    assert.equal(items.get(STORAGE_KEY), original);
  }
});

test("review does not mark trailing moves after a finished game as analyzed", () => {
  const start = fromSfen("8k/9/7G1/9/9/9/9/9/K8 b RG 1");
  const valid = reviewGame(["G*1b"], "black", 1, start);
  assert.equal(valid.complete, true);
  const invalid = reviewGame(["G*1b", "1a2a"], "black", 1, start);
  assert.equal(invalid.complete, false);
  assert.equal(invalid.analyzedPlies, 1);
  assert.equal(invalid.totalPlies, 2);
  assert.equal(invalid.stopReason, "illegal-move");
});
