import { Worker } from "node:worker_threads";
import { resolve } from "node:path";

/** One worker per engine; terminate() also destroys its WebAssembly and pthread workers. */
export function wasmTransport(engineDirectory) {
  const worker = new Worker(new URL("./wasm-worker.mjs", import.meta.url), { workerData: { engineDirectory: resolve(engineDirectory) } });
  let stopped = false;
  return {
    send(command) { if (stopped) throw new Error("Worker closed"); worker.postMessage(command); },
    subscribe(onLine, onError) {
      const message = data => { if (typeof data.line === "string") onLine(data.line); else if (data.error) onError(new Error(data.error)); };
      const error = value => onError(value);
      const exit = code => { if (!stopped) onError(new Error(`Engine worker exited (${code})`)); };
      worker.on("message", message); worker.on("error", error); worker.on("exit", exit);
      return () => { worker.off("message", message); worker.off("error", error); worker.off("exit", exit); };
    },
    terminate() { stopped = true; void worker.terminate(); },
  };
}
