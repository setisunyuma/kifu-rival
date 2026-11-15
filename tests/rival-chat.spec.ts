import assert from "node:assert/strict";
import test from "node:test";
import { initialGame } from "../lib/shogi";
import { RivalChatContext, rivalReply } from "../lib/rival-chat";

function context(overrides: Partial<RivalChatContext> = {}): RivalChatContext {
  return {
    game: initialGame(),
    records: [],
    completedLessons: 2,
    recentMessages: [],
    ...overrides,
  };
}

test("recognizes a player's victory from the completed game, apologizing for reversal", () => {
  const game = { ...initialGame(), result: "black" as const };
  const reply = rivalReply("勝ったのは僕だよ？", context({ game }));
  assert.match(reply, /君の勝ち/);
  assert.match(reply, /取り違え/);
  assert.doesNotMatch(reply, /^僕の勝ち/);
});

test("checks the previous record if a new match has not started yet", () => {
  const records = [{ id: "1", date: "2026-11-15T04:00:00Z", result: "black" as const, moves: ["7g7f", "3c3d"] }];
  const reply = rivalReply("僕が勝ったよ", context({ records }));
  assert.match(reply, /2手/);
  assert.match(reply, /君の勝ち/);
});

test("does not agree to a false user claim", () => {
  const game = { ...initialGame(), result: "white" as const };
  const reply = rivalReply("勝ったのは僕だよ？", context({ game }));
  assert.match(reply, /僕の勝ち/);
  assert.doesNotMatch(reply, /そうだ、君の勝ち/);
});

test("does not hallucinate results without a completed game", () => {
  const reply = rivalReply("勝ったのは誰？", context());
  assert.match(reply, /記録が見つからない/);
});

test("an ongoing game has no winner even if another completed game exists", () => {
  const game = { ...initialGame(), history: [{ from: { r: 6, c: 2 }, to: { r: 5, c: 2 } }] };
  const reply = rivalReply("今の勝者は誰？", context({
    game,
    records: [{ id: "old", date: "2026-11-14T00:00:00Z", result: "black", moves: ["7g7f"] }],
  }));
  assert.match(reply, /まだ勝敗がついていない/);
});

test("answers lesson and opening questions without claiming unimplemented engine ability", () => {
  assert.match(rivalReply("何から勉強する？", context()), /2項目/);
  assert.match(rivalReply("どんな戦型を使う？", context()), /まだない/);
});

test("answers match statistics from actual records", () => {
  const records = [
    { id: "a", date: "2026-11-15", result: "black" as const, moves: [] },
    { id: "b", date: "2026-11-14", result: "white" as const, moves: [] },
  ];
  assert.match(rivalReply("勝率は？", context({ records })), /50％/);
});
