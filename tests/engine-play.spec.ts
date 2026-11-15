import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initialGame, legalMoves, playMove, usi } from "../lib/shogi";
import { EngineRival } from "../lib/engine/engine-rival";
import { EngineError } from "../lib/engine/usi-adapter";
import type { UsiTransport } from "../lib/engine/usi-adapter";
import { probeDevEngine } from "../lib/engine/browser-engine";
import { parseEngineSettings, parseStoredEngineSettings, DEFAULT_ENGINE_SETTINGS } from "../hooks/use-engine-rival";
import { resolveEngineDirectory, engineManifest } from "../scripts/vite/engine-dev-plugin.mjs";

/** Answers every `go` with the given candidate lines; optionally crashes on the first search. */
class ScriptedTransport implements UsiTransport {
  static created = 0;
  sent: string[] = []; terminated = false;
  line: (line: string) => void = () => {}; error: (e: Error) => void = () => {};
  constructor(private lines: (moves: string) => string[], private crash = false) { ScriptedTransport.created++; }
  subscribe(line: (l: string) => void, error: (e: Error) => void) { this.line = line; this.error = error; return () => {}; }
  send(command: string) {
    this.sent.push(command);
    queueMicrotask(() => {
      if (this.terminated) return;
      if (command === "usi") { for (const k of ["Threads", "USI_Hash", "USI_MultiPV", "Use_NNUE", "USI_Variant"]) this.line(`option name ${k} type string default x`); this.line("usiok"); }
      else if (command === "isready") this.line("readyok");
      else if (command.startsWith("go ")) {
        if (this.crash) { this.error(new Error("synthetic crash")); return; }
        const position = this.sent.filter(c => c.startsWith("position")).at(-1)!;
        for (const l of this.lines(position)) this.line(l);
      }
    });
  }
  terminate() { this.terminated = true; }
}

const opening = () => ["info depth 6 multipv 1 score cp 40 pv 7g7f", "info depth 6 multipv 2 score cp 30 pv 2g2f", "info depth 6 multipv 3 score cp 10 pv 5g5f", "bestmove 7g7f"];

test("engine rival: one turn = start engine, search with the strength's time, apply the policy", async () => {
  let transport!: ScriptedTransport;
  const rival = new EngineRival(() => (transport = new ScriptedTransport(opening)), { Threads: 1 });
  const turn = await rival.think(initialGame(), { strength: "practice", style: "balanced" });
  assert.equal(turn.decision.kind, "move");
  assert.ok(transport.sent.includes("go movetime 300"));
  assert.ok(transport.sent.includes("setoption name USI_MultiPV value 5"));
  assert.ok(turn.startupMs !== undefined);
  // The second turn reuses the running engine (no new startup).
  const next = await rival.think(initialGame(), { strength: "strong", style: "balanced" });
  assert.equal(next.startupMs, undefined);
  assert.ok(transport.sent.includes("go movetime 1000"));
});

test("engine rival: a crash or cancellation discards the engine and the next turn starts a fresh one", async () => {
  ScriptedTransport.created = 0;
  let crash = true;
  const rival = new EngineRival(() => new ScriptedTransport(opening, crash), {});
  await assert.rejects(rival.think(initialGame(), { strength: "strong", style: "balanced" }), (e: EngineError) => e.code === "transport");
  crash = false;
  const turn = await rival.think(initialGame(), { strength: "strong", style: "balanced" });
  assert.equal(turn.decision.kind === "move" && turn.decision.choice.notation, "7g7f");
  assert.equal(ScriptedTransport.created, 2);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(rival.think(initialGame(), { strength: "strong", style: "balanced" }, controller.signal), (e: EngineError) => e.code === "cancelled");
});

test("engine rival: an illegal engine move is rejected, never played", async () => {
  const rival = new EngineRival(() => new ScriptedTransport(() => ["info depth 3 score cp 0 pv 7g7f", "bestmove 5a5b"]), {});
  await assert.rejects(rival.think(initialGame(), { strength: "strong", style: "balanced" }), (e: EngineError) => e.code === "protocol");
});

test("engine rival: the turn carries the exact position key (repetition history included)", async () => {
  const rival = new EngineRival(() => new ScriptedTransport(() => ["info depth 3 multipv 1 score cp 0 pv 3c3d", "info depth 3 multipv 2 score cp -5 pv 8c8d", "info depth 3 multipv 3 score cp -9 pv 4c4d", "bestmove 3c3d"]), {});
  const g = playMove(initialGame(), legalMoves(initialGame()).find(m => usi(m) === "7g7f")!);
  const turn = await rival.think(g, { strength: "balanced", style: "solid" });
  const other = { ...g, positionLog: [{ key: "other", check: false }] };
  assert.notEqual(turn.positionKey, (await rival.think(other, { strength: "balanced", style: "solid" })).positionKey);
});

test("browser engine probe: absent route, bad manifest and missing isolation are reported, not used", async () => {
  const env = { crossOriginIsolated: true, hasSharedArrayBuffer: true, hasWorker: true };
  const manifest = { name: "x", version: "1", license: "GPL-3.0", wasmBytes: 10, wasmSha256: "a".repeat(64), development: true };
  const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  assert.equal((await probeDevEngine(respond(404, {}), undefined, env)).status, "unavailable");
  assert.equal((await probeDevEngine(respond(200, { ...manifest, development: false }), undefined, env)).status, "unavailable");
  assert.equal((await probeDevEngine(respond(200, manifest), undefined, { ...env, crossOriginIsolated: false })).status, "unavailable");
  const ok = await probeDevEngine(respond(200, manifest), undefined, env);
  assert.equal(ok.status, "available");
  const thrown = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
  assert.equal((await probeDevEngine(thrown, undefined, env)).status, "unavailable");
});

test("engine settings: unknown or damaged values fall back to defaults; match defaults to next", () => {
  assert.deepEqual(parseEngineSettings("{bad"), DEFAULT_ENGINE_SETTINGS);
  assert.deepEqual(parseEngineSettings(JSON.stringify({ opponent: "engine", strength: "godlike", style: "solid" })),
    { ...DEFAULT_ENGINE_SETTINGS, opponent: "engine", style: "solid" });
  const stored = parseStoredEngineSettings(JSON.stringify({ next: { opponent: "engine", strength: "strong" } }));
  assert.deepEqual(stored.match, stored.next);
  assert.equal(stored.next.strength, "strong");
});

test("dev engine plugin: refuses an engine directory inside the repository, accepts one outside", () => {
  assert.throws(() => resolveEngineDirectory(resolve("tests"), process.cwd()), /outside the repository/);
  const dir = mkdtempSync(join(tmpdir(), "kiyu-engine-"));
  try {
    for (const name of ["stockfish.js", "stockfish.worker.js", "Copying.txt", "AUTHORS"]) writeFileSync(join(dir, name), "x");
    writeFileSync(join(dir, "stockfish.wasm"), Buffer.from([0, 97, 115, 109]));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "synthetic", version: "0.0.1", license: "GPL-3.0" }));
    const engine = resolveEngineDirectory(dir, process.cwd());
    const manifest = engineManifest(engine);
    assert.equal(manifest.development, true);
    assert.equal(manifest.wasmBytes, 4);
    mkdirSync(join(dir, "empty"));
    assert.throws(() => resolveEngineDirectory(join(dir, "empty"), process.cwd()));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
