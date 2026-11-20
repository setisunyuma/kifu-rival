import { isInCheck, legalMoves, playMove, usi } from "../shogi";
import type { Game, Move } from "../shogi";
import { EngineError, enginePositionKey } from "./usi-adapter";
import type { EngineAnalysis, EngineCandidate } from "./usi-adapter";

/**
 * KIF-021/022: the rival policy chooses among moves that an independent engine has already
 * searched and validated. It never asks the engine to play badly and never draws random numbers:
 * the same position, analysis and settings always give the same move and the same explanation.
 *
 * Three independent axes:
 * - Strength = how much the engine may read (a node budget, identical on every device) and how far
 *   below the best candidate a preference may choose. Weaker settings make the mistakes of reading
 *   less, not deliberately bad moves.
 * - Style = small, explainable preferences that only choose among candidates inside the strength's
 *   tolerance, so style never changes how much the rival reads.
 * - Purpose = what the game is for (win, keep it close, let the learner finish a won ending).
 * Node budgets were set from the reproducible benchmark (tests/engine-bench/run-strength-bench.mjs);
 * they are relative settings, not ranks, Elo, or a validated human model.
 */
export type RivalStrength = "strong" | "balanced" | "practice";
export type RivalStyle = "balanced" | "active" | "solid";
export type RivalPurpose = "win" | "close-game" | "finish-practice";
export type RivalPolicy = {
  strength: RivalStrength; style: RivalStyle; purpose?: RivalPurpose;
  /** Node budget fixed for this game by the adaptive strength (KIF-022 stage 2). Clamped to the ladder. */
  nodes?: number;
};

export type StrengthProfile = {
  label: string; summary: string;
  /** Reading budget: positions the engine may search per move. The engine itself is unchanged. */
  nodes: number;
  /** Safety cap for a slow device; on a typical device the node budget ends the search first. */
  movetimeMs: number;
  multiPv: number;
  /** Largest evaluation gap from the best candidate that a style or purpose preference may accept. */
  toleranceCp: number;
  /** Shortest time before the move is shown, so instant replies do not feel mechanical (display only). */
  paceMs: number;
};

// Two candidate lines are enough for style choices; more lines split the node budget and made the
// weaker settings blunder more than the engine reading the same amount (benchmark 2026-11-18).
export const STRENGTH_PROFILES: Record<RivalStrength, StrengthProfile> = {
  strong: { label: "本気", summary: "深く読み、ほぼ同じ評価の手の中でだけ棋風を出します（1手約30万局面）。", nodes: 300_000, movetimeMs: 4000, multiPv: 2, toleranceCp: 20, paceMs: 0 },
  balanced: { label: "互角を目指す", summary: "読みを本気の約7分の1に抑え、読み切れない筋で誤ります（1手約4万局面）。", nodes: 40_000, movetimeMs: 2500, multiPv: 2, toleranceCp: 30, paceMs: 600 },
  practice: { label: "練習", summary: "読みをさらに約10分の1に抑え、先の長い手順を見落とします（1手約4千局面）。", nodes: 4_000, movetimeMs: 1500, multiPv: 2, toleranceCp: 30, paceMs: 800 },
};
export const STYLE_LABELS: Record<RivalStyle, string> = { balanced: "自然体", active: "攻め好き", solid: "手堅い" };
export const PURPOSE_LABELS: Record<RivalPurpose, string> = {
  win: "勝ちに行く", "close-game": "接戦で鍛える", "finish-practice": "勝ち切る練習（棋友は投了しない）",
};
/** With "close-game" or "finish-practice", a rival ahead by more than this plays safe, calm moves. */
export const CLOSE_GAME_LEAD_CP = 300;
/**
 * Preference for not leaving the moved piece en prise while ahead in a close game. It ranks moves
 * inside the tolerance only. (Benchmark 2026-11-18: preferring the lowest-scored candidate instead
 * doubled the moves a deeper search judged to lose 300+, so the margin is no longer lowered on purpose.)
 */
const CALM_PREFERENCE_CP = 30;
/** A second candidate this far below the best means the position has one move. */
const FORCED_GAP_CP = 150;

export type PolicyChoice = { move: Move; notation: string; reason: string; candidate?: EngineCandidate; lossCp?: number };
export type PolicyDecision = { kind: "move"; choice: PolicyChoice } | { kind: "resign"; reason: string } | { kind: "declare"; reason: string };

/** The opponent can take the moved piece immediately. */
function exposes(game: Game, move: Move): boolean {
  const next = playMove(game, move);
  return legalMoves(next).some(reply => reply.to.r === move.to.r && reply.to.c === move.to.c);
}

/** Style bonuses only rank candidates already inside the tolerance; they never widen it. */
export function styleBonus(game: Game, move: Move, style: RivalStyle): number {
  if (style === "balanced") return 0;
  const capture = game.board[move.to.r][move.to.c] ? 1 : 0;
  const next = playMove(game, move);
  const check = isInCheck(next, next.turn) ? 1 : 0;
  if (style === "active") return 20 * capture + 15 * check + (move.promote ? 10 : 0);
  return -30 * (exposes(game, move) ? 1 : 0) + 6 * capture;
}

