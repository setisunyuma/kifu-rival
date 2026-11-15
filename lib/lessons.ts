import { Game, initialGame, puzzleGame } from "./shogi";

/**
 * Skill map (docs/CURRICULUM.md §2). IDs are stable: progress data will refer to them.
 * `requires` lists prerequisite skills; the graph must stay acyclic (tested).
 */
export type SkillId =
  | "A1" | "A2" | "A3" | "A4" | "A5" | "A6"
  | "B1" | "B2" | "B3" | "B4"
  | "C1" | "C2" | "C3" | "C4"
  | "D1" | "D2" | "D3"
  | "E1" | "E2" | "E3" | "E4"
  | "F1" | "F2" | "F3" | "F4"
  | "G1" | "G2" | "G3" | "G4"
  | "H1" | "H2"
  | "I1" | "I2" | "I3";

export const SKILLS: Record<SkillId, { name: string; requires: SkillId[] }> = {
  A1: { name: "駒の動き", requires: [] },
  A2: { name: "成り", requires: ["A1"] },
  A3: { name: "取る・持ち駒・打つ", requires: ["A1"] },
  A4: { name: "王手と詰み", requires: ["A2", "A3"] },
  A5: { name: "反則（二歩・打ち歩詰め・行き所のない駒）", requires: ["A4"] },
  A6: { name: "千日手・持将棋・入玉宣言", requires: ["A4"] },
  B1: { name: "駒の価値", requires: ["A3"] },
  B2: { name: "タダで取られない・取る", requires: ["B1"] },
  B3: { name: "両取り", requires: ["B2"] },
  B4: { name: "駒に紐を付ける", requires: ["B2"] },
  C1: { name: "1手詰", requires: ["A4", "B2"] },
  C2: { name: "3手詰", requires: ["C1"] },
  C3: { name: "5手詰", requires: ["C2"] },
  C4: { name: "7手以上の詰み", requires: ["C3"] },
  D1: { name: "詰めろ", requires: ["C2"] },
  D2: { name: "必至", requires: ["D1"] },
  D3: { name: "囲い別の崩し", requires: ["D2", "G2"] },
  E1: { name: "王手の受け（合駒・逃げる方向）", requires: ["A4"] },
  E2: { name: "詰めろの受け", requires: ["D1", "E1"] },
  E3: { name: "凌ぎの手筋", requires: ["E2"] },
  E4: { name: "終盤の速度計算", requires: ["D2", "E2"] },
  F1: { name: "歩の手筋", requires: ["B2"] },
  F2: { name: "大駒の手筋", requires: ["F1"] },
  F3: { name: "桂・香の手筋", requires: ["F1"] },
  F4: { name: "拠点", requires: ["F1"] },
  G1: { name: "序盤の原則", requires: ["B1"] },
  G2: { name: "囲い", requires: ["G1"] },
  G3: { name: "戦型（攻め形）", requires: ["G2"] },
  G4: { name: "定跡の狙いの理解", requires: ["G3"] },
  H1: { name: "形勢判断の4要素", requires: ["B1", "G2"] },
  H2: { name: "方針の決定", requires: ["H1"] },
  I1: { name: "感想戦の進め方", requires: ["A4"] },
  I2: { name: "敗因の特定", requires: ["I1"] },
  I3: { name: "時間の使い方", requires: ["I1"] },
};

/**
 * How the answer is verified automatically (quality layer L2, docs/CURRICULUM.md §4).
 * - "move": the goal names one specific move; only legality is checked.
 * - "capture" / "check": the answer must capture / give check.
 * - "mate-in-1": the answer must mate, and every other mating move must be listed in
 *   `alsoMates` (or the position fixed), so a correct alternative is never rejected silently.
 */
export type LessonVerify = "move" | "capture" | "check" | "mate-in-1";

/** Provenance (quality layer L0). Problems from books or other sites are never used. */
export type LessonSource = { kind: "original"; author: string; method: string };

export type Lesson = {
  id: string;
  skills: SkillId[];
  verify: LessonVerify;
  alsoMates?: string[];
  source: LessonSource;
  title: string;
  category: string;
  stage: string;
  summary: string;
  explanation: string;
  goal: string;
  hint: string;
  answer: string;
  setup: () => Game;
};

const kings = [
  { r: 8, c: 8, kind: "OU" as const, owner: "black" as const },
  { r: 0, c: 4, kind: "OU" as const, owner: "white" as const },
];

