// Own bridge only. The engine package is supplied by an absolute path outside the repository.
import { parentPort, workerData } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const queued = [];
let engine;
parentPort.on("message", command => {
  if (typeof command !== "string" || /[\r\n]/.test(command)) return;
  if (engine) engine.postMessage(command); else queued.push(command);
});

const directory = workerData.engineDirectory;
const loadEngine = createRequire(import.meta.url);
const factory = loadEngine(join(directory, "stockfish.js"));
// Explicit bytes avoid Node's fetch(file:) failure in this older Emscripten wrapper.
factory({ wasmBinary: readFileSync(join(directory, "stockfish.wasm")) }).then(instance => {
  engine = instance;
  engine.addMessageListener(line => parentPort.postMessage({ line }));
  for (const command of queued) engine.postMessage(command);
  queued.length = 0;
}).catch(error => { parentPort.postMessage({ error: String(error) }); });
