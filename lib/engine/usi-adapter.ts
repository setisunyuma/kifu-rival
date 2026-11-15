import { checkDeclaration, initialGame, legalMoves, playMove, toSfen, usi, validatePosition } from "../shogi";
import type { Game, Move } from "../shogi";

/** A transport owns one isolated engine. Cancellation destroys that engine. */
export interface UsiTransport {
  send(command: string): void;
  subscribe(line: (text: string) => void, error: (error: Error) => void): () => void;
  terminate(): void;
}

export type EngineScore = { kind: "cp" | "mate"; value: number };
export type EngineCandidate = {
  move: string; score: EngineScore; depth: number; rank: number;
  pv: string[]; nodes?: number; engineMs?: number;
};
export type EngineAnalysis = {
  sfen: string; positionKey: string; bestmove: string; candidates: EngineCandidate[];
  elapsedMs: number; requestedMs: number; completed: true;
};

/** Includes repetition history and the declaration rule, which SFEN alone cannot express. */
export function enginePositionKey(game: Game): string {
  return JSON.stringify([toSfen(game), game.history.map(usi), game.positionLog ?? [], game.declarationRule ?? "jsa"]);
}

/** Preserve a normal game's move history; custom starting positions use their current SFEN. */
export function positionCommand(game: Game): string {
  const current = `position sfen ${toSfen(game, game.history.length + 1)}`;
  let replay = initialGame(game.declarationRule);
  for (const recorded of game.history) {
    if (replay.result !== "playing") return current;
    const move = legalMoves(replay).find(candidate => usi(candidate) === usi(recorded));
    if (!move) return current;
    replay = playMove(replay, move);
  }
  if (toSfen(replay) === toSfen(game)) return `position startpos${game.history.length ? ` moves ${game.history.map(usi).join(" ")}` : ""}`;
  return current;
}
export type EngineErrorCode = "closed" | "busy" | "not-ready" | "input" | "timeout" | "cancelled" | "protocol" | "transport";
export class EngineError extends Error {
  constructor(public readonly code: EngineErrorCode, message: string) { super(message); this.name = "EngineError"; }
}

/** Parse exact, finite scores only. Bounds are not interchangeable with estimates. */
export function parseInfo(line: string): EngineCandidate | undefined {
  if (!line.startsWith("info ") || line.startsWith("info string ") || /\b(?:lowerbound|upperbound)\b/.test(line)) return;
  const score = line.match(/\bscore (cp|mate) (-?\d+)(?=\s|$)/);
  const depth = line.match(/\bdepth (\d+)(?=\s|$)/);
  const pv = line.match(/\bpv (.+)$/)?.[1].trim().split(/\s+/);
  if (!score || !depth || !pv?.length || pv.length > 256) return;
  const value = Number(score[2]), d = Number(depth[1]);
  const rankMatch = line.match(/\bmultipv (\d+)(?=\s|$)/);
  if (/\bmultipv\b/.test(line) && !rankMatch) return;
  const rank = Number(rankMatch?.[1] ?? 1);
  if (![value, d, rank].every(Number.isSafeInteger) || rank < 1 || rank > 8) return;
  const numeric = (key: string) => {
    const x = line.match(new RegExp(`\\b${key} (\\d+)(?=\\s|$)`));
    const n = x ? Number(x[1]) : undefined;
    return n !== undefined && Number.isSafeInteger(n) ? n : undefined;
  };
  return { move: pv[0], score: { kind: score[1] as EngineScore["kind"], value }, depth: d, rank,
    pv, nodes: numeric("nodes"), engineMs: numeric("time") };
}

function validPv(game: Game, pv: string[]): boolean {
  let current = game;
  for (const notation of pv) {
    if (current.result !== "playing") return false;
    const move = legalMoves(current).find(m => usi(m) === notation);
    if (!move) return false;
    current = playMove(current, move);
  }
  return true;
}

/** No DOM, Node or third-party engine code: usable with a Worker or process transport. */
export class UsiAdapter {
  private closed = false;
  private ready = false;
  private busy = false;
  private lineHandler?: (line: string) => void;
  private rejectPending?: (error: EngineError) => void;
  private readonly unsubscribe: () => void;
  readonly options = new Set<string>();
  name = "unknown";

  constructor(private readonly transport: UsiTransport, private readonly graceMs = 1000) {
    this.unsubscribe = transport.subscribe(line => this.onLine(line), error => this.fail(new EngineError("transport", error.message)));
  }

  private onLine(line: string) {
    if (this.closed || line.length > 65536) return;
    const option = line.match(/^option name (.+) type /);
    if (option) this.options.add(option[1]);
    if (line.startsWith("id name ")) this.name = line.slice(8);
    this.lineHandler?.(line.trim());
  }

  private assertOpen() {
    if (this.closed) throw new EngineError("closed", "エンジンは終了しています。新しく起動してください。");
  }

  private fail(error: EngineError) {
    if (this.closed) return;
    const reject = this.rejectPending;
    this.closed = true; this.ready = false;
    this.lineHandler = undefined; this.rejectPending = undefined;
    this.unsubscribe?.(); this.transport.terminate(); reject?.(error);
  }

  close() { this.fail(new EngineError("cancelled", "解析を中断しました。")); }

