import type { UsiTransport } from "./usi-adapter";

/** Route served only by the development plugin (scripts/vite/engine-dev-plugin.mjs). */
export const DEV_ENGINE_ROUTE = "/__kiyu-engine/";

export type EngineManifest = {
  name: string; version: string; license: string; homepage?: string;
  wasmBytes: number; wasmSha256: string; development: true;
};
export type EngineAvailability =
  | { status: "checking" }
  | { status: "available"; manifest: EngineManifest }
  | { status: "unavailable"; reason: string };

function isManifest(value: unknown): value is EngineManifest {
  const m = value as Partial<EngineManifest> | null;
  return !!m && typeof m === "object" && typeof m.name === "string" && typeof m.version === "string" && typeof m.license === "string"
    && typeof m.wasmSha256 === "string" && /^[0-9a-f]{64}$/.test(m.wasmSha256) && Number.isSafeInteger(m.wasmBytes) && m.development === true;
}

/** Detect the development engine without loading it. The Site and production builds answer 404. */
export async function probeDevEngine(fetcher: typeof fetch = fetch, signal?: AbortSignal,
  environment: { crossOriginIsolated?: boolean; hasSharedArrayBuffer: boolean; hasWorker: boolean } = {
    crossOriginIsolated: typeof crossOriginIsolated === "boolean" ? crossOriginIsolated : false,
    hasSharedArrayBuffer: typeof SharedArrayBuffer !== "undefined", hasWorker: typeof Worker !== "undefined" }): Promise<EngineAvailability> {
  let response: Response;
  try { response = await fetcher(`${DEV_ENGINE_ROUTE}manifest.json`, { cache: "no-store", signal }); }
  catch { return { status: "unavailable", reason: "開発用エンジンに接続できません。" }; }
  if (!response.ok) return { status: "unavailable", reason: "この環境には強いエンジンが入っていません（開発版のみ。公開版への配布は未承認）。" };
  let manifest: unknown;
  try { manifest = await response.json(); } catch { return { status: "unavailable", reason: "エンジン情報を読めません。" }; }
  if (!isManifest(manifest)) return { status: "unavailable", reason: "エンジン情報の形式が正しくありません。" };
  if (!environment.hasWorker) return { status: "unavailable", reason: "このブラウザはWeb Workerに対応していません。" };
  if (!environment.crossOriginIsolated || !environment.hasSharedArrayBuffer) {
    return { status: "unavailable", reason: "このページはエンジンに必要な分離設定（COOP/COEP）を満たしていません。" };
  }
  return { status: "available", manifest };
}

/** One Worker per transport. Terminating it is how a search is cancelled (no stale bestmove). */
export function createDevEngineTransport(WorkerClass: typeof Worker = Worker): UsiTransport {
  const worker = new WorkerClass(`${DEV_ENGINE_ROUTE}bridge.js`);
  return {
    send(command) { worker.postMessage(command); },
    subscribe(onLine, onError) {
      const message = (event: MessageEvent<{ line?: string; error?: string }>) => {
        if (typeof event.data?.line === "string") onLine(event.data.line);
        else if (typeof event.data?.error === "string") onError(new Error(event.data.error));
      };
      const error = (event: ErrorEvent) => onError(new Error(event.message || "エンジンのWorkerが停止しました。"));
      worker.addEventListener("message", message); worker.addEventListener("error", error);
      return () => { worker.removeEventListener("message", message); worker.removeEventListener("error", error); };
    },
    terminate() { worker.terminate(); },
  };
}

export const DEV_ENGINE_OPTIONS = { Threads: 1, USI_Hash: 16, Use_NNUE: false, USI_Variant: "shogi" } as const;
