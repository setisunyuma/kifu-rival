// Own harness (KIF-022). Reproducible strength benchmark for the rival settings.
//
// Plays two players from 16 fixed openings with colours swapped (32 games by default), through
// the same EngineRival + rival policy the app uses, and audits every move with a deeper reference
// search. The engine package stays OUTSIDE this repository (ADR-010). Manual only; not part of CI.
//
//   KIFU_FAIRY_WASM_DIR=<dir> node tests/engine-bench/run-strength-bench.mjs \
//     --pair tier:balanced:tier:practice [--purpose win] [--style balanced] [--audit-nodes 200000] [--jobs 4]
//
// Player specs:
//   tier:<strength>[/<style>[/<purpose>]]  the app's rival settings (style/purpose default to the flags)
//   nodes:<N>                              the engine's best move after N nodes (an anchor, no policy)
//   builtin:<level>                        the built-in heuristic AI (Lv.1-4), seeded per move
//
// Searches limited by nodes are single-threaded and start from a cleared hash, so a run repeats
// move for move on any machine as long as no search hits its time cap (reported as capHits).
import { build } from "esbuild";
import { mkdirSync, realpathSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { wasmTransport } from "./wasm-transport.mjs";

const root = resolve(import.meta.dirname, "../..");
const arg = (flag, fallback) => { const i = process.argv.indexOf(flag); return i < 0 ? fallback : process.argv[i + 1]; };
if (!process.env.KIFU_FAIRY_WASM_DIR) throw new Error("Set KIFU_FAIRY_WASM_DIR to the unpacked package outside the repository");
const engineDirectory = realpathSync(process.env.KIFU_FAIRY_WASM_DIR);
const inside = relative(root, engineDirectory);
if (!isAbsolute(inside) && inside.split(sep)[0] !== "..") throw new Error("Third-party engine must remain outside the repository");

// --source lets a run use another copy of lib/ (for example the previous policy) for the players.
const source = resolve(arg("--source", root));
const out = resolve(root, ".sites-runtime/engine-bench/strength"); mkdirSync(out, { recursive: true });
// One bundle per process, so concurrent runs (for example old and new sources) never share code.
const bundle = async (dir, name, contents) => {
  const file = resolve(out, `${name}-${process.pid}.mjs`);
  await build({ stdin: { contents, resolveDir: dir, sourcefile: `${name}.ts`, loader: "ts" }, bundle: true, platform: "node", format: "esm",
    outfile: file, logLevel: "warning" });
  return import(file);
};
const players = await bundle(source, "players", 'export * from "./lib/shogi"; export * from "./lib/engine/engine-rival"; export * from "./lib/engine/browser-engine"; export * from "./lib/engine/rival-policy";');
const reference = await bundle(root, "reference", 'export * from "./lib/engine/usi-adapter"; export { DEV_ENGINE_OPTIONS } from "./lib/engine/browser-engine";');
const { EngineRival, DEV_ENGINE_OPTIONS, initialGame, legalMoves, playMove, usi, declareEntering, chooseRivalMove, isInCheck, STRENGTH_PROFILES } = players;
const { UsiAdapter } = reference;

/** Short, common opening sequences (move orders only). Every one is replayed and validated below. */
export const OPENINGS = [
  { name: "平手", moves: [] },
  { name: "角道を開け合う", moves: ["7g7f", "3c3d"] },
  { name: "相居飛車（飛車先）", moves: ["2g2f", "8c8d"] },
  { name: "居飛車（角道と飛車先）", moves: ["7g7f", "8c8d"] },
  { name: "対抗形の入口", moves: ["2g2f", "3c3d", "7g7f", "4c4d"] },
  { name: "矢倉模様", moves: ["7g7f", "8c8d", "6g6f", "3c3d"] },
  { name: "後手角道止め", moves: ["7g7f", "3c3d", "2g2f", "4c4d", "2f2e", "2b3c"] },
  { name: "横歩取り模様", moves: ["7g7f", "3c3d", "2g2f", "8c8d", "2f2e", "8d8e"] },
  { name: "先手中飛車", moves: ["5g5f", "3c3d", "2h5h"] },
  { name: "先手四間飛車", moves: ["7g7f", "3c3d", "6g6f", "8c8d", "2h6h"] },
  { name: "先手三間飛車", moves: ["7g7f", "3c3d", "2h7h"] },
  { name: "後手四間飛車", moves: ["7g7f", "3c3d", "2g2f", "4c4d", "2f2e", "2b3c", "4i5h", "8b4b"] },
  { name: "後手三間飛車", moves: ["2g2f", "3c3d", "7g7f", "4c4d", "2f2e", "2b3c", "4i5h", "8b3b"] },
  { name: "後手中飛車", moves: ["7g7f", "5c5d", "2g2f", "8b5b"] },
  { name: "相掛かり", moves: ["2g2f", "8c8d", "2f2e", "8d8e", "6i7h", "4a3b"] },
  { name: "角換わり", moves: ["7g7f", "3c3d", "8h2b+", "3a2b"] },
];

const apply = (game, notation) => {
  const move = legalMoves(game).find(m => usi(m) === notation);
  if (!move) throw new Error(`Illegal move: ${notation}`);
  return playMove(game, move);
};
for (const opening of OPENINGS) opening.moves.reduce(apply, initialGame());

const defaults = { style: arg("--style", "balanced"), purpose: arg("--purpose", "win") };
function parsePlayer(spec) {
  const [kind, value] = spec.split(/:(.*)/s);
  if (kind === "tier") {
    const [strength, style = defaults.style, purpose = defaults.purpose] = value.split("/");
    if (!STRENGTH_PROFILES[strength]) throw new Error(`Unknown strength: ${strength}`);
    return { spec, kind, policy: { strength, style, purpose } };
  }
  if (kind === "nodes" && /^\d+$/.test(value)) return { spec, kind, nodes: Number(value) };
  if (kind === "builtin" && /^[1-4]$/.test(value)) return { spec, kind, level: Number(value) };
  throw new Error(`Unknown player: ${spec}`);
}
const pairArg = arg("--pair", "tier:balanced:tier:practice");
const split = pairArg.match(/^((?:tier|nodes|builtin):[^:]+):((?:tier|nodes|builtin):[^:]+)$/);
if (!split) throw new Error("--pair must look like tier:balanced:tier:practice or nodes:4000:builtin:4");
const [A, B] = [parsePlayer(split[1]), parsePlayer(split[2])];
const openingCount = Math.min(Number(arg("--openings", OPENINGS.length)), OPENINGS.length);
const jobs = Math.max(1, Number(arg("--jobs", 4)));
const maxPlies = Number(arg("--max-plies", 256));
const auditNodes = Number(arg("--audit-nodes", 0));
const label = arg("--label", `${A.spec}-vs-${B.spec}${auditNodes ? "" : "-noaudit"}`.replace(/[^\w.-]+/g, "_"));

/** Deterministic PRNG so the built-in AI (which uses Math.random) repeats move for move. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

async function startAdapter() {
  const adapter = new UsiAdapter(wasmTransport(engineDirectory));
  await adapter.initialize(DEV_ENGINE_OPTIONS, 15000);
  return adapter;
}

function createPlayer(player) {
  if (player.kind === "tier") {
    const rival = new EngineRival(() => wasmTransport(engineDirectory), DEV_ENGINE_OPTIONS);
    return {
      async move(game) {
        const turn = await rival.think(game, player.policy);
        const capHit = turn.analysis.requestedNodes !== undefined && turn.analysis.elapsedMs >= turn.analysis.requestedMs - 5;
        return { decision: turn.decision, capHit };
      },
      close() { rival.reset(); },
    };
  }
  if (player.kind === "nodes") {
    let adapter;
    return {
      async move(game) {
        adapter ??= await startAdapter();
        const analysis = await adapter.analyze(game, { nodes: player.nodes, movetimeMs: 10000, multiPv: 1 });
        if (analysis.bestmove === "resign") return { decision: { kind: "resign", reason: "engine resigned" } };
        if (analysis.bestmove === "win") return { decision: { kind: "declare", reason: "engine declared" } };
        return { decision: { kind: "move", choice: { notation: analysis.bestmove } }, capHit: analysis.elapsedMs >= 9995 };
      },
      close() { adapter?.close(); },
    };
  }
  return {
    async move(game, seed) {
      const original = Math.random; Math.random = seeded(seed);
      try {
        const move = chooseRivalMove(game, player.level);
        return move ? { decision: { kind: "move", choice: { notation: usi(move) } } } : { decision: { kind: "resign", reason: "no move" } };
      } finally { Math.random = original; }
    },
    close() {},
  };
}

/** Mover-relative centipawns; mate scores become ±(10000 - plies) so losses can be compared. */
const cp = score => score.kind === "mate" ? Math.sign(score.value || -1) * (10000 - Math.abs(score.value)) : score.value;

async function audit(positions) {
  if (!auditNodes) return [];
  const adapter = await startAdapter();
  try {
    const values = [];
    for (const game of positions) {
      if (game.result !== "playing") { values.push(game.result === "draw" ? 0 : (game.result === game.turn ? 10000 : -10000)); continue; }
      const analysis = await adapter.analyze(game, { nodes: auditNodes, movetimeMs: 10000, multiPv: 1 });
      const top = analysis.candidates[0];
      values.push(top ? cp(top.score) : analysis.bestmove === "resign" ? -10000 : 0);
    }
    return values;
  } finally { adapter.close(); }
}

async function playGame(index) {
  const opening = OPENINGS[Math.floor(index / 2) % openingCount];
  const blackIsA = index % 2 === 0;
  const side = { black: blackIsA ? A : B, white: blackIsA ? B : A };
  const live = { black: createPlayer(side.black), white: createPlayer(side.white) };
  let game = initialGame(); for (const m of opening.moves) game = apply(game, m);
  const positions = [game], moves = [...opening.moves], movers = [], capHits = { black: 0, white: 0 }, ms = { black: [], white: [] };
  let outcome, reason;
  try {
    while (game.result === "playing" && moves.length < maxPlies) {
      const turn = game.turn, started = performance.now();
      const { decision, capHit } = await live[turn].move(game, (index + 1) * 100003 + moves.length);
      ms[turn].push(performance.now() - started); if (capHit) capHits[turn]++;
      if (decision.kind === "resign") { outcome = turn === "black" ? "white" : "black"; reason = `resign: ${decision.reason}`; break; }
      if (decision.kind === "declare") { game = declareEntering(game, "match").game; reason = "declaration"; break; }
      game = apply(game, decision.choice.notation); moves.push(decision.choice.notation); movers.push(turn); positions.push(game);
    }
  } catch (error) { reason = `failure: ${error.message}`; outcome = "failure"; }
  finally { live.black.close(); live.white.close(); }
  outcome ??= game.result === "playing" ? "cap" : game.result;
  // Audit: value[i] is the mover's evaluation before ply i; the loss of a move is
  // value[i] + value[i+1] (the next value is from the opponent's side).
  const values = await audit(positions);
  const perMove = movers.map((mover, i) => {
    const before = positions[i], move = legalMoves(before).find(m => usi(m) === moves[opening.moves.length + i]);
    const next = positions[i + 1];
    return { mover, capture: !!before.board[move.to.r][move.to.c], check: isInCheck(next, next.turn), promote: !!move.promote, drop: !move.from,
      before: values[i], loss: values.length ? Math.max(0, values[i] + values[i + 1]) : undefined };
  });
  const winner = outcome === "black" || outcome === "white" ? side[outcome].spec : outcome;
  const median = list => list.length ? [...list].sort((x, y) => x - y)[Math.floor(list.length / 2)] : null;
  return { game: index + 1, opening: opening.name, black: side.black.spec, white: side.white.spec, outcome, winner, reason: reason ?? "kiyu-rules",
    plies: moves.length, capHits, medianMs: { black: median(ms.black), white: median(ms.white) }, moves, perMove };
}

function summarize(games) {
  const score = { [A.spec]: 0, [B.spec]: 0, draw: 0, cap: 0, failure: 0 };
  for (const g of games) score[g.winner === A.spec || g.winner === B.spec ? g.winner : g.winner === "draw" ? "draw" : g.winner === "cap" ? "cap" : "failure"]++;
  const n = games.length - score.failure;
  const p = n ? (score[A.spec] + (score.draw + score.cap) / 2) / n : 0.5;
  const z = 1.96, centre = (p + z * z / (2 * n)) / (1 + z * z / n), half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n);
  const elo = x => { const c = Math.min(Math.max(x, 0.5 / n), 1 - 0.5 / n); return Math.round(400 * Math.log10(c / (1 - c))); };
  const quality = spec => {
    const rows = games.flatMap(g => g.perMove.filter(m => (m.mover === "black" ? g.black : g.white) === spec));
    const audited = rows.filter(m => m.loss !== undefined && Math.abs(m.before) < 2000);
    const rate = f => rows.length ? +(rows.filter(f).length / rows.length).toFixed(3) : null;
    return { moves: rows.length, audited: audited.length,
      meanLossCp: audited.length ? Math.round(audited.reduce((s, m) => s + Math.min(m.loss, 1000), 0) / audited.length) : null,
      mistakes150: audited.filter(m => m.loss >= 150).length, blunders300: audited.filter(m => m.loss >= 300).length, severe1000: audited.filter(m => m.loss >= 1000).length,
      captureRate: rate(m => m.capture), checkRate: rate(m => m.check), promoteRate: rate(m => m.promote), dropRate: rate(m => m.drop),
      capHits: games.reduce((s, g) => s + (g.black === spec ? g.capHits.black : 0) + (g.white === spec ? g.capHits.white : 0), 0) };
  };
  return { score, games: n, scoreA: +p.toFixed(3), ci95: [+(centre - half).toFixed(3), +(centre + half).toFixed(3)],
    eloA: elo(p), eloCi95: [elo(centre - half), elo(centre + half)], quality: { [A.spec]: quality(A.spec), [B.spec]: quality(B.spec) } };
}

