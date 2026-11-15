import { Game, initialGame, puzzleGame } from "./shogi";

export type Lesson = {
  id: string;
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
    id: "first-pawn", stage: "01", category: "入門", title: "はじめの一歩", summary: "歩を動かして、将棋の盤に慣れよう。",
    explanation: "将棋は先手と後手が交互に駒を動かすゲーム。歩は前に1マスだけ進める。自分の駒がある場所には進めないよ。",
    goal: "7七の歩を7六へ進めてみよう。", hint: "盤の下から3段目、左寄りの「歩」をタップして、一つ上のマスへ。", answer: "7g7f", setup: initialGame,
  },
  {
    id: "rook-pawn", stage: "01", category: "入門", title: "飛車の道をつくる", summary: "序盤の基本となる飛車先の歩を進める。",
    explanation: "飛車は縦横に何マスでも進める強力な駒。最初は歩に道をふさがれている。飛車の前の歩を突いて、働ける道を少しずつ作ろう。",
    goal: "2七の歩を2六へ。", hint: "右から2列目の歩を一つ前へ。", answer: "2g2f", setup: initialGame,
  },
  {
    id: "gold-step", stage: "01", category: "入門", title: "金で玉を守る", summary: "金将の動き方を体験しよう。",
    explanation: "金は前・横・真後ろに動けるほか、斜め前にも進める。ただし斜め後ろには動けない。玉の近くを守るのが得意な駒だ。",
    goal: "5八の金を6七へ斜め前に動かそう。", hint: "中央の金を左上へ1マス。", answer: "5h6g",
    setup: () => puzzleGame([...kings, { r: 7, c: 4, kind: "KI", owner: "black" }]),
  },
  {
    id: "capture-pawn", stage: "02", category: "基本手筋", title: "駒を取ってみよう", summary: "相手の駒を取り、持ち駒にする。",
    explanation: "相手の駒があるマスへ移動すれば、その駒を取って自分の持ち駒にできる。取った駒は次の手以降に盤上へ打てるよ。",
    goal: "5六の歩で、5五の相手の歩を取ろう。", hint: "手前の歩を一つ前へ。相手の歩が持ち駒になる。", answer: "5f5e",
    setup: () => puzzleGame([...kings, { r: 5, c: 4, kind: "FU", owner: "black" }, { r: 4, c: 4, kind: "FU", owner: "white" }]),
  },
  {
    id: "rook-check", stage: "02", category: "基本手筋", title: "王手をかける", summary: "相手の玉を直接狙う手を考える。",
    explanation: "次に玉を取れる状態を「王手」という。王手をかけられたら、必ず玉が取られないように応じなければならない。",
    goal: "6七の飛車を、玉と同じ5筋に動かして王手しよう。", hint: "飛車を右へ1マス。縦の利きが玉まで通る。", answer: "6g5g",
    setup: () => puzzleGame([...kings, { r: 6, c: 3, kind: "HI", owner: "black" }]),
  },
  {
    id: "rook-mate", stage: "02", category: "詰将棋", title: "はじめての一手詰", summary: "金の守りを利用して、飛車で玉を詰ます。",
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
