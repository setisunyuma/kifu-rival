// Own harness. KIFU_FAIRY_WASM_DIR points to an unpacked engine outside this repository.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { wasmTransport } from "./wasm-transport.mjs";

const root = resolve(import.meta.dirname, "../..");
if (!process.env.KIFU_FAIRY_WASM_DIR) throw new Error("Set KIFU_FAIRY_WASM_DIR to the unpacked package outside the repository");
const engineDirectory = realpathSync(process.env.KIFU_FAIRY_WASM_DIR);
const relativeEngine = relative(root, engineDirectory);
if (!isAbsolute(relativeEngine) && relativeEngine.split(sep)[0] !== "..") throw new Error("Third-party engine must remain outside the repository");
const out = resolve(root, ".sites-runtime/engine-prototype"); mkdirSync(out, { recursive: true });
await build({ stdin: { contents: 'export * from "./lib/shogi"; export * from "./lib/engine/usi-adapter"; export * from "./lib/engine/rival-policy";', resolveDir: root, sourcefile: "prototype.ts", loader: "ts" },
  bundle: true, platform: "node", format: "esm", outfile: resolve(out, "runtime.mjs"), logLevel: "warning" });
const { UsiAdapter, initialGame, legalMoves, playMove, usi, chooseRivalMove, choosePolicyMove, toSfen } = await import(resolve(out, "runtime.mjs"));
const numberArg = (flag, fallback) => {
  const i = process.argv.indexOf(flag), n = i < 0 ? fallback : Number(process.argv[i + 1]);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`Invalid ${flag}`); return n;
};
const games = Math.min(numberArg("--games", 6), 24), movetimeMs = Math.min(numberArg("--movetime", 100), 1000), multiPv = 3;
const openings = [[], ["7g7f", "3c3d"], ["2g2f", "8c8d"]];
const config = { Threads: 1, USI_Hash: 16, Use_NNUE: false, USI_Variant: "shogi" };
const start = async () => {
  const engine = new UsiAdapter(wasmTransport(engineDirectory)), t = performance.now();
  try { await engine.initialize(config); return { engine, readyMs: performance.now() - t }; }
  catch (error) { engine.close(); throw error; }
};
const apply = (game, notation) => {
  const move = legalMoves(game).find(m => usi(m) === notation);
  if (!move) throw new Error(`Illegal synthetic-game move: ${notation}`);
  return playMove(game, move);
};
const seededLv4 = (game, seed) => {
  const original = Math.random; let state = seed >>> 0;
  Math.random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  try { return chooseRivalMove(game, 4); } finally { Math.random = original; }
};
const summary = values => {
  const sorted = [...values].sort((a, b) => a - b), total = sorted.reduce((a, b) => a + b, 0);
  return { count: sorted.length, mean: sorted.length ? total / sorted.length : null,
    median: sorted[Math.floor(sorted.length / 2)] ?? null, max: sorted.at(-1) ?? null };
};

const pkg = JSON.parse(readFileSync(resolve(engineDirectory, "package.json"), "utf8"));
const result = { measuredAt: new Date().toISOString(), node: process.version, engine: { package: pkg.name, version: pkg.version, license: pkg.license,
  wasmBytes: readFileSync(resolve(engineDirectory, "stockfish.wasm")).length,
  wasmSha256: createHash("sha256").update(readFileSync(resolve(engineDirectory, "stockfish.wasm"))).digest("hex") },
  settings: { ...config, movetimeMs, multiPv, games, maxPlies: 240, seeds: "20261116 + gameIndex*1000 + ply" },
  startupMs: [], positions: [], policyExamples: [], cancellation: {}, matches: [], score: { wasmWins: 0, lv4Wins: 0, draws: 0, capped: 0 },
  illegalMoves: 0, failures: [] };
