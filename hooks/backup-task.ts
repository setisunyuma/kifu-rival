import type { SavedState, parseBackup } from "../lib/backup";
import BackupWorker from "./backup.worker.ts?worker";

export type BackupRequest = { kind: "parse"; text: string } | { kind: "export"; state: SavedState };
export type ParsedBackup = ReturnType<typeof parseBackup>;

function requestBackup<T>(request: BackupRequest, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("中断しました。", "AbortError")); return; }
    let worker: Worker;
    try { worker = new BackupWorker(); }
    catch { reject(new Error("この端末では記録の確認を開始できませんでした。元の記録は変更していません。")); return; }
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); worker.terminate(); };
    const cancel = () => { cleanup(); reject(new DOMException("中断しました。", "AbortError")); };
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => { cleanup(); reject(new Error("記録の確認が時間内に終わりませんでした。元の記録は変更していません。")); }, 60000);
    worker.onmessage = (event: MessageEvent<{ ok: boolean; value?: T; error?: string }>) => {
      cleanup();
      if (event.data.ok) resolve(event.data.value as T);
      else reject(new Error(event.data.error || "記録を確認できませんでした。"));
    };
    worker.onerror = () => { cleanup(); reject(new Error("記録の確認中に問題が起きました。元の記録は変更していません。")); };
    worker.postMessage(request);
  });
}

export function parseBackupOffThread(text: string, signal?: AbortSignal) {
  return requestBackup<ParsedBackup>({ kind: "parse", text }, signal);
}
export function exportBackupOffThread(state: SavedState, signal?: AbortSignal) {
  return requestBackup<string>({ kind: "export", state }, signal);
}

export function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
