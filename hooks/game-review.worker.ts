/// <reference lib="webworker" />
// Reviews recorded games off the main thread (KIF-032). One message per game, then "done".
import { reviewGame } from "../lib/shogi";

type Request = { token: number; games: { id: string; date: string; moves: string[] }[]; timeLimitMs: number };

self.onmessage = (event: MessageEvent<Request>) => {
  const { token, games, timeLimitMs } = event.data;
  for (const g of games) {
    const review = reviewGame(g.moves, "black", 3, undefined, { deadline: Date.now() + timeLimitMs });
    self.postMessage({ token, recordId: g.id, date: g.date, review });
  }
  self.postMessage({ token, done: true });
};
