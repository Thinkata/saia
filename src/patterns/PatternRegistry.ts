import fs from "fs";
import path from "path";

export interface PatternSpec {
  id: string;
  cells: string[]; // cell ids
  router: string; // RouterStrategy | LearningStrategy string
  tags?: string[];
  edges?: Array<[string, string]>; // optional edges between roles/cells
  roles?: string[]; // distinct role labels like 'critic'
}

export interface RegistryFile {
  version: number;
  patterns: PatternSpec[];
  default?: string;
}

export class PatternRegistry {
  private registryPath: string;
  private registry: RegistryFile = { version: 1, patterns: [] };
  private activePatternId: string | null = null;

  constructor(registryPath?: string) {
    this.registryPath = registryPath ?? path.resolve(process.cwd(), "src/patterns/registry.json");
    this.load();
  }

  load(): void {
    try {
      const raw = fs.readFileSync(this.registryPath, "utf-8");
      const parsed = JSON.parse(raw) as RegistryFile;
      if (!Array.isArray(parsed.patterns)) throw new Error("Invalid registry.json: patterns missing");
      this.registry = parsed;
      this.activePatternId = parsed.default ?? parsed.patterns[0]?.id ?? null;
    } catch (err) {
      // Fallback with safe defaults
      this.registry = { version: 1, patterns: [] };
      this.activePatternId = null;
    }
  }

  list(): PatternSpec[] { return this.registry.patterns; }
  getActivePatternId(): string | null { return this.activePatternId; }
  getPattern(id: string): PatternSpec | undefined { return this.registry.patterns.find(p => p.id === id); }
  getActivePattern(): PatternSpec | null { return this.activePatternId ? (this.getPattern(this.activePatternId) ?? null) : null; }

  setActivePatternId(id: string | null): void { this.activePatternId = id; }

  activePatternComplexity(): number {
    const p = this.getActivePattern();
    if (!p) return 0;
    const w_nodes = 1, w_edges = 1, w_depth = 1, w_roles = 0.5;
    const nodes = p.cells.length;
    const edges = p.edges?.length ?? 0;
    const depth = this.longestPathLength(p);
    const roles = p.roles?.length ?? 0;
    return w_nodes * nodes + w_edges * edges + w_depth * depth + w_roles * roles;
  }

  private longestPathLength(p: PatternSpec): number {
    const edges = p.edges ?? [];
    const graph: Record<string, string[]> = {};
    for (const [u, v] of edges) {
      (graph[u] ||= []).push(v);
    }
    const visited: Record<string, number> = {};
    const dfs = (u: string): number => {
      if (visited[u] !== undefined) return visited[u]!;
      const next = graph[u] || [];
      const len = next.length ? 1 + Math.max(...next.map(dfs)) : 0;
      visited[u] = len; return len;
    };
    return Math.max(0, ...Object.keys(graph).map(dfs));
  }

  synthesizeNewPattern(): PatternSpec {
    // Prefer a pattern with strictly higher complexity; fallback to next cyclic
    if (this.registry.patterns.length === 0) throw new Error("No patterns available to synthesize");
    const currentComplexity = this.activePatternComplexity();
    const higher = this.registry.patterns
      .filter(p => p.cells.length > currentComplexity)
      .sort((a, b) => a.cells.length - b.cells.length)[0];
    if (higher) return higher;
    const currentId = this.activePatternId;
    const idx = Math.max(0, this.registry.patterns.findIndex(p => p.id === currentId));
    return this.registry.patterns[(idx + 1) % this.registry.patterns.length]!;
  }
}


