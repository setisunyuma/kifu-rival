"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowRight, BookOpen, Check, ChevronRight, CircleHelp, Clock3,
  Crown, Flag, History, Layers3, MessageCircle, RotateCcw, Send,
  Settings2, ShieldCheck, Sparkles, Swords, Target, Trophy, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  DECLARATION_RULE_LABELS, DeclarationRule, Game, HandKind, HAND_ORDER, Move, PIECE_NAMES, PROMOTED_NAMES, Side,
  Square, checkDeclaration, chooseRivalMove, declarationRuleOf, declareEntering, explainDeclaration,
  initialGame, legalMoves, playMove, shouldDeclare, toSfen, usi,
} from "../lib/shogi";
import { LessonAttempt, LESSONS, PlanItem, ROADMAP, acceptsLessonMove, createLessonAttempt, dailyPlan, masteredSkills, skillsForMissedMates } from "../lib/lessons";
import { RivalGameRecord, RivalMessage, rivalReply } from "../lib/rival-chat";
import { useGameReview } from "../hooks/use-game-review";
import { parseBackupOffThread } from "../hooks/backup-task";
import { DataBackupPanel } from "../components/data-backup-panel";
import type { SavedState } from "../lib/backup";
import { assertBackupCapacity } from "../lib/backup";
import { STORAGE_KEY, restoreSavedState } from "../lib/persistence";

type View = "play" | "learn" | "rival" | "history";
type ChatMessage = RivalMessage;
type GameRecord = RivalGameRecord;
type PromoteRequest = { moves: Move[]; learning: boolean };

const GREETING = "棋友です。今日はどんな一局になるだろう。盤上で交わした手も、そのあとに交わす言葉も、大事にしたい。";
const LEVELS = ["はじめて", "初級", "中級", "挑戦"];
const STANDARD_START = toSfen(initialGame());
const recordIdentity = (record: GameRecord) => JSON.stringify([record.startSfen ?? STANDARD_START, record.declarationRule ?? "jsa", record.result, record.moves]);
const NAV_ITEMS: { id: View; label: string; sub: string; icon: LucideIcon }[] = [
  { id: "play", label: "対局する", sub: "ライバルと一局", icon: Swords },
  { id: "learn", label: "教材モード", sub: "一歩ずつ上達", icon: BookOpen },
  { id: "rival", label: "棋友と話す", sub: "感想戦・雑談", icon: MessageCircle },
  { id: "history", label: "成長の記録", sub: "棋譜と達成状況", icon: Trophy },
];

function RivalFace({ large = false }: { large?: boolean }) {
  return (
    <div className={`rival-face ${large ? "rival-face-large" : ""}`} aria-label="棋友の肖像" role="img">
      <Image src="/kiyu-rival-portrait-v2.webp" alt="" width={400} height={400} unoptimized className="rival-portrait" />
    </div>
  );
}

function ShogiPiece({ name, owner, promoted }: { name: string; owner: Side; promoted: boolean }) {
  return (
    <svg className={`shogi-piece ${owner === "white" ? "piece-opponent" : ""} ${promoted ? "piece-promoted" : ""}`}
      viewBox="0 0 100 110" aria-hidden="true" focusable="false">
      <path className="piece-outline" d="M50 2 L92 19 L86 106 L14 106 L8 19 Z" />
      <path className="piece-inset" d="M50 8 L86 23 L81 101 L19 101 L14 23 Z" />
      <path className="piece-grain" d="M21 94 L25 37 M77 89 L75 39" />
      <text x="50" y="79" textAnchor="middle" className="piece-glyph">{name}</text>
    </svg>
  );
}

function HandDisplay({ game, side, active, selected, onChoose }: {
  game: Game; side: Side; active: boolean; selected?: HandKind | null; onChoose?: (kind: HandKind) => void;
}) {
  const owned = HAND_ORDER.filter(kind => game.hands[side][kind] > 0);
  return (
    <div className={`hand-area ${side === "white" ? "hand-opponent" : ""}`}>
      <span className="hand-label">{side === "black" ? "あなたの持ち駒" : "棋友の持ち駒"}</span>
      <div className="hand-pieces">
        {owned.length ? owned.map(kind => (
          <button
            key={kind} type="button" disabled={!active || !onChoose}
            onClick={() => onChoose?.(kind)}
            className={`hand-piece ${selected === kind ? "hand-piece-selected" : ""}`}
            aria-label={`${PIECE_NAMES[kind]} ${game.hands[side][kind]}枚`}
          >{PIECE_NAMES[kind]}<span className="piece-count">×{game.hands[side][kind]}</span></button>
        )) : <span className="hand-empty">まだありません</span>}
      </div>
    </div>
  );
}

