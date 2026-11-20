import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { initialGame, legalMoves, playMove, toSfen, usi } from "../lib/shogi";
import { MAX_SEARCH_NODES, UsiAdapter, EngineError, analysisMove, enginePositionKey, parseInfo, positionCommand } from "../lib/engine/usi-adapter";
import type { EngineAnalysis, EngineCandidate, UsiTransport } from "../lib/engine/usi-adapter";
import { STRENGTH_PROFILES, choosePolicyMove, decideRivalAction } from "../lib/engine/rival-policy";

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
const sample = (rows: EngineCandidate[], bestmove = "7g7f", game = initialGame()): EngineAnalysis => {
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

test("USI: a node budget is sent with the time cap and validated before searching", async () => {
  const t = new FakeTransport(), engine = new UsiAdapter(t);
  await engine.initialize();
  for (const nodes of [0, 1.5, MAX_SEARCH_NODES + 1]) {
    await assert.rejects(engine.analyze(initialGame(), { nodes, movetimeMs: 100, multiPv: 1 }), (e: EngineError) => e.code === "input");
  }
  assert.equal(t.sent.some(c => c.startsWith("go ")), false);
  const pending = engine.analyze(initialGame(), { nodes: 5000, movetimeMs: 200, multiPv: 1 });
  assert.ok(t.sent.includes("go nodes 5000 movetime 200"));
  t.line("info depth 7 score cp 40 nodes 5001 time 12 pv 7g7f");
  t.line("bestmove 7g7f");
  const result = await pending;
  assert.equal(result.requestedNodes, 5000);
  assert.equal(result.requestedMs, 200);
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
  assert.throws(() => choosePolicyMove(different, result, { strength: "strong", style: "balanced" }), (e: EngineError) => e.code === "input");
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
    assert.equal(choosePolicyMove(initialGame(), sample([candidate("7g7f", 10), mate]), { strength, style: "solid" })?.notation, "2g2f");
    const losing = { ...candidate("2g2f", 1, 2), score: { kind: "mate" as const, value: -3 } };
    assert.equal(choosePolicyMove(initialGame(), sample([candidate("7g7f", 10), losing]), { strength, style: "active" })?.notation, "7g7f");
    assert.equal(choosePolicyMove(initialGame(), sample([candidate("7g7f", 10), losing], "2g2f"), { strength, style: "active" })?.notation, "7g7f");
  }
});

test("policy: no randomness; tolerance, close-game lead, style and purpose are deterministic", () => {
  const game = initialGame(), result = sample([candidate("7g7f", 100), candidate("2g2f", 60, 2), candidate("5g5f", -200, 3)]);
  for (const strength of ["strong", "balanced", "practice"] as const) for (const style of ["balanced", "active", "solid"] as const) {
    const config = { strength, style };
    const choice = choosePolicyMove(game, result, config)!;
    assert.notEqual(choice.notation, "5g5f");
    assert.ok((choice.lossCp ?? 0) <= STRENGTH_PROFILES[strength].toleranceCp);
    assert.deepEqual(choice, choosePolicyMove(game, result, config));
  }
  // Level or behind: the best candidate is chosen; weaker settings read less instead of erring on purpose.
  for (const strength of ["strong", "balanced", "practice"] as const) {
    assert.equal(choosePolicyMove(game, result, { strength, style: "balanced" })?.notation, "7g7f");
  }
  // Far ahead in a close game: prefer a move that leaves nothing to be taken (inside the tolerance);
  // the margin itself is not lowered on purpose.
  const opened = playMove(game, legalMoves(game).find(m => usi(m) === "7g7f")!);
  const reply = playMove(opened, legalMoves(opened).find(m => usi(m) === "3c3d")!);
  const ahead = sample([candidate("8h2b+", 600), candidate("2g2f", 580, 2), candidate("5g5f", 400, 3)], "8h2b+", reply);
  const eased = choosePolicyMove(reply, ahead, { strength: "practice", style: "balanced" })!;
  assert.equal(eased.notation, "2g2f");
  assert.match(eased.reason, /駒を取られない落ち着いた候補/);
  // The calm preference never reaches outside the tolerance or toward a lower margin by itself.
  const calmFar = sample([candidate("8h2b+", 600), candidate("2g2f", 500, 2)], "8h2b+", reply);
  assert.equal(choosePolicyMove(reply, calmFar, { strength: "practice", style: "balanced" })?.notation, "8h2b+");
  const level = sample([candidate("7g7f", 600), candidate("2g2f", 580, 2), candidate("5g5f", 560, 3)]);
  assert.equal(choosePolicyMove(game, level, { strength: "practice", style: "balanced" })?.notation, "7g7f");
  // Easing never hands back the lead, even when a candidate inside the tolerance would.
  const narrow = sample([candidate("7g7f", 320), candidate("2g2f", 270, 2)]);
  assert.equal(choosePolicyMove(game, narrow, { strength: "practice", style: "balanced" })?.notation, "7g7f");
  // Purpose "win" disables easing.
  assert.equal(choosePolicyMove(reply, ahead, { strength: "practice", style: "balanced", purpose: "win" })?.notation, "8h2b+");
  // A large gap to the second candidate is treated as a forced move.
  const forced = sample([candidate("7g7f", 400), candidate("2g2f", 100, 2)]);
  assert.equal(choosePolicyMove(game, forced, { strength: "practice", style: "active" })?.notation, "7g7f");
});

