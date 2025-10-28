import { GenAICell } from "../agents/GenAICell";
import { Metrics } from "../metrics";

export type LearningStrategy = "success_rate" | "keyword" | "rl_bandit";

export interface LearningRouterResult {
  cell: GenAICell;
  confidence: number; // 0..1 overall score used for adaptation
  reason: string;
}

export class LearningRouter {
  private readonly cells: GenAICell[];
  private epsilon: number = Number(process.env.RL_EPSILON || 0.15);
  private counts: Record<string, number> = {};
  private values: Record<string, number> = {};
  private alpha: number = 0.2; // learning rate for bandit value updates
  private decay: number = Number(process.env.RL_DECAY || 0.02); // decay toward neutral for non-selected cells
  // epsilon schedule + drift spike
  private step: number = 0;
  private eps0: number = Number(process.env.RL_EPSILON0 || this.epsilon);
  private minEps: number = Number(process.env.RL_MIN_EPSILON || 0.08);
  private epsDecay: number = Number(process.env.RL_EPSILON_DECAY || 0.0);
  private warmupSteps: number = Number(process.env.RL_WARMUP_STEPS || 0);
  private driftWindow: number = Number(process.env.RL_DRIFT_WINDOW || 30);
  private driftDrop: number = Number(process.env.RL_DRIFT_DROP || 0.08);
  private spikeEpsilon: number = Number(process.env.RL_SPIKE_EPSILON || 0.30);
  private spikeDecay: number = Number(process.env.RL_SPIKE_DECAY || 0.01);
  private spikeSteps: number = Number(process.env.RL_SPIKE_STEPS || 20);
  private spikeUntil: number = 0;

  constructor(cells: GenAICell[]) {
    this.cells = cells;
  }

  route(input: string, strategy: LearningStrategy = "success_rate"): LearningRouterResult {
    // Force base cell for explicit tool usage prompts to ensure tool execution
    const toolPromptPatterns = [
      /\b(file\.list\.dir|search\.regex|ts\.transpile|file\.write)\b/i,
      /\busing the.*tool\b/i,
      /\buse.*tool\b/i,
      /\btool.*to\b/i,
      /\bwrite\s+.*\s+to\s+file\b/i,
      /\bcreate\s+file\b/i
    ];
    const isExplicitToolPrompt = toolPromptPatterns.some(pattern => pattern.test(input));
    if (isExplicitToolPrompt) {
      const baseCell = this.cells.find(c => c.id === 'cell-base');
      if (baseCell) {
        return { cell: baseCell, confidence: 1.0, reason: 'explicit-tool-prompt' };
      }
    }

    if (strategy === "keyword") {
      // purely keyword-driven: pick highest tag match
      let best = this.cells[0]!;
      let bestMatch = best.matchTags(input);
      for (const c of this.cells.slice(1)) {
        const m = c.matchTags(input);
        if (m > bestMatch) {
          best = c;
          bestMatch = m;
        }
      }
      const conf = Math.max(0.05, Math.min(1, bestMatch));
      return { cell: best, confidence: conf, reason: `keyword bestMatch=${bestMatch.toFixed(2)}` };
    }

    if (strategy === "rl_bandit") {
      this.step++;
      const epsEff = this.effectiveEpsilon(this.step);
      // Epsilon-greedy over learned values with exploration
      if (Math.random() < epsEff) {
        const randomCell = this.cells[Math.floor(Math.random() * this.cells.length)]!;
        const rconf = Math.max(0.05, this.values[randomCell.id] ?? 0.5);
        return { cell: randomCell, confidence: rconf, reason: `rl_bandit explore ε=${epsEff.toFixed(3)}` };
      }
      // Tag guard: if a cell strongly matches the prompt, prefer it for quick domain shifts
      const guarded = this.pickByTagGuard(input, Number(process.env.TAG_GUARD_THRESHOLD || 0.6));
      if (guarded) {
        const conf = Math.max(0.05, Math.min(1, this.values[guarded.cell.id] ?? guarded.match));
        return { cell: guarded.cell, confidence: conf, reason: `rl_bandit tagGuard match=${guarded.match.toFixed(2)}` };
      }
      // Exploit: choose cell with highest learned value (fallback to balanced score)
      let best = this.cells[0]!;
      let bestVal = this.values[best.id] ?? this.scoreCell(best, input, 0.5, 0.5);
      for (const c of this.cells.slice(1)) {
        const val = this.values[c.id] ?? this.scoreCell(c, input, 0.5, 0.5);
        if (val > bestVal) { best = c; bestVal = val; }
      }
      const conf = Math.max(0.05, Math.min(1, bestVal));
      return { cell: best, confidence: conf, reason: `rl_bandit exploit value=${bestVal.toFixed(2)}` };
    }

    // default: success_rate strategy uses 0.5 perf and 0.5 tag match with a tag-first guard
    // If a cell's tagMatch is strong, prefer it to reduce lock-in
    const tagPreferred = this.pickByTagGuard(input, 0.6);
    if (tagPreferred) {
      const conf = Math.max(0.05, Math.min(1, tagPreferred.match));
      return { cell: tagPreferred.cell, confidence: conf, reason: `success_rate tagGuard match=${tagPreferred.match.toFixed(2)}` };
    }
    return this.scoreAndPick(input, 0.5, 0.5, "success_rate");
  }