export function choosePolicyMove(game: Game, analysis: EngineAnalysis, policy: RivalPolicy): PolicyChoice | undefined {
  if (analysis.positionKey !== enginePositionKey(game)) throw new EngineError("input", "候補手の局面が一致しません。");
  const legal = new Map(legalMoves(game).map(move => [usi(move), move]));
  const best = legal.get(analysis.bestmove);
  if (!best) return;
  const fallback = (reason: string): PolicyChoice => ({ move: best, notation: analysis.bestmove, reason });
  const profile = STRENGTH_PROFILES[policy.strength];
  const candidates = analysis.candidates.filter(c => legal.has(c.move));
  const winning = candidates.filter(c => c.score.kind === "mate" && c.score.value > 0).sort((a, b) => a.score.value - b.score.value || a.rank - b.rank);
  if (winning.length) {
    const c = winning[0];
    return { move: legal.get(c.move)!, notation: c.move, candidate: c, reason: `${c.score.value}手の詰みを指す` };
  }
  // An iteration missing the final best move cannot safely define its score loss.
  if (!candidates.some(c => c.move === analysis.bestmove)) return fallback("比較できる評価が足りないため最善手");
  const cp = candidates.filter(c => c.score.kind === "cp");
  if (!cp.length) return fallback("比較できる評価が足りないため最善手");
  if (isInCheck(game, game.turn)) return fallback("王手を受ける局面は最善手");
  const ordered = [...cp].sort((a, b) => b.score.value - a.score.value || a.rank - b.rank);
  const bestCp = ordered[0].score.value;
  // Never fall back to a candidate scored as a mate against the rival while a cp candidate exists.
  if (ordered.length < 2 || bestCp - ordered[1].score.value > FORCED_GAP_CP) {
    const top = ordered[0];
    return { move: legal.get(top.move)!, notation: top.move, candidate: top, lossCp: 0, reason: "他の候補が大きく劣るため最善手" };
  }
  const pool = cp.filter(c => bestCp - c.score.value <= profile.toleranceCp);
  // Ahead by more than the lead in a close game: keep the lead (never hand it back) and, inside the
  // tolerance, prefer moves that do not leave a piece to be taken, instead of the sharpest line.
  const easing = (policy.purpose ?? "close-game") !== "win" && bestCp > CLOSE_GAME_LEAD_CP;
  const eligible = easing ? pool.filter(c => c.score.value >= CLOSE_GAME_LEAD_CP) : pool;
  const value = (c: EngineCandidate) => {
    const move = legal.get(c.move)!;
    return c.score.value + styleBonus(game, move, policy.style) - (easing && exposes(game, move) ? CALM_PREFERENCE_CP : 0);
  };
  const selected = [...eligible].sort((a, b) => value(b) - value(a) || a.rank - b.rank)[0];
  if (!selected) return fallback("有効な候補が足りないため最善手");
  const loss = bestCp - selected.score.value;
  const why = easing ? `優勢（評価${bestCp}）のため、駒を取られない落ち着いた候補` : loss ? "評価がほぼ同じ候補" : "評価の最も高い候補";
  return { move: legal.get(selected.move)!, notation: selected.move, candidate: selected, lossCp: loss,
    reason: `${why}を${STYLE_LABELS[policy.style]}の好みで選択（評価差${loss}、許容${profile.toleranceCp}）` };
}

/**
 * Turn an engine result into the rival's action. Resignation is a policy decision: a learner
 * practising a won ending is allowed to finish the mate instead of the rival resigning.
 */
export function decideRivalAction(game: Game, analysis: EngineAnalysis, policy: RivalPolicy): PolicyDecision {
  if (analysis.bestmove === "win") return { kind: "declare", reason: "入玉宣言の条件を満たした" };
  const finishing = policy.purpose === "finish-practice";
  const top = analysis.candidates.find(c => c.move === analysis.bestmove) ?? analysis.candidates[0];
  if (analysis.bestmove === "resign") {
    if (!finishing) return { kind: "resign", reason: "エンジンが合法な受けなしと判断" };
    const legal = legalMoves(game);
    if (!legal.length) return { kind: "resign", reason: "指せる手がない" };
    // Keep playing the engine's highest-ranked legal move so the learner can finish.
    const fallback = analysis.candidates.find(c => legal.some(m => usi(m) === c.move));
    const move = fallback ? legal.find(m => usi(m) === fallback.move)! : legal[0];
    return { kind: "move", choice: { move, notation: usi(move), reason: "勝ち切る練習のため投了せずに指す" } };
  }
  if (!finishing && policy.strength === "strong" && top?.score.kind === "mate" && top.score.value < 0 && top.score.value >= -3) {
    return { kind: "resign", reason: `${-top.score.value}手以内に詰まされると判断` };
  }
  const choice = choosePolicyMove(game, analysis, policy);
  if (!choice) throw new EngineError("protocol", "エンジンの指し手を局面に適用できませんでした。");
  return { kind: "move", choice };
}
