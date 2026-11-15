import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { initialGame, legalMoves, playMove, toSfen, usi } from "../lib/shogi";
import { UsiAdapter, EngineError, analysisMove, enginePositionKey, parseInfo, positionCommand } from "../lib/engine/usi-adapter";
import type { EngineAnalysis, EngineCandidate, UsiTransport } from "../lib/engine/usi-adapter";
import { choosePolicyMove } from "../lib/engine/rival-policy";

class FakeTransport implements UsiTransport {
  sent: string[] = [];
  terminated = false;
  line: (line: string) => void = () => {};
  error: (error: Error) => void = () => {};
  subscribe(line: (line: string) => void, error: (error: Error) => void) {
    this.line = line; this.error = error;
    return () => { this.line = () => {}; this.error = () => {}; };
  }
  send(command: string) {
    this.sent.push(command);
    if (command === "usi") {
      this.line("id name Test engine");
      for (const key of ["Threads", "USI_Hash", "USI_MultiPV", "Use_NNUE"]) this.line(`option name ${key} type spin default 1 min 1 max 8`);
      this.line("usiok");
    }
    if (command === "isready") this.line("readyok");
  }
  terminate() { this.terminated = true; }
}

const candidate = (move: string, value: number, rank = 1): EngineCandidate => ({ move, score: { kind: "cp", value }, rank, depth: 8, pv: [move] });
const sample = (rows: EngineCandidate[], bestmove = "7g7f"): EngineAnalysis => {
  const game = initialGame();
  return { sfen: toSfen(game), positionKey: enginePositionKey(game), bestmove, candidates: rows, completed: true, elapsedMs: 10, requestedMs: 10 };
};

test("USI: synchronous handshake and options are received before commands return", async () => {
  const transport = new FakeTransport(), engine = new UsiAdapter(transport);
  await engine.initialize({ Threads: 1, Use_NNUE: false });
  assert.equal(engine.name, "Test engine");
  assert.ok(transport.sent.includes("setoption name Use_NNUE value false"));
  await assert.rejects(engine.analyze(initialGame(), { movetimeMs: 0 }), (e: EngineError) => e.code === "input");
  engine.close();
});

test("USI: choose a complete MultiPV depth and validate every returned variation", async () => {
  const t = new FakeTransport(), engine = new UsiAdapter(t);
  await engine.initialize();
  const pending = engine.analyze(initialGame(), { movetimeMs: 100, multiPv: 3 });
  t.line("info depth 5 multipv 1 score cp 90 nodes 1000 time 50 pv 7g7f 3c3d");
  t.line("info depth 5 multipv 2 score cp 30 nodes 1000 time 50 pv 2g2f 8c8d");
  t.line("info depth 5 multipv 3 score cp 10 nodes 1000 time 50 pv 5g5f 9a9i");
  t.line("info depth 6 multipv 1 score cp 900 pv 7g7f");
  t.line("bestmove 7g7f ponder 3c3d");
  const result = await pending;
  assert.deepEqual(result.candidates.map(c => [c.move, c.depth, c.score.value]), [["7g7f", 5, 90], ["2g2f", 5, 30]]);
  assert.ok(t.sent.includes("setoption name USI_MultiPV value 3"));
  assert.ok(t.sent.includes("position startpos"));
  assert.equal(usi(analysisMove(initialGame(), result)!), "7g7f");
  engine.close();
});

test("USI: parser distinguishes bounds, mate signs and malformed output", () => {
  assert.equal(parseInfo("info depth 3 score cp 20 lowerbound pv 7g7f"), undefined);
  assert.equal(parseInfo("info depth 3 score cp NaN pv 7g7f"), undefined);
  assert.equal(parseInfo("info depth 3 multipv 100 score cp 5 pv 7g7f"), undefined);
  assert.equal(parseInfo("info depth 3 score cp 20.5 pv 7g7f"), undefined);
  assert.equal(parseInfo("info depth 3.1 score cp 20 pv 7g7f"), undefined);
  assert.equal(parseInfo("info depth 3 multipv 1.5 score cp 20 pv 7g7f"), undefined);
  assert.equal(parseInfo("info string depth 3 score cp 20 pv 7g7f"), undefined);
  assert.deepEqual(parseInfo("info depth 4 score mate -3 pv 7g7f")?.score, { kind: "mate", value: -3 });
});

