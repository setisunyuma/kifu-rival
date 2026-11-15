"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Upload, ShieldCheck, CircleHelp } from "lucide-react";
import type { SavedState } from "../lib/backup";
import { MAX_BACKUP_BYTES } from "../lib/backup";
import { downloadText, exportBackupOffThread, parseBackupOffThread, type ParsedBackup } from "../hooks/backup-task";
import { RECOVERY_KEY, STORAGE_KEY } from "../lib/persistence";

type Props = {
  snapshot: SavedState;
  onRestore: (state: SavedState) => void;
  onPreviewChange: (open: boolean) => void;
};

const filename = (kind: string) => `kiyu-${kind}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

export function DataBackupPanel({ snapshot, onRestore, onPreviewChange }: Props) {
  const [preview, setPreview] = useState<ParsedBackup | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [savedCopy, setSavedCopy] = useState(false);
  const task = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);

  useEffect(() => () => { task.current?.abort(); onPreviewChange(false); }, [onPreviewChange]);

  async function readFile(file: File) {
    const current = ++generation.current;
    task.current?.abort();
    const controller = new AbortController(); task.current = controller;
    setError(""); setMessage(""); setPreview(null); setSavedCopy(false); setBusy(true); onPreviewChange(true);
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error("ファイルが大きすぎます。5 MB以下の記録を選んでください。");
      const result = await parseBackupOffThread(await file.text(), controller.signal);
      if (generation.current !== current) return;
      setPreview(result); setFileName(file.name);
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : "記録を読み込めませんでした。");
      onPreviewChange(false);
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }

  async function exportCurrent(beforeRestore = false) {
    setError(""); setMessage(""); setBusy(true);
    const controller = new AbortController(); task.current?.abort(); task.current = controller;
    try {
      const text = await exportBackupOffThread(snapshot, controller.signal);
      downloadText(text, filename(beforeRestore ? "before-restore" : "backup"));
      setMessage("ファイルを書き出しました。保存先でファイルを確認してください。");
      if (beforeRestore) setSavedCopy(true);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "書き出しに失敗しました。"); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }

  function rescue(key: string) {
    setError(""); setMessage("");
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) throw new Error(key === RECOVERY_KEY ? "復元前の退避記録はまだありません。" : "この端末に保存された記録はありません。");
      downloadText(raw, filename(key === RECOVERY_KEY ? "recovery" : "saved-raw"));
      setMessage("保存されている内容をそのまま書き出しました。");
    } catch (e) { setError(e instanceof Error ? e.message : "保存記録を取得できませんでした。"); }
  }

  function cancel() { ++generation.current; task.current?.abort(); setPreview(null); setBusy(false); setSavedCopy(false); onPreviewChange(false); }

  function restore() {
    if (!preview || !savedCopy || busy) return;
    setError("");
    try {
      onRestore(preview.state);
      setPreview(null); setSavedCopy(false); onPreviewChange(false);
      setMessage("記録を復元しました。クラウド同期は停止し、この端末に保存しています。");
    } catch (e) { setError(e instanceof Error ? e.message : "復元できませんでした。元の記録は変更していません。"); }
  }

  return <section className="panel data-backup" aria-labelledby="backup-title">
    <div className="daily-plan-head"><strong id="backup-title"><ShieldCheck size={18} /> 記録の持ち出しと復元</strong><small>この端末の対局・途中の盤面・学習・会話・設定を、一つのファイルに残せます。</small></div>
    <div className="backup-actions">
      <button type="button" className="primary-button" onClick={() => void exportCurrent()} disabled={busy}><Download size={16} /> 記録を書き出す</button>
      <button type="button" className="secondary-button" onClick={() => input.current?.click()} disabled={busy}><Upload size={16} /> ファイルを読み込む</button>
      <input ref={input} type="file" accept=".json,application/json" aria-label="復元する記録ファイル" className="backup-file-input" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void readFile(file); }} />
    </div>
    <p className="daily-plan-note">書き出したファイルには会話も含まれます。自分で管理できる場所に保存してください。クラウドにだけ残る記録は、このファイルに含まれません。</p>
    {busy && <p role="status" className="backup-status">記録を確認しています…</p>}
    {preview && <div className="backup-preview" role="region" aria-label="復元内容の確認">
      <h3>復元する内容を確認</h3><p className="backup-filename">{fileName}</p>
      <dl className="backup-counts"><div><dt>対局</dt><dd>{preview.state.records.length}局</dd></div><div><dt>回答</dt><dd>{preview.state.lessonAttempts.length}件</dd></div><div><dt>達成</dt><dd>{preview.state.completed.length}件</dd></div><div><dt>会話</dt><dd>{preview.state.messages.length}件</dd></div></dl>
      <p>途中の盤面・対局レベル・規則も含め、この端末の記録を置き換えます。元の記録を先に書き出してください。</p>
      {preview.warnings.length > 0 && <ul>{preview.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
      <p className="daily-plan-note">復元後はクラウド同期を停止します。元の記録は端末にも1世代残ります。</p>
      <div className="backup-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void exportCurrent(true)}><Download size={15} /> 復元前の記録を書き出す</button><button type="button" className="primary-button" disabled={busy || !savedCopy} onClick={restore}>この内容で復元する</button><button type="button" className="text-button" onClick={cancel}>やめる</button></div>
      {savedCopy && <p className="daily-plan-note">書き出したファイルの保存を確認してから、復元してください。</p>}
    </div>}
    {error && <p className="backup-error" role="alert"><CircleHelp size={16} /> {error}</p>}
    {message && <p className="backup-status" role="status">{message}</p>}
    <details className="backup-recovery"><summary>保存記録をそのまま退避する</summary><p>読込みに問題がある場合や、復元前へ戻したい場合に使えます。</p><div className="backup-actions"><button type="button" className="text-button" onClick={() => rescue(STORAGE_KEY)}>端末の保存内容を書き出す</button><button type="button" className="text-button" onClick={() => rescue(RECOVERY_KEY)}>直前の復元前データを書き出す</button></div></details>
  </section>;
}
