/// <reference lib="webworker" />
import { parseBackup, serializeBackup } from "../lib/backup";
import type { BackupRequest } from "./backup-task";

self.onmessage = (event: MessageEvent<BackupRequest>) => {
  try {
    const request = event.data;
    const value = request.kind === "parse" ? parseBackup(request.text) : serializeBackup(request.state);
    self.postMessage({ ok: true, value });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : "記録を確認できませんでした。" });
  }
};
