import { ToolAdapter } from "./ToolTypes";
import { ToolKnowledge, TaskContext } from "./ToolKnowledge";

export class ToolRegistry {
  private tools: Map<string, ToolAdapter> = new Map();
  constructor(private knowledge?: ToolKnowledge) {}

  register(adapter: ToolAdapter): void {
    this.tools.set(adapter.spec.id, adapter);
  }

  get(id: string): ToolAdapter | undefined {
    return this.tools.get(id);
  }

  list(): Array<{ id: string; title: string; description: string; tags: string[]; sideEffects: string; risk: string }> {
    return Array.from(this.tools.values()).map(t => ({
      id: t.spec.id,
      title: t.spec.title,
      description: t.spec.description,
      tags: t.spec.tags,
      sideEffects: t.spec.sideEffects,
      risk: t.spec.risk,
    }));
  }

  listWithStats(): Array<{ id: string; title: string; description: string; tags: string[]; sideEffects: string; risk: string; successRate: number; avgLatency: number }> {
    return Array.from(this.tools.values()).map(t => ({
      id: t.spec.id,
      title: t.spec.title,
      description: t.spec.description,
      tags: t.spec.tags,
      sideEffects: t.spec.sideEffects,
      risk: t.spec.risk,
      successRate: this.knowledge?.successRate(t.spec.id) ?? 0,
      avgLatency: this.knowledge?.avgLatency(t.spec.id) ?? 0,
    }));
  }

  recommend(ctx: TaskContext, k = 3): string[] {
    const items = Array.from(this.tools.values()).map(t => ({ id: t.spec.id, tags: t.spec.tags, domains: (t.spec as any).domains }));
    return (this.knowledge?.recommend(items, ctx, k) ?? []).map(r => r.id);
  }

  recordOutcome(toolId: string, ok: boolean, latencyMs: number, ctx: TaskContext): void {
    this.knowledge?.recordOutcome(toolId, ok, latencyMs, ctx);
  }
}


