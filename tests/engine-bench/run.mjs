// Usage (from the repository root, engines built outside the repo):
//   KIFU_YANEURAOU=/path/YaneuraOu-by-gcc KIFU_FAIRY=/path/stockfish KIFU_FAIRY_NNUE=/path/shogi-xxxx.nnue \
//     node tests/engine-bench/run.mjs [--quick]
// Writes .sites-runtime/engine-bench/out/results.json and run.log (ignored by Git).
import { build } from "esbuild";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const here = import.meta.dirname, root = resolve(here, "../..");
await build({ entryPoints: [resolve(root, "lib/shogi.ts")], bundle: true, platform: "node", format: "esm", outfile: resolve(root, ".sites-runtime/engine-bench/shogi.mjs"), logLevel: "warning" });
const { Engine, lv4, match } = await import("./usi-bench.mjs");

const out = resolve(root, ".sites-runtime/engine-bench/out"); mkdirSync(out, { recursive: true });
const LOG = resolve(out, "run.log"); writeFileSync(LOG, "");
const log = s => { console.log(s); appendFileSync(LOG, s + "\n"); };
const quick = process.argv.includes("--quick");
const openings = [[], ["7g7f", "3c3d"], ["2g2f", "8c8d"], ["7g7f", "8c8d"], ["2g2f", "3c3d"], ["5g5f", "3c3d"]];
const env = name => { const v = process.env[name]; if (!v) log(`skip: ${name} not set`); return v; };

const engines = {};
if (env("KIFU_YANEURAOU")) engines.yane = await new Engine("YaneuraOu-material", process.env.KIFU_YANEURAOU, { Threads: 1, USI_Hash: 64 }).start();
if (env("KIFU_FAIRY")) {
  engines.fsfClassic = await new Engine("Fairy-classical", process.env.KIFU_FAIRY, { UCI_Variant: "shogi", Threads: 1, USI_Hash: 64 }).start();
  if (env("KIFU_FAIRY_NNUE")) engines.fsfNnue = await new Engine("Fairy-NNUE", process.env.KIFU_FAIRY, { UCI_Variant: "shogi", Threads: 1, USI_Hash: 64, EvalFile: process.env.KIFU_FAIRY_NNUE }).start();
}
for (const e of Object.values(engines)) log(`${e.name}: ready ${e.readyMs} ms`);

const g = n => (quick ? 2 : n);
const plan = [
  ["lv4-vs-yane", lv4, engines.yane, g(6), 100],
  ["lv4-vs-fsfClassic", lv4, engines.fsfClassic, g(6), 100],
  ["lv4-vs-fsfNnue", lv4, engines.fsfNnue, g(6), 100],
  ["yane-vs-fsfClassic", engines.yane, engines.fsfClassic, g(12), 200],
  ["fsfNnue-vs-fsfClassic", engines.fsfNnue, engines.fsfClassic, g(12), 200],
  ["fsfNnue-vs-yane", engines.fsfNnue, engines.yane, g(12), 200],
].filter(([, a, b]) => a && b);

const results = {};
for (const [name, a, b, games, movetime] of plan) {
  log(`=== ${name} (${games} games, ${movetime} ms/move)`);
  const r = await match(a, b, { games, movetime, openings, log });
  log(JSON.stringify(r.score));
  results[name] = { games, movetime, score: r.score, rows: r.rows.map(({ stats, ...row }) => ({ ...row,
    perEngine: Object.fromEntries(Object.entries(stats || {}).map(([n, s]) => {
      const avg = xs => (xs.length ? xs.reduce((p, c) => p + c, 0) / xs.length : null);
      return [n, { moves: s.length, avgDepth: avg(s.filter(x => x.depth).map(x => x.depth)), avgNps: avg(s.filter(x => x.nps).map(x => x.nps)) }];
    })) })) };
  writeFileSync(resolve(out, "results.json"), JSON.stringify(results, null, 2));
}
for (const e of Object.values(engines)) { log(`${e.name}: peak RSS ${e.peakRssMB()} MB`); e.quit(); }
log("DONE");