  private waitFor(command: string, answer: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const finish = (error?: EngineError) => {
        clearTimeout(timer); this.lineHandler = undefined; this.rejectPending = undefined;
        if (error) reject(error); else resolve();
      };
      const timer = setTimeout(() => this.fail(new EngineError("timeout", "エンジンの起動が時間内に完了しませんでした。")), timeoutMs);
      this.rejectPending = finish;
      this.lineHandler = line => { if (line === answer) finish(); };
      try { this.transport.send(command); }
      catch (error) { this.fail(new EngineError("transport", String(error))); }
    });
  }

  async initialize(options: Record<string, string | number | boolean> = {}, timeoutMs = 10000): Promise<void> {
    this.assertOpen();
    if (this.busy) throw new EngineError("busy", "エンジンは処理中です。");
    if (this.ready) return;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new EngineError("input", "起動時間の上限が不正です。");
    for (const [key, value] of Object.entries(options)) {
      if (!key || /[\r\n]/.test(key + value)) throw new EngineError("input", "エンジン設定が不正です。");
    }
    this.busy = true;
    try {
      await this.waitFor("usi", "usiok", timeoutMs);
      this.assertOpen();
      for (const [key, value] of Object.entries(options)) {
        if (!this.options.has(key)) throw new EngineError("input", `エンジンが設定「${key}」に対応していません。`);
        this.transport.send(`setoption name ${key} value ${value}`);
      }
      await this.waitFor("isready", "readyok", timeoutMs);
      this.assertOpen(); this.ready = true;
    } catch (error) {
      this.fail(error instanceof EngineError ? error : new EngineError("transport", String(error)));
      throw error;
    } finally { this.busy = false; }
  }

  async analyze(game: Game, { movetimeMs = 100, multiPv = 3, signal }: { movetimeMs?: number; multiPv?: number; signal?: AbortSignal } = {}): Promise<EngineAnalysis> {
    this.assertOpen();
    if (!this.ready) throw new EngineError("not-ready", "先にエンジンを起動してください。");
    if (this.busy) throw new EngineError("busy", "前の解析が終わるまで次の解析を開始できません。");
    if (!Number.isInteger(movetimeMs) || movetimeMs < 1 || movetimeMs > 10000 || !Number.isInteger(multiPv) || multiPv < 1 || multiPv > 8) {
      throw new EngineError("input", "思考時間または候補手数が範囲外です。");
    }
    if (signal?.aborted) throw new EngineError("cancelled", "解析開始前に中断されました。");
    if (game.result !== "playing" || validatePosition(game).length) throw new EngineError("input", "解析できる対局中の局面ではありません。");
    const legal = legalMoves(game), allowed = new Map(legal.map(m => [usi(m), m]));
    const expected = Math.min(multiPv, allowed.size);
    if (!expected) throw new EngineError("input", "合法手がありません。");
    // Snapshot: callers changing their state cannot change validation during the search.
    const snapshot = structuredClone(game), sfen = toSfen(snapshot), positionKey = enginePositionKey(snapshot), started = performance.now();
    const iterations = new Map<number, Map<number, EngineCandidate>>();
    this.busy = true;
    try {
      return await new Promise<EngineAnalysis>((resolve, reject) => {
        const abort = () => this.fail(new EngineError("cancelled", "解析を中断しました。"));
        const finish = (error?: EngineError, analysis?: EngineAnalysis) => {
          clearTimeout(timer); signal?.removeEventListener("abort", abort);
          this.lineHandler = undefined; this.rejectPending = undefined;
          if (error) reject(error); else resolve(analysis!);
        };
        const timer = setTimeout(() => this.fail(new EngineError("timeout", "思考時間の上限を超えたためエンジンを終了しました。")), movetimeMs + this.graceMs);
        this.rejectPending = error => finish(error);
        signal?.addEventListener("abort", abort, { once: true });
        this.lineHandler = line => {
          const info = parseInfo(line);
          if (info && allowed.has(info.move) && info.rank <= expected) {
            const iteration = iterations.get(info.depth) ?? new Map<number, EngineCandidate>();
            iteration.set(info.rank, info); iterations.set(info.depth, iteration);
            // Search output is untrusted and bounded independently of the engine.
            if (iterations.size > 16) iterations.delete(Math.min(...iterations.keys()));
          }
          if (!line.startsWith("bestmove ")) return;
          const bestmove = line.split(/\s+/)[1];
          if (bestmove !== "resign" && !allowed.has(bestmove) && !(bestmove === "win" && checkDeclaration(snapshot).outcome === "win")) {
            this.fail(new EngineError("protocol", `エンジンが不正な指し手を返しました: ${bestmove}`)); return;
          }
          const complete = [...iterations.entries()].filter(([, rows]) =>
            rows.size === expected && new Set([...rows.values()].map(c => c.move)).size === expected);
          const rows = complete.sort((a, b) => b[0] - a[0])[0]?.[1];
          const candidates = rows ? [...rows.values()].sort((a, b) => a.rank - b.rank).filter(c => validPv(snapshot, c.pv)) : [];
          finish(undefined, { sfen, positionKey, bestmove, candidates, completed: true, requestedMs: movetimeMs, elapsedMs: performance.now() - started });
        };
        try {
          const option = this.options.has("USI_MultiPV") ? "USI_MultiPV" : this.options.has("MultiPV") ? "MultiPV" : undefined;
          if (!option && multiPv > 1) throw new EngineError("input", "このエンジンは複数候補に対応していません。");
          if (option) this.transport.send(`setoption name ${option} value ${multiPv}`);
          this.transport.send("usinewgame");
          this.transport.send(positionCommand(snapshot));
          this.transport.send(`go movetime ${movetimeMs}`);
        } catch (error) { this.fail(error instanceof EngineError ? error : new EngineError("transport", String(error))); }
      });
    } finally { this.busy = false; }
  }
}

/** Translate only a move validated against the exact position that was analysed. */
export function analysisMove(game: Game, analysis: EngineAnalysis): Move | undefined {
  if (enginePositionKey(game) !== analysis.positionKey) throw new EngineError("input", "解析後に局面が変わりました。");
  return legalMoves(game).find(move => usi(move) === analysis.bestmove);
}
