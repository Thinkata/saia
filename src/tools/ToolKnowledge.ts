import fs from "fs";
import path from "path";
import { canonicalize, tokenizeNormalized, jaccardIndex, fuzzyStringSim } from "../utils/text";

export type TaskContext = { prompt?: string; domain?: string; tags?: string[]; cellId?: string };

type ToolStat = {
  count: number;
  ok: number;
  latencySum: number;
  byDomain: Record<string, { count: number; ok: number }>;
  tags: Record<string, number>;
};

export class ToolKnowledge {
  private filePath: string;
  private stats: Record<string, ToolStat> = {};

  constructor(filePath?: string) {
    this.filePath = filePath ?? path.resolve(process.cwd(), "knowledge/tools.json");
    this.load();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      this.stats = JSON.parse(raw || "{}");
    } catch {
      this.stats = {};
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.stats, null, 2));
  }

  recordOutcome(toolId: string, ok: boolean, latencyMs: number, ctx: TaskContext): void {
    const s = (this.stats[toolId] ||= { count: 0, ok: 0, latencySum: 0, byDomain: {}, tags: {} });
    s.count += 1;
    if (ok) s.ok += 1;
    s.latencySum += Math.max(0, Number(latencyMs || 0));
    const d = canonicalize(String(ctx.domain || ""));
    if (d) {
      const bd = (s.byDomain[d] ||= { count: 0, ok: 0 });
      bd.count += 1;
      if (ok) bd.ok += 1;
    }
    for (const t of (ctx.tags || []).map(x => canonicalize(String(x)))) {
      s.tags[t] = (s.tags[t] || 0) + 1;
    }
    this.save();
  }

  successRate(toolId: string): number {
    const s = this.stats[toolId];
    return s?.count ? Number((s.ok / s.count).toFixed(3)) : 0;
  }

  avgLatency(toolId: string): number {
    const s = this.stats[toolId];
    return s?.count ? Math.round(s.latencySum / s.count) : 0;
  }

  recommend(tools: Array<{ id: string; tags: string[]; domains?: string[] }>, ctx: TaskContext, k = 3): Array<{ id: string; score: number; s: number; lat: number }> {
    const promptTokens = new Set(tokenizeNormalized(ctx.prompt || ""));
    const ctxTags = new Set((ctx.tags || []).map(canonicalize));
    const domain = canonicalize(ctx.domain || "");
    const slo = Number(process.env.LATENCY_SLO_MS || 2000);
    const scored = tools.map(t => {
      const tTags = new Set((t.tags || []).map(canonicalize));
      const tagMatch = jaccardIndex(ctxTags.size ? ctxTags : promptTokens, tTags);
      const domMatch = domain && t.domains?.length ? Math.max(...t.domains.map(d => fuzzyStringSim(domain, canonicalize(d)))) : 0;
      const s = this.successRate(t.id);
      const lat = this.avgLatency(t.id);
      const perf = s - Math.min(1, (lat || 0) / Math.max(1, slo)) * 0.2;
      const score = 0.45 * tagMatch + 0.35 * domMatch + 0.20 * perf;
      return { id: t.id, score, s, lat };
    }).sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(1, k));
  }

  dump(): Record<string, ToolStat> {
    return this.stats;
  }
}