  private scoreAndPick(input: string, perfWeight: number, tagWeight: number, reasonLabel: string): LearningRouterResult {
    let best = this.cells[0]!;
    let bestScore = this.scoreCell(best, input, perfWeight, tagWeight);
    for (const c of this.cells.slice(1)) {
      const s = this.scoreCell(c, input, perfWeight, tagWeight);
      if (s > bestScore) {
        best = c;
        bestScore = s;
      }
    }
    const confidence = Math.max(0.05, Math.min(1, bestScore));
    return { cell: best, confidence, reason: `${reasonLabel} perfWeight=${perfWeight} tagWeight=${tagWeight} score=${bestScore.toFixed(2)}` };
  }

  private scoreCell(cell: GenAICell, input: string, perfWeight: number, tagWeight: number): number {
    const perf = Metrics.getCellSuccessRate(cell.id); // 0..1
    const tagMatch = cell.matchTags(input); // 0..1
    return perfWeight * perf + tagWeight * tagMatch;
  }

  getBanditState() {
    return { epsilon: this.epsilon, counts: { ...this.counts }, values: { ...this.values } };
  }

  setBanditState(state: { epsilon?: number; counts?: Record<string, number>; values?: Record<string, number> }) {
    if (typeof state.epsilon === "number") this.epsilon = Math.max(0, Math.min(1, state.epsilon));
    if (state.counts) this.counts = { ...state.counts };
    if (state.values) this.values = { ...state.values };
  }

  update(cellId: string, reward: number) {
    const r = Math.max(0, Math.min(1, reward));
    const prev = this.values[cellId] ?? 0.5;
    const newVal = prev + this.alpha * (r - prev);
    this.values[cellId] = Number(newVal.toFixed(3));
    this.counts[cellId] = (this.counts[cellId] ?? 0) + 1;
    // Decay values for non-selected cells toward neutral to forget previous regime
    if (this.decay > 0) {
      for (const c of this.cells) {
        if (c.id === cellId) continue;
        const v = this.values[c.id] ?? 0.5;
        const dv = v * (1 - this.decay) + 0.5 * this.decay;
        this.values[c.id] = Number(dv.toFixed(3));
      }
    }
    // Detect drift and schedule exploration spike if reward degraded
    this.maybeSpikeOnDrift();
  }

