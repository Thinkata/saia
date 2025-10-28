export interface RequestMetric {
  requestId: string;
  cellId: string;
  latencyMs: number;
  success: boolean;
  policyPassed: boolean;
  timestamp: string; // ISO
  prompt?: string;
  response?: string;
  domain?: string;
  tags?: string[];
}

class MetricsRegistry {
  private readonly events: RequestMetric[] = [];
  private readonly cellSuccessEma: Record<string, number> = {};
  private readonly cellComplianceEma: Record<string, number> = {};
  private readonly adaptationSteps: Record<string, number> = {};
  private readonly routerConfidence: Record<string, number> = {};
  private readonly saiByCell: Record<string, number> = {};
  private globalSuccessEma = 0.5;
  private globalAlpha = 0.2;

  record(event: RequestMetric): void {
    this.events.push(event);
    const y = event.success ? 1 : 0;
    this.globalSuccessEma = this.globalAlpha * y + (1 - this.globalAlpha) * this.globalSuccessEma;
    // update per-cell compliance EMA
    const cPrev = this.cellComplianceEma[event.cellId] ?? 1.0;
    const c = event.policyPassed ? 1 : 0;
    this.cellComplianceEma[event.cellId] = Number((0.2 * c + 0.8 * cPrev).toFixed(3));
  }

  getCellSuccessRate(cellId: string): number {
    return this.cellSuccessEma[cellId] ?? 0.5; // start neutral
  }

  setCellSuccessRate(cellId: string, value: number): void {
    this.cellSuccessEma[cellId] = Math.max(0, Math.min(1, Number(value.toFixed(3))));
  }

  getCellComplianceRate(cellId: string): number {
    return this.cellComplianceEma[cellId] ?? 1.0;
  }

  setCellComplianceRate(cellId: string, value: number): void {
    this.cellComplianceEma[cellId] = Math.max(0, Math.min(1, Number(value.toFixed(3))));
  }

  incrementAdaptationSteps(cellId: string): void {
    this.adaptationSteps[cellId] = (this.adaptationSteps[cellId] ?? 0) + 1;
  }

  setRouterConfidence(cellId: string, value: number): void {
    this.routerConfidence[cellId] = Math.max(0, Math.min(1, Number(value.toFixed(3))));
  }

  setSAI(cellId: string, value: number): void {
    this.saiByCell[cellId] = Math.max(0, Math.min(1, Number(value.toFixed(3))));
  }

  detailed() {
    // Combine per-cell aggregates and adaptation state
    const perCell: Record<string, any> = {};
    for (const e of this.events) {
      const s = perCell[e.cellId] ?? (perCell[e.cellId] = { count: 0, success: 0, avgLatency: 0 });
      s.count += 1;
      s.success += e.success ? 1 : 0;
      s.avgLatency += e.latencyMs;
    }
    for (const k of Object.keys(perCell)) {
      const s = perCell[k]!;
      s.avgLatency = s.count > 0 ? Math.round(s.avgLatency / s.count) : 0;
      s.successRate = s.count > 0 ? Number((s.success / s.count).toFixed(3)) : 0;
      s.emaSuccess = this.getCellSuccessRate(k);
      s.complianceEma = this.getCellComplianceRate(k);
      s.adaptationSteps = this.adaptationSteps[k] ?? 0;
      s.routerConfidence = this.routerConfidence[k] ?? 0;
      s.SAI = this.saiByCell[k] ?? 0;
    }
    return { perCell, recent: this.events.slice(-50) };
  }

  globalSuccessEMA(): number {
    return Number(this.globalSuccessEma.toFixed(3));
  }

  summary() {
    const total = this.events.length;
    const successCount = this.events.filter(e => e.success).length;
    const policyPassCount = this.events.filter(e => e.policyPassed).length;
    const avgLatency = total > 0 ? Math.round(this.events.reduce((a, e) => a + e.latencyMs, 0) / total) : 0;
    const perCell: Record<string, { count: number; success: number; avgLatency: number } > = {};
    for (const e of this.events) {
      const s = perCell[e.cellId] ?? (perCell[e.cellId] = { count: 0, success: 0, avgLatency: 0 });
      s.count += 1;
      s.success += e.success ? 1 : 0;
      s.avgLatency += e.latencyMs;
    }
    for (const k of Object.keys(perCell)) {
      const s = perCell[k]!;
      s.avgLatency = s.count > 0 ? Math.round(s.avgLatency / s.count) : 0;
    }
    return {
      total,
      successCount,
      policyPassCount,
      successRate: total > 0 ? Number((successCount / total).toFixed(3)) : 0,
      policyPassRate: total > 0 ? Number((policyPassCount / total).toFixed(3)) : 0,
      avgLatency,
      perCell,
      recent: this.events.slice(-25),
    };
  }
}

export const Metrics = new MetricsRegistry();


