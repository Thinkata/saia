import fs from "fs";
import path from "path";
import { canonicalize, tokenizeNormalized, jaccardIndex, fuzzyStringSim } from "../utils/text";

export type PolicyDecision = { passed: boolean; reason?: string; risk?: number };

type PolicyKnowledge = {
  version: number;
  // token -> weight (0..1); learned from past blocked prompts
  riskTokens: Record<string, number>;
  // seed phrases used for fuzzy/jaccard similarity scoring
  seedPhrases: string[];
  // moving threshold for pass/fail; adapts slowly
  threshold: number; // 0..1
};

const DEFAULT_KNOWLEDGE: PolicyKnowledge = {
  version: 1,
  riskTokens: {
    // generic destructive domains (lower weight; learning will reinforce as needed)
    "rm": 0.5, "rf": 0.6, "format": 0.6, "shutdown": 0.6, "mkfs": 0.7,
    "drop": 0.6, "table": 0.5, "sudo": 0.5, "dd": 0.5, "dev": 0.4,
    "wipe": 0.6, "erase": 0.6, "exfiltrate": 0.7, "netcat": 0.6, "nc": 0.5,
  },
  seedPhrases: [
    "rm -rf /",
    "drop table",
    "format c:",
    "shutdown now",
    "dd if=/dev/",
    "mkfs",
    "netcat -e",
  ],
  threshold: 0.62,
};

export class PolicyEngine {
  private state: PolicyKnowledge;
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? path.resolve(process.cwd(), "knowledge/policy.json");
    this.state = this.load();
  }

  private load(): PolicyKnowledge {
    try {
      if (!fs.existsSync(this.filePath)) return { ...DEFAULT_KNOWLEDGE };
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw || "{}");
      return { ...DEFAULT_KNOWLEDGE, ...parsed };
    } catch {
      return { ...DEFAULT_KNOWLEDGE };
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
    } catch {}
  }

  // Compute a continuous risk score (0..1) using learned token weights and fuzzy similarity to seeds
  score(input: string): number {
    const text = (input || "").slice(0, 4000); // bound
    const tokens = tokenizeNormalized(text);
    if (!tokens.length) return 0;
    // token contribution (average of present token weights)
    let sum = 0, cnt = 0;
    for (const t of tokens) {
      const w = this.state.riskTokens[t];
      if (typeof w === "number") { sum += Math.max(0, Math.min(1, w)); cnt++; }
    }
    const tokenRisk = cnt ? sum / cnt : 0;

    // phrase similarity (max over seeds using blended jw/levenshtein via fuzzyStringSim on canonicalized strings)
    const canon = canonicalize(text).replace(/-/g, " ");
    let maxSim = 0;
    for (const s of this.state.seedPhrases) {
      const sim = fuzzyStringSim(canon, canonicalize(s).replace(/-/g, " "));
      if (sim > maxSim) maxSim = sim;
    }

    // jaccard over tokens vs seed tokens (max across seeds)
    let maxJac = 0;
    for (const s of this.state.seedPhrases) {
      const js = jaccardIndex(new Set(tokens), new Set(tokenizeNormalized(s)));
      if (js > maxJac) maxJac = js;
    }

    // final risk: weighted blend with caps
    const risk = Math.max(0, Math.min(1, 0.55 * tokenRisk + 0.30 * maxSim + 0.15 * maxJac));
    return Number(risk.toFixed(3));
  }

  evaluate(input: string): PolicyDecision {
    const risk = this.score(input);
    const passed = risk < this.state.threshold;
    return passed ? { passed: true, risk } : { passed: false, reason: `risk=${risk}`, risk };
  }

  // Learning: on blocks, reinforce tokens and slightly lower threshold; on passes, gentle decay
  learn(input: string, passed: boolean, risk: number | undefined): void {
    try {
      const tokens = tokenizeNormalized(input).slice(0, 200);
      if (!tokens.length) return;
      if (!passed) {
        for (const t of tokens) {
          const cur = this.state.riskTokens[t] ?? 0.0;
          const upd = Math.min(1, cur + 0.05 + (risk ?? 0) * 0.05);
          if (upd > 0.02) this.state.riskTokens[t] = Number(upd.toFixed(3));
        }
        // be slightly more conservative after a block
        this.state.threshold = Number(Math.max(0.4, Math.min(0.9, this.state.threshold - 0.01)).toFixed(3));
      } else {
        // decay tokens related to benign prompts
        for (const t of tokens) {
          if (!this.state.riskTokens[t]) continue;
          const upd = Math.max(0, this.state.riskTokens[t] - 0.005);
          if (upd === 0) delete this.state.riskTokens[t]; else this.state.riskTokens[t] = Number(upd.toFixed(3));
        }
        // relax threshold slowly
        this.state.threshold = Number(Math.max(0.4, Math.min(0.9, this.state.threshold + 0.002)).toFixed(3));
      }
      this.save();
    } catch {}
  }
}

export const policyEngine = new PolicyEngine();


