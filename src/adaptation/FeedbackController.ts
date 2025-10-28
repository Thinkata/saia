import { Metrics } from "../metrics";
import { GenAICell } from "../agents/GenAICell";

export interface Outcome {
  success: boolean;
  latencyMs: number;
  policyPassed: boolean;
}

export class FeedbackController {
  private readonly emaAlpha: number;
  private readonly minTemp = 0.1;
  private readonly maxTemp = 0.9;
  private readonly latencySLOms: number;

  constructor(alpha = 0.2, latencySLOms = Number(process.env.LATENCY_SLO_MS || 2000)) {
    this.emaAlpha = alpha;
    this.latencySLOms = latencySLOms;
  }

  update(cell: GenAICell, outcome: Outcome, routerConfidence: number): void {
    // 1) Update EMA success rate
    const prev = Metrics.getCellSuccessRate(cell.id);
    const y = outcome.success ? 1 : 0;
    const ema = this.emaAlpha * y + (1 - this.emaAlpha) * prev;
    Metrics.setCellSuccessRate(cell.id, ema);

    // 2) Track adaptation step count and router confidence
    Metrics.incrementAdaptationSteps(cell.id);
    Metrics.setRouterConfidence(cell.id, routerConfidence);

    // 3) Update SAI using SLO and compliance
    const latencyPenalty = Math.min(1, outcome.latencyMs / Math.max(1, this.latencySLOms));
    const compliance = Metrics.getCellComplianceRate(cell.id);
    const sai = Math.max(0, Math.min(1, (ema * (1 - latencyPenalty) * compliance)));
    Metrics.setSAI(cell.id, sai);

    // 4) Adjust cell parameters bounded by [0.1, 0.9]
    const confidence = ema * 0.7 + routerConfidence * 0.3; // blend of EMA and router confidence
    cell.adjustParameters(confidence, { minTemp: this.minTemp, maxTemp: this.maxTemp });
  }
}