const save = () => writeFileSync(resolve(out, "results.json"), JSON.stringify(result, null, 2) + "\n");
try {
  // Synthetic position probes also show the independent policy on a common candidate set.
  const first = await start(); result.startupMs.push(first.readyMs); result.engine.reportedName = first.engine.name;
  try {
    for (const opening of openings) {
      let game = initialGame(); for (const notation of opening) game = apply(game, notation);
      for (const time of [100, 500]) {
        const analysis = await first.engine.analyze(game, { movetimeMs: time, multiPv });
        result.positions.push({ opening, time, elapsedMs: analysis.elapsedMs, bestmove: analysis.bestmove,
          candidates: analysis.candidates.map(({ move, score, depth, nodes, engineMs }) => ({ move, score, depth, nodes, engineMs })) });
        if (time === 500) for (const style of ["balanced", "active", "solid"]) {
          const choice = choosePolicyMove(game, analysis, { strength: "practice", style, seed: 20261116 });
          result.policyExamples.push({ opening, style, move: choice?.notation, lossCp: choice?.lossCp, reason: choice?.reason });
        }
      }
    }
    const controller = new AbortController(), t = performance.now();
    const pending = first.engine.analyze(initialGame(), { movetimeMs: 5000, signal: controller.signal });
    setTimeout(() => controller.abort(), 25);
    try { await pending; throw new Error("Cancellation unexpectedly completed"); }
    catch (error) { if (error.code !== "cancelled") throw error; result.cancellation = { code: error.code, settledMs: performance.now() - t, transportDestroyed: true }; }
  } finally { first.engine.close(); }
  save();

  for (let i = 0; i < games; i++) {
    const { engine, readyMs } = await start(); result.startupMs.push(readyMs);
    const wasmSide = i % 2 === 0 ? "black" : "white", opening = openings[Math.floor(i / 2) % openings.length];
    let game = initialGame(); const moves = [], wasmLatency = [], lv4Latency = [], depths = [];
    let outcome, reason;
    try {
      for (const notation of opening) { game = apply(game, notation); moves.push(notation); }
      while (game.result === "playing" && moves.length < 240) {
        let notation;
        if (game.turn === wasmSide) {
          const analysis = await engine.analyze(game, { movetimeMs, multiPv });
          wasmLatency.push(analysis.elapsedMs); depths.push(analysis.candidates[0]?.depth ?? 0);
          if (analysis.bestmove === "resign") { outcome = wasmSide === "black" ? "white" : "black"; reason = "engine-resigned"; break; }
          if (analysis.bestmove === "win") { outcome = wasmSide; reason = "validated-declaration"; break; }
          notation = choosePolicyMove(game, analysis, { strength: "strong", style: "balanced", seed: 20261116 })?.notation;
        } else {
          const t = performance.now(), move = seededLv4(game, 20261116 + i * 1000 + moves.length);
          lv4Latency.push(performance.now() - t);
          if (!move) { outcome = wasmSide; reason = "lv4-no-move"; break; }
          notation = usi(move);
        }
        try { game = apply(game, notation); } catch (error) { result.illegalMoves++; throw error; }
        moves.push(notation);
      }
      outcome ??= game.result === "playing" ? "cap" : game.result;
      reason ??= game.result === "playing" ? "240-ply-cap" : "kiyu-rules";
      if (outcome === wasmSide) result.score.wasmWins++;
      else if (outcome === "draw") result.score.draws++;
      else if (outcome === "cap") result.score.capped++;
      else result.score.lv4Wins++;
      result.matches.push({ game: i + 1, wasmSide, opening, outcome, reason, plies: moves.length,
        wasmLatency: summary(wasmLatency), lv4Latency: summary(lv4Latency), depth: summary(depths), finalSfen: toSfen(game), moves });
      console.log(`game ${i + 1}/${games}: WASM ${wasmSide}, ${outcome}, ${moves.length} plies`);
    } finally { engine.close(); }
    save();
  }
} catch (error) { result.failures.push({ code: error.code ?? "error", message: error.message }); save(); throw error; }
result.startup = summary(result.startupMs); save();
console.log(JSON.stringify({ score: result.score, illegalMoves: result.illegalMoves, failures: result.failures, startup: result.startup, cancellation: result.cancellation, results: resolve(out, "results.json") }, null, 2));
