"use client";
import { useEffect, useRef, useState } from "react";
import { AdaptiveStore, INITIAL_ADAPTIVE, createMatchToken, ratedGameOf, summarize } from "../lib/engine/adaptive-strength";
import type { AdaptiveState, GameEnd, MatchToken } from "../lib/engine/adaptive-strength";

type View = { state: AdaptiveState; readOnly: boolean; warning?: string; saveError?: string; loaded: boolean };

/** In-memory stand-in when the browser refuses storage (results then last until the page closes). */
function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const data = new Map<string, string>();
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: k => { data.delete(k); } };
}

const newId = () => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
  ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

/** KIF-022 stage 2: the adaptive strength of "互角を目指す", stored in its own key. */
export function useAdaptiveStrength() {
  const store = useRef<AdaptiveStore | null>(null);
  const [view, setView] = useState<View>({ state: INITIAL_ADAPTIVE, readOnly: false, loaded: false });
  const refresh = () => {
    const s = store.current!;
    setView({ state: s.state, readOnly: s.readOnly, warning: s.warning, saveError: s.saveError, loaded: true });
  };
  useEffect(() => {
    let storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
    try { storage = window.localStorage; } catch { storage = memoryStorage(); }
    store.current = new AdaptiveStore(storage);
    // The store owns its state; the view is refreshed after every change.
    queueMicrotask(refresh);
  }, []);

  /** Count a finished game if it was started as a rated game. Returns why it was skipped otherwise. */
  function record(end: GameEnd): { counted: boolean; reason?: string } {
    const s = store.current;
    if (!s) return { counted: false, reason: "読み込み中" };
    const rated = ratedGameOf(end, s.state.generation);
    if ("skip" in rated) return { counted: false, reason: rated.skip };
    if (s.readOnly) return { counted: false, reason: "新しい版の記録のため変更しない" };
    const counted = s.record(rated);
    refresh();
    return counted ? { counted } : { counted, reason: "数え済みの対局" };
  }
  const act = (f: (s: AdaptiveStore) => void) => { if (store.current) { f(store.current); refresh(); } };
  return {
    ...view,
    summary: summarize(view.state),
    newToken: (): MatchToken => createMatchToken(view.readOnly ? { ...view.state, enabled: false } : view.state, newId()),
    record,
    setEnabled: (enabled: boolean) => act(s => s.setEnabled(enabled)),
    reset: () => act(s => s.reset()),
    retrySave: () => act(s => { s.flush(); }),
  };
}