function ShogiBoard({ game, selected, selectedDrop, legal, onSquare, onHand, disabled = false }: {
  game: Game; selected: Square | null; selectedDrop: HandKind | null; legal: Move[];
  onSquare: (r: number, c: number) => void; onHand: (kind: HandKind) => void; disabled?: boolean;
}) {
  const possible = (r: number, c: number) => legal.some(move => move.to.r === r && move.to.c === c &&
    (selectedDrop ? move.drop === selectedDrop : selected ? move.from?.r === selected.r && move.from?.c === selected.c : false));
  const last = game.lastMove;
  return (
    <div className="board-component">
      <HandDisplay game={game} side="white" active={false} />
      <div className="board-frame">
        <div className="board-top-coords">{"９８７６５４３２１".split("").map(x => <span key={x}>{x}</span>)}</div>
        <div className="board-position">
          <div className="shogi-board" role="grid" aria-label="将棋盤。先手が下側です">
            {game.board.map((row, r) => row.map((piece, c) => {
              const active = selected?.r === r && selected?.c === c;
              const highlighted = last && ((last.to.r === r && last.to.c === c) || (last.from?.r === r && last.from?.c === c));
              return (
                <button
                  key={`${r}-${c}`} role="gridcell" type="button" disabled={disabled} onClick={() => onSquare(r, c)}
                  aria-label={`${9 - c}${"一二三四五六七八九"[r]} ${piece ? `${piece.owner === "black" ? "先手" : "後手"}${piece.promoted ? PROMOTED_NAMES[piece.kind] : PIECE_NAMES[piece.kind]}` : "空きマス"}`}
                  className={`board-square ${active ? "square-selected" : ""} ${possible(r, c) ? "square-possible" : ""} ${highlighted ? "square-last" : ""}`}
                >
                  {piece && <ShogiPiece name={piece.kind === "OU" && piece.owner === "white" ? "王" : piece.promoted ? PROMOTED_NAMES[piece.kind] : PIECE_NAMES[piece.kind]} owner={piece.owner} promoted={piece.promoted} />}
                  {possible(r, c) && !piece && <span className="move-dot" />}
                </button>
              );
            }))}
          </div>
          <div className="board-side-coords">{"一二三四五六七八九".split("").map(x => <span key={x}>{x}</span>)}</div>
        </div>
      </div>
      <HandDisplay game={game} side="black" active={!disabled && game.turn === "black" && game.result === "playing"} selected={selectedDrop} onChoose={onHand} />
    </div>
  );
}