  getParams() {
    return {
      epsilon: this.epsilon,
      decay: this.decay,
      eps0: this.eps0,
      minEps: this.minEps,
      epsDecay: this.epsDecay,
      warmupSteps: this.warmupSteps,
      driftWindow: this.driftWindow,
      driftDrop: this.driftDrop,
      spikeEpsilon: this.spikeEpsilon,
      spikeDecay: this.spikeDecay,
      spikeSteps: this.spikeSteps,
    };
  }

  setParams(params: Partial<{ epsilon: number; decay: number; eps0: number; minEps: number; epsDecay: number; warmupSteps: number; driftWindow: number; driftDrop: number; spikeEpsilon: number; spikeDecay: number; spikeSteps: number }>) {
    if (typeof params.epsilon === 'number') this.epsilon = Math.max(0, Math.min(1, params.epsilon));
    if (typeof params.decay === 'number') this.decay = Math.max(0, Math.min(1, params.decay));
    if (typeof params.eps0 === 'number') this.eps0 = Math.max(0, Math.min(1, params.eps0));
    if (typeof params.minEps === 'number') this.minEps = Math.max(0, Math.min(1, params.minEps));
    if (typeof params.epsDecay === 'number') this.epsDecay = Math.max(0, params.epsDecay);
    if (typeof params.warmupSteps === 'number') this.warmupSteps = Math.max(0, Math.floor(params.warmupSteps));
    if (typeof params.driftWindow === 'number') this.driftWindow = Math.max(1, Math.floor(params.driftWindow));
    if (typeof params.driftDrop === 'number') this.driftDrop = Math.max(0, Math.min(1, params.driftDrop));
    if (typeof params.spikeEpsilon === 'number') this.spikeEpsilon = Math.max(0, Math.min(1, params.spikeEpsilon));
    if (typeof params.spikeDecay === 'number') this.spikeDecay = Math.max(0, params.spikeDecay);
    if (typeof params.spikeSteps === 'number') this.spikeSteps = Math.max(1, Math.floor(params.spikeSteps));
  }

  private pickByTagGuard(input: string, threshold: number): { cell: GenAICell; match: number } | null {
    let best = this.cells[0]!;
    let bestMatch = best.matchTags(input);
    for (const c of this.cells.slice(1)) {
      const m = c.matchTags(input);
      if (m > bestMatch) { best = c; bestMatch = m; }
    }
    return bestMatch >= threshold ? { cell: best, match: bestMatch } : null;
  }

  private effectiveEpsilon(nowStep: number): number {
    // warmup
    if (nowStep <= this.warmupSteps) return this.eps0;
    const t = nowStep - this.warmupSteps;
    const decayed = this.eps0 * Math.exp(-this.epsDecay * t);
    const scheduled = Math.max(this.minEps, decayed);
    if (nowStep < this.spikeUntil) {
      const remaining = this.spikeUntil - nowStep;
      const spike = this.spikeEpsilon * Math.exp(-this.spikeDecay * (this.spikeSteps - remaining));
      return Math.max(scheduled, spike);
    }
    return scheduled;
  }

  private maybeSpikeOnDrift(): void {
    try {
      const detailed: any = Metrics.detailed();
      const recent: any[] = Array.isArray(detailed.recent) ? detailed.recent : [];
      const n = this.driftWindow * 2;
      if (recent.length < n) return;
      const slic = recent.slice(-n);
      const slo = Number(process.env.LATENCY_SLO_MS || 2000);
      const reward = (e: any) => {
        const y = e.success ? 1 : 0;
        const latPen = Math.min(1, Number(e.latencyMs || 0) / Math.max(1, slo));
        return Math.max(0, y * (1 - latPen));
      };
      const a = slic.slice(0, this.driftWindow).map(reward);
      const b = slic.slice(this.driftWindow).map(reward);
      const avg = (arr: number[]) => arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : 0;
      const pre = avg(a), post = avg(b);
      if (pre - post >= this.driftDrop) {
        this.spikeUntil = this.step + this.spikeSteps;
      }
    } catch {}
  }
}


