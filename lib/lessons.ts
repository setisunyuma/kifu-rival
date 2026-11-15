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
 * - "mate-in-N" (1/3/5): under tsume rules (every attacking move checks) the answer must force
 *   mate within N plies, and every other first move that does must be listed in `alsoMates`
 *   (or the position fixed), so a correct alternative is never rejected silently.
 */
export type LessonVerify = "move" | "capture" | "check" | "mate-in-1" | "mate-in-3" | "mate-in-5";

/**
 * Educational review record (quality layer L3, docs/CURRICULUM.md §4.2). Kept separate
 * from machine verification: tests only check that the record is well-formed, never that
 * the lesson is pedagogically good. `status` stays "draft" until a person reviews it;
 * a draft written by Claude is a proposal, not a review.
 */
export type LessonReview = {
  status: "draft" | "reviewed" | "needs-revision";
  /** Intended level and the skills a learner should already have. */
  target: string;
  /** What the learner can do after solving it. */
  purpose: string;
  /** Typical wrong answers and why they are wrong. */
  misconceptions: string[];
  /** Difficulty as intended (1 = first contact ... 5 = dan level). Compared with real data in L4. */
  intendedDifficulty: 1 | 2 | 3 | 4 | 5;
  history: { date: string; by: string; note: string }[];
  /** Filled only by the person who reviewed it (status "reviewed"). */
  reviewedBy?: string;
  reviewedOn?: string;
};

/** Provenance (quality layer L0). Problems from books or other sites are never used. */
export type LessonSource = { kind: "original"; author: string; method: string };