test("USI: illegal bestmove and invalid declaration cannot reach the board", async () => {
  for (const notation of ["7g7e", "win"]) {
    const t = new FakeTransport(), engine = new UsiAdapter(t);
    await engine.initialize();
    const promise = engine.analyze(initialGame());
    t.line(`bestmove ${notation}`);
    await assert.rejects(promise, (e: EngineError) => e.code === "protocol");
    assert.equal(t.terminated, true);
  }
});

test("USI: cancellation destroys the transport and discards delayed old output", async () => {
  const t = new FakeTransport(), engine = new UsiAdapter(t), controller = new AbortController();
  await engine.initialize();
  const promise = engine.analyze(initialGame(), { signal: controller.signal });
  await assert.rejects(engine.analyze(initialGame()), (e: EngineError) => e.code === "busy");
  controller.abort();
  t.line("bestmove 7g7f");
  await assert.rejects(promise, (e: EngineError) => e.code === "cancelled");
  assert.equal(t.terminated, true);
  await assert.rejects(engine.analyze(initialGame()), (e: EngineError) => e.code === "closed");
});

test("USI: time budget and worker failures settle the request and terminate", async () => {
  const timed = new FakeTransport(), a = new UsiAdapter(timed, 10);
  await a.initialize();
  await assert.rejects(a.analyze(initialGame(), { movetimeMs: 1 }), (e: EngineError) => e.code === "timeout");
  assert.equal(timed.terminated, true);
  const failed = new FakeTransport(), b = new UsiAdapter(failed);
  await b.initialize();
  const pending = b.analyze(initialGame());
  failed.error(new Error("worker crashed"));
  await assert.rejects(pending, (e: EngineError) => e.code === "transport");
  assert.equal(failed.terminated, true);
});

test("USI: normal games preserve move history and stale histories are rejected", () => {
  const initial = initialGame();
  const game = playMove(initial, legalMoves(initial).find(m => usi(m) === "7g7f")!);
  assert.equal(positionCommand(game), "position startpos moves 7g7f");
  const result = sample([candidate("7g7f", 100)]);
  const different = { ...initial, positionLog: [{ key: "different repetition state", check: false }] };
  assert.throws(() => analysisMove(different, result), (e: EngineError) => e.code === "input");
  assert.throws(() => choosePolicyMove(different, result, { strength: "strong", style: "balanced", seed: 1 }), (e: EngineError) => e.code === "input");
});

test("USI: custom starting positions include the required SFEN move-number field", () => {
  const initial = initialGame();
  const played = playMove(initial, legalMoves(initial).find(m => usi(m) === "7g7f")!);
  const custom = { ...played, history: [] };
  assert.equal(positionCommand(custom), `position sfen ${toSfen(custom, 1)}`);
});

test("policy: adaptive profiles preserve mate scores and avoid negative mates with cp candidates", () => {
  const mate = { ...candidate("2g2f", 1, 2), score: { kind: "mate" as const, value: 3 } };
  for (const strength of ["balanced", "practice"] as const) {
    assert.equal(choosePolicyMove(initialGame(), sample([candidate("7g7f", 10), mate]), { strength, style: "solid", seed: 123 })?.notation, "2g2f");
    const losing = { ...candidate("2g2f", 1, 2), score: { kind: "mate" as const, value: -3 } };
    assert.equal(choosePolicyMove(initialGame(), sample([candidate("7g7f", 10), losing]), { strength, style: "active", seed: 123 })?.notation, "7g7f");
    assert.equal(choosePolicyMove(initialGame(), sample([candidate("7g7f", 10), losing], "2g2f"), { strength, style: "active", seed: 123 })?.notation, "7g7f");
  }
});

