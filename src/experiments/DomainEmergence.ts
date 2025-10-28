import { ExperimentRunner } from "./ExperimentRunner";
import { loadExperimentConfig } from "./Config";

export interface PhaseResult {
  phase: string;
  total: number;
  cellsUsed: Record<string, number>;
}

export class DomainEmergenceExperiment {
  private readonly runner: ExperimentRunner;

  constructor(runner?: ExperimentRunner) {
    this.runner = runner ?? new ExperimentRunner();
  }

  private creativePrompts(n: number): string[] {
    const cfg = loadExperimentConfig();
    const base = cfg.domainEmergence?.creativePrompts && cfg.domainEmergence.creativePrompts.length
      ? cfg.domainEmergence.creativePrompts
      : ["Write a haiku about the ocean."];
    return Array.from({ length: n }, (_, i) => base[i % base.length]!);
  }

  private codePrompts(n: number): string[] {
    const cfg = loadExperimentConfig();
    const base = cfg.domainEmergence?.codePrompts && cfg.domainEmergence.codePrompts.length
      ? cfg.domainEmergence.codePrompts
      : ["How to print 'hi' in TypeScript.\n\nReturn ```json {\"domain\":\"TypeScript\",\"tags\":[\"typescript\",\"console\",\"log\"]}``` at the end."];
    return Array.from({ length: n }, (_, i) => base[i % base.length]!);
  }

  private async runPhase(name: string, prompts: string[]): Promise<PhaseResult> {
    const cellsUsed: Record<string, number> = {};
    for (const p of prompts) {
      const cfg = loadExperimentConfig();
      const tools = Array.isArray((cfg as any).tools?.allow) ? (cfg as any).tools.allow : undefined;
      const out = await this.runner.act(p, "rl_bandit", tools);
      cellsUsed[out.cellId] = (cellsUsed[out.cellId] ?? 0) + 1;
      await this.runner.sleep(30);
    }
    return { phase: name, total: prompts.length, cellsUsed };
  }

  async execute(): Promise<{ phases: PhaseResult[]; synthesize: any[] }> {
    const phases: PhaseResult[] = [];
    const cfg = loadExperimentConfig();
    const generic = cfg.domainEmergence?.phases;
    if (Array.isArray(generic) && generic.length) {
      for (const ph of generic) {
        const prompts = Array.isArray(ph.prompts) && ph.prompts.length ? ph.prompts : [""];
        const expanded = Array.from({ length: Math.max(1, ph.count || prompts.length) }, (_, i) => prompts[i % prompts.length]!);
        phases.push(await this.runPhase(ph.name || "phase", expanded));
        if (ph.synthesizeAfter) {
          await this.runner.synthesize();
          await this.runner.sleep(400);
        }
        if (ph.evolveAfter) {
          const n = Math.max(1, Number(ph.evolveTimes || 1));
          for (let i = 0; i < n; i++) await this.runner.evolve();
        }
      }
      return { phases, synthesize: [] };
    }

    // Back-compat: creative/code/mixed
    const cCount = cfg.domainEmergence?.creativeCount ?? 20;
    const kCount = cfg.domainEmergence?.codeCount ?? 20;
    const mCount = cfg.domainEmergence?.mixedCount ?? 20;
    phases.push(await this.runPhase("creative", this.creativePrompts(cCount)));
    await this.runner.synthesize();
    await this.runner.sleep(400);
    phases.push(await this.runPhase("code", this.codePrompts(kCount)));
    await this.runner.synthesize();
    await this.runner.sleep(400);
    const mixed = [
      ...this.creativePrompts(Math.floor(mCount / 2)),
      ...this.codePrompts(Math.ceil(mCount / 2))
    ];
    phases.push(await this.runPhase("mixed", mixed));
    return { phases, synthesize: [] };
  }
}


