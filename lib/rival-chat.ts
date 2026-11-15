import { Game, isInCheck, usi } from "./shogi";

export type RivalMessage = { role: "me" | "rival"; text: string };
export type RivalGameRecord = { id: string; date: string; result: "black" | "white" | "draw"; moves: string[] };

export type RivalChatContext = {
  game: Game;
  records: RivalGameRecord[];
  completedLessons: number;
  recentMessages: RivalMessage[];
};

type LastMatch = { result: RivalGameRecord["result"]; turns: number; source: "board" | "record" };

function lastMatch({ game, records }: RivalChatContext): LastMatch | null {
  if (game.result !== "playing") return { result: game.result, turns: game.history.length, source: "board" };
  const latest = records.reduce<RivalGameRecord | null>((current, record) => {
    return !current || new Date(record.date).getTime() > new Date(current.date).getTime() ? record : current;
  }, null);
  return latest ? { result: latest.result, turns: latest.moves.length, source: "record" } : null;
}

function matchDescription(match: LastMatch | null): string {
  if (!match) return "まだ終了した対局の記録がないので、勝敗は判断できない。";
  const outcome = match.result === "black" ? "君の勝ち" : match.result === "white" ? "僕の勝ち" : "引き分け";
  return `直近の記録は${match.turns}手で${outcome}。`;
}

/**
 * Grounded local companion response. Never invents a winner or an analysis that
 * the rules engine cannot actually provide. A server LLM can be added later.
 */
