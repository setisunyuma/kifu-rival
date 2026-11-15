import { isInCheck, legalMoves, playMove, usi } from "../shogi";
import type { Game, Move } from "../shogi";
import { EngineError, enginePositionKey } from "./usi-adapter";
import type { EngineAnalysis, EngineCandidate } from "./usi-adapter";

export type RivalPolicy = {
  strength: "strong" | "balanced" | "practice";
  style: "balanced" | "active" | "solid";
  seed: number;
};
export type PolicyChoice = { move: Move; notation: string; reason: string; candidate?: EngineCandidate; lossCp?: number };

function hash(text: string, seed: number): number {
  let n = seed >>> 0;
  for (const char of text) n = Math.imul(n ^ char.charCodeAt(0), 16777619) >>> 0;
  return n / 0x100000000;
}

/** Experimental score budgets; they are not ranks, Elo, or a validated human model. */
export function choosePolicyMove(game: Game, analysis: EngineAnalysis, policy: RivalPolicy): PolicyChoice | undefined {
  if (analysis.positionKey !== enginePositionKey(game)) throw new EngineError("input", "候補手の局面が一致しません。");
  const legal = new Map(legalMoves(game).map(move => [usi(move), move]));
  const best = legal.get(analysis.bestmove);
  if (!best) return;
  const fallback = (reason: string): PolicyChoice => ({ move: best, notation: analysis.bestmove, reason });
  if (policy.strength === "strong") return fallback("エンジンの最善候補を選択（棋力は未校正）");
  const candidates = analysis.candidates.filter(c => legal.has(c.move));
  const winning = candidates.filter(c => c.score.kind === "mate" && c.score.value > 0).sort((a, b) => a.score.value - b.score.value);
  if (winning.length) {
    const c = winning[0];
    return { move: legal.get(c.move)!, notation: c.move, candidate: c, reason: "詰みを維持する候補を選択" };
  }
  // An iteration missing the final best move cannot safely define its score loss.
  const principal = candidates.find(c => c.move === analysis.bestmove);
  if (!principal) return fallback("比較可能な評価が不足したため最善候補を選択");
  const cp = candidates.filter(c => c.score.kind === "cp");
  if (!cp.length) return fallback("比較可能な評価が不足したため最善候補を選択");
  const bestCp = Math.max(...cp.map(c => c.score.value));
  const ordered = cp.map(c => c.score.value).sort((a, b) => b - a);
  const forced = isInCheck(game, game.turn) || (ordered.length > 1 && ordered[0] - ordered[1] > 150);
  const budget = forced ? 0 : policy.strength === "balanced" ? 70 : 180;
  const pool = cp.filter(c => bestCp - c.score.value <= budget);
  const value = (c: EngineCandidate): number => {
    const move = legal.get(c.move)!;
    const capture = game.board[move.to.r][move.to.c] ? 1 : 0;
    const next = playMove(game, move);
    const check = isInCheck(next, next.turn) ? 1 : 0;
    const threatened = legalMoves(next).some(reply => reply.to.r === move.to.r && reply.to.c === move.to.c) ? 1 : 0;
    const style = policy.style === "active" ? 24 * capture + 18 * check + (move.promote ? 12 : 0)
      : policy.style === "solid" ? -35 * threatened + 8 * capture : 0;
    return c.score.value + style + hash(`${analysis.sfen}:${c.move}`, policy.seed) * (policy.strength === "practice" ? 160 : 45);
  };
  const selected = [...pool].sort((a, b) => value(b) - value(a) || a.rank - b.rank)[0];
  if (!selected) return fallback("有効な候補が不足したため最善候補を選択");
  return { move: legal.get(selected.move)!, notation: selected.move, candidate: selected,
    lossCp: bestCp - selected.score.value,
    reason: `${forced ? "強制手に近い局面では評価差を許容せず" : `評価差${budget}以内で棋風を考慮して`}選択（仮設定）` };
}