export type Lesson = {
  id: string;
  skills: SkillId[];
  verify: LessonVerify;
  alsoMates?: string[];
  source: LessonSource;
  review: LessonReview;
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
    id: "first-pawn", review: { status: "draft", target: "入門。前提なし（盤と駒を初めて触る）", purpose: "歩が前に1マス進むことを知り、駒を選んで動かす操作に慣れる", misconceptions: ["違う歩を動かす（どの歩でも前には進めるが、お題は7筋）"], intendedDifficulty: 1, history: [{ date: "2026-11-15", by: "Claude", note: "L3の下書き。人のレビューは未実施" }] },
    skills: ["A1"], verify: "move", source: { kind: "original", author: "ChatGPT（試作第1号）", method: "手作業で作成、Claudeが自動検証（2026-11-15）" },
    stage: "01", category: "入門", title: "はじめの一歩", summary: "歩を動かして、将棋の盤に慣れよう。",
    explanation: "将棋は先手と後手が交互に駒を動かすゲーム。歩は前に1マスだけ進める。自分の駒がある場所には進めないよ。",
    goal: "7七の歩を7六へ進めてみよう。", hint: "盤の下から3段目、左寄りの「歩」をタップして、一つ上のマスへ。", answer: "7g7f", setup: initialGame,
  },
  {
    id: "rook-pawn", review: { status: "draft", target: "入門。歩の動き（A1）", purpose: "飛車の前の歩を突いて大駒の通り道を作る、序盤の第一歩を知る", misconceptions: ["飛車そのものを動かそうとする（歩が邪魔で動けない理由を説明する）"], intendedDifficulty: 1, history: [{ date: "2026-11-15", by: "Claude", note: "L3の下書き。人のレビューは未実施" }] },
    skills: ["A1", "G1"], verify: "move", source: { kind: "original", author: "ChatGPT（試作第1号）", method: "手作業で作成、Claudeが自動検証（2026-11-15）" },
    stage: "01", category: "入門", title: "飛車の道をつくる", summary: "序盤の基本となる飛車先の歩を進める。",
    explanation: "飛車は縦横に何マスでも進める強力な駒。最初は歩に道をふさがれている。飛車の前の歩を突いて、働ける道を少しずつ作ろう。",
    goal: "2七の歩を2六へ。", hint: "右から2列目の歩を一つ前へ。", answer: "2g2f", setup: initialGame,
  },
  {
    id: "gold-step", review: { status: "draft", target: "入門。歩の動き", purpose: "金の動き（斜め後ろには動けない）を体験する", misconceptions: ["斜め後ろへ動かそうとする（金は斜め後ろに動けない）"], intendedDifficulty: 1, history: [{ date: "2026-11-15", by: "Claude", note: "L3の下書き。人のレビューは未実施" }] },
    skills: ["A1"], verify: "move", source: { kind: "original", author: "ChatGPT（試作第1号）", method: "手作業で作成、Claudeが自動検証（2026-11-15）" },
    stage: "01", category: "入門", title: "金で玉を守る", summary: "金将の動き方を体験しよう。",
    explanation: "金は前・横・真後ろに動けるほか、斜め前にも進める。ただし斜め後ろには動けない。玉の近くを守るのが得意な駒だ。",
    goal: "5八の金を6七へ斜め前に動かそう。", hint: "中央の金を左上へ1マス。", answer: "5h6g",
    setup: () => puzzleGame([...kings, { r: 7, c: 4, kind: "KI", owner: "black" }]),
  },
  {
    id: "capture-pawn", review: { status: "draft", target: "入門。駒の動き（A1）", purpose: "相手の駒を取ると持ち駒になることを知る", misconceptions: ["取らずに別の手を指す（取れる駒を見落とす）"], intendedDifficulty: 1, history: [{ date: "2026-11-15", by: "Claude", note: "L3の下書き。人のレビューは未実施" }] },
    skills: ["A3"], verify: "capture", source: { kind: "original", author: "ChatGPT（試作第1号）", method: "手作業で作成、Claudeが自動検証（2026-11-15）" },
    stage: "02", category: "基本手筋", title: "駒を取ってみよう", summary: "相手の駒を取り、持ち駒にする。",
    explanation: "相手の駒があるマスへ移動すれば、その駒を取って自分の持ち駒にできる。取った駒は次の手以降に盤上へ打てるよ。",
    goal: "5六の歩で、5五の相手の歩を取ろう。", hint: "手前の歩を一つ前へ。相手の歩が持ち駒になる。", answer: "5f5e",
    setup: () => puzzleGame([...kings, { r: 5, c: 4, kind: "FU", owner: "black" }, { r: 4, c: 4, kind: "FU", owner: "white" }]),
  },
  {
    id: "rook-check", review: { status: "draft", target: "入門。駒の動き・飛車の利き", purpose: "王手の意味（次に玉を取れる状態）を知る", misconceptions: ["5筋以外で王手をかける（お題は5筋。他の王手も王手ではあることを説明する）"], intendedDifficulty: 2, history: [{ date: "2026-11-15", by: "Claude", note: "L3の下書き。人のレビューは未実施" }] },
    skills: ["A4"], verify: "check", source: { kind: "original", author: "ChatGPT（試作第1号）", method: "手作業で作成、Claudeが自動検証（2026-11-15）" },
    stage: "02", category: "基本手筋", title: "王手をかける", summary: "相手の玉を直接狙う手を考える。",
    explanation: "次に玉を取れる状態を「王手」という。王手をかけられたら、必ず玉が取られないように応じなければならない。",
    goal: "6七の飛車を、玉と同じ5筋に動かして王手しよう。", hint: "飛車を右へ1マス。縦の利きが玉まで通る。", answer: "6g5g",
    setup: () => puzzleGame([...kings, { r: 6, c: 3, kind: "HI", owner: "black" }]),
  },
  {
    id: "rook-mate", review: { status: "draft", target: "入門〜15級。王手（A4）・持ち駒を打つ（A3）", purpose: "頭金型ではない基本の1手詰で、打った駒が守られていれば玉が取れないことを理解する", misconceptions: ["守りのない場所に飛車を打つ（玉に取られる）", "王手だが逃げ道が残る手を指す"], intendedDifficulty: 2, history: [{ date: "2026-11-15", by: "Claude", note: "L3の下書き。人のレビューは未実施" }] },
    skills: ["A4", "C1"], verify: "mate-in-1", source: { kind: "original", author: "ChatGPT（試作第1号）", method: "手作業で作成、Claudeが自動検証（2026-11-15）" },
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

// ---------------------------------------------------------------------------
// Learning loop, minimal version (KIF-032 P3/P4; docs/CURRICULUM.md §3).
// Pure functions over a list of attempts so the loop is fully testable. All
// numbers below are initial hypotheses to be tuned with real use.
// ---------------------------------------------------------------------------

/** One answer to a lesson. Stored on the device (localStorage), never sent elsewhere. */
export type LessonAttempt = { lessonId: string; correct: boolean; at: string };

/** Review intervals in days for boxes 1..4 (Leitner-style). Hypothesis. */
export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 21];
/** Daily plan size: one review, one weak point, one new lesson. Hypothesis. */
export const DAILY_PLAN_SIZE = 3;

