import { Game, fromSfen, initialGame, puzzleGame, withRemainingPiecesToDefender } from "./shogi";

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
  /** Same learning aim across different positions; stable across content updates. */
  transferGroup?: string;
  /** A different position used to check transfer, rather than repeat a memorised answer. */
  transfer?: boolean;
  /** Verified example continuations, shown after the first-move answer is submitted. */
  variations?: { moves: string[]; explanation: string }[];
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

/** Accept every listed correct first move. This does not claim the whole line was played. */
export function acceptsLessonMove(lesson: Lesson, moveUsi: string): boolean {
  return moveUsi === lesson.answer || (lesson.alsoMates ?? []).includes(moveUsi);
}

const originalSource: LessonSource = {
  kind: "original", author: "ChatGPT", method: "棋友の合成局面をもとに手作業で構成。玉方は残り駒全部。全合法手・全応手と解説の手順をテストで検証（2026-11-16）",
};
const draftReview = (purpose: string, misconceptions: string[], difficulty: 1 | 2 | 3 | 4 | 5 = 2): LessonReview => ({
  status: "draft", target: "王手・持ち駒・基本の1手詰を練習した人。段級位との対応は未検証",
  purpose, misconceptions, intendedDifficulty: difficulty,
  history: [{ date: "2026-11-16", by: "ChatGPT", note: "作問とL3の下書き。人による教育レビューは未実施" }],
});
const tsume = (sfen: string) => () => withRemainingPiecesToDefender(fromSfen(sfen));

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
    skills: ["A4", "C1"], verify: "mate-in-1", transferGroup: "guarded-rook", source: { kind: "original", author: "ChatGPT（試作第1号）", method: "手作業で作成、Claudeが自動検証（2026-11-15）" },
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
  {
    id: "rook-mate-transfer-center", skills: ["C1"], verify: "mate-in-1", transferGroup: "guarded-rook", transfer: true,
    source: originalSource,
    review: draftReview("玉の位置が変わっても、守られた飛車を打ち、逃げ道がないことを確かめる", ["玉に取られる飛車を打つ", "玉の位置だけを見て金の利きを確かめない"]),
    stage: "02", category: "転用・1手詰", title: "別の筋でも、守りを使う", summary: "覚えたマスではなく、金の利きから詰みを探す。",
    explanation: "持ち駒は飛車1枚。打つ飛車が守られているかと、玉の逃げ道を確かめよう。相手の持ち駒は盤上と自分の持ち駒以外の残り全部。",
    goal: "持ち駒の飛車で、一手詰の初手を答えよう。", hint: "玉のすぐ下に打つ飛車を、3三の金が守れるか考えよう。", answer: "R*3b",
    variations: [{ moves: ["R*3b"], explanation: "▲3二飛打まで。飛車は3三の金に守られ、2二・4二も金と飛車の利きで逃げられない。" }],
    setup: tsume("5pkp1/9/6G2/9/9/9/9/9/K8 b R 1"),
  },
  {
    id: "rook-mate-transfer-edge", skills: ["C1"], verify: "mate-in-1", transferGroup: "guarded-rook", transfer: true,
    source: originalSource,
    review: draftReview("盤の端でも、駒の守りと玉の逃げ道を組み合わせて1手詰を見つける", ["端の玉だからどこへ王手しても詰むと思う", "飛車を打つ場所が金に守られているかを見落とす"]),
    stage: "02", category: "転用・1手詰", title: "端の玉の逃げ道", summary: "端の形で、飛車と金の役割を確かめる。",
    explanation: "端の玉は逃げ道が少ない。ただし王手だけでなく、取られない飛車を打つことが必要だ。相手の持ち駒は残り全部。",
    goal: "持ち駒の飛車で、一手詰の初手を答えよう。", hint: "1三の金が守っている、玉のすぐ下のマスを見よう。", answer: "R*1b",
    variations: [{ moves: ["R*1b"], explanation: "▲1二飛打まで。飛車は1三の金に守られている。2一には後手の歩があり、2二は飛車と金が利いている。" }],
    setup: tsume("7pk/9/8G/9/9/9/9/9/K8 b R 1"),
  },
  {
    id: "double-rook-mate-3", skills: ["C2"], verify: "mate-in-3", transferGroup: "rook-sandwich",
    source: originalSource,
    review: draftReview("1枚目の飛車で玉を横へ動かし、2枚目の飛車を守りながら詰ます3手のつながりを読む", ["最初から1段目に飛車を打つ", "玉が左右どちらへ逃げるか一方しか読まない"], 3),
    stage: "03", category: "詰将棋・3手", title: "二枚の飛車で挟む", summary: "玉がどちらへ逃げても、同じ仕上げを読む。",
    explanation: "3手詰は、自分の王手・相手の応手・最後の王手までを読む練習。まず初手を答え、正解後に解説で応手と詰みまでを確認しよう。相手の持ち駒は残り全部。",
    goal: "飛車2枚を使う三手詰。最初の一手を答えよう。", hint: "3一の銀が4二を守っている。まず2段目の飛車で玉を横へ動かそう。", answer: "R*4b",
    variations: [
      { moves: ["R*4b", "4a5a", "R*4a"], explanation: "▲4二飛打→△5一玉→▲4一飛打まで。最後の飛車は4二の飛車に守られ、1段目と2段目の逃げ道を二枚でふさぐ。" },
      { moves: ["R*4b", "4a3a", "R*4a"], explanation: "▲4二飛打に△3一玉と銀を取っても、▲4一飛打まで。左右どちらへの逃げも同じ仕上げになる。" },
    ],
    setup: tsume("5kS2/8l/5b3/9/9/9/9/9/K8 b 2R 1"),
  },
  {
    id: "double-gold-mate-3", skills: ["C2"], verify: "mate-in-3", transferGroup: "gold-net",
    alsoMates: ["G*3b"], source: originalSource,
    review: draftReview("角の利きを使って1枚目の金を守り、玉の移動先を2枚目の金で詰ます", ["守りのない頭金をいきなり打つ", "模範手と逆側の正しい金打ちを誤りだと思う"], 3),
    stage: "03", category: "詰将棋・3手", title: "角に支えられた二枚の金", summary: "同じ狙いの正しい初手が二つある問題。",
    explanation: "金を一枚ずつ使い、玉を横へ動かしてから逃げ道を閉じよう。この問題には正しい初手が二つある。相手の持ち駒は残り全部。",
    goal: "金2枚を使う三手詰。正しい初手を一つ答えよう。", hint: "4三の角が守る3二と5二に注目。玉の次の移動先まで読んでみよう。", answer: "G*5b",
    variations: [
      { moves: ["G*5b", "4a3a", "G*3b"], explanation: "▲5二金打→△3一玉→▲3二金打まで。二枚の金は4三の角に守られ、最後の頭金で逃げ道がなくなる。" },
      { moves: ["G*3b", "4a5a", "G*5b"], explanation: "▲3二金打→△5一玉→▲5二金打も正解。左右を入れ替えても、角に守られた二枚の金という狙いは同じ。" },
    ],
    setup: tsume("5k3/9/5B3/9/9/9/9/9/K8 b 2G 1"),
  },
  {
    id: "double-rook-mate-3-transfer", skills: ["C2"], verify: "mate-in-3", transferGroup: "rook-sandwich", transfer: true,
    source: originalSource,
    review: draftReview("筋が変わった局面で、二枚の飛車による挟撃を自分で組み立てる", ["前の問題と同じ4二に打つ", "一枚目を守る銀の位置を見落とす"], 3),
    stage: "03", category: "転用・3手詰", title: "場所が変わった二枚の飛車", summary: "マスの暗記から、飛車どうしの支えへ。",
    explanation: "玉と銀の位置が変わった。二枚の飛車が最後に互いを支えられるよう、初手から組み立てよう。相手の持ち駒は残り全部。",
    goal: "飛車2枚で三手詰。最初の一手を答えよう。", hint: "4一の銀が守る5二から、1段目をふさぐ形を考えよう。", answer: "R*5b",
    variations: [
      { moves: ["R*5b", "5a6a", "R*5a"], explanation: "▲5二飛打→△6一玉→▲5一飛打まで。5二の飛車が最後の飛車を守り、二枚で上下の逃げ道を閉じる。" },
      { moves: ["R*5b", "5a4a", "R*5a"], explanation: "▲5二飛打→△4一玉→▲5一飛打まで。銀を取る応手にも同じ仕上げになる。初手から左右の逃げを両方確かめよう。" },
    ],
    setup: tsume("4kS3/7l1/4b4/9/9/9/9/9/K8 b 2R 1"),
  },
  {
    id: "double-gold-mate-3-transfer", skills: ["C2"], verify: "mate-in-3", transferGroup: "gold-net", transfer: true,
    alsoMates: ["G*1b"], source: originalSource,
    review: draftReview("盤の端が近い局面でも、角の支えと二枚の金を使う3手の狙いを転用する", ["端に近いので手順を読まずに頭金を打つ", "初手を片側に限定してしまう"], 3),
    stage: "03", category: "転用・3手詰", title: "端へ誘う二枚の金", summary: "盤の端と駒の利きで、逃げ道を確かめる。",
    explanation: "2三の角と持ち駒の金2枚を使う。玉を動かす初手と、移動先での仕上げを続けて考えよう。相手の持ち駒は残り全部。",
    goal: "三手詰の正しい初手を一つ答えよう。", hint: "角が守っている1二または3二に金を打つと、玉はどこへ逃げるだろう。", answer: "G*3b",
    variations: [
      { moves: ["G*3b", "2a1a", "G*1b"], explanation: "▲3二金打→△1一玉→▲1二金打まで。最後の金は2三の角に守られ、端の玉の逃げ道を閉じる。" },
      { moves: ["G*1b", "2a3a", "G*3b"], explanation: "▲1二金打→△3一玉→▲3二金打も正解。逆側へ逃がす手順でも、角の支えを使える。" },
    ],
    setup: tsume("7k1/9/7B1/9/9/9/9/9/K8 b 2G 1"),
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

/** One first-move answer. Missing optional fields are unknown in legacy records. */
export type LessonAttempt = {
  lessonId: string;
  correct: boolean;
  at: string;
  hinted?: boolean;
  /** First recorded answer to this position, not proof that the whole line was played. */
  firstSeen?: boolean;
};

/** The caller also remembers answered IDs beyond its retained attempt window. */
export function createLessonAttempt(lessonId: string, correct: boolean, at: string, attempts: readonly LessonAttempt[], hinted = false,
  seenLessonIds: readonly string[] = []): LessonAttempt {
  return { lessonId, correct, at, hinted, firstSeen: !attempts.some(a => a.lessonId === lessonId) && !seenLessonIds.includes(lessonId) };
}

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

const orderedAttempts = (attempts: readonly LessonAttempt[]) => attempts
  .filter(a => Number.isFinite(Date.parse(a.at)))
  .slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

/**
 * Replay attempts in time order. A correct answer moves the lesson up one box only
 * when it was due (re-solving early does not count as spaced practice); a wrong
 * answer drops it back to box 1.
 */
export function lessonStates(attempts: LessonAttempt[], lessons: Lesson[] = LESSONS): Map<string, LessonState> {
  const states = new Map<string, LessonState>(lessons.map(l => [l.id, { lessonId: l.id, box: 0 }]));
  const ordered = orderedAttempts(attempts);
  for (const a of ordered) {
    const st = states.get(a.lessonId);
    if (!st) continue;
    const due = !st.dueAt || Date.parse(a.at) >= Date.parse(st.dueAt);
    if (a.correct && a.hinted !== true) st.box = st.box === 0 ? 1 : due ? Math.min(st.box + 1, REVIEW_INTERVAL_DAYS.length) : st.box;
    else if (a.correct) { /* An assisted answer does not advance the review box. */ }
    else st.box = st.box === 0 ? 0 : 1;
    st.lastAt = a.at; st.lastCorrect = a.correct;
    st.dueAt = st.box > 0 || a.hinted === true
      ? new Date(Date.parse(a.at) + REVIEW_INTERVAL_DAYS[Math.max(0, st.box - 1)] * DAY_MS).toISOString() : undefined;
  }
  return states;
}

/**
 * Provisional practice readiness, NOT transfer mastery. It remains a path to the next
 * lesson even if a small transfer bank is exhausted. Transfer problems are counted
 * separately by masteredSkills, so adding them does not reset basic practice progress.
 */
export function practisedSkills(states: Map<string, LessonState>, lessons: Lesson[] = LESSONS): Set<SkillId> {
  const out = new Set<SkillId>();
  const taught = new Set(lessons.flatMap(l => l.skills));
  for (const skill of taught) {
    const ls = lessons.filter(l => !l.transfer && l.skills.includes(skill));
    if (ls.length && ls.every(l => (states.get(l.id)?.box ?? 0) >= 2)) out.add(skill);
  }
  return out;
}

/**
 * Initial hypothesis: two distinct unseen transfer positions answered correctly without
 * hints, at least 24 hours apart. Old records and repeated answers are not fresh evidence.
 * The returned set concerns the first-move skill; it does not certify an entire variation.
 * Unknown lesson IDs are ignored for this calculation, never removed from saved history.
 */
export function masteredSkills(attempts: readonly LessonAttempt[], lessons: Lesson[] = LESSONS): Set<SkillId> {
  const byId = new Map(lessons.map(l => [l.id, l]));
  const seen = new Set<string>();
  const evidence = new Map<SkillId, number[]>();
  for (const a of orderedAttempts(attempts)) {
    const first = !seen.has(a.lessonId);
    seen.add(a.lessonId);
    const lesson = byId.get(a.lessonId);
    if (!first || !lesson?.transfer || !a.correct || a.hinted !== false || a.firstSeen !== true) continue;
    for (const skill of lesson.skills) evidence.set(skill, [...(evidence.get(skill) ?? []), Date.parse(a.at)]);
  }
  return new Set([...evidence].filter(([, dates]) => dates.length >= 2 && dates[dates.length - 1] - dates[0] >= DAY_MS).map(([skill]) => skill));
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

export type PlanItem = { lessonId: string; reason: "review" | "weak" | "new" | "game" };

/**
 * Skills behind mates missed in the player's games: 1-ply -> C1, 3-ply -> C2. Only chances
 * that were actually lost count as weakness evidence; playing a different correct mate
 * ("shorter-mate-available") is a learning opportunity and is not counted.
 */
export function skillsForMissedMates(missed: { plies: number; kind?: string }[]): SkillId[] {
  const out = new Set<SkillId>();
  for (const m of missed) if (m.kind !== "shorter-mate-available") out.add(m.plies === 1 ? "C1" : "C2");
  return [...out];
}

/**
 * Lessons to recommend for skills weak in real games. Falls back to the nearest
 * prerequisite that has lessons (e.g. C2 -> C1) so a recommendation always exists.
 */
export function lessonsForSkills(skills: SkillId[], lessons: Lesson[] = LESSONS): string[] {
  const ids: string[] = [];
  for (const skill of skills) {
    let frontier: SkillId[] = [skill];
    const seen = new Set<SkillId>();
    while (frontier.length) {
      const hits = lessons.filter(l => l.skills.some(s => frontier.includes(s))).map(l => l.id);
      if (hits.length) { for (const h of hits) if (!ids.includes(h)) ids.push(h); break; }
      frontier.forEach(f => seen.add(f));
      frontier = frontier.flatMap(f => SKILLS[f].requires).filter(r => !seen.has(r));
    }
  }
  return ids;
}

/**
 * Today's plan: the most overdue review, the most recent mistake, a lesson for a skill the
 * player's own games showed as weak (`gameSkills`), then the next new lesson.
 */
export function dailyPlan(attempts: LessonAttempt[], now: Date, lessons: Lesson[] = LESSONS, gameSkills: SkillId[] = []): PlanItem[] {
  const states = lessonStates(attempts, lessons);
  const nowIso = now.toISOString();
  const plan: PlanItem[] = [];
  const taken = new Set<string>();
  let freshTransferAdded = false;
  const add = (lessonId: string | undefined, reason: PlanItem["reason"]) => {
    const freshTransfer = lessonId && lessons.find(l => l.id === lessonId)?.transfer && !states.get(lessonId)?.lastAt;
    if (freshTransfer && freshTransferAdded) return;
    if (lessonId && !taken.has(lessonId) && plan.length < DAILY_PLAN_SIZE) {
      plan.push({ lessonId, reason }); taken.add(lessonId);
      if (freshTransfer) freshTransferAdded = true;
    }
  };
  const all = [...states.values()];
  const weak = all.filter(s => s.lastCorrect === false).sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
  const due = all.filter(s => s.dueAt && s.dueAt <= nowIso && s.lastCorrect !== false).sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));
  // Practice readiness keeps the small question bank from permanently locking later
  // lessons. Actual transfer mastery remains separately observable via masteredSkills.
  const ready = new Set([...practisedSkills(states, lessons), ...masteredSkills(attempts, lessons)]);
  const transferIds = new Set(lessons.filter(l => l.transfer).map(l => l.id));
  const recentTransfer = attempts.some(a => transferIds.has(a.lessonId) && Number.isFinite(Date.parse(a.at))
    && now.getTime() - Date.parse(a.at) >= 0 && now.getTime() - Date.parse(a.at) < DAY_MS);
  const transferReady = (l: Lesson) => !l.transfer || (!recentTransfer && lessons.some(base => !base.transfer
    && base.transferGroup === l.transferGroup && states.get(base.id)?.lastCorrect === true));
  const fresh = lessons.filter(l => !states.get(l.id)?.lastAt && prerequisitesMet(l, ready, lessons) && transferReady(l));
  add(due[0]?.lessonId, "review");
  add(weak[0]?.lessonId, "weak");
  // A game mistake is a reason to learn, not permission to skip required foundations.
  let frontier = [...gameSkills];
  const visited = new Set<SkillId>();
  while (frontier.length) {
    const candidates = lessons.filter(l => !l.transfer && l.skills.some(skill => frontier.includes(skill)) && prerequisitesMet(l, ready, lessons));
    if (candidates.length) {
      const preferred = candidates.find(l => !taken.has(l.id) && !states.get(l.id)?.lastAt) ?? candidates.find(l => !taken.has(l.id));
      add(preferred?.id, "game"); break;
    }
    frontier.forEach(skill => visited.add(skill));
    frontier = frontier.flatMap(skill => SKILLS[skill].requires).filter(skill => !visited.has(skill));
  }
  for (const l of fresh) add(l.id, "new");
  for (const s of due.slice(1)) add(s.lessonId, "review");
  for (const s of weak.slice(1)) add(s.lessonId, "weak");
  return plan;
}
