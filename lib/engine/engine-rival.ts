import type { Game } from "../shogi";
import { EngineError, UsiAdapter, enginePositionKey } from "./usi-adapter";
import type { EngineAnalysis, UsiTransport } from "./usi-adapter";
import { STRENGTH_PROFILES, decideRivalAction } from "./rival-policy";
import type { PolicyDecision, RivalPolicy } from "./rival-policy";

export type EngineTurn = { decision: PolicyDecision; analysis: EngineAnalysis; startupMs?: number; positionKey: string };

/**
 * Search limits of one turn. An adaptive node budget is kept inside the ladder (practice..strong);
 * large budgets get the strong setting's time cap so a slow device does not cut them short early.
 */
export function searchLimits(policy: RivalPolicy): { nodes: number; movetimeMs: number; multiPv: number } {
  const profile = STRENGTH_PROFILES[policy.strength];
  if (policy.nodes === undefined || !Number.isFinite(policy.nodes)) return { nodes: profile.nodes, movetimeMs: profile.movetimeMs, multiPv: profile.multiPv };
  const nodes = Math.round(Math.min(STRENGTH_PROFILES.strong.nodes, Math.max(STRENGTH_PROFILES.practice.nodes, policy.nodes)));
  const movetimeMs = nodes > 100_000 ? Math.max(profile.movetimeMs, STRENGTH_PROFILES.strong.movetimeMs) : profile.movetimeMs;
  return { nodes, movetimeMs, multiPv: profile.multiPv };
}

/** Errors after which the engine instance cannot be trusted and must be replaced. */
const FATAL: EngineError["code"][] = ["closed", "timeout", "cancelled", "protocol", "transport"];

/**
 * KIF-021: one rival turn = (start engine if needed) → search the exact position → rival policy.
 * The engine and the policy stay separate: the engine is always asked for its real best lines,
 * and only the policy decides which validated candidate to play.
 */
export class EngineRival {
  private adapter?: UsiAdapter;
  private starting?: Promise<number | undefined>;
  restarts = 0;
  engineName = "";

  constructor(private readonly createTransport: () => UsiTransport,
    private readonly options: Record<string, string | number | boolean>, private readonly startupTimeoutMs = 15000) {}

  private async ensure(): Promise<number | undefined> {
    if (this.adapter) return;
    if (this.starting) return this.starting;
    const fresh = new UsiAdapter(this.createTransport());
    const started = performance.now();
    this.starting = fresh.initialize(this.options, this.startupTimeoutMs)
      .then(() => { this.adapter = fresh; this.engineName = fresh.name; return performance.now() - started; })
      .catch(error => { fresh.close(); throw error; })
      .finally(() => { this.starting = undefined; });
    return this.starting;
  }

  async think(game: Game, policy: RivalPolicy, signal?: AbortSignal): Promise<EngineTurn> {
    if (signal?.aborted) throw new EngineError("cancelled", "中断しました。");
    const positionKey = enginePositionKey(game);
    let startupMs: number | undefined;
    try {
      startupMs = await this.ensure();
      if (signal?.aborted) throw new EngineError("cancelled", "中断しました。");
      const { nodes, movetimeMs, multiPv } = searchLimits(policy);
      const analysis = await this.adapter!.analyze(game, { nodes, movetimeMs, multiPv, signal });
      return { decision: decideRivalAction(game, analysis, policy), analysis, startupMs, positionKey };
    } catch (error) {
      if (!(error instanceof EngineError) || FATAL.includes(error.code)) this.reset();
      throw error;
    }
  }

  /** Terminates the Worker. The next think() starts a fresh engine. */
  reset() {
    if (this.adapter) { this.adapter.close(); this.restarts++; }
    this.adapter = undefined;
  }
}
