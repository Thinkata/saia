import { PolicyDecision, PolicyModelAdapter } from "./policyTypes";

type SafetyLLMConfig = {
  endpoint: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
};

type RawLLMResponse = {
  allowed?: boolean;
  passed?: boolean;
  blocked?: boolean;
  risk?: number;
  score?: number;
  reason?: string;
  explanation?: string;
  metadata?: Record<string, unknown>;
};

const clamp01 = (value: unknown, fallback: number): number => {
  const num = typeof value === "number" ? value : Number.NaN;
  if (Number.isFinite(num)) return Math.max(0, Math.min(1, num));
  return Math.max(0, Math.min(1, fallback));
};

export class SafetyLLMClient implements PolicyModelAdapter {
  readonly name = "safety-llm";
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly model?: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(config: SafetyLLMConfig) {
    this.endpoint = config.endpoint;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.timeoutMs = Math.max(200, config.timeoutMs ?? 1200);
    this.maxRetries = Math.max(1, Math.min(3, config.maxRetries ?? 2));
  }

  static fromEnv(): SafetyLLMClient | null {
    const endpoint = process.env.POLICY_LLM_ENDPOINT;
    if (!endpoint) return null;
    const timeout = process.env.POLICY_LLM_TIMEOUT_MS ? Number(process.env.POLICY_LLM_TIMEOUT_MS) : undefined;
    const retries = process.env.POLICY_LLM_MAX_RETRIES ? Number(process.env.POLICY_LLM_MAX_RETRIES) : undefined;
    return new SafetyLLMClient({
      endpoint,
      apiKey: process.env.POLICY_LLM_API_KEY,
      model: process.env.POLICY_LLM_MODEL,
      timeoutMs: Number.isFinite(timeout) ? timeout : undefined,
      maxRetries: Number.isFinite(retries) ? retries : undefined,
    });
  }

  async evaluate(input: string): Promise<PolicyDecision | null> {
    const payload = {
      prompt: input,
      model: this.model,
    };

    let attempt = 0;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    if (this.model) headers["X-Policy-Model"] = this.model;

    while (attempt < this.maxRetries) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(this.endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
          if (attempt >= this.maxRetries) return null;
          continue;
        }
        const data = (await res.json()) as RawLLMResponse | undefined;
        if (!data) return null;
        const allowed = typeof data.allowed === "boolean"
          ? data.allowed
          : typeof data.passed === "boolean"
            ? data.passed
            : data.blocked === true
              ? false
              : undefined;
        if (typeof allowed !== "boolean") return null;
        const risk = clamp01(data.risk ?? data.score, allowed ? 0.05 : 0.99);
        const reason = data.reason || data.explanation || (allowed ? "llm_allow" : "llm_block");
        return { passed: allowed, reason, risk };
      } catch (err) {
        clearTimeout(timer);
        const retriable = err instanceof Error && err.name === "AbortError";
        if (!retriable || attempt >= this.maxRetries) return null;
      }
    }
    return null;
  }
}

