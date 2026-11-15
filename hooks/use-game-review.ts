"use client";
import { useEffect, useState } from "react";
import type { DeclarationRule, GameReview } from "../lib/shogi";
// Vite builds the worker as its own bundle and returns a constructor. (new URL(..., import.meta.url)
// does not work here: vinext rewrites import.meta.url to a file: URL in client modules.)
import ReviewWorker from "./game-review.worker.ts?worker";

export type ReviewedGame = { recordId: string; date: string; review: GameReview };
export type ReviewStatus = "idle" | "running" | "done" | "unavailable";

/** Per-game time budget in the worker. A game that exceeds it is reported as incomplete. */
const TIME_LIMIT_MS = 15000;

/**
 * Review the given games in a Web Worker so the screen stays usable however long a search
 * takes. When the games change, the old worker is terminated and its messages (old token)
 * are ignored, so results of different inputs never mix. Without Worker support nothing is
 * analysed on the main thread; the status is "unavailable" instead.
 */
export function useGameReview(games: { id: string; date: string; moves: string[]; startSfen?: string; declarationRule?: DeclarationRule }[]) {
  const [state, setState] = useState<{ key: string; status: ReviewStatus; results: ReviewedGame[] }>({ key: "", status: "idle", results: [] });
  // Restored records may keep their ID and number of plies while their moves change.
  const key = JSON.stringify(games);
  const hasGames = games.length > 0;

  useEffect(() => {
    if (!hasGames) return;
    let active = true;
    let worker: Worker;
    try {
      worker = new ReviewWorker();
    } catch {
      queueMicrotask(() => { if (active) setState({ key, status: "unavailable", results: [] }); });
      return () => { active = false; };
    }
    const token = Date.now() + Math.random();
    const results: ReviewedGame[] = [];
    queueMicrotask(() => { if (active) setState({ key, status: "running", results: [] }); });
    worker.onmessage = (event: MessageEvent<{ token: number; done?: boolean } & ReviewedGame>) => {
      if (!active || event.data.token !== token) return; // stale message from an earlier input
      if (event.data.done) { setState({ key, status: "done", results: [...results] }); worker.terminate(); return; }
      results.push({ recordId: event.data.recordId, date: event.data.date, review: event.data.review });
      setState({ key, status: "running", results: [...results] });
    };
    worker.onerror = () => { if (active) setState({ key, status: "unavailable", results: [...results] }); worker.terminate(); };
    worker.postMessage({ token, games, timeLimitMs: TIME_LIMIT_MS });
    return () => { active = false; worker.terminate(); };
    // `games` is captured through `key`; re-running on identity changes would restart the work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, hasGames]);

  // Results computed for a different input are never shown.
  return state.key === key ? state : { key, status: (hasGames ? "running" : "idle") as ReviewStatus, results: [] };
}
