"use client";

import { useMemo, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CircleHelp, Eye, Target } from "lucide-react";
import { ShogiBoard } from "./shogi-board";
import { legalMoves, moveName, usi } from "../lib/shogi";
import type { HandKind, MissedMate, Move, Square } from "../lib/shogi";
import type { RivalGameRecord } from "../lib/rival-chat";
import type { GameReview } from "../lib/shogi";
import type { LessonAttempt } from "../lib/lessons";
import { LESSONS } from "../lib/lessons";
import { replayRecord, studyPathForMissed } from "../lib/study-path";
import type { StudyPath } from "../lib/study-path";

export type StudyStart = { recordId: string; ply: number; path: StudyPath };

/**
 * KIF-032 P3: replay one recorded game, jump to the positions where a mate was missed,
 * try to find it on the board, then continue to the matching lesson and transfer problem.
 */
export function GameStudy({ record, review, reviewStatus, attempts, onStudy, onClose }: {
  record: RivalGameRecord; review?: GameReview; reviewStatus: string; attempts: LessonAttempt[];
  onStudy: (start: StudyStart) => void; onClose: () => void;
}) {
  const replay = useMemo(() => replayRecord(record), [record]);
  const last = replay.positions.length - 1;
  const firstMissed = review?.missed[0]?.ply;
  const [ply, setPly] = useState(firstMissed ?? last);
  const [selected, setSelected] = useState<Square | null>(null);
  const [drop, setDrop] = useState<HandKind | null>(null);
  const [tryResult, setTryResult] = useState<{ ply: number; move: string; ok: boolean } | null>(null);
  const [revealed, setRevealed] = useState<number | null>(null);
  const position = replay.positions[Math.min(ply, last)];
  const missed: MissedMate | undefined = review?.missed.find(m => m.ply === ply);
  const legal = useMemo(() => legalMoves(position), [position]);
  const trying = !!missed && !(tryResult?.ply === ply && tryResult.ok);

  function go(next: number) {
    setPly(Math.max(0, Math.min(last, next))); setSelected(null); setDrop(null); setTryResult(null);
  }
  function choose(move: Move) {
    if (!missed) return;
    const notation = usi(move);
    setTryResult({ ply, move: moveName(position, move), ok: missed.solutions.includes(notation) });
    setSelected(null); setDrop(null);
  }
  function onSquare(r: number, c: number) {
    if (!trying) return;
    const targets = legal.filter(m => m.to.r === r && m.to.c === c && (drop ? m.drop === drop : selected ? m.from?.r === selected.r && m.from?.c === selected.c : false));
    if (targets.length) {
      // With a promotion choice, a listed mating move is preferred; otherwise the unpromoted move.
      choose(targets.find(t => missed!.solutions.includes(usi(t))) ?? targets.find(t => !t.promote) ?? targets[0]);
      return;
    }
    const piece = position.board[r][c];
    if (piece?.owner === position.turn) { setSelected({ r, c }); setDrop(null); } else { setSelected(null); setDrop(null); }
  }
  const played = ply < record.moves.length ? legal.find(m => usi(m) === record.moves[ply]) : undefined;
  const path = missed ? studyPathForMissed(missed, attempts) : undefined;
  const lessonTitle = (id?: string) => LESSONS.find(l => l.id === id)?.title ?? "";
  const playerTurn = position.turn === "black";

  return (
    <section className="panel game-study" aria-label="対局の振り返り">
      <div className="daily-plan-head"><strong>{new Date(record.date).toLocaleDateString("ja-JP")}の対局を振り返る</strong><small>{record.moves.length}手 · {record.result === "black" ? "勝ち" : record.result === "white" ? "負け" : "引き分け"}</small><button type="button" className="text-button" onClick={onClose}>閉じる</button></div>
      {replay.error && <p className="daily-plan-note">第{replay.error.ply + 1}手（{replay.error.move}）を再生できないため、それ以降は表示していません。</p>}
      {review && review.missed.length > 0 && <div className="study-chips" role="list">{review.missed.map(m => <button key={m.ply} type="button" role="listitem" className={`study-chip ${m.ply === ply ? "study-chip-active" : ""} ${m.kind === "shorter-mate-available" ? "study-chip-chance" : ""}`} onClick={() => go(m.ply)}>第{m.ply + 1}手 {m.kind === "shorter-mate-available" ? "より短い詰み" : `${m.plies}手詰を逃した`}</button>)}</div>}
      {review && review.missed.length === 0 && review.complete && <p className="daily-plan-note">この対局では、1手詰・3手詰の見逃しは見つかりませんでした。</p>}
      {!review && <p className="daily-plan-note">{reviewStatus === "unavailable" ? "この端末では解析できませんでした。" : "詰みの見逃しを解析中…（再生はそのまま使えます）"}</p>}
      {review && !review.complete && <p className="daily-plan-note">第{review.analyzedPlies}手までしか解析していません。それ以降の見逃しは未確認です。</p>}
      <div className="study-board"><ShogiBoard game={position} selected={selected} selectedDrop={drop} legal={trying && playerTurn ? legal : []} onSquare={onSquare} onHand={kind => { if (trying) { setDrop(drop === kind ? null : kind); setSelected(null); } }} disabled={!trying || !playerTurn} /></div>
      <div className="replay-controls" role="group" aria-label="棋譜の再生">
        <button type="button" onClick={() => go(0)} aria-label="最初へ"><ChevronsLeft size={18} /></button>
        <button type="button" onClick={() => go(ply - 1)} aria-label="1手戻る"><ChevronLeft size={18} /></button>
        <input type="range" min={0} max={last} value={ply} onChange={e => go(Number(e.target.value))} aria-label="手数" />
        <button type="button" onClick={() => go(ply + 1)} aria-label="1手進む"><ChevronRight size={18} /></button>
        <button type="button" onClick={() => go(last)} aria-label="最後へ"><ChevronsRight size={18} /></button>
      </div>
      <p className="replay-label">{ply === 0 ? "開始局面" : `第${ply}手まで`}{played ? ` · 次の手 ${moveName(position, played)}（${playerTurn ? "あなた" : "棋友"}）` : ply === last ? " · 終局" : ""}</p>
      {missed && <div className={`study-card ${missed.kind === "shorter-mate-available" ? "study-card-chance" : ""}`}>
        <strong><Target size={16} /> {missed.kind === "shorter-mate-available" ? `指した手でも詰みでしたが、${missed.plies}手で詰む手もありました。` : `この局面には${missed.plies}手で詰む手がありました。`}</strong>
        <span>実戦の手：{played ? moveName(position, played) : record.moves[ply]}</span>
        {trying && <small>盤上で詰ませる初手を指してみよう（王手を続ける詰みのみ判定）。</small>}
        {tryResult?.ply === ply && <p role="status" className={tryResult.ok ? "feedback-success practice-feedback" : "practice-feedback"}>{tryResult.ok ? `正解です。${tryResult.move}で詰みます。` : `${tryResult.move}では${missed.plies}手以内に詰みません。もう一度探してみよう。`}</p>}
        {revealed === ply || tryResult?.ok ? <small>詰ませる初手：{missed.solutionNames.join("、")}</small> : <button type="button" className="text-button" onClick={() => setRevealed(ply)}><Eye size={15} /> 答えを見る</button>}
        {path ? <div className="study-next"><span>{path.reason}</span><span>① {lessonTitle(path.base)}{path.transfer ? ` → ② 応用：${lessonTitle(path.transfer)}` : ""}</span><button type="button" className="primary-button" onClick={() => onStudy({ recordId: record.id, ply, path })}><BookOpen size={15} /> 教材で練習する</button></div>
          : <small><CircleHelp size={13} /> 指した手でも詰んでいたため、弱点としては記録しません。より短い詰みを確認するだけで十分です。</small>}
      </div>}
    </section>
  );
}
