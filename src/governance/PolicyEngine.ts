import fs from "fs";
import path from "path";
import { canonicalize, tokenizeNormalized, jaccardIndex, fuzzyStringSim } from "../utils/text";
import { SafetyLLMClient } from "./SafetyLLMClient";
import { PolicyDecision, PolicyModelAdapter } from "./policyTypes";

type PolicyKnowledge = {
  version: number;
  // token -> weight (0..1); learned from past blocked prompts
  riskTokens: Record<string, number>;
  // seed phrases used for fuzzy/jaccard similarity scoring
  seedPhrases: string[];
  // moving threshold for pass/fail; adapts slowly
  threshold: number; // 0..1
  // optional: hard-block regexes (case-insensitive). If any match and prompt is not clearly educational, block immediately
  blockPatterns?: string[];
  // Proximity-based intent/target detection
  intents?: string[];
  targets?: string[];
  proximityWindow?: number; // tokens
  extractionIntents?: string[]; // read/print/dump/decrypt
  sensitiveTargets?: string[]; // passwords/keys/tokens
  // Lightweight char n-gram classifier (weights learned online)
  ngramWeights?: Record<string, number>;
  ngramScale?: number; // multiplier for n-gram score
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
  blockPatterns: [
    String(/\brm\s+-rf\s+\/(?:\s|$)/i),
    String(/\b(delete|remove|erase|wipe|truncate)\b[^\n]*\b(all|everything)\b[^\n]*\b(files?|folders?|directories?)\b/i),
    String(/\bdd\s+if=\/dev\/zero\s+of=\/dev\/[a-z0-9]+/i),
    String(/\bmkfs(?:\.[a-z0-9]+)?\s+\/dev\/[a-z0-9]+/i),
    String(/\bdrop\s+(table|database)\b/i),
    String(/\bshutdown\s+(?:-h|-P)?\s*now\b/i),
    String(/\b(netcat|nc)\b[^\n]*\b-e\b/i),
    String(/bash\s+-i[^\n]*\/dev\/tcp\//i),
    String(/\bchmod\s+-R\s+7{2,3}\b[^\n]*\//i),
    String(/systemctl\s+stop\s+sshd/i),
    String(/\b(enable|grant|allow)\b[^\n]{0,40}\bfull\s+disk\s+access\b/i),
    String(/\bcsrutil\s+disable\b/i),
    String(/\bspctl\s+--master-disable\b/i),
  ],
  intents: [
    "delete","remove","erase","wipe","truncate","format","drop","shutdown","poweroff","stop","kill","exfiltrate","leak","decrypt","dump","print","reveal","display","show","read"
  ],
  targets: [
    "password","passwords","keychain","secrets","secret","token","tokens","ssh","id_rsa",".ssh","users","database","table","root","/dev","disk","sda","filesystem","all","everything","files","folders","directories"
  ],
  proximityWindow: 5,
  extractionIntents: ["read","print","dump","show","display","reveal","decrypt","cat","list","exfiltrate","leak"],
  sensitiveTargets: ["password","passwords","credential","credentials","keychain","ssh","id_rsa","private","secret","secrets","token","tokens","apikey","api_key"],
  ngramWeights: {},
  ngramScale: 1.0,
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export class PolicyEngine {
  private state: PolicyKnowledge;
  private readonly filePath: string;
  private model: PolicyModelAdapter | null;

  constructor(filePath?: string, model?: PolicyModelAdapter | null) {
    this.filePath = filePath ?? path.resolve(process.cwd(), "knowledge/policy.json");
    this.state = this.load();
    this.model = typeof model === "undefined" ? SafetyLLMClient.fromEnv() : model;
  }

  useModel(model: PolicyModelAdapter | null): void {
    this.model = model ?? null;
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

  private intentTargetScore(input: string): number {
    try {
      const tokens = tokenizeNormalized((input || "").slice(0, 4000));
      if (!tokens.length) return 0;
      const intents = (this.state.intents && this.state.intents.length) ? this.state.intents : (DEFAULT_KNOWLEDGE.intents || []);
      const targets = (this.state.targets && this.state.targets.length) ? this.state.targets : (DEFAULT_KNOWLEDGE.targets || []);
      const win = Math.max(1, Number(this.state.proximityWindow || 5));
      const intentIdx: number[] = [];
      const targetIdx: number[] = [];
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i] as string;
        if (intents.includes(t)) intentIdx.push(i);
        if (targets.includes(t)) targetIdx.push(i);
      }
      if (!intentIdx.length || !targetIdx.length) return 0;
      let score = 0;
      for (const i of intentIdx) {
        for (const j of targetIdx) {
          const d = Math.abs(i - j);
          if (d <= win) score += 1 / (1 + d);
        }
      }
      // normalize: more close pairs → higher risk; cap and map to 0..1
      const norm = Math.min(1, score / (intentIdx.length + targetIdx.length));
      return Number(norm.toFixed(3));
    } catch { return 0; }
  }

  private ngramScore(input: string): number {
    try {
      const s = (input || "").slice(0, 3000).toLowerCase();
      if (!s) return 0;
      const weights = this.state.ngramWeights || {};
      let sum = 0, cnt = 0;
      const add = (g: string) => { const w = weights[g]; if (typeof w === 'number') { sum += w; cnt++; } };
      for (let n = 3; n <= 5; n++) {
        for (let i = 0; i <= s.length - n; i++) add(s.slice(i, i + n));
      }
      if (!cnt) return 0;
      const raw = Math.max(0, Math.min(1, (sum / cnt)));
      const scaled = Math.max(0, Math.min(1, raw * (this.state.ngramScale ?? 1.0)));
      return Number(scaled.toFixed(3));
    } catch { return 0; }
  }

  // Fuzzy, typo-tolerant contains for short keywords
  private fuzzyContains(text: string, needle: string, threshold: number = 0.88): boolean {
    try {
      const s = canonicalize(text).replace(/-/g, "");
      const n = canonicalize(needle).replace(/-/g, "");
      if (!s || !n) return false;
      if (s.includes(n)) return true;
      const minLen = Math.max(1, n.length - 1);
      const maxLen = n.length + 2;
      for (let L = minLen; L <= maxLen; L++) {
        for (let i = 0; i + L <= s.length; i++) {
          const window = s.slice(i, i + L);
          const sim = fuzzyStringSim(window, n);
          if (sim >= threshold) return true;
        }
      }
      return false;
    } catch { return false; }
  }

  async evaluate(input: string): Promise<PolicyDecision> {
    const text = String(input ?? "");
    const llmDecision = await this.evaluateWithModel(text);
    if (llmDecision) return llmDecision;
    return this.evaluateHeuristics(text);
  }

  private async evaluateWithModel(input: string): Promise<PolicyDecision | null> {
    if (!this.model) return null;
    try {
      const decision = await this.model.evaluate(input);
      if (!decision || typeof decision.passed !== "boolean") return null;
      const risk = clamp01(typeof decision.risk === "number" ? decision.risk : decision.passed ? 0.05 : 0.98);
      const reason = decision.reason || (decision.passed ? "llm_allow" : "llm_block");
      return { passed: decision.passed, reason, risk };
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[PolicyEngine] safety model error: ${message}`);
      }
      return null;
    }
  }

  private evaluateHeuristics(input: string): PolicyDecision {
    // 0) Hard block patterns (unless clearly educational/explanatory prompt)
    try {
      const text = String(input || "");
      const educational = /\b(explain|why|safe|safety|dangerous|mitigations?|prevent|avoid|secure)\b/i.test(text);
      const patterns = (this.state.blockPatterns && Array.isArray(this.state.blockPatterns) && this.state.blockPatterns.length)
        ? this.state.blockPatterns
        : (DEFAULT_KNOWLEDGE.blockPatterns || []);
      for (const p of patterns) {
        try {
          const rx = typeof p === 'string' ? new RegExp(p.slice(1, -2), 'i') : (p as any);
          if (rx.test(text) && !educational) {
            return { passed: false, reason: `pattern`, risk: 0.99 };
          }
        } catch {}
      }
      // Phrase-level safeguard: attempts to grant "Full Disk Access"
      if (!educational) {
        const hasFullDiskAccess = this.fuzzyContains(text, 'full disk access', 0.92);
        const hasEnableVerb = /\b(enable|grant|allow)\b/i.test(text);
        if (hasFullDiskAccess && hasEnableVerb) {
          return { passed: false, reason: 'full_disk_access', risk: 0.98 };
        }
      }
    } catch {}

    // 0.5) Sensitive extraction proximity rule
    try {
      const text = (input || "").slice(0, 4000);
      const educational = /\b(explain|why|safe|safety|dangerous|mitigations?|prevent|avoid|secure)\b/i.test(text);
      const tokens = tokenizeNormalized(text);
      const win = Math.max(1, Number(this.state.proximityWindow || 5));
      const intents = (this.state.extractionIntents && this.state.extractionIntents.length) ? this.state.extractionIntents : (DEFAULT_KNOWLEDGE.extractionIntents || []);
      const targets = (this.state.sensitiveTargets && this.state.sensitiveTargets.length) ? this.state.sensitiveTargets : (DEFAULT_KNOWLEDGE.sensitiveTargets || []);
      const I: number[] = [], T: number[] = [];
      for (let i = 0; i < tokens.length; i++) {
        if (intents.includes(tokens[i] as string)) I.push(i);
        if (targets.includes(tokens[i] as string)) T.push(i);
      }
      outer: for (const i of I) {
        for (const j of T) {
          if (Math.abs(i - j) <= win && !educational) {
            return { passed: false, reason: 'sensitive', risk: 0.95 };
          }
        }
      }
    } catch {}

    // 0.6) Fuzzy detection: intent + sensitive target anywhere in text (typo/spacing tolerant)
    try {
      const text = (input || "").slice(0, 4000);
      const educational = /\b(explain|why|safe|safety|dangerous|mitigations?|prevent|avoid|secure)\b/i.test(text);
      if (!educational) {
        const intents = (this.state.extractionIntents && this.state.extractionIntents.length) ? this.state.extractionIntents : (DEFAULT_KNOWLEDGE.extractionIntents || []);
        const targets = (this.state.sensitiveTargets && this.state.sensitiveTargets.length) ? this.state.sensitiveTargets : (DEFAULT_KNOWLEDGE.sensitiveTargets || []);
        let intentHit = false;
        for (const w of intents) { if (this.fuzzyContains(text, w, 0.88)) { intentHit = true; break; } }
        if (intentHit) {
          for (const t of targets) { if (this.fuzzyContains(text, t, 0.9)) { return { passed: false, reason: 'sensitive_fuzzy', risk: 0.96 }; } }
        }
      }
    } catch {}

    const base = this.score(input);
    const prox = this.intentTargetScore(input);
    const ng = this.ngramScore(input);
    const risk = Number(Math.max(0, Math.min(1, 0.2 * base + 0.45 * prox + 0.35 * ng)).toFixed(3));
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
        // reinforce n-grams present in blocked prompts
        try {
          const s = (input || "").slice(0, 3000).toLowerCase();
          const w = this.state.ngramWeights || (this.state.ngramWeights = {});
          for (let n = 3; n <= 5; n++) {
            for (let i = 0; i <= s.length - n; i++) {
              const g = s.slice(i, i + n);
              const cur = w[g] ?? 0;
              w[g] = Number(Math.min(1, cur + 0.02 + (risk ?? 0) * 0.01).toFixed(4));
            }
          }
        } catch {}
        // be slightly more conservative after a block
        this.state.threshold = Number(Math.max(0.4, Math.min(0.9, this.state.threshold - 0.01)).toFixed(3));
      } else {
        // decay tokens related to benign prompts
        for (const t of tokens) {
          if (!this.state.riskTokens[t]) continue;
          const upd = Math.max(0, this.state.riskTokens[t] - 0.005);
          if (upd === 0) delete this.state.riskTokens[t]; else this.state.riskTokens[t] = Number(upd.toFixed(3));
        }
        // soften n-grams
        try {
          const s = (input || "").slice(0, 3000).toLowerCase();
          const w = this.state.ngramWeights || {};
          for (let n = 3; n <= 5; n++) {
            for (let i = 0; i <= s.length - n; i++) {
              const g = s.slice(i, i + n);
              if (typeof w[g] === 'number') {
                const v = Math.max(0, (w[g] as number) - 0.002);
                if (v === 0) delete w[g]; else w[g] = Number(v.toFixed(4));
              }
            }
          }
          this.state.ngramWeights = w;
        } catch {}
        // relax threshold slowly
        this.state.threshold = Number(Math.max(0.4, Math.min(0.9, this.state.threshold + 0.002)).toFixed(3));
      }
      this.save();
    } catch {}
  }

  // Expose current policy state for diagnostics/UI
  dump(): { threshold: number; seedPhrases: string[]; riskTokens: Record<string, number>; intents?: string[]; targets?: string[] } {
    return { threshold: this.state.threshold, seedPhrases: [...this.state.seedPhrases], riskTokens: { ...this.state.riskTokens }, intents: this.state.intents, targets: this.state.targets };
  }
}

export const policyEngine = new PolicyEngine();
export type { PolicyDecision } from "./policyTypes";


