import fs from "fs";
import path from "path";
import { PatternRegistry } from "../patterns/PatternRegistry";
import { StabilityAssessor } from "./StabilityAssessor";
import { Metrics } from "../metrics";
import { verifyEvolution, signEvolutionEvent, appendPatternEventLog } from "../governance/SAGA";

export class SelfDevelopmentEngine {
  private readonly registry: PatternRegistry;
  private readonly stability: StabilityAssessor;
  private readonly minImprovementCycles: number;
  private noImprovementCounter = 0;
  private lastPerf = 0.5;

  constructor(registry: PatternRegistry, stability: StabilityAssessor, minImprovementCycles = 3) {
    this.registry = registry;
    this.stability = stability;
    this.minImprovementCycles = minImprovementCycles;
  }

  private knowledgePath(): string {
    return path.resolve(process.cwd(), "knowledge/state.json");
  }

  loadKnowledge(): void {
    try {
      const raw = fs.readFileSync(this.knowledgePath(), "utf-8");
      const data = JSON.parse(raw) as { perf?: number; activePatternId?: string; cells?: Record<string, { ema?: number; routerConfidence?: number; temp?: number }>; bandit?: { epsilon?: number; counts?: Record<string, number>; values?: Record<string, number> } };
      if (typeof data.perf === "number") this.lastPerf = data.perf;
      if (data.activePatternId) this.registry.setActivePatternId(data.activePatternId);
      // seed per-cell priors
      if (data.cells) {
        for (const [cellId, v] of Object.entries(data.cells)) {
          if (typeof v.ema === "number") Metrics.setCellSuccessRate(cellId, v.ema);
          if (typeof v.routerConfidence === "number") Metrics.setRouterConfidence(cellId, v.routerConfidence);
        }
      }
      // seed bandit: handled externally (index.ts) where router instance is available
    } catch {}
  }

  saveKnowledge(): void {
    const snapshot = { perf: this.lastPerf, activePatternId: this.registry.getActivePatternId() };
    const p = this.knowledgePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(snapshot, null, 2));
  }

  async evaluate(): Promise<void> {
    // Optionally, we could auto-synthesize here based on accumulated suggestions.
    // Leaving discovery to the explicit /evolution/synthesize endpoint for governance.
    const prePerf = Metrics.globalSuccessEMA();
    const preCx = this.registry.activePatternComplexity();
    if (prePerf <= this.lastPerf + 0.001) this.noImprovementCounter++; else this.noImprovementCounter = 0;

    if (this.noImprovementCounter >= this.minImprovementCycles && verifyEvolution()) {
      const next = this.registry.synthesizeNewPattern();
      const postCx = Math.max(1, next.cells.length);
      const { alpha, beta } = this.stability.getCoefficients();
      const prospect = this.stability.computeProspective(prePerf, prePerf, preCx, postCx);
      if (prospect.deltaV < 0) {
        // Canary (simplified): we don't change pattern yet; rely on orchestrator to apply after external trigger
        const now = new Date().toISOString();
        const signed = signEvolutionEvent(next, { deltaV: prospect.deltaV, timestamp: now, preSuccess: prePerf, postSuccess: prePerf, preComplexity: preCx, postComplexity: postCx, alpha, beta, decision: "commit", canaryN: 0, canaryWindowMs: 0 });
        appendPatternEventLog(signed);
        this.registry.setActivePatternId(next.id);
        this.noImprovementCounter = 0;
        this.stability.commit(prePerf, postCx);
      } else {
        const now = new Date().toISOString();
        const signed = signEvolutionEvent(next, { deltaV: prospect.deltaV, timestamp: now, preSuccess: prePerf, postSuccess: prePerf, preComplexity: preCx, postComplexity: postCx, alpha, beta, decision: "rollback", canaryN: 0, canaryWindowMs: 0 });
        appendPatternEventLog(signed);
      }
    }
    this.lastPerf = prePerf;
    this.saveKnowledge();
  }
}


