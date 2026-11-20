import type { SavedState } from "./backup";

export const STORAGE_KEY = "kifu-rival.v1";
export const RECOVERY_KEY = "kifu-rival.before-restore.v1";

/** Save the old bytes first. A failed replacement never changes the live record. */
export function restoreSavedState(storage: Pick<Storage, "getItem" | "setItem">, next: SavedState, current: SavedState): SavedState {
  const restored: SavedState = { ...next, cloudSyncPaused: true };
  const replacement = JSON.stringify(restored);
  const original = storage.getItem(STORAGE_KEY) ?? JSON.stringify(current);
  storage.setItem(RECOVERY_KEY, original);
  storage.setItem(STORAGE_KEY, replacement);
  return restored;
}
