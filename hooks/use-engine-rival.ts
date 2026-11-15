"use client";
import { useEffect, useRef, useState } from "react";
import type { Game } from "../lib/shogi";
import { DEV_ENGINE_OPTIONS, createDevEngineTransport, probeDevEngine } from "../lib/engine/browser-engine";
import type { EngineAvailability } from "../lib/engine/browser-engine";
import { EngineRival } from "../lib/engine/engine-rival";
import type { EngineTurn } from "../lib/engine/engine-rival";
import { EngineError, enginePositionKey } from "../lib/engine/usi-adapter";
import type { RivalPolicy, RivalPurpose, RivalStrength, RivalStyle } from "../lib/engine/rival-policy";

export type Opponent = "builtin" | "engine";
export type EngineSettings = { opponent: Opponent; strength: RivalStrength; style: RivalStyle; purpose: RivalPurpose };
export const DEFAULT_ENGINE_SETTINGS: EngineSettings = { opponent: "builtin", strength: "balanced", style: "balanced", purpose: "close-game" };
/**
 * Development settings only. Kept apart from kifu-rival.v1 so backups, restores and older app
 * versions never see an unknown field; losing this key only resets the opponent choice.
 */
export const ENGINE_SETTINGS_KEY = "kifu-rival.engine-dev.v1";

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? value as T : fallback;

export function parseEngineSettings(raw: string | null): EngineSettings {
  if (!raw) return DEFAULT_ENGINE_SETTINGS;
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    return {
      opponent: pick(data.opponent, ["builtin", "engine"] as const, "builtin"),
      strength: pick(data.strength, ["strong", "balanced", "practice"] as const, "balanced"),
      style: pick(data.style, ["balanced", "active", "solid"] as const, "balanced"),
      purpose: pick(data.purpose, ["win", "close-game", "finish-practice"] as const, "close-game"),
    };
  } catch { return DEFAULT_ENGINE_SETTINGS; }
}

type StoredEngineSettings = { next: EngineSettings; match: EngineSettings };

export function parseStoredEngineSettings(raw: string | null): StoredEngineSettings {
  if (!raw) return { next: DEFAULT_ENGINE_SETTINGS, match: DEFAULT_ENGINE_SETTINGS };
  try {
    const data = JSON.parse(raw) as { next?: unknown; match?: unknown };
    const next = parseEngineSettings(JSON.stringify(data.next ?? null));
    return { next, match: data.match ? parseEngineSettings(JSON.stringify(data.match)) : next };
  } catch { return { next: DEFAULT_ENGINE_SETTINGS, match: DEFAULT_ENGINE_SETTINGS }; }
}

/**
 * `next` is what the player selected; `match` is fixed for the current game (like the
 * entering-king rule), so the opponent cannot change in the middle of a game.
 */
export function useEngineSettings() {
  const [stored, setStored] = useState<StoredEngineSettings>({ next: DEFAULT_ENGINE_SETTINGS, match: DEFAULT_ENGINE_SETTINGS });
  const [availability, setAvailability] = useState<EngineAvailability>({ status: "checking" });
  const loaded = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    try { const saved = parseStoredEngineSettings(window.localStorage.getItem(ENGINE_SETTINGS_KEY)); queueMicrotask(() => { loaded.current = true; setStored(saved); }); }
    catch { loaded.current = true; }
    void probeDevEngine(fetch, controller.signal).then(result => { if (!controller.signal.aborted) setAvailability(result); });
    return () => controller.abort();
  }, []);
  function save(value: StoredEngineSettings) {
    try { if (loaded.current) window.localStorage.setItem(ENGINE_SETTINGS_KEY, JSON.stringify(value)); } catch { /* not critical */ }
  }
  /** Change the selection; it also applies to the current game only if that game has not started. */
  function update(change: Partial<EngineSettings>, applyNow: boolean) {
    setStored(previous => {
      const next = { ...previous.next, ...change };
      const value = { next, match: applyNow ? next : previous.match };
      save(value); return value;
    });
  }
  function startMatch() { setStored(previous => { const value = { next: previous.next, match: previous.next }; save(value); return value; }); }
  return { settings: stored.next, match: stored.match, update, startMatch, availability };
}

export type EngineTurnState =
  | { status: "idle" }
  | { status: "thinking"; startedAt: number }
  | { status: "paused" }
  | { status: "error"; message: string };

/**
 * Runs the rival's engine turn for `game` while `active`. A changed position, a pause or
 * unmounting aborts the search by terminating its Worker; a result is delivered only if it was
 * computed for the exact current position (repetition history and rule included).
 */
export function useEngineTurn({ active, paused, game, policy, onTurn }: {
  active: boolean; paused: boolean; game: Game; policy: RivalPolicy; onTurn: (turn: EngineTurn, game: Game) => void;
}) {
  const rival = useRef<EngineRival | null>(null);
  const callback = useRef(onTurn);
  useEffect(() => { callback.current = onTurn; }, [onTurn]);
  const [state, setState] = useState<EngineTurnState>({ status: "idle" });
  const [retry, setRetry] = useState(0);
  const [lastTurn, setLastTurn] = useState<EngineTurn | null>(null);
  const positionKey = enginePositionKey(game);
  const policyKey = JSON.stringify(policy);

  useEffect(() => () => { rival.current?.reset(); }, []);

  useEffect(() => {
    if (!active) { queueMicrotask(() => setState({ status: "idle" })); return; }
    if (paused) { queueMicrotask(() => setState({ status: "paused" })); return; }
    rival.current ??= new EngineRival(() => createDevEngineTransport(), DEV_ENGINE_OPTIONS);
    const controller = new AbortController();
    const snapshot = game;
    queueMicrotask(() => { if (!controller.signal.aborted) setState({ status: "thinking", startedAt: performance.now() }); });
    const attempt = async (left: number): Promise<EngineTurn> => {
      try { return await rival.current!.think(snapshot, policy, controller.signal); }
      catch (error) {
        // One automatic restart after a crash or timeout; a cancellation is never retried.
        if (left > 0 && !controller.signal.aborted && error instanceof EngineError && ["timeout", "transport", "closed"].includes(error.code)) return attempt(left - 1);
        throw error;
      }
    };
    void attempt(1).then(turn => {
      if (controller.signal.aborted || turn.positionKey !== enginePositionKey(snapshot)) return;
      setLastTurn(turn); setState({ status: "idle" });
      callback.current(turn, snapshot);
    }).catch(error => {
      if (controller.signal.aborted) return;
      setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    });
    return () => controller.abort();
    // The position key and policy key fully describe `game` and `policy` for this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, paused, positionKey, policyKey, retry]);

  return { state, lastTurn, retry: () => setRetry(n => n + 1) };
}
