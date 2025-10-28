import { ExperimentRunner } from "./ExperimentRunner";
import { BaselineComparisonExperiment } from "./BaselineComparison";
import { DomainEmergenceExperiment } from "./DomainEmergence";
import { loadExperimentConfig, resolveExperimentConfigPath } from "./Config";

export class FullExperiment {
  private readonly runner: ExperimentRunner;

  constructor(runner?: ExperimentRunner) {
    this.runner = runner ?? new ExperimentRunner();
  }

  async execute(): Promise<any> {
    const cfgPath = resolveExperimentConfigPath();
    const cfg = loadExperimentConfig();

    // 1) Baseline
    const baseline = await new BaselineComparisonExperiment(this.runner).execute([], 0);
    // optional evolve after baseline per config
    if (cfg.evolve?.enabled && cfg.evolve.afterBaseline) {
      const n = Math.max(1, Number(cfg.evolve.times || 1));
      for (let i = 0; i < n; i++) await this.runner.evolve();
    }

    // 2) Domain Emergence
    const domain = await new DomainEmergenceExperiment(this.runner).execute();

    // 3) Evolve (Lyapunov gate)
    const evolveResults: any[] = [];
    try {
      if (cfg.evolve?.enabled && !cfg.evolve.afterBaseline) {
        const n = Math.max(1, Number(cfg.evolve.times || 3));
        for (let i = 0; i < n; i++) evolveResults.push(await this.runner.evolve());
      }
    } catch {}

    // 4) Gather logs and metrics
    const metrics = await this.runner.getMetrics();
    const evoLogs = await this.runner.getEvolutionLogs(200);
    const actions = await this.runner.getActions(300);

    return {
      configPath: cfgPath,
      config: cfg,
      baseline,
      domain,
      evolveResults,
      metrics,
      evolutionLogs: evoLogs,
      actions,
    };
  }
}


