import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";

export interface ExperimentConfig {
  tools?: {
    allow?: string[]; // e.g., ['ts.transpile','search.regex']
  };
  baseline?: {
    iterations?: number;
    prompts?: string[];
    strategies?: string[];
  };
  evolve?: {
    enabled?: boolean;
    times?: number; // how many /evolve calls overall
    minImprovementCycles?: number; // pass-through to SelfDevelopmentEngine
    afterBaseline?: boolean; // call evolve after baseline completes
    afterPhases?: string[]; // names of phases after which to call evolve
  };
  domainEmergence?: {
    // Generic, label-free phases: name + prompts + count + optional synthesize flag
    phases?: Array<{
      name: string;
      prompts: string[];
      count: number;
      synthesizeAfter?: boolean;
      evolveAfter?: boolean; // call /evolve once at end of phase
      evolveTimes?: number;  // override number of evolve calls for this phase
    }>;
    // Back-compat keys (optional)
    creativePrompts?: string[];
    codePrompts?: string[];
    creativeCount?: number;
    codeCount?: number;
    mixedCount?: number; // total mixed prompts
  };
}

export function loadExperimentConfig(customPath?: string): ExperimentConfig {
  const baseDir = process.cwd();
  const tryPaths = [
    customPath,
    process.env.EXPERIMENT_CONFIG,
    path.resolve(baseDir, "experiments/config.yaml"),
    path.resolve(baseDir, "experiments/config.yml"),
    path.resolve(baseDir, "experiments/config.json"),
  ].filter((p): p is string => !!p);

  for (const p of tryPaths) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf-8");
      if (/\.ya?ml$/i.test(p)) {
        return (parseYaml(raw) as ExperimentConfig) || {};
      }
      return (JSON.parse(raw) as ExperimentConfig) || {};
    } catch {
      // continue to next path
    }
  }
  return {};
}

export function resolveExperimentConfigPath(customPath?: string): string | undefined {
  const baseDir = process.cwd();
  const tryPaths = [
    customPath,
    process.env.EXPERIMENT_CONFIG,
    path.resolve(baseDir, "experiments/config.yaml"),
    path.resolve(baseDir, "experiments/config.yml"),
    path.resolve(baseDir, "experiments/config.json"),
  ].filter((p): p is string => !!p);
  for (const p of tryPaths) {
    try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  return undefined;
}