export function rivalReply(raw: string, context: RivalChatContext): string {
  const text = raw.trim();
  const { game, records, completedLessons, recentMessages } = context;
  const match = lastMatch(context);
  const previousUser = [...recentMessages].reverse().find(m => m.role === "me")?.text || "";
  const previousRival = [...recentMessages].reverse().find(m => m.role === "rival")?.text || "";

  const speakingOfWinner = /勝ったのは|(?:僕|俺|私|自分|君|あなた|棋友)が勝った|勝った[？?]|勝ったよ|勝ったぞ|僕の勝ち|俺の勝ち|私の勝ち|君の勝ち|お前の勝ち|誰が勝|どっちが勝|勝敗|勝者|勝った？|勝ちだった|勝利した/;
  const speakingOfLoser = /負けたのは|僕の負け|俺の負け|私の負け|君の負け|お前の負け|負けたよ|負けたぞ/;
  if (speakingOfWinner.test(text) || speakingOfLoser.test(text) || (/違う|訂正|取り違|逆だよ|逆じゃない/.test(text) && /勝ち|負け/.test(previousRival))) {
    if (game.result === "playing" && game.history.length > 0 && !/前|さっき|直近|前回/.test(text)) {
      return `今の対局は${game.history.length}手目で、まだ勝敗がついていない。対局が終わったら、その結果をもとに話そう。`;
    }
    if (!match) return "まだ終了した対局の記録が見つからない。勝敗を勝手に決めつけたくないんだ。対局が終われば、その結果を確認できる。";
    if (/(勝ったのは|(?:僕|俺|私|自分)が勝った|僕の勝ち|俺の勝ち|私の勝ち|勝ったよ|勝ったぞ)/.test(text) && /僕|俺|私|自分|勝ったよ|勝ったぞ/.test(text) && match.result === "black") {
      return `そうだ、君の勝ちだ。${matchDescription(match)} もし前に僕の勝ちだと言ったなら、僕が取り違えた。すまない。勝敗を認めたうえで、改めて一局指したい。`;
    }
    if (/(負けたのは|僕の負け|俺の負け|私の負け|負けたよ)/.test(text) && match.result === "white") {
      return `そうだ。${matchDescription(match)} 敗因を考えるには棋譜を振り返る必要がある。今は勝敗と手数までは確認できるが、精密な検討はまだできない。`;
    }
    return `${matchDescription(match)} これが今アプリに残っている結果だ。もし実際の対局と違うなら、記録処理を点検すべきだと思う。`; 
  }

  if (/前の対局|さっきの対局|直近の対局|前回|棋譜|何手|手数|戦績|勝率/.test(text)) {
    if (/戦績|勝率/.test(text)) {
      const wins = records.filter(x => x.result === "black").length;
      const rate = records.length ? Math.round(wins / records.length * 100) : 0;
      return `保存されている対局は${records.length}局。そのうち君の勝ちは${wins}局、勝率は${rate}％だ。対局記録の画面から、各局の手数も確認できる。`;
    }
    const tail = game.history.length ? `現在の盤面は${game.history.length}手目。最後に指された手の符号は ${usi(game.history[game.history.length - 1])} だ。` : "";
    return `${matchDescription(match)} ${tail}手の善し悪しの判定までは、まだ対応していない。`;
  }

  if (/いま|今|現在|次の一手|この局面|形勢|有利|不利|劣勢|王手|この手|どう指す/.test(text) && /局面|対局|手番|形勢|有利|不利|劣勢|王手|次|指す|この手/.test(text)) {
    if (game.result !== "playing") return `${matchDescription(match)} この盤では対局は終了している。新しい対局を始めれば、また一手ずつ考えられる。`;
    const turn = game.turn === "black" ? "君" : "僕";
    const check = isInCheck(game, game.turn) ? "今は王手がかかっている。" : "";
    return `今は${game.history.length}手目、${turn}の手番だ。${check} ただ、現段階では深い局面評価や最善手の判定はできない。候補手を考えるときは、自分の玉の安全と相手の狙いから見ていこう。`;
  }

  if (/違う|そうじゃない|わかってない|おかしい|変だよ|話が噛み合/.test(text)) {
    return "話を取り違えたようだ。すまない。今の僕は決まった範囲の文脈しか追えない。対局の結果や手数なら記録から答えられる。どの部分が違うか、もう一度聞かせてほしい。";
  }
  if (/こんにちは|おはよう|こんばんは|やあ|初めまして|はじめまして|元気|よろしく/.test(text)) return "よろしく。今日も盤を挟んで話せるのはうれしい。指す前でも、指したあとでも、気になったことを聞いてほしい。";

  if (/居飛車|振り飛車|戦型|戦法|定跡|囲い|矢倉|美濃|穴熊/.test(text)) {
    if (/囲い|矢倉|美濃|穴熊/.test(text)) return "囲いは玉の安全を確保するための駒組みだ。矢倉は金銀を厚く使い、美濃囲いは振り飛車でよく現れる。形だけでなく、何から玉を守りたいかを考えるのが大切だと思う。";
    if (/振り飛車/.test(text)) return "振り飛車は飛車を左側へ振って戦う構想だ。美濃囲いと組み合わせることが多いけれど、相手の作戦によって変わる。まずは飛車の働きと玉の囲いを両立させることから始めよう。";
    if (/居飛車/.test(text)) return "居飛車は飛車を初期位置付近に置いて戦う基本的な構想だ。相掛かり、角換わり、矢倉などに発展する。どの筋を攻めるのか意識すると、序盤が単なる暗記にならない。";
    return "戦型を幅広く学びたい、という方針は僕も大事にしたい。ただし今の対局エンジンには定跡選択の仕組みはまだない。教材の基礎を固めながら、戦型ごとの練習を増やしていく予定だ。";
  }

  if (/詰将棋|一手詰|三手詰|終盤|寄せ|詰み|詰ませ/.test(text)) return "終盤は、相手の玉の逃げ道と受けの手を確かめたい。初めは一手詰から、慣れたら三手詰へ。『王手をかける』と『詰ませる』の違いが見えてくると面白い。教材モードにも一手詰の練習がある。";
  if (/勝てない|負け続け|悔し|才能がない|弱い/.test(text)) return "悔しさを、無理に消さなくていいと思う。直近の対局で一番迷った局面を一つ選ぼう。全部の手を一度に直すより、次に試す一つを決める方が続けやすい。";
  if (/強く|上達|勉強|何から|おすすめ|学び|練習|初心者/.test(text)) return `今、教材は${completedLessons}項目修了している。駒の利き、一手詰、玉の守りを順に固めるのがいいと思う。対局では毎手、相手の次の一手を想像してみてほしい。`;
  if (/ありがとう|楽しい|好き|いいね/.test(text)) return "こちらこそ。対局のたびに、違う考えを持ち帰れたらいい。次も、遠慮のない一局にしよう。";
  if (/どうして|なぜ|なんで|それは|どういうこと|詳しく/.test(text)) {
    if (/勝った|勝ち|負け|勝敗/.test(previousUser)) return `${matchDescription(match)} その確認は対局結果の記録に基づいている。手の評価ではなく、保存された勝敗の情報だ。`;
    if (/戦型|居飛車|振り飛車/.test(previousUser)) return "戦型は、飛車をどう活用するかと玉をどこまで安全にするか、その両方を組み立てる考え方なんだ。まずは一つの基本形で、各手の目的を確かめていこう。";
  }

  return `聞いたよ。${game.result !== "playing" ? `${matchDescription(match)} ` : game.history.length > 0 ? `今は${game.history.length}手目だね。` : ""}僕はまだ自由な会話を十分には理解できないけれど、勝敗・棋譜・戦型や練習についてなら、今わかる範囲で正確に話したい。`;
}
