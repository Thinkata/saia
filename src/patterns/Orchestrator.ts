import { GenAICell } from "../agents/GenAICell";
import { LearningRouter, LearningStrategy } from "../adaptation/LearningRouter";
import { PatternRegistry, PatternSpec } from "./PatternRegistry";

export type RouterStrategy = "round_robin" | "random" | "keyword";

export interface OrchestratorConfig {
  strategy?: RouterStrategy;
}

export class Orchestrator {
  private readonly cells: GenAICell[] = [];
  private strategy: RouterStrategy;
  private rrIndex = 0;
  private learningRouter: LearningRouter;
  private activeCells: GenAICell[] = [];

  constructor(cells: GenAICell[], config?: OrchestratorConfig) {
    if (cells.length === 0) throw new Error("Orchestrator requires at least one cell");
    this.cells = cells;
    this.strategy = config?.strategy ?? (process.env.ROUTER_STRATEGY as RouterStrategy) ?? "round_robin";
    this.learningRouter = new LearningRouter(this.cells);
    this.activeCells = [...cells];
  }

  setStrategy(strategy: RouterStrategy) {
    this.strategy = strategy;
  }

  private getPool(): GenAICell[] {
    return this.activeCells.length ? this.activeCells : this.cells;
  }

  private pickCellByRoundRobin(): GenAICell {
    const pool = this.getPool();
    const cell = pool[this.rrIndex % pool.length]!;
    this.rrIndex = (this.rrIndex + 1) % pool.length;
    return cell;
  }

  private pickCellByRandom(): GenAICell {
    const pool = this.getPool();
    const idx = Math.floor(Math.random() * pool.length);
    return pool[idx]!;
  }

  private pickCellByKeyword(input: string): GenAICell {
    const pool = this.getPool();
    // Use cell capabilities to match input semantically rather than hard-coded keywords
    let bestMatch: GenAICell | null = null;
    let bestScore = 0;
    
    for (const cell of pool) {
      const score = cell.matchTags(input);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = cell;
      }
    }
    
    return bestMatch && bestScore > 0.3 ? bestMatch : this.pickCellByRoundRobin();
  }

  route(input: string, overrideStrategy?: RouterStrategy | LearningStrategy): GenAICell {
    const strategy = overrideStrategy ?? this.strategy;

    if (strategy === "success_rate" || strategy === "rl_bandit") {
      return this.learningRouter.route(input, strategy as LearningStrategy).cell;
    }
    if (strategy === "random") return this.pickCellByRandom();
    if (strategy === "keyword") return this.pickCellByKeyword(input);
    return this.pickCellByRoundRobin();
  }

  applyPattern(pattern: PatternSpec, allCells: GenAICell[]): void {
    const wanted = new Set(pattern.cells);
    const matched = allCells.filter(c => wanted.has(c.id));
    this.activeCells = matched.length ? matched : [...allCells];
  }

  autoReconfigure(registry: PatternRegistry, allCells: GenAICell[]): void {
    const p = registry.getActivePattern();
    if (p) this.applyPattern(p, allCells);
  }

  addCell(cell: GenAICell): void {
    (this as any).cells.push(cell);
    this.activeCells.push(cell);
    this.learningRouter = new LearningRouter((this as any).cells);
  }

  removeCell(cellId: string): void {
    (this as any).cells = (this as any).cells.filter((c: GenAICell) => c.id !== cellId);
    this.activeCells = this.activeCells.filter(c => c.id !== cellId);
    this.learningRouter = new LearningRouter((this as any).cells);
  }
}


