// Serves only this synthetic probe and an explicitly supplied local engine on loopback.
import { createServer } from "node:http";
import { readFileSync, realpathSync, mkdirSync } from "node:fs";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "../.."), directory = process.env.KIFU_FAIRY_WASM_DIR;
if (!directory) throw new Error("Set KIFU_FAIRY_WASM_DIR to the unpacked engine outside the repository");
const engine = realpathSync(directory);
const relativeEngine = relative(root, engine);
if (!isAbsolute(relativeEngine) && relativeEngine.split(sep)[0] !== "..") throw new Error("Keep third-party engine files outside the repository");
const out = resolve(root, ".sites-runtime/engine-prototype"); mkdirSync(out, { recursive: true });
await build({ entryPoints: [resolve(import.meta.dirname, "prototype-browser.ts")], bundle: true, format: "esm", platform: "browser", outfile: resolve(out, "browser.js"), logLevel: "warning" });
const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>棋友 エンジン計測</title><style>body{max-width:880px;margin:30px auto;padding:0 18px;font:16px/1.7 system-ui;background:#f5f2e9;color:#273a32}h1{font-size:24px}button{padding:12px 16px;margin:4px;border:1px solid #b9c1b8;border-radius:8px;background:#fff;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:white;padding:16px;border-radius:8px;font-size:12px}#status{min-height:3em}</style><h1>棋友 エンジン計測</h1><p>初期局面だけを使う試作です。サイトの棋譜や保存データは読みません。</p><div><button data-time="100">0.1秒解析</button><button data-time="500">0.5秒解析</button><button data-time="1000">1秒解析</button><button id="stop">中断</button></div><p id="status">計測待ち</p><button id="tap">操作の応答を確認：<span id="taps">0</span>回</button><pre></pre><script type="module" src="/browser.js"></script></html>`;
const files = new Map([
  ["/browser.js", [resolve(out, "browser.js"), "text/javascript"]],
  ["/browser-worker.js", [resolve(import.meta.dirname, "browser-worker.js"), "text/javascript"]],
  ...["stockfish.js", "stockfish.worker.js", "stockfish.wasm", "Copying.txt", "AUTHORS"].map(name => [`/engine/${name}`, [resolve(engine, name), name.endsWith(".wasm") ? "application/wasm" : name.endsWith(".js") ? "text/javascript" : "text/plain"]]),
]);
const port = Number(process.env.KIFU_ENGINE_PREVIEW_PORT ?? 8879);
const server = createServer((request, response) => {
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET") { response.writeHead(405); response.end(); return; }
  const path = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
  if (path === "/") { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html); return; }
  const file = files.get(path);
  if (!file) { response.writeHead(404); response.end(); return; }
  try { response.setHeader("Content-Type", file[1]); response.end(readFileSync(file[0])); }
  catch { response.writeHead(404); response.end(); }
});
server.listen(port, "127.0.0.1", () => console.log(`Synthetic engine probe: http://127.0.0.1:${port}`));
process.on("SIGINT", () => server.close(() => process.exit(0)));
