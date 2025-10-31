import fs from "fs";
import path from "path";
import crypto from "crypto";
import { policyEngine } from "./PolicyEngine";

export interface PolicyResult {
  passed: boolean;
  reason?: string;
  risk?: number; // 0..1
}

export interface SignedAction {
  requestId: string;
  timestamp: string; // ISO
  cellId: string;
  promptHash: string; // sha256 of prompt
  responseHash: string; // sha256 of response
  policy: PolicyResult;
  signature: string; // hex
  signatureAlgo: "HMAC-SHA256";
  routerStrategy?: string;
  adaptationReason?: string;
}

export async function verifyPolicy(input: string): Promise<PolicyResult> {
  // Adaptive, learning policy using PolicyEngine (continuous risk score)
  const dec = await policyEngine.evaluate(input);
  return { passed: dec.passed, reason: dec.passed ? undefined : dec.reason, risk: dec.risk };
}

export function signAction(requestId: string, cellId: string, prompt: string, response: string, policy: PolicyResult, extras?: { routerStrategy?: string; adaptationReason?: string }): SignedAction {
  const secret = process.env.SAIA_SECRET ?? "dev-secret";
  const h = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
  const promptHash = h(prompt);
  const responseHash = h(response);

  const payload = JSON.stringify({ requestId, cellId, promptHash, responseHash, policy, routerStrategy: extras?.routerStrategy, adaptationReason: extras?.adaptationReason }, null, 0);
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  return {
    requestId,
    timestamp: new Date().toISOString(),
    cellId,
    promptHash,
    responseHash,
    policy,
    signature,
    signatureAlgo: "HMAC-SHA256",
    routerStrategy: extras?.routerStrategy,
    adaptationReason: extras?.adaptationReason,
  };
}

export function appendActionLog(entry: SignedAction): void {
  const logsDir = path.resolve(process.cwd(), "logs");
  const logFile = path.join(logsDir, "actions.jsonl");
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  fs.appendFileSync(logFile, JSON.stringify(entry) + "\n", { encoding: "utf-8" });
}

export function verifyEvolution(): boolean {
  // Minimal governance rule: evolution allowed if secret is set (simulating policy approval)
  return Boolean(process.env.SAIA_SECRET);
}

export interface SignedEvolutionEvent {
  timestamp: string;
  patternId: string;
  deltaV: number;
  preSuccess?: number;
  postSuccess?: number;
  preComplexity?: number;
  postComplexity?: number;
  alpha?: number;
  beta?: number;
  decision?: "commit" | "rollback";
  canaryN?: number;
  canaryWindowMs?: number;
  signature: string;
  signatureAlgo: "HMAC-SHA256";
}

export function signEvolutionEvent(pattern: { id: string }, meta: { deltaV: number; timestamp?: string; preSuccess?: number; postSuccess?: number; preComplexity?: number; postComplexity?: number; alpha?: number; beta?: number; decision?: "commit" | "rollback"; canaryN?: number; canaryWindowMs?: number }): SignedEvolutionEvent {
  const secret = process.env.SAIA_SECRET ?? "dev-secret";
  const payload = JSON.stringify({ patternId: pattern.id, deltaV: meta.deltaV, timestamp: meta.timestamp ?? new Date().toISOString(), preSuccess: meta.preSuccess, postSuccess: meta.postSuccess, preComplexity: meta.preComplexity, postComplexity: meta.postComplexity, alpha: meta.alpha, beta: meta.beta, decision: meta.decision, canaryN: meta.canaryN, canaryWindowMs: meta.canaryWindowMs });
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const parsed = JSON.parse(payload);
  return { timestamp: parsed.timestamp, patternId: pattern.id, deltaV: meta.deltaV, preSuccess: meta.preSuccess, postSuccess: meta.postSuccess, preComplexity: meta.preComplexity, postComplexity: meta.postComplexity, alpha: meta.alpha, beta: meta.beta, decision: meta.decision, canaryN: meta.canaryN, canaryWindowMs: meta.canaryWindowMs, signature, signatureAlgo: "HMAC-SHA256" };
}

export function appendPatternEventLog(entry: SignedEvolutionEvent): void {
  const logsDir = path.resolve(process.cwd(), "logs");
  const logFile = path.join(logsDir, "pattern_events.jsonl");
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  fs.appendFileSync(logFile, JSON.stringify(entry) + "\n", { encoding: "utf-8" });
}

// Cell creation governance
export interface SignedCellCreateEvent {
  timestamp: string;
  cellId: string;
  tags: string[];
  signature: string;
  signatureAlgo: "HMAC-SHA256";
}

export function signCellCreateEvent(cellId: string, tags: string[], timestamp?: string): SignedCellCreateEvent {
  const secret = process.env.SAIA_SECRET ?? "dev-secret";
  const payload = JSON.stringify({ cellId, tags, timestamp: timestamp ?? new Date().toISOString() });
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const parsed = JSON.parse(payload);
  return { timestamp: parsed.timestamp, cellId, tags, signature, signatureAlgo: "HMAC-SHA256" };
}

export function appendCellEventLog(entry: SignedCellCreateEvent): void {
  const logsDir = path.resolve(process.cwd(), "logs");
  const logFile = path.join(logsDir, "pattern_events.jsonl");
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  fs.appendFileSync(logFile, JSON.stringify(entry) + "\n", { encoding: "utf-8" });
}


// Tool governance
export interface SignedToolEvent {
  timestamp: string;
  toolId: string;
  inputHash: string;
  ok: boolean;
  error?: string;
  latencyMs?: number;
  signature: string;
  signatureAlgo: "HMAC-SHA256";
}

export function verifyToolCall(spec: { id: string; sideEffects: string; risk: string }, input: Record<string, unknown>): PolicyResult {
  // Simple allowlist via env: TOOLS_ALLOW=id1,id2
  const allow = String(process.env.TOOLS_ALLOW || "").split(",").map(s => s.trim()).filter(Boolean);
  if (allow.length && !allow.includes(spec.id)) return { passed: false, reason: `tool not allowed: ${spec.id}` };
  // No network tools unless explicitly enabled
  if (spec.sideEffects === "network" && process.env.TOOLS_ALLOW_NETWORK !== "1") return { passed: false, reason: "network disabled" };
  return { passed: true };
}

export function signToolEvent(toolId: string, input: any, output: { ok: boolean; error?: string }, latencyMs?: number): SignedToolEvent {
  const secret = process.env.SAIA_SECRET ?? "dev-secret";
  const h = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
  const inputHash = h(JSON.stringify(input ?? {}));
  const payload = JSON.stringify({ toolId, inputHash, ok: output.ok, error: output.error, latencyMs, timestamp: new Date().toISOString() });
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const parsed = JSON.parse(payload);
  return { timestamp: parsed.timestamp, toolId, inputHash, ok: output.ok, error: output.error, latencyMs, signature, signatureAlgo: "HMAC-SHA256" };
}

export function appendToolEventLog(entry: SignedToolEvent): void {
  const logsDir = path.resolve(process.cwd(), "logs");
  const logFile = path.join(logsDir, "tool_events.jsonl");
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  fs.appendFileSync(logFile, JSON.stringify(entry) + "\n", { encoding: "utf-8" });
}