test("policy: style never widens the strength's tolerance and strength never depends on style", () => {
  // From the start, 7g7f opens the bishop and 2g2f does not capture; give a capture-like bonus no room.
  const opened = playMove(initialGame(), legalMoves(initialGame()).find(m => usi(m) === "7g7f")!);
  const reply = playMove(opened, legalMoves(opened).find(m => usi(m) === "3c3d")!);
  const capture = "8h2b+", quiet = "2g2f";
  for (const strength of ["strong", "balanced", "practice"] as const) {
    const tolerance = STRENGTH_PROFILES[strength].toleranceCp;
    // The capture is just outside the tolerance: no style may pick it.
    const outside = sample([candidate(quiet, 100), candidate(capture, 100 - tolerance - 1, 2)], quiet, reply);
    for (const style of ["balanced", "active", "solid"] as const) {
      assert.equal(choosePolicyMove(reply, outside, { strength, style, purpose: "win" })?.notation, quiet);
    }
    // Inside the tolerance the attacking style prefers the capture; the natural style keeps the best.
    const within = sample([candidate(quiet, 100), candidate(capture, 100 - Math.min(tolerance, 10), 2)], quiet, reply);
    assert.equal(choosePolicyMove(reply, within, { strength, style: "active", purpose: "win" })?.notation, capture);
    assert.equal(choosePolicyMove(reply, within, { strength, style: "balanced", purpose: "win" })?.notation, quiet);
  }
  // Reading depth is set by strength alone.
  assert.ok(STRENGTH_PROFILES.strong.nodes > STRENGTH_PROFILES.balanced.nodes && STRENGTH_PROFILES.balanced.nodes > STRENGTH_PROFILES.practice.nodes);
});

test("policy: resignation depends on purpose; engine 'win' becomes a declaration", () => {
  const game = initialGame();
  const lost = { ...sample([{ ...candidate("7g7f", 0), score: { kind: "mate" as const, value: -1 } }]) };
  assert.equal(decideRivalAction(game, lost, { strength: "strong", style: "balanced" }).kind, "resign");
  assert.equal(decideRivalAction(game, lost, { strength: "strong", style: "balanced", purpose: "finish-practice" }).kind, "move");
  const resigned = { ...sample([candidate("7g7f", -3000)]), bestmove: "resign" };
  assert.equal(decideRivalAction(game, resigned, { strength: "practice", style: "balanced" }).kind, "resign");
  const kept = decideRivalAction(game, resigned, { strength: "practice", style: "balanced", purpose: "finish-practice" });
  assert.equal(kept.kind === "move" && kept.choice.notation, "7g7f");
  assert.equal(decideRivalAction(game, { ...sample([]), bestmove: "win" }, { strength: "strong", style: "balanced" }).kind, "declare");
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