test("policy: candidate score budgets and seeded choices stay deterministic", () => {
  const game = initialGame(), result = sample([candidate("7g7f", 100), candidate("2g2f", 60, 2), candidate("5g5f", -200, 3)]);
  for (let seed = 1; seed <= 20; seed++) {
    const config = { strength: "practice" as const, style: "balanced" as const, seed };
    const choice = choosePolicyMove(game, result, config)!;
    assert.notEqual(choice.notation, "5g5f");
    assert.ok((choice.lossCp ?? 0) <= 180);
    assert.deepEqual(choice, choosePolicyMove(game, result, config));
  }
  assert.equal(choosePolicyMove(game, result, { strength: "strong", style: "active", seed: 1 })?.notation, "7g7f");
});

test("browser probe: a worker failure is followed by a fresh successful worker", async () => {
  type Event = { data?: { line: string }; message?: string };
  class TestWorker {
    static created: TestWorker[] = [];
    terminated = false;
    listeners = new Map<string, Set<(event: Event) => void>>();
    constructor() { TestWorker.created.push(this); }
    addEventListener(kind: string, callback: (event: Event) => void) {
      const listeners = this.listeners.get(kind) ?? new Set(); listeners.add(callback); this.listeners.set(kind, listeners);
    }
    removeEventListener(kind: string, callback: (event: Event) => void) { this.listeners.get(kind)?.delete(callback); }
    emit(kind: string, event: Event) { for (const listener of this.listeners.get(kind) ?? []) listener(event); }
    postMessage(command: string) {
      queueMicrotask(() => {
        if (this.terminated) return;
        const line = (line: string) => this.emit("message", { data: { line } });
        if (command === "usi") {
          for (const name of ["Threads", "USI_Hash", "USI_MultiPV", "Use_NNUE", "USI_Variant"]) line(`option name ${name} type string default test`);
          line("usiok");
        } else if (command === "isready") line("readyok");
        else if (command.startsWith("go ")) {
          if (TestWorker.created[0] === this) this.emit("error", { message: "synthetic worker failure" });
          else {
            ["7g7f", "2g2f", "5g5f"].forEach((move, i) => line(`info depth 1 multipv ${i + 1} score cp ${30 - i} pv ${move}`));
            line("bestmove 7g7f");
          }
        }
      });
    }
    terminate() { this.terminated = true; }
  }
  const elements = new Map(["pre", "#status", "#stop", "#tap", "#taps"].map(name => [name, { textContent: "", onclick: undefined }]));
  const window: { kiyuEngineProbe?: { probe(ms: number): Promise<EngineAnalysis>; cancel(): void } } = {};
  const script = execFileSync(resolve("node_modules/.bin/esbuild"), ["tests/engine-bench/prototype-browser.ts", "--bundle", "--platform=browser", "--format=iife", "--log-level=error"], { encoding: "utf8" });
  runInNewContext(script, { window, document: { querySelector: (name: string) => elements.get(name), querySelectorAll: () => [] },
    Worker: TestWorker, navigator: { userAgent: "unit-test" }, crossOriginIsolated: true, SharedArrayBuffer,
    AbortController, performance, structuredClone, setTimeout, clearTimeout });
  const probe = window.kiyuEngineProbe!;
  try {
    await assert.rejects(probe.probe(100), (error: EngineError) => error.code === "transport");
    assert.equal(TestWorker.created[0].terminated, true);
    const result = await probe.probe(100);
    assert.equal(TestWorker.created.length, 2);
    assert.equal(result.bestmove, "7g7f");
    assert.equal(result.candidates.length, 3);
  } finally { probe.cancel(); }
});
