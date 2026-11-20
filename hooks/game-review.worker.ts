/// <reference lib="webworker" />
// Reviews recorded games off the main thread (KIF-032). One message per game, then "done".
import { fromSfen, initialGame, reviewGame, type DeclarationRule } from "../lib/shogi";

type Request = { token: number; games: { id: string; date: string; moves: string[]; startSfen?: string; declarationRule?: DeclarationRule }[]; timeLimitMs: number };

self.onmessage = (event: MessageEvent<Request>) => {
  const { token, games, timeLimitMs } = event.data;
  for (const g of games) {
    const start = g.startSfen ? { ...fromSfen(g.startSfen), declarationRule: g.declarationRule ?? "jsa" } : initialGame(g.declarationRule);
    const review = reviewGame(g.moves, "black", 3, start, { deadline: Date.now() + timeLimitMs });
    self.postMessage({ token, recordId: g.id, date: g.date, review });
  }
  self.postMessage({ token, done: true });
};
