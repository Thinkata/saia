import { ExperimentRunner } from "./ExperimentRunner";
import { loadExperimentConfig } from "./Config";

type Task = { name: string; prompt: string; validator?: { tool: string; input?: any; expectMinCount?: number; expectDiagnostics?: number } };
type ArmResult = { arm: "baseline"|"explore"; total: number; toolOkRate: number; avgLatency: number; validatorPassRate: number };

export class ToolExplorationExperiment {
  private readonly runner: ExperimentRunner;
  constructor(runner?: ExperimentRunner) { this.runner = runner ?? new ExperimentRunner(); }

  private async runArm(tasks: Task[], tools: string[], iterations: number): Promise<ArmResult> {
    let okTool = 0, toolCalls = 0, latSum = 0, vPass = 0, vTotal = 0;
    for (let i = 0; i < iterations; i++) {
      const t = tasks[i % tasks.length]!;
      const out = await this.runner.act(t.prompt, "rl_bandit", tools);
      latSum += Number(out.metrics?.latencyMs || 0);
      if (t.validator?.tool) {
        const v = await this.runner.postJSON<any>("/tools/execute", { toolId: t.validator.tool, input: t.validator.input || {} });
        if (typeof v?.latencyMs === "number") { toolCalls++; if (v.ok) okTool++; }
        vTotal++;
        if (typeof t.validator.expectMinCount === "number") {
          const count = Number(v?.data?.count || 0); if (count >= t.validator.expectMinCount) vPass++;
        } else if (typeof t.validator.expectDiagnostics === "number") {
          const diags = Number(v?.data?.diagnostics?.length || 0); if (diags === t.validator.expectDiagnostics) vPass++;
        } else if (v?.ok) { vPass++; }
      }
      if (i % 5 === 4) await this.runner.sleep(50);
    }
    return {
      arm: tools.length > 2 ? "explore" : "baseline",
      total: iterations,
      toolOkRate: toolCalls ? okTool / toolCalls : 0,
      avgLatency: iterations ? Math.round(latSum / iterations) : 0,
      validatorPassRate: vTotal ? vPass / vTotal : 0,
    };
  }

  async execute() {
    const cfg: any = loadExperimentConfig();
    const T = Array.isArray(cfg.toolExplore?.tasks) ? cfg.toolExplore.tasks : [];
    const tasks: Task[] = T;
    const N = Number(cfg.toolExplore?.iterations || 40);
    const base = (cfg.toolExplore?.baselineTools || []) as string[];
    const explore = (cfg.toolExplore?.exploreTools || []) as string[];

    const baseline = await this.runArm(tasks, base, N);
    await this.runner.sleep(200);
    const exploreRes = await this.runArm(tasks, explore, N);

    const slo = Number(process.env.LATENCY_SLO_MS || 2000);
    const successUplift = (exploreRes.validatorPassRate - baseline.validatorPassRate);
    const latencyDelta = (exploreRes.avgLatency - baseline.avgLatency) / Math.max(1, slo);
    const complexity = 1 + Math.max(0, explore.length - base.length) * 0.2;
    const alpha = 1.0, beta = 0.6;
    const deltaV = beta * complexity - alpha * Math.max(0, successUplift - 0.2 * latencyDelta);

    return { baseline, explore: exploreRes, successUplift, latencyDelta, complexity, deltaV };
  }
}