export type LessonState = {
  lessonId: string;
  /** 0 = never answered correctly; 1..4 = review box. */
  box: number;
  lastAt?: string;
  lastCorrect?: boolean;
  /** When the next review is due (ISO); undefined if never answered correctly. */
  dueAt?: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Replay attempts in time order. A correct answer moves the lesson up one box only
 * when it was due (re-solving early does not count as spaced practice); a wrong
 * answer drops it back to box 1.
 */
export function lessonStates(attempts: LessonAttempt[], lessons: Lesson[] = LESSONS): Map<string, LessonState> {
  const states = new Map<string, LessonState>(lessons.map(l => [l.id, { lessonId: l.id, box: 0 }]));
  const ordered = [...attempts].sort((a, b) => a.at.localeCompare(b.at));
  for (const a of ordered) {
    const st = states.get(a.lessonId);
    if (!st) continue;
    const due = !st.dueAt || a.at >= st.dueAt;
    if (a.correct) st.box = st.box === 0 ? 1 : due ? Math.min(st.box + 1, REVIEW_INTERVAL_DAYS.length) : st.box;
    else st.box = st.box === 0 ? 0 : 1;
    st.lastAt = a.at; st.lastCorrect = a.correct;
    st.dueAt = st.box > 0 ? new Date(new Date(a.at).getTime() + REVIEW_INTERVAL_DAYS[st.box - 1] * DAY_MS).toISOString() : undefined;
  }
  return states;
}

/**
 * Provisional skill mastery: a skill counts as practised when every lesson that
 * teaches it has reached box 2 (answered correctly again after a delay). This is a
 * stand-in until transfer problems exist (re-solving the same position can be memorised).
 */
export function practisedSkills(states: Map<string, LessonState>, lessons: Lesson[] = LESSONS): Set<SkillId> {
  const out = new Set<SkillId>();
  const taught = new Set(lessons.flatMap(l => l.skills));
  for (const skill of taught) {
    const ls = lessons.filter(l => l.skills.includes(skill));
    if (ls.every(l => (states.get(l.id)?.box ?? 0) >= 2)) out.add(skill);
  }
  return out;
}

/**
 * A lesson is recommended as "new" only when the prerequisites of its skills that
 * are taught somewhere are practised. Prerequisites with no lessons yet do not
 * block. Lessons are never hidden: this affects recommendations only.
 */
export function prerequisitesMet(lesson: Lesson, practised: Set<SkillId>, lessons: Lesson[] = LESSONS): boolean {
  const taught = new Set(lessons.flatMap(l => l.skills));
  const own = new Set(lesson.skills);
  return lesson.skills.every(skill => SKILLS[skill].requires.every(req => own.has(req) || !taught.has(req) || practised.has(req)));
}

export type PlanItem = { lessonId: string; reason: "review" | "weak" | "new" };

/** Today's plan: the most overdue review, the most recent mistake, then the next new lesson. */
export function dailyPlan(attempts: LessonAttempt[], now: Date, lessons: Lesson[] = LESSONS): PlanItem[] {
  const states = lessonStates(attempts, lessons);
  const nowIso = now.toISOString();
  const plan: PlanItem[] = [];
  const taken = new Set<string>();
  const add = (lessonId: string | undefined, reason: PlanItem["reason"]) => {
    if (lessonId && !taken.has(lessonId) && plan.length < DAILY_PLAN_SIZE) { plan.push({ lessonId, reason }); taken.add(lessonId); }
  };
  const all = [...states.values()];
  const weak = all.filter(s => s.lastCorrect === false).sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
  const due = all.filter(s => s.dueAt && s.dueAt <= nowIso && s.lastCorrect !== false).sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));
  const practised = practisedSkills(states, lessons);
  const fresh = lessons.filter(l => !all.find(s => s.lessonId === l.id)?.lastAt && prerequisitesMet(l, practised, lessons));
  add(due[0]?.lessonId, "review");
  add(weak[0]?.lessonId, "weak");
  for (const l of fresh) add(l.id, "new");
  for (const s of due.slice(1)) add(s.lessonId, "review");
  for (const s of weak.slice(1)) add(s.lessonId, "weak");
  return plan;
}
