import { isInCheck, legalMoves, playMove, usi } from "../shogi";
import type { Game, Move } from "../shogi";
import { EngineError, enginePositionKey } from "./usi-adapter";
import type { EngineAnalysis, EngineCandidate } from "./usi-adapter";

/**
 * KIF-021/022: the rival policy chooses among moves that an independent engine has already
 * searched and validated. It never asks the engine to play badly and never draws random numbers:
 * the same position, analysis and settings always give the same move and the same explanation.
 *
 * Strength = how much search time the engine gets, plus how far (in centipawns) the choice may
 * stay below the best candidate. Style = small, explainable preferences inside that budget.
 * Purpose = what the game is for (win, keep it close, let the learner finish a won ending).
 * All numbers are provisional settings, not ranks, Elo, or a validated human model.
 */
export type RivalStrength = "strong" | "balanced" | "practice";
export type RivalStyle = "balanced" | "active" | "solid";
export type RivalPurpose = "win" | "close-game" | "finish-practice";
export type RivalPolicy = { strength: RivalStrength; style: RivalStyle; purpose?: RivalPurpose };

export type StrengthProfile = {
  label: string; summary: string;
  /** Engine search time per move. Weaker settings search less; the engine itself is unchanged. */
  movetimeMs: number; multiPv: number;
  /** Largest evaluation gap from the best candidate that the policy may accept. */
  budgetCp: number;
  /** When the rival leads by more than this, it prefers the candidate closest to this lead. */
  targetLeadCp?: number;
};

export const STRENGTH_PROFILES: Record<RivalStrength, StrengthProfile> = {
  strong: { label: "本気", summary: "エンジンの最善手を指します（1手1秒）。", movetimeMs: 1000, multiPv: 3, budgetCp: 0 },
  balanced: { label: "互角を目指す", summary: "評価差80以内の候補から、大差にしすぎない手を選びます（1手0.5秒）。", movetimeMs: 500, multiPv: 5, budgetCp: 80, targetLeadCp: 300 },
  practice: { label: "練習", summary: "評価差200以内の候補から、接戦を保つ手を選びます（1手0.3秒）。", movetimeMs: 300, multiPv: 5, budgetCp: 200, targetLeadCp: 100 },
};
export const STYLE_LABELS: Record<RivalStyle, string> = { balanced: "自然体", active: "攻め好き", solid: "手堅い" };
export const PURPOSE_LABELS: Record<RivalPurpose, string> = {
  win: "勝ちに行く", "close-game": "接戦で鍛える", "finish-practice": "勝ち切る練習（棋友は投了しない）",
};

export type PolicyChoice = { move: Move; notation: string; reason: string; candidate?: EngineCandidate; lossCp?: number };
export type PolicyDecision = { kind: "move"; choice: PolicyChoice } | { kind: "resign"; reason: string } | { kind: "declare"; reason: string };

/** Style bonuses are capped well below the budgets so style never outweighs a real evaluation gap. */
function styleBonus(game: Game, move: Move, style: RivalStyle): number {
  if (style === "balanced") return 0;
  const capture = game.board[move.to.r][move.to.c] ? 1 : 0;
  const next = playMove(game, move);
  const check = isInCheck(next, next.turn) ? 1 : 0;
  if (style === "active") return 20 * capture + 15 * check + (move.promote ? 10 : 0);
  const exposed = legalMoves(next).some(reply => reply.to.r === move.to.r && reply.to.c === move.to.c) ? 1 : 0;
  return -30 * exposed + 6 * capture;
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
  if (winning.length && policy.strength !== "strong") {
    const c = winning[0];
    return { move: legal.get(c.move)!, notation: c.move, candidate: c, reason: `${c.score.value}手の詰みを指す` };
  }
  if (profile.budgetCp === 0) return fallback("エンジンの最善手（棋力は未校正）");
  // An iteration missing the final best move cannot safely define its score loss.
  if (!candidates.some(c => c.move === analysis.bestmove)) return fallback("比較できる評価が足りないため最善手");
  const cp = candidates.filter(c => c.score.kind === "cp");
  if (!cp.length) return fallback("比較できる評価が足りないため最善手");
  const bestCp = Math.max(...cp.map(c => c.score.value));
  const ordered = cp.map(c => c.score.value).sort((a, b) => b - a);
  if (isInCheck(game, game.turn)) return fallback("王手を受ける局面は最善手");
  if (ordered.length > 1 && ordered[0] - ordered[1] > 150) return fallback("他の候補が大きく劣るため最善手");
  const pool = cp.filter(c => bestCp - c.score.value <= profile.budgetCp);
  const target = policy.purpose === "win" ? undefined : profile.targetLeadCp;
  const easing = target !== undefined && bestCp > target;
  const value = (c: EngineCandidate) => {
    // Ahead by more than the target: prefer the candidate whose evaluation is nearest the target.
    const base = easing ? -Math.abs(c.score.value - target!) : c.score.value;
    return base + styleBonus(game, legal.get(c.move)!, policy.style);
  };
  const selected = [...pool].sort((a, b) => value(b) - value(a) || a.rank - b.rank)[0];
  if (!selected) return fallback("有効な候補が足りないため最善手");
  const loss = bestCp - selected.score.value;
  const why = easing ? `優勢（評価${bestCp}）のため、差を${target}付近に保つ候補` : "評価の高い候補";
  return { move: legal.get(selected.move)!, notation: selected.move, candidate: selected, lossCp: loss,
    reason: `${why}を${STYLE_LABELS[policy.style]}の好みで選択（評価差${loss}、許容${profile.budgetCp}）` };
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
