import { initialGame } from "../../lib/shogi";
import { UsiAdapter, EngineError } from "../../lib/engine/usi-adapter";
import type { EngineAnalysis, UsiTransport } from "../../lib/engine/usi-adapter";
import { choosePolicyMove } from "../../lib/engine/rival-policy";

let engine: UsiAdapter | undefined;
let initializing: Promise<void> | undefined;
let controller: AbortController | undefined;
let running = false;
const output = document.querySelector("pre")!;
const status = document.querySelector<HTMLElement>("#status")!;
const show = (value: unknown) => { output.textContent = JSON.stringify(value, null, 2); };
const createTransport = (): UsiTransport => {
  const worker = new Worker("/browser-worker.js");
  return {
    send(command) { worker.postMessage(command); },
    subscribe(onLine, onError) {
      const message = (event: MessageEvent<{ line?: string; error?: string }>) => {
        if (event.data.line) onLine(event.data.line); else if (event.data.error) onError(new Error(event.data.error));
      };
      const error = (event: ErrorEvent) => onError(new Error(event.message));
      worker.addEventListener("message", message); worker.addEventListener("error", error);
      return () => { worker.removeEventListener("message", message); worker.removeEventListener("error", error); };
    },
    terminate() { worker.terminate(); },
  };
};
const ensure = async () => {
  if (!crossOriginIsolated || typeof SharedArrayBuffer === "undefined") {
    throw new Error("この計測には安全な接続とCOOP/COEPが必要です。HTTPのLANアドレスでは利用できません。");
  }
  if (initializing) return initializing;
  if (engine) return;
  const fresh = new UsiAdapter(createTransport()); engine = fresh;
  const started = performance.now(); status.textContent = "エンジンを起動中…";
  initializing = fresh.initialize({ Threads: 1, USI_Hash: 16, Use_NNUE: false, USI_Variant: "shogi" })
    .then(() => { status.textContent = `起動完了（${Math.round(performance.now() - started)} ms）`; })
    .catch(error => { fresh.close(); engine = undefined; throw error; })
    .finally(() => { initializing = undefined; });
  return initializing;
};

async function probe(movetimeMs: number): Promise<EngineAnalysis> {
  if (running) throw new EngineError("busy", "解析中です。中断するか完了を待ってください。");
  running = true;
  let active: UsiAdapter | undefined;
  try {
    await ensure(); active = engine; controller = new AbortController();
    if (!active) throw new EngineError("cancelled", "解析を中断しました。");
    status.textContent = "初期局面を解析中…（画面は操作できます）";
    const analysis = await active.analyze(initialGame(), { movetimeMs, multiPv: 3, signal: controller.signal });
    status.textContent = `解析完了（${Math.round(analysis.elapsedMs)} ms）`;
    show({ ...analysis, policy: ["strong", "balanced", "practice"].map(strength => choosePolicyMove(initialGame(), analysis,
      { strength: strength as "strong" | "balanced" | "practice", style: "balanced", seed: 20261116 })) });
    return analysis;
  } catch (error) {
    if (active && engine === active && error instanceof EngineError &&
      ["closed", "timeout", "cancelled", "protocol", "transport"].includes(error.code)) {
      active.close(); engine = undefined;
    }
    status.textContent = error instanceof Error ? error.message : String(error); throw error;
  } finally { running = false; controller = undefined; }
}
function cancel() { controller?.abort(); engine?.close(); engine = undefined; status.textContent = "中断しました。次の解析ではエンジンを起動し直します。"; }
async function cancellationProbe() {
  if (running) throw new EngineError("busy", "前の解析が終わるまで待ってください。");
  await ensure(); const started = performance.now(), pending = probe(5000);
  const timer = setTimeout(cancel, 25);
  try { await pending; throw new Error("中断されませんでした。"); }
  catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "cancelled") throw error;
    return { code: error.code, elapsedMs: performance.now() - started };
  } finally { clearTimeout(timer); }
}
document.querySelectorAll<HTMLButtonElement>("[data-time]").forEach(button => {
  button.onclick = () => { void probe(Number(button.dataset.time)).catch(error => show({ error: String(error) })); };
});
document.querySelector<HTMLButtonElement>("#stop")!.onclick = cancel;
let taps = 0;
document.querySelector<HTMLButtonElement>("#tap")!.onclick = () => { document.querySelector("#taps")!.textContent = String(++taps); };
Object.assign(window, { kiyuEngineProbe: { ensure, probe, cancel, cancellationProbe } });
show({ crossOriginIsolated, sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined", userAgent: navigator.userAgent,
  note: "合成の初期局面だけを使う実験です。棋力の級・段位や人間らしさは未校正です。" });