export const LESSONS: Lesson[] = [
  {
    id: "first-pawn", skills: ["A1"], verify: "move", source: { kind: "original", author: "ChatGPT（試作第1号）", method: "手作業で作成、Claudeが自動検証（2026-11-15）" },
    stage: "01", category: "入門", title: "はじめの一歩", summary: "歩を動かして、将棋の盤に慣れよう。",
    explanation: "将棋は先手と後手が交互に駒を動かすゲーム。歩は前に1マスだけ進める。自分の駒がある場所には進めないよ。",
    goal: "7七の歩を7六へ進めてみよう。", hint: "盤の下から3段目、左寄りの「歩」をタップして、一つ上のマスへ。", answer: "7g7f", setup: initialGame,
  },
  {
    id: "rook-pawn", skills: ["A1", "G1"], verify: "move", source: { kind: "original", author: "ChatGPT（試作第1号）", method: "手作業で作成、Claudeが自動検証（2026-11-15）" },
    stage: "01", category: "入門", title: "飛車の道をつくる", summary: "序盤の基本となる飛車先の歩を進める。",
    explanation: "飛車は縦横に何マスでも進める強力な駒。最初は歩に道をふさがれている。飛車の前の歩を突いて、働ける道を少しずつ作ろう。",
    goal: "2七の歩を2六へ。", hint: "右から2列目の歩を一つ前へ。", answer: "2g2f", setup: initialGame,
  },
  {
    id: "gold-step", skills: ["A1"], verify: "move", source: { kind: "original", author: "ChatGPT（試作第1号）", method: "手作業で作成、Claudeが自動検証（2026-11-15）" },
    stage: "01", category: "入門", title: "金で玉を守る", summary: "金将の動き方を体験しよう。",
    explanation: "金は前・横・真後ろに動けるほか、斜め前にも進める。ただし斜め後ろには動けない。玉の近くを守るのが得意な駒だ。",
    goal: "5八の金を6七へ斜め前に動かそう。", hint: "中央の金を左上へ1マス。", answer: "5h6g",
    setup: () => puzzleGame([...kings, { r: 7, c: 4, kind: "KI", owner: "black" }]),
  },
  {
    id: "capture-pawn", skills: ["A3"], verify: "capture", source: { kind: "original", author: "ChatGPT（試作第1号）", method: "手作業で作成、Claudeが自動検証（2026-11-15）" },
    stage: "02", category: "基本手筋", title: "駒を取ってみよう", summary: "相手の駒を取り、持ち駒にする。",
    explanation: "相手の駒があるマスへ移動すれば、その駒を取って自分の持ち駒にできる。取った駒は次の手以降に盤上へ打てるよ。",
    goal: "5六の歩で、5五の相手の歩を取ろう。", hint: "手前の歩を一つ前へ。相手の歩が持ち駒になる。", answer: "5f5e",
    setup: () => puzzleGame([...kings, { r: 5, c: 4, kind: "FU", owner: "black" }, { r: 4, c: 4, kind: "FU", owner: "white" }]),
  },
  {
    id: "rook-check", skills: ["A4"], verify: "check", source: { kind: "original", author: "ChatGPT（試作第1号）", method: "手作業で作成、Claudeが自動検証（2026-11-15）" },
    stage: "02", category: "基本手筋", title: "王手をかける", summary: "相手の玉を直接狙う手を考える。",
    explanation: "次に玉を取れる状態を「王手」という。王手をかけられたら、必ず玉が取られないように応じなければならない。",
    goal: "6七の飛車を、玉と同じ5筋に動かして王手しよう。", hint: "飛車を右へ1マス。縦の利きが玉まで通る。", answer: "6g5g",
    setup: () => puzzleGame([...kings, { r: 6, c: 3, kind: "HI", owner: "black" }]),
  },
  {
    id: "rook-mate", skills: ["A4", "C1"], verify: "mate-in-1", source: { kind: "original", author: "ChatGPT（試作第1号）", method: "手作業で作成、Claudeが自動検証（2026-11-15）" },
    stage: "02", category: "詰将棋", title: "はじめての一手詰", summary: "金の守りを利用して、飛車で玉を詰ます。",
    explanation: "王手を避ける合法手がなくなった状態を「詰み」という。この局面は飛車を1枚持っている。金の利きをよく見てみよう。",
    goal: "持ち駒の飛車を使って、一手で詰ませよう。", hint: "5二に飛車を打とう。飛車は金に守られている。", answer: "R*5b",
    setup: () => puzzleGame([
      ...kings,
      { r: 2, c: 4, kind: "KI", owner: "black" },
      { r: 0, c: 3, kind: "FU", owner: "white" },
      { r: 0, c: 5, kind: "FU", owner: "white" },
    ], { black: { HI: 1 } }),
  },
];

export const ROADMAP = [
  { stage: "03", title: "戦型を学ぶ", summary: "居飛車・振り飛車・囲い・急戦と持久戦", status: "制作予定" },
  { stage: "04", title: "中盤を組み立てる", summary: "仕掛け・攻めと受け・形勢判断", status: "制作予定" },
  { stage: "05", title: "終盤を磨く", summary: "寄せ・必至・詰将棋・実戦の読み", status: "制作予定" },
  { stage: "06", title: "有段者の研究室", summary: "棋譜研究・戦法別弱点・複雑な局面", status: "制作予定" },
];
