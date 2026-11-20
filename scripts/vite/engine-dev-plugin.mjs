// KIF-021 development-only engine serving. Inactive unless KIFU_ENGINE_DIR is set for `vite dev`.
// The third-party engine stays OUTSIDE the repository; production builds contain neither the
// engine nor this route (ADR-010). Nothing here is used by `npm run build` or the Site.
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const ENGINE_ROUTE = "/__kiyu-engine/";
const ENGINE_FILES = {
  "stockfish.js": "text/javascript", "stockfish.worker.js": "text/javascript", "stockfish.wasm": "application/wasm",
  "Copying.txt": "text/plain; charset=utf-8", "AUTHORS": "text/plain; charset=utf-8",
};

/** Throws unless the directory exists outside `root` and holds the expected engine package. */
export function resolveEngineDirectory(directory, root) {
  const engine = realpathSync(directory);
  const inside = relative(realpathSync(root), engine);
  if (!isAbsolute(inside) && inside.split(sep)[0] !== "..") throw new Error("KIFU_ENGINE_DIR must point outside the repository (third-party engines are not committed).");
  for (const name of Object.keys(ENGINE_FILES)) readFileSync(resolve(engine, name));
  return engine;
}

export function engineManifest(engine) {
  const pkg = JSON.parse(readFileSync(resolve(engine, "package.json"), "utf8"));
  const wasm = readFileSync(resolve(engine, "stockfish.wasm"));
  return { name: String(pkg.name ?? "unknown"), version: String(pkg.version ?? "unknown"), license: String(pkg.license ?? "unknown"),
    homepage: typeof pkg.homepage === "string" ? pkg.homepage : undefined,
    wasmBytes: wasm.length, wasmSha256: createHash("sha256").update(wasm).digest("hex"), development: true };
}

export function engineDevPlugin({ directory = process.env.KIFU_ENGINE_DIR, root = process.cwd() } = {}) {
  return {
    name: "kiyu-engine-dev",
    apply: "serve",
    configureServer(server) {
      if (!directory) return;
      const engine = resolveEngineDirectory(directory, root);
      const manifest = JSON.stringify(engineManifest(engine));
      const bridge = readFileSync(resolve(import.meta.dirname, "engine-bridge.js"));
      server.config.logger.info(`[kiyu-engine] development engine enabled from outside the repository (${JSON.parse(manifest).name}@${JSON.parse(manifest).version}).`);
      server.middlewares.use((request, response, next) => {
        // SharedArrayBuffer (threaded WASM) requires cross-origin isolation for the whole page.
        response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
        const path = (request.url ?? "").split("?")[0];
        if (!path.startsWith(ENGINE_ROUTE)) { next(); return; }
        response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        response.setHeader("Cache-Control", "no-store");
        if (request.method !== "GET" && request.method !== "HEAD") { response.statusCode = 405; response.end(); return; }
        const name = path.slice(ENGINE_ROUTE.length);
        if (name === "manifest.json") { response.setHeader("Content-Type", "application/json"); response.end(manifest); return; }
        if (name === "bridge.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bridge); return; }
        const type = ENGINE_FILES[name];
        if (!type) { response.statusCode = 404; response.end(); return; }
        response.setHeader("Content-Type", type);
        response.end(readFileSync(resolve(engine, name)));
      });
    },
  };
}
