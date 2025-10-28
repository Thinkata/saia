import { ExperimentRunner } from "./ExperimentRunner";
import { loadExperimentConfig } from "./Config";

export interface BaselineResult {
  strategy: string;
  total: number;
  avgLatency: number;
  perCell: Record<string, { count: number; avgLatency: number }>;
}

export class BaselineComparisonExperiment {
  private readonly runner: ExperimentRunner;

  constructor(runner?: ExperimentRunner) {
    this.runner = runner ?? new ExperimentRunner();
  }

  private async runStrategy(prompts: string[], strategy: string, iterations: number): Promise<BaselineResult> {
    const latencies: number[] = [];
    const perCell: Record<string, { count: number; latencySum: number }> = {};
    const sample = prompts.length > 0 ? prompts : ["Write a haiku about the ocean.", "How to print 'hi' in TypeScript."];
    for (let i = 0; i < iterations; i++) {
      const prompt = sample[i % sample.length]!;
      const out = await this.runner.act(prompt, strategy, (loadExperimentConfig().tools?.allow ?? []));
      const latency = Number(out.metrics?.latencyMs || 0);
      latencies.push(latency);
      const cell = String(out.cellId);
      const entry = perCell[cell] ?? (perCell[cell] = { count: 0, latencySum: 0 });
      entry.count += 1;
      entry.latencySum += latency;
      // gentle pacing to avoid overwhelming the server
      if (i % 5 === 4) await this.runner.sleep(50);
    }
    const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
    const perCellFinal: BaselineResult["perCell"] = {};
    for (const [cell, v] of Object.entries(perCell)) {
      perCellFinal[cell] = { count: v.count, avgLatency: v.count ? Math.round(v.latencySum / v.count) : 0 };
    }
    return { strategy, total: iterations, avgLatency, perCell: perCellFinal };
  }

  async execute(prompts: string[], iterations: number = 40): Promise<{ results: BaselineResult[] }> {
    const cfg = loadExperimentConfig();
    const strategies = cfg.baseline?.strategies && cfg.baseline.strategies.length
      ? cfg.baseline.strategies
      : ["round_robin", "keyword", "rl_bandit"];
    if (!prompts || prompts.length === 0) {
      prompts = cfg.baseline?.prompts && cfg.baseline.prompts.length ? cfg.baseline.prompts : prompts;
    }
    iterations = cfg.baseline?.iterations ?? iterations;
    const results: BaselineResult[] = [];
    for (const s of strategies) {
      results.push(await this.runStrategy(prompts, s, iterations));
      await this.runner.sleep(200);
    }
    return { results };
  }
}


