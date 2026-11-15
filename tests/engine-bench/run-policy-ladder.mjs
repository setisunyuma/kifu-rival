// Own harness (KIF-021/022). Plays the app's rival settings against each other through the same
// EngineRival + rival policy used by the app. KIFU_FAIRY_WASM_DIR points to an engine package
// OUTSIDE this repository (ADR-010). Manual only; not part of CI.
//   KIFU_FAIRY_WASM_DIR=<dir> node tests/engine-bench/run-policy-ladder.mjs --pair strong:practice --games 4
import { build } from "esbuild";
import { mkdirSync, realpathSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { wasmTransport } from "./wasm-transport.mjs";

const root = resolve(import.meta.dirname, "../..");
if (!process.env.KIFU_FAIRY_WASM_DIR) throw new Error("Set KIFU_FAIRY_WASM_DIR to the unpacked package outside the repository");
const engineDirectory = realpathSync(process.env.KIFU_FAIRY_WASM_DIR);
const inside = relative(root, engineDirectory);
if (!isAbsolute(inside) && inside.split(sep)[0] !== "..") throw new Error("Third-party engine must remain outside the repository");
const out = resolve(root, ".sites-runtime/engine-ladder"); mkdirSync(out, { recursive: true });
await build({ stdin: { contents: 'export * from "./lib/shogi"; export * from "./lib/engine/engine-rival"; export * from "./lib/engine/browser-engine";', resolveDir: root, sourcefile: "ladder.ts", loader: "ts" },
  bundle: true, platform: "node", format: "esm", outfile: resolve(out, "runtime.mjs"), logLevel: "warning" });
const { EngineRival, DEV_ENGINE_OPTIONS, initialGame, legalMoves, playMove, usi, declareEntering } = await import(resolve(out, "runtime.mjs"));

const arg = (flag, fallback) => { const i = process.argv.indexOf(flag); return i < 0 ? fallback : process.argv[i + 1]; };
const [a, b] = arg("--pair", "strong:practice").split(":");
const games = Math.min(Number(arg("--games", 4)), 20);
const style = arg("--style", "balanced");
const purpose = arg("--purpose", "close-game");
const openings = [[], ["7g7f", "3c3d"], ["2g2f", "8c8d"], ["7g7f", "8c8d"]];
const apply = (game, notation) => {
  const move = legalMoves(game).find(m => usi(m) === notation);
  if (!move) throw new Error(`Illegal move: ${notation}`);
  return playMove(game, move);
};
const wasm = readFileSync(resolve(engineDirectory, "stockfish.wasm"));
const pkg = JSON.parse(readFileSync(resolve(engineDirectory, "package.json"), "utf8"));
const result = { measuredAt: new Date().toISOString(), node: process.version,
  engine: { package: pkg.name, version: pkg.version, license: pkg.license, wasmSha256: createHash("sha256").update(wasm).digest("hex") },
  settings: { pair: [a, b], style, purpose, engineOptions: DEV_ENGINE_OPTIONS, maxPlies: 256 },
  score: { [a]: 0, [b]: 0, draw: 0, cap: 0 }, illegal: 0, failures: 0, games: [] };
for (let i = 0; i < games; i++) {
  const blackIsA = i % 2 === 0, opening = openings[Math.floor(i / 2) % openings.length];
  const side = { black: blackIsA ? a : b, white: blackIsA ? b : a };
  const rivals = { black: new EngineRival(() => wasmTransport(engineDirectory), DEV_ENGINE_OPTIONS), white: new EngineRival(() => wasmTransport(engineDirectory), DEV_ENGINE_OPTIONS) };
  let game = initialGame(); const moves = [...opening]; for (const m of opening) game = apply(game, m);
  const ms = { black: [], white: [] }; let outcome, reason;
  try {
    while (game.result === "playing" && moves.length < 256) {
      const turn = game.turn;
      const t = performance.now();
      const { decision } = await rivals[turn].think(game, { strength: side[turn], style, purpose });
      ms[turn].push(performance.now() - t);
      if (decision.kind === "resign") { outcome = turn === "black" ? "white" : "black"; reason = `resign: ${decision.reason}`; break; }
      if (decision.kind === "declare") { game = declareEntering(game, "match").game; reason = "declaration"; break; }
      game = apply(game, decision.choice.notation); moves.push(decision.choice.notation);
    }
  } catch (error) { result.failures++; reason = `failure: ${error.message}`; if (/Illegal/.test(error.message)) result.illegal++; }
  finally { rivals.black.reset(); rivals.white.reset(); }
  outcome ??= game.result === "playing" ? "cap" : game.result;
  const winner = outcome === "black" || outcome === "white" ? side[outcome] : outcome;
  result.score[winner] = (result.score[winner] ?? 0) + 1;
  const med = list => [...list].sort((x, y) => x - y)[Math.floor(list.length / 2)] ?? null;
  result.games.push({ game: i + 1, black: side.black, white: side.white, opening, outcome, winner, reason: reason ?? "kiyu-rules", plies: moves.length,
    medianMs: { black: med(ms.black), white: med(ms.white) }, moves });
  console.log(`game ${i + 1}/${games}: ${side.black}(▲) vs ${side.white}(△) → ${winner} (${moves.length} plies, ${reason ?? "kiyu-rules"})`);
  writeFileSync(resolve(out, `ladder-${a}-${b}.json`), JSON.stringify(result, null, 2) + "\n");
}
console.log(JSON.stringify({ pair: [a, b], score: result.score, illegal: result.illegal, failures: result.failures }));