export default function RivalApp() {
  const [view, setView] = useState<View>("play");
  const [game, setGame] = useState<Game>(initialGame);
  const [level, setLevel] = useState(2);
  const [selected, setSelected] = useState<Square | null>(null);
  const [selectedDrop, setSelectedDrop] = useState<HandKind | null>(null);
  const [promotion, setPromotion] = useState<PromoteRequest | null>(null);
  const [lessonIndex, setLessonIndex] = useState(0);
  const [practice, setPractice] = useState<Game>(() => LESSONS[0].setup());
  const [practiceSelected, setPracticeSelected] = useState<Square | null>(null);
  const [practiceDrop, setPracticeDrop] = useState<HandKind | null>(null);
  const [completed, setCompleted] = useState<string[]>([]);
  // Answers to lessons, kept on this device only (KIF-032 minimal loop).
  const [attempts, setAttempts] = useState<LessonAttempt[]>([]);
  const [attemptRecorded, setAttemptRecorded] = useState(false);
  const [seenLessons, setSeenLessons] = useState<string[]>([]);
  const [pendingHints, setPendingHints] = useState<string[]>([]);

  const [lessonFeedback, setLessonFeedback] = useState("");
  const [solvedMove, setSolvedMove] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [records, setRecords] = useState<GameRecord[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "rival", text: GREETING }]);
  const [draft, setDraft] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [toast, setToast] = useState("");
  // Entering-king rule for the NEXT game. The current game's rule is fixed in game.declarationRule (ADR-011).
  const [ruleSetting, setRuleSetting] = useState<DeclarationRule>("jsa");
  const [declaring, setDeclaring] = useState(false);
  const chatScroll = useRef<HTMLDivElement>(null);
  const [storageError, setStorageError] = useState("");
  const [cloudStatus, setCloudStatus] = useState<"checking" | "limited" | "unavailable" | "failed" | "paused">("checking");
  const [cloudSyncPaused, setCloudSyncPaused] = useState(false);
  const [importPreview, setImportPreview] = useState(false);
  const saveAllowed = useRef(true);
  const cloudPaused = useRef(false);
  const dataRevision = useRef(0);
  const snapshot = useMemo<SavedState>(() => ({ game, level, declarationRule: ruleSetting, completed, lessonAttempts: attempts, records, messages, cloudSyncPaused, seenLessons, pendingHints }), [game, level, ruleSetting, completed, attempts, records, messages, cloudSyncPaused, seenLessons, pendingHints]);
  const currentSnapshot = useRef(snapshot);
  useEffect(() => { currentSnapshot.current = snapshot; }, [snapshot]);

  function applySavedState(saved: SavedState) {
    currentSnapshot.current = saved;
    setGame(saved.game); setLevel(saved.level); setRuleSetting(saved.declarationRule);
    setCompleted(saved.completed); setAttempts(saved.lessonAttempts); setRecords(saved.records); setMessages(saved.messages);
    setSeenLessons(saved.seenLessons ?? saved.lessonAttempts.map(a => a.lessonId));
    setPendingHints(saved.pendingHints ?? []);
    cloudPaused.current = saved.cloudSyncPaused === true;
    setCloudSyncPaused(cloudPaused.current);
  }

  function hasRoom(candidate: SavedState): boolean {
    try { assertBackupCapacity(candidate); return true; }
    catch (error) {
      setStorageError(`${error instanceof Error ? error.message : "保存できる容量の上限です。"} この操作は記録に反映していません。今の記録を書き出して保管してください。`);
      return false;
    }
  }

  async function loadCloudProgress(revision: number, signal?: AbortSignal) {
    if (cloudPaused.current || !saveAllowed.current) return;
    try {
      const response = await fetch("/api/progress", { signal });
      if (signal?.aborted || revision !== dataRevision.current || cloudPaused.current) return;
      if (!response.ok) { setCloudStatus(response.status === 401 || response.status === 403 || response.status === 503 ? "unavailable" : "failed"); return; }
      const cloud = await response.json() as { completed?: unknown; games?: unknown };
      if ((cloud.completed !== undefined && !Array.isArray(cloud.completed)) || (cloud.games !== undefined && !Array.isArray(cloud.games))) throw new Error("Invalid cloud data");
      const remote = ((cloud.games ?? []) as { id: number; result: GameRecord["result"]; moves: string[]; createdAt: string }[]).map(x => ({ id: `cloud-${x.id}`, result: x.result, moves: x.moves, date: x.createdAt }));
      const existing = currentSnapshot.current;
      const fingerprints = new Set(existing.records.map(recordIdentity));
      const additions = remote.filter(r => !fingerprints.has(recordIdentity(r)));
      const candidate = { ...existing, records: [...existing.records, ...additions], completed: [...new Set([...existing.completed, ...((cloud.completed ?? []) as string[])])] };
      const { state } = await parseBackupOffThread(JSON.stringify(candidate), signal);
      if (signal?.aborted || revision !== dataRevision.current || cloudPaused.current) return;
      // Merge only the cloud-owned collections, preserving moves and settings changed while awaiting validation.
      const latest = currentSnapshot.current;
      const keys = new Set(latest.records.map(recordIdentity));
      const mergedRecords = [...latest.records, ...state.records.filter(r => !keys.has(recordIdentity(r)))].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      const mergedCompleted = [...new Set([...latest.completed, ...state.completed])];
      const merged = { ...latest, records: mergedRecords, completed: mergedCompleted };
      try { assertBackupCapacity(merged); }
      catch {
        setCloudStatus("failed");
        setStorageError("クラウドの記録を加えると端末の保存上限を超えるため、追加を停止しました。端末の記録を書き出して保管してください。");
        return;
      }
      currentSnapshot.current = merged;
      setCompleted(mergedCompleted);
      setRecords(mergedRecords);
      setCloudStatus(previous => previous === "failed" ? previous : "limited");
    } catch { if (!signal?.aborted && revision === dataRevision.current && !cloudPaused.current) setCloudStatus("failed"); }
  }

  function sendProgress(payload: Record<string, unknown>) {
    if (cloudPaused.current || !saveAllowed.current) return;
    const revision = dataRevision.current;
    void fetch("/api/progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then(response => {
        if (revision !== dataRevision.current || cloudPaused.current) return;
        if (!response.ok) setCloudStatus(response.status === 401 || response.status === 403 || response.status === 503 ? "unavailable" : "failed");
        else setCloudStatus(previous => previous === "failed" ? previous : "limited");
      }).catch(() => { if (revision === dataRevision.current && !cloudPaused.current) setCloudStatus("failed"); });
  }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw !== null) {
          const { state } = await parseBackupOffThread(raw, controller.signal);
          if (!active) return;
          applySavedState(state);
        }
      } catch (error) {
        if (!active) return;
        saveAllowed.current = false;
        setStorageError(`保存記録を読み込めなかったため、自動保存を停止しています。成長の記録から元の保存内容を退避できます。${error instanceof Error ? ` ${error.message}` : ""}`);
      }
      if (!active) return;
      setHydrated(true);
      if (cloudPaused.current) setCloudStatus("paused");
      else if (saveAllowed.current) void loadCloudProgress(dataRevision.current, controller.signal);
      else setCloudStatus("unavailable");
    })();
    return () => { active = false; controller.abort(); };
    // Boot owns the initial hydration; later snapshots are saved by the effect below.
  }, []);

  useEffect(() => {
    if (!hydrated || !saveAllowed.current) return;
    try { assertBackupCapacity(snapshot); window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); queueMicrotask(() => setStorageError("")); }
    catch (error) { queueMicrotask(() => setStorageError(`端末への保存に失敗しました。画面の記録は保持しています。成長の記録からファイルへ書き出してください。${error instanceof Error ? ` ${error.message}` : ""}`)); }
  }, [hydrated, snapshot]);

  // Scroll only within the chat panel. scrollIntoView used to drag the whole
  // iPhone page down to the chat, hiding the board immediately after opening.
  useEffect(() => {
    if (chatScroll.current) chatScroll.current.scrollTop = chatScroll.current.scrollHeight;
  }, [messages, view]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const moves = useMemo(() => legalMoves(game), [game]);
  const gameRule = declarationRuleOf(game);
  const myDeclaration = useMemo(() => checkDeclaration(game, "black"), [game]);
  const practiceMoves = useMemo(() => legalMoves(practice), [practice]);
  const lesson = LESSONS[lessonIndex];
  // Computed only after hydration so the server render and the first client render agree.
  // Review of the last 3 games in a Web Worker (KIF-032): never blocks the screen.
  const recentGames = useMemo(() => (hydrated ? records.slice(0, 3).map(r => ({ id: r.id, date: r.date, moves: r.moves, startSfen: r.startSfen, declarationRule: r.declarationRule })) : []), [hydrated, records]);
  const gameReview = useGameReview(recentGames);
  const reviewed = gameReview.results;
  const gameSkills = useMemo(() => skillsForMissedMates(reviewed.flatMap(r => r.review.missed)), [reviewed]);
  const todayPlan: PlanItem[] = useMemo(() => (hydrated ? dailyPlan(attempts, new Date(), LESSONS, gameSkills) : []), [hydrated, attempts, gameSkills]);
  const confirmedSkills = useMemo(() => masteredSkills(attempts), [attempts]);
  const stats = { won: records.filter(x => x.result === "black").length, lost: records.filter(x => x.result === "white").length };

  function saveMatch(result: GameRecord["result"], position: Game) {
    const notation = position.history.map(usi);
    const completeLog = position.positionLog?.length === position.history.length + 1;
    const start = completeLog ? position.positionLog![0].key : undefined;
    const startSfen = start && start !== STANDARD_START ? start : undefined;
    const record: GameRecord = { id: `${Date.now()}-${Math.random()}`, date: new Date().toISOString(), result, moves: notation, declarationRule: declarationRuleOf(position), ...(startSfen ? { startSfen } : {}) };
    const latest = currentSnapshot.current;
    const nextRecords = [record, ...latest.records];
    if (!hasRoom({ ...latest, game: { ...position, result }, records: nextRecords })) return false;
    setRecords(nextRecords);
    // The existing cloud schema describes games from the standard starting position.
    if (!startSfen) sendProgress({ type: "game", result, moves: notation });
    return true;
  }

  function commitMove(position: Game, move: Move) {
    finishOrContinue(playMove(position, move));
  }

  function finishOrContinue(next: Game) {
    if (next.result === "playing") { if (!hasRoom({ ...currentSnapshot.current, game: next })) return false; }
    else if (!saveMatch(next.result, next)) return false;
    setGame(next);
    setSelected(null);
    setSelectedDrop(null);
    setDeclaring(false);
    if (next.result !== "playing") {
      setToast(next.result === "black" ? "あなたの勝ちです。" : next.result === "draw" ? "引き分けになりました。" : "対局が終わりました。");
    }
    return true;
  }

  function confirmDeclaration() {
    if (game.turn !== "black" || game.result !== "playing") return;
    finishOrContinue(declareEntering(game, "match").game);
  }

  const thinking = hydrated && !importPreview && game.turn === "white" && game.result === "playing";
  useEffect(() => {
    if (!hydrated || importPreview || game.turn !== "white" || game.result !== "playing") return;
    const timer = window.setTimeout(() => {
      if (shouldDeclare(game)) { finishOrContinue(declareEntering(game, "match").game); return; }
      const move = chooseRivalMove(game, level);
      if (move) commitMove(game, move);
    }, 500);
    return () => window.clearTimeout(timer);
    // commitMove operates on the immutable game snapshot supplied to this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, level, hydrated, importPreview]);

  function completeLesson() {
    if (completed.includes(lesson.id)) return;
    setCompleted(prev => [...prev, lesson.id]);
    sendProgress({ type: "lesson", lessonId: lesson.id });
  }

  function runMove(move: Move, learning: boolean) {
    setPromotion(null);
    if (!learning) { commitMove(game, move); return; }
    setPracticeSelected(null); setPracticeDrop(null);
    const correct = acceptsLessonMove(lesson, usi(move));
    const nextAttempts = attemptRecorded ? attempts : [...attempts, createLessonAttempt(lesson.id, correct, new Date().toISOString(), attempts, pendingHints.includes(lesson.id), seenLessons)];
    const nextSeen = attemptRecorded ? seenLessons : [...new Set([...seenLessons, lesson.id])];
    const nextHints = attemptRecorded ? pendingHints : pendingHints.filter(id => id !== lesson.id);
    if (!hasRoom({ ...snapshot, lessonAttempts: nextAttempts, seenLessons: nextSeen, pendingHints: nextHints, completed: correct ? [...new Set([...completed, lesson.id])] : completed })) return;
    // Record only the first answer per visit, so trying several moves is not counted as several mistakes.
    if (!attemptRecorded) {
      setAttempts(nextAttempts);
      setSeenLessons(nextSeen);
      setPendingHints(nextHints);
      setAttemptRecorded(true);
    }
    if (!correct) {
      setLessonFeedback("その手も考えられるね。今回は、お題の手を探してみよう。");
      return;
    }
    setPractice(playMove(practice, move));
    setSolvedMove(usi(move));
    setLessonFeedback(lesson.variations?.length ? "正解です。詰みへつながる初手を選べました。手順と狙いも確かめよう。" : "正解です。手の意味を確かめて、次の一手へ。");
    completeLesson();
  }

  function handleSquare(r: number, c: number, learning: boolean) {
    const current = learning ? practice : game;
    const available = learning ? practiceMoves : moves;
    const selection = learning ? practiceSelected : selected;
    const drop = learning ? practiceDrop : selectedDrop;
    const setSelection = learning ? setPracticeSelected : setSelected;
    const setDrop = learning ? setPracticeDrop : setSelectedDrop;
    if (current.result !== "playing" || current.turn !== "black" || (!learning && thinking) || (learning && lessonFeedback.startsWith("正解です"))) return;
    const targets = available.filter(m => m.to.r === r && m.to.c === c && (drop ? m.drop === drop : selection ? m.from?.r === selection.r && m.from?.c === selection.c : false));
    if (targets.length) {
      if (targets.length > 1) setPromotion({ moves: targets, learning });
      else runMove(targets[0], learning);
      return;
    }
    const piece = current.board[r][c];
    if (piece?.owner === "black") { setSelection({ r, c }); setDrop(null); }
    else { setSelection(null); setDrop(null); }
  }

  function handleHand(kind: HandKind, learning: boolean) {
    if (learning) { setPracticeDrop(practiceDrop === kind ? null : kind); setPracticeSelected(null); }
    else { setSelectedDrop(selectedDrop === kind ? null : kind); setSelected(null); }
  }

  function newGame() {
    setGame(initialGame(ruleSetting)); setSelected(null); setSelectedDrop(null); setPromotion(null); setDeclaring(false);
    setToast("新しい対局を始めました。");
  }

  function resign() {
    if (game.result !== "playing" || game.history.length === 0) { newGame(); return; }
    if (finishOrContinue({ ...game, result: "white" })) setToast("投了を記録しました。");
  }

  function chooseLesson(index: number) {
    setLessonIndex(index); setPractice(LESSONS[index].setup()); setPracticeSelected(null); setPracticeDrop(null); setAttemptRecorded(false);
    setLessonFeedback(""); setSolvedMove(""); setShowHint(false); setPromotion(null);
  }

  function restoreSnapshot(incoming: SavedState) {
    let restored: SavedState;
    const normalized = { ...incoming, cloudSyncPaused: true, seenLessons: incoming.seenLessons ?? [...new Set(incoming.lessonAttempts.map(a => a.lessonId))], pendingHints: incoming.pendingHints ?? [] };
    assertBackupCapacity(normalized);
    try { restored = restoreSavedState(window.localStorage, normalized, snapshot); }
    catch { throw new Error("端末に復元できませんでした。保存容量やブラウザの設定を確認してください。元の保存記録は変更していません。"); }
    dataRevision.current += 1;
    saveAllowed.current = true;
    applySavedState(restored);
    setCloudStatus("paused"); setStorageError("");
    setSelected(null); setSelectedDrop(null); setDeclaring(false); setDraft("");
    chooseLesson(lessonIndex);
    setToast("記録を復元しました。");
  }

  function resumeCloudSync() {
    if (!window.confirm("クラウド同期を再開します。クラウドの対局と達成記録を、この端末の記録に追加します。よろしいですか？")) return;
    cloudPaused.current = false; setCloudSyncPaused(false); setCloudStatus("checking");
    const revision = ++dataRevision.current;
    void loadCloudProgress(revision);
  }

  function sendChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim().slice(0, 500);
    if (!text) return;
    const reply = rivalReply(text, { game, records, completedLessons: completed.length, recentMessages: messages });
    const nextMessages = [...messages, { role: "me" as const, text }, { role: "rival" as const, text: reply }];
    if (!hasRoom({ ...snapshot, messages: nextMessages })) return;
    setMessages(nextMessages);
    setDraft("");
    sendProgress({ type: "chat", userText: text, replyText: reply });
  }

  function chatPanel(compact = false) {
    return (
      <section className={`panel chat-panel ${compact ? "chat-panel-compact" : ""}`}>
        <div className="chat-panel-header">
          <RivalFace />
          <div className="chat-panel-title"><strong>棋友との対話</strong><span><i className="online-dot" /> 対局の記録をたどりながら</span></div>
          <span className="chat-bubble-icon"><MessageCircle size={16} /></span>
        </div>
        <div className="chat-messages" ref={chatScroll}>
          {messages.slice(-80).map((m, i) => (
            <div key={i} className={`chat-line ${m.role === "me" ? "chat-line-me" : ""}`}>
              {m.role === "rival" && <RivalFace />}
              <p className={`chat-text ${m.role === "me" ? "chat-text-me" : ""}`}>{m.text}</p>
            </div>
          ))}
        </div>
        <form onSubmit={sendChat} className="chat-input-row">
          <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="棋友に話しかける..." maxLength={500} aria-label="棋友へのメッセージ" />
          <button type="submit" disabled={!draft.trim()} aria-label="送信"><Send size={17} /></button>
        </form>
        <p className="preview-note">現在は記録に基づく会話の試作版。自由会話と詳細な局面解析にはまだ対応していません。</p>
      </section>
    );
  }

  return (
    <div className="app-frame">
      <aside className="desktop-sidebar">
        <div className="brand"><div className="brand-seal">棋</div><div><strong>棋友 <small>KIYU</small></strong><span>棋譜を重ね、技を磨く。</span></div></div>
        <div className="sidebar-divider" />
        <p className="sidebar-eyebrow">THE ART OF SHOGI</p>
        <nav className="sidebar-links" aria-label="メインメニュー">
          {NAV_ITEMS.map(item => <button key={item.id} onClick={() => setView(item.id)} className={`nav-link ${view === item.id ? "nav-active" : ""}`}>
            <item.icon size={20} strokeWidth={1.8} /><span><strong>{item.label}</strong><small>{item.sub}</small></span>{view === item.id && <span className="nav-active-dot" />}
          </button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-rival"><RivalFace /><div><strong>次の一手を、共に。</strong><span>盤上で待っています。</span></div></div>
          <div className="sidebar-foot"><span className="sync-indicator" /> {storageError ? "保存を確認してください" : "端末に自動保存"} <span>·</span> EARLY ACCESS</div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-path"><span>棋友</span><ChevronRight size={14} /> <strong>{NAV_ITEMS.find(x => x.id === view)?.label}</strong></div>
          <div className="topbar-actions"><span className="alpha-pill">PRIVATE PREVIEW · α</span><div className="topbar-user">私</div></div>
        </header>

        {!hydrated && <p className="loading-records" role="status">端末の記録を確認しています…</p>}
        {storageError && <div className="storage-warning" role="alert"><CircleHelp size={18} /><p>{storageError}</p><button type="button" className="text-button" onClick={() => setView("history")}>記録の退避へ</button></div>}
        <div className="content-wrap" inert={!hydrated} aria-busy={!hydrated}>
          {view === "play" && <>
            <div className="page-header"><div><p className="eyebrow"><span>―</span> TODAY&apos;S MATCH</p><h1>一手ずつ、深く。</h1><p>静かに考え、指し、振り返る。棋譜に残る一局を。</p></div><div className="header-stats"><span><Swords size={15} /> 通算 {records.length} 局</span><span><Trophy size={15} /> {stats.won} 勝</span></div></div>
            <div className="play-layout">
              <section className="panel board-panel">
                <div className="board-panel-head"><div><p className="section-eyebrow">PRACTICE MATCH · 棋譜</p><h2>棋友との対局</h2></div><span className="mode-chip"><span /> 練習対局</span></div>
                <div className="board-status-row"><div className="player-label"><RivalFace /><div><strong>棋友 <small>AI</small></strong><span>対局AI · 調整中</span></div></div><span className="turn-badge">{game.result !== "playing" ? "対局終了" : thinking ? "考慮中" : game.turn === "white" ? "棋友の手番" : "あなたの手番"}</span></div>
                <div className="board-padding"><ShogiBoard game={game} selected={selected} selectedDrop={selectedDrop} legal={moves} onSquare={(r, c) => handleSquare(r, c, false)} onHand={kind => handleHand(kind, false)} disabled={game.turn !== "black" || game.result !== "playing" || thinking} /></div>
                <div className="board-actions"><button type="button" className="secondary-button" onClick={newGame}><RotateCcw size={15} /> 新しい対局</button><button type="button" className="text-button" onClick={resign} disabled={game.result !== "playing" || game.history.length === 0}><Flag size={15} /> 投了する</button>{game.result === "playing" && game.turn === "black" && !thinking && myDeclaration.kingInCamp && !declaring && <button type="button" className="secondary-button declare-button" onClick={() => setDeclaring(true)}><Crown size={15} /> 入玉宣言</button>}<span className="move-count">第 {game.history.length} 手</span></div>
                {declaring && game.result === "playing" && <div className="declare-panel" role="dialog" aria-label="入玉宣言の確認">
                  <strong>入玉宣言の確認 <small>{DECLARATION_RULE_LABELS[gameRule]}</small></strong>
                  <ul>{explainDeclaration(myDeclaration).map(item => <li key={item.text} className={item.ok ? "declare-ok" : "declare-ng"}>{item.ok ? "○" : "×"} {item.text}</li>)}</ul>
                  <p>{myDeclaration.outcome === "win" ? "このまま宣言すると、あなたの勝ちです。" : myDeclaration.outcome === "draw" ? "このまま宣言すると、引き分け（指し直し相当）です。" : "条件を満たしていません。規則どおり、宣言するとあなたの負けになります。"}</p>
                  <div className="declare-actions"><button type="button" className="secondary-button" onClick={() => setDeclaring(false)}>やめる</button><button type="button" className={myDeclaration.outcome === "lose" ? "text-button" : "primary-button"} onClick={confirmDeclaration}>宣言する</button></div>
                </div>}
                {game.result !== "playing" && <div className="result-banner"><Crown size={19} /> {game.result === "black" ? "対局終了。あなたの勝ちです。" : game.result === "white" ? "対局終了。棋友の勝ちです。" : "対局終了。引き分けです。"}{game.declaration && <span className="declare-note">入玉宣言（{game.declaration.side === "black" ? "あなた" : "棋友"}・{game.declaration.points}点）</span>}<button onClick={newGame}>もう一局 <ArrowRight size={14} /></button></div>}
                <p className="board-disclaimer"><CircleHelp size={13} /> 現在は基本的な合法手に対応する練習AIです。棋力や一部の細かな反則判定は開発途中です。</p>
              </section>
              <aside className="play-rail">
                <section className="panel rival-card"><div className="rival-card-art"><RivalFace large /></div><div className="rival-card-copy"><span className="tiny-label">YOUR RIVAL / 棋友</span><h3>今日も、良い将棋を。</h3><p>互いに考え抜いた一手を重ねよう。勝っても負けても、次の一局が楽しみだ。</p></div><div className="level-select"><label htmlFor="difficulty"><Settings2 size={14} /> 対局レベル</label><select id="difficulty" value={level} onChange={e => setLevel(Number(e.target.value))}>{LEVELS.map((name, i) => <option key={name} value={i + 1}>Lv.{i + 1} · {name}</option>)}</select></div><div className="level-select"><label htmlFor="declaration-rule"><Crown size={14} /> 入玉宣言</label><select id="declaration-rule" value={ruleSetting} onChange={e => { const rule = e.target.value as DeclarationRule; setRuleSetting(rule); if (game.history.length === 0 && game.result === "playing") setGame(prev => ({ ...prev, declarationRule: rule })); }}><option value="jsa">連盟規則（31点）</option><option value="amateur27">27点法</option></select>{ruleSetting !== gameRule && <small className="rule-note">この対局は{gameRule === "jsa" ? "連盟規則" : "27点法"}。次の対局から変わります。</small>}</div></section>
                {chatPanel(true)}
                <button className="small-lesson-card" onClick={() => setView("learn")}><span className="mini-lesson-icon"><BookOpen size={20} /></span><span><strong>教材で、一手を磨く</strong><small>{completed.length} / {LESSONS.length} レッスン修了</small></span><ChevronRight size={17} /><span className="mini-progress" style={{ width: `${(completed.length / LESSONS.length) * 100}%` }} /></button>
              </aside>
            </div>
          </>}

          {view === "learn" && <>
            <div className="page-header"><div><p className="eyebrow"><span>―</span> STUDY / 学び</p><h1>将棋を、深く知る。</h1><p>駒の動きから戦型の構想へ。初めの一手を丁寧に。</p></div><div className="header-stats"><span><Check size={15} /> {completed.length} / {LESSONS.length} 修了</span></div></div>
            <div className="learning-progress"><div><span>YOUR PROGRESS</span><strong>基礎コース</strong></div><div className="progress-track"><span style={{ width: `${(completed.length / LESSONS.length) * 100}%` }} /></div><strong>{Math.round(completed.length / LESSONS.length * 100)}%</strong></div>
            {todayPlan.length > 0 && <section className="panel daily-plan"><div className="daily-plan-head"><strong>今日の課題</strong><small>復習・苦手・実戦・新しいレッスンから最大3問。回答はこの端末に保存されます。</small></div><div className="daily-plan-list">{todayPlan.map(item => { const index = LESSONS.findIndex(l => l.id === item.lessonId); const l = LESSONS[index]; return <button key={item.lessonId} type="button" onClick={() => chooseLesson(index)} className={`daily-plan-item plan-${item.reason}`}><span>{item.reason === "review" ? "復習" : item.reason === "weak" ? "苦手" : item.reason === "game" ? "実戦" : "新しい"}</span><strong>{l.title}</strong><ChevronRight size={15} /></button>; })}</div><p className="daily-plan-note">同じ問題で復習し、局面を変えた応用問題で力を確かめます。日を空けた初見・ヒントなしの回答を、習熟の確認に使います（基準は試行中）。{confirmedSkills.size > 0 && ` 確認できた技能：${confirmedSkills.size}件。`}</p></section>}
            <div className="learn-layout"><section className="panel lesson-list-panel"><div className="list-heading"><h2>学びの道のり</h2><p>レッスンを選んで始めよう</p></div><div className="lesson-list">
              {LESSONS.map((item, index) => <button key={item.id} onClick={() => chooseLesson(index)} className={`lesson-item ${lessonIndex === index ? "lesson-selected" : ""}`}><span className={`lesson-index ${completed.includes(item.id) ? "lesson-done" : ""}`}>{completed.includes(item.id) ? <Check size={15} /> : `${index + 1}`}</span><span className="lesson-info"><small>STAGE {item.stage} · {item.category}</small><strong>{item.title}</strong><span>{item.summary}</span></span><ChevronRight size={16} /></button>)}
            </div><div className="roadmap-heading"><Layers3 size={17} /> この先の学び <span>COMING SOON</span></div><div className="roadmap-list">{ROADMAP.map(item => <div className="roadmap-item" key={item.stage}><span>{item.stage}</span><div><strong>{item.title}</strong><small>{item.summary}</small></div><span className="roadmap-lock">準備中</span></div>)}</div></section>
              <section className="panel lesson-stage"><div className="lesson-head"><span className="lesson-step">LESSON {String(lessonIndex + 1).padStart(2, "0")} / {String(LESSONS.length).padStart(2, "0")}</span><span className="lesson-category">{lesson.category}{lesson.transfer ? " · 応用" : ""}</span></div><h2>{lesson.title}</h2><p className="lesson-explanation">{lesson.explanation}</p><div className="lesson-goal"><Target size={19} /><div><small>今回のチャレンジ</small><strong>{lesson.goal}</strong></div></div>
              <div className="lesson-board"><ShogiBoard game={practice} selected={practiceSelected} selectedDrop={practiceDrop} legal={practiceMoves} onSquare={(r, c) => handleSquare(r, c, true)} onHand={kind => handleHand(kind, true)} disabled={lessonFeedback.startsWith("正解です")} /></div>
              {lessonFeedback && <div role="status" className={`practice-feedback ${lessonFeedback.startsWith("正解です") ? "feedback-success" : ""}`}>{lessonFeedback.startsWith("正解です") ? <Check size={17} /> : <CircleHelp size={17} />}{lessonFeedback}</div>}
              {solvedMove && lesson.variations && <div className="lesson-solution"><h3>詰みまでの手順</h3>{lesson.variations.filter(v => v.moves[0] === solvedMove).map(v => <p key={v.moves.join(" ")}>{v.explanation}</p>)}<small>今回は初手の選択を記録しました。相手の応手と最後の手も、盤面を思い浮かべて確かめよう。</small></div>}
              {showHint && <div className="hint-box"><Sparkles size={18} /> {lesson.hint}</div>}
              <div className="lesson-actions"><button className="secondary-button" onClick={() => { if (!showHint && !attemptRecorded) { const hints = [...new Set([...pendingHints, lesson.id])]; if (!hasRoom({ ...snapshot, pendingHints: hints })) return; setPendingHints(hints); } setShowHint(v => !v); }}><CircleHelp size={16} /> {showHint ? "ヒントを隠す" : "ヒントを見る"}</button><button className="text-button" onClick={() => chooseLesson(lessonIndex)}><RotateCcw size={15} /> やり直す</button>{lessonFeedback.startsWith("正解です") && <button className="primary-button" onClick={() => chooseLesson(Math.min(lessonIndex + 1, LESSONS.length - 1))}>{lessonIndex === LESSONS.length - 1 ? "もう一度" : "次のレッスン"} <ArrowRight size={16} /></button>}</div>
              </section></div>
          </>}

          {view === "rival" && <>
            <div className="page-header"><div><p className="eyebrow"><span>―</span> RIVAL / 対話</p><h1>盤を離れて、言葉を交わす。</h1><p>勝敗を認め、手を振り返る。その先に、良いライバルがいる。</p></div></div>
            <div className="rival-layout"><section className="panel rival-profile"><div className="profile-art"><RivalFace large /></div><span className="tiny-label">YOUR SHOGI RIVAL / V.02</span><h2>棋友 <small>KIYU</small></h2><p>いろんな戦型を指せる相手を目指している。今はまだ練習相手としての初期段階だけれど、対局の記録は正確に受け止めたい。</p><div className="profile-tags"><span>全戦型への対応を目標に</span><span>一局ごとに記録する</span><span>試作版</span></div><div className="profile-stats"><div><strong>{records.length}</strong><span>一緒に指した局</span></div><div><strong>{completed.length}</strong><span>学んだ項目</span></div></div><div className="profile-notice"><CircleHelp size={17} /><span>対局情報を使った返答には対応しました。自由な自然言語会話と詳細な感想戦は、これからの開発課題です。</span></div><button className="secondary-button" onClick={() => setView("play")}><Swords size={17} /> 対局する <ArrowRight size={15} /></button></section>{chatPanel()}</div>
          </>}

          {view === "history" && <>
            <div className="page-header"><div><p className="eyebrow"><span>―</span> ARCHIVE / 棋譜</p><h1>指した一手が、残っていく。</h1><p>自分の将棋を、いつでも振り返れるように。</p></div></div>
            <div className="history-cards"><div className="panel history-stat"><span><Swords size={19} /></span><strong>{records.length}</strong><small>対局数</small></div><div className="panel history-stat"><span><Trophy size={19} /></span><strong>{stats.won}</strong><small>勝利数</small></div><div className="panel history-stat"><span><BookOpen size={19} /></span><strong>{completed.length}</strong><small>修了レッスン</small></div><div className="panel history-stat"><span><Zap size={19} /></span><strong>{records.length ? Math.round(stats.won / records.length * 100) : 0}%</strong><small>勝率</small></div></div>
            <div className="save-status" role="status"><span>{storageError ? "端末：保存を確認してください" : "端末：保存済み"}</span><span>{cloudStatus === "paused" ? "クラウド：復元後の同期を停止中" : cloudStatus === "checking" ? "クラウド：接続を確認中" : cloudStatus === "limited" ? "クラウド：対局・達成・会話の一部を同期" : cloudStatus === "failed" ? "クラウド：同期に失敗（端末の記録は保持）" : "クラウド：この環境では同期できません"}</span>{cloudStatus === "paused" && <button type="button" className="text-button" onClick={resumeCloudSync}>同期を再開</button>}</div>
            <DataBackupPanel snapshot={snapshot} onRestore={restoreSnapshot} onPreviewChange={setImportPreview} />
            {recentGames.length > 0 && (() => {
              const items = reviewed.flatMap(r => r.review.missed.map(m => ({ r, m })));
              const incomplete = reviewed.filter(r => !r.review.complete);
              const names = (list: string[]) => list.slice(0, 3).join("、") + (list.length > 3 ? ` ほか${list.length - 3}通り` : "");
              const reason = (x: string | undefined) => x === "time-limit" ? "時間の上限" : x === "illegal-move" ? "読めない手" : "中断";
              return <section className="panel game-review"><div className="daily-plan-head"><strong>最近の対局の振り返り</strong><small>あなたの手番で詰ませる手があった局面です（1手詰・3手詰、王手を続ける詰みのみ）。{gameReview.status === "running" ? "解析中…（画面はそのまま使えます）" : gameReview.status === "unavailable" ? "この端末では解析を実行できませんでした。" : ""}</small></div>
                {items.length > 0 && <ul className="game-review-list">{items.slice(0, 5).map(({ r, m }) => <li key={`${r.recordId}-${m.ply}`}><span className={m.kind === "shorter-mate-available" ? "review-chance" : ""}>{m.kind === "shorter-mate-available" ? "より短い詰み" : `${m.plies}手詰`}</span><div><strong>{new Date(r.date).toLocaleDateString("ja-JP")}の対局・第{m.ply + 1}手</strong><small>{m.kind === "shorter-mate-available" ? `指した手でも詰みでした。もっと早い詰み: ${names(m.solutionNames)}` : `詰ませる手: ${names(m.solutionNames)}（指した手では${m.horizon}手以内の詰みは続かず。より長い詰みや安全な勝ち方は判定していません）`}</small></div></li>)}</ul>}
                {items.length > 5 && <p className="daily-plan-note">ほか {items.length - 5} 件。まずは上の局面から確認しよう。</p>}
                {gameReview.status === "done" && items.length === 0 && incomplete.length === 0 && <p className="daily-plan-note">直近{reviewed.length}局では、詰ませる手を逃した局面は見つかりませんでした（1手詰・3手詰の範囲）。</p>}
                {incomplete.map(r => <p key={r.recordId} className="daily-plan-note">{new Date(r.date).toLocaleDateString("ja-JP")}の対局は第{r.review.analyzedPlies}手までしか解析していません（{reason(r.review.stopReason)}）。それ以降は未確認です。</p>)}
                {items.some(x => x.m.kind === "mate-not-continued") && <button type="button" className="secondary-button" onClick={() => setView("learn")}><BookOpen size={15} /> 今日の課題へ</button>}
              </section>;
            })()}
            <section className="panel history-panel"><div className="history-title"><div><p className="section-eyebrow">MATCH ARCHIVE</p><h2>対局の記録</h2></div><span><History size={17} /> 最近の対局</span></div>
              {!records.length ? <div className="empty-history"><span><Clock3 size={28} /></span><h3>ここから、君の棋譜が始まる。</h3><p>棋友と一局指してみよう。対局が終わると記録がここに残るよ。</p><button className="primary-button" onClick={() => setView("play")}>はじめての対局 <ArrowRight size={16} /></button></div> : <div className="record-list">{records.slice(0, 30).map(record => <div className="record-line" key={record.id}><div className={`record-symbol ${record.result === "black" ? "record-win" : "record-loss"}`}>{record.result === "black" ? <Trophy size={18} /> : <Flag size={18} />}</div><div><strong>{record.result === "black" ? "勝利" : record.result === "white" ? "敗北" : "引き分け"} <small>vs 棋友</small></strong><span>{record.moves.length}手 · {record.moves.slice(0, 6).join("  ")}{record.moves.length > 6 ? " …" : ""}</span></div><time>{new Date(record.date).toLocaleDateString("ja-JP")}</time></div>)}</div>}
              <p className="history-footnote"><ShieldCheck size={15} /> 対局と学習の記録はブラウザに自動保存されます。認証された環境ではクラウド同期も試みます。</p>
            </section>
          </>}
        </div>
      </main>

      <nav className="mobile-bottom-nav" aria-label="モバイルメニュー">{NAV_ITEMS.map(item => <button key={item.id} onClick={() => setView(item.id)} className={view === item.id ? "mobile-active" : ""}><item.icon size={21} strokeWidth={1.9} /><span>{item.label}</span></button>)}</nav>

      {promotion && <div className="modal-backdrop" role="presentation" onClick={() => setPromotion(null)}><div role="dialog" aria-modal="true" aria-label="成りの選択" className="promotion-dialog" onClick={e => e.stopPropagation()}><div className="promotion-dialog-icon"><Sparkles size={21} /></div><h3>駒を成りますか？</h3><p>相手陣地で駒を成ると、動き方が変わるよ。</p><div className="promotion-options"><button className="primary-button" onClick={() => runMove(promotion.moves.find(m => m.promote)!, promotion.learning)}>成る</button><button className="secondary-button" onClick={() => runMove(promotion.moves.find(m => !m.promote)!, promotion.learning)}>成らない</button></div></div></div>}
      {toast && <output className="toast" role="status"><Sparkles size={16} /> {toast}</output>}
    </div>
  );
}