const total = openingCount * 2;
const wasm = readFileSync(resolve(engineDirectory, "stockfish.wasm"));
const pkg = JSON.parse(readFileSync(resolve(engineDirectory, "package.json"), "utf8"));
const meta = { measuredAt: new Date().toISOString(), node: process.version, source: source === root ? "working tree" : source,
  engine: { package: pkg.name, version: pkg.version, license: pkg.license, wasmSha256: createHash("sha256").update(wasm).digest("hex") },
  settings: { pair: [A, B], defaults, engineOptions: DEV_ENGINE_OPTIONS, openings: OPENINGS.slice(0, openingCount).map(o => o.name), games: total, maxPlies, auditNodes,
    profiles: STRENGTH_PROFILES } };
const games = new Array(total);
let next = 0, done = 0;
const started = performance.now();
await Promise.all(Array.from({ length: Math.min(jobs, total) }, async () => {
  while (next < total) {
    const index = next++;
    games[index] = await playGame(index);
    const g = games[index];
    console.log(`[${++done}/${total}] game ${g.game} ${g.opening}: ${g.black}(▲) vs ${g.white}(△) → ${g.winner} (${g.plies} plies, ${g.reason})`);
  }
}));
const summary = summarize(games);
const result = { ...meta, wallSeconds: Math.round((performance.now() - started) / 1000), summary, games };
writeFileSync(resolve(out, `${label}.json`), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ label, ...summary }, null, 2));
