import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import pino from "pino";
import crypto from "crypto";

import { GenAICell } from "./agents/GenAICell";
import { Orchestrator, RouterStrategy } from "./patterns/Orchestrator";
import { LearningRouter } from "./adaptation/LearningRouter";
import { FeedbackController } from "./adaptation/FeedbackController";
import { PatternRegistry } from "./patterns/PatternRegistry";
import { StabilityAssessor } from "./evolution/StabilityAssessor";
import { SelfDevelopmentEngine } from "./evolution/SelfDevelopmentEngine";
import { verifyEvolution, signCellCreateEvent, appendCellEventLog } from "./governance/SAGA";
import { Metrics } from "./metrics";
import { appendActionLog, signAction, verifyPolicy } from "./governance/SAGA";
import { policyEngine } from "./governance/PolicyEngine";
import { CellFactory } from "./cells/CellFactory";
import { DomainSynthesis } from "./evolution/DomainSynthesis";
import { ExperimentRunner } from "./experiments/ExperimentRunner";
import { BaselineComparisonExperiment } from "./experiments/BaselineComparison";
import { DomainEmergenceExperiment } from "./experiments/DomainEmergence";
import { resolveExperimentConfigPath } from "./experiments/Config";
import { FullExperiment } from "./experiments/FullExperiment";
import { ToolRegistry } from "./tools/ToolRegistry";
import { GovernedToolRunner } from "./tools/GovernedToolRunner";
import { TsTranspileAdapter } from "./tools/adapters/TsTranspile";
import { SearchRegexAdapter } from "./tools/adapters/SearchRegex";
import { ToolKnowledge } from "./tools/ToolKnowledge";
import { FileListDirAdapter } from "./tools/adapters/FileListDir";
import { FileReadRangeAdapter } from "./tools/adapters/FileReadRange";
import { DataParseTodoAdapter } from "./tools/adapters/DataParseTodo";
import { SchedulePrioritizeAdapter } from "./tools/adapters/SchedulePrioritize";
import { LogAppendAdapter } from "./tools/adapters/LogAppend";
import { ToolExplorationExperiment } from "./experiments/ToolExploration";
// Specialized composite removed from default registration to emphasize foundational tools
import { TodoPrioritizeFromDirAdapter } from "./tools/adapters/TodoPrioritizeFromDir";
import { WriteFileAdapter } from "./tools/adapters/WriteFile";
// Lazy-load certain optional tooling to avoid compile-time issues in some environments

const logger = pino({ name: "saia-level1" });

// Bootstrap with a single base cell; others synthesized dynamically
const cells: GenAICell[] = [
  CellFactory.createFromDomain({ id: "base", systemPrompt: "You are a tool execution assistant. When the user mentions any of these tools: file.list.dir, search.regex, ts.transpile, file.write - you MUST immediately output ONLY the tool JSON in this format: {\"tool\":{\"id\":\"tool-name\",\"input\":{...}}}. Do not explain, do not describe, do not add text. Just output the JSON. Available tools: file.list.dir (use 'dir' parameter), search.regex (use 'pattern' and 'glob' parameters), ts.transpile (use 'code' parameter), file.write (use 'file' and 'content' parameters).", temperature: 0.1, tags: ["general","assist"] })
];

const orchestrator = new Orchestrator(cells, { strategy: (process.env.ROUTER_STRATEGY as RouterStrategy) ?? "round_robin" });
const learningRouter = new LearningRouter(cells);
const controller = new FeedbackController(0.2);
const registry = new PatternRegistry();
const stability = new StabilityAssessor();
const evolution = new SelfDevelopmentEngine(registry, stability, 3);
evolution.loadKnowledge();
// Align orchestrator active pool to current registry selection
orchestrator.autoReconfigure(registry, cells);

// Auto-synthesis cooldown and helper
const autosynthCooldownMs = Number(process.env.SYNTHESIZE_COOLDOWN_MS || 15000);
let lastAutosynthAt = 0;
async function autoSynthesizeIfNeeded() {
  const now = Date.now();
  if (now - lastAutosynthAt < autosynthCooldownMs) return;
  try {
    const candidates = DomainSynthesis.discover();
    const existing = new Set(cells.map(c => c.id.replace(/^cell-/, "")));
    const created: string[] = [];
    for (const sig of candidates) {
      if (existing.has(sig.id)) continue;
      const cell = CellFactory.createFromDomain(sig);
      const event = signCellCreateEvent(cell.id, sig.tags);
      appendCellEventLog(event);
      cells.push(cell);
      orchestrator.addCell(cell);
      created.push(cell.id);
      break; // create at most one per cooldown window
    }
    if (created.length) {
      // Merge near-duplicates, keep better performer
      const redundant = DomainSynthesis.findRedundantCells(cells.map(c => c.id));
      for (const rid of redundant) {
        orchestrator.removeCell(rid);
        const idx = cells.findIndex(c => c.id === rid);
        if (idx >= 0) cells.splice(idx, 1);
      }
      lastAutosynthAt = now;
    }
  } catch {}
}

export const app = express();
app.use(express.json({ limit: "1mb" }));
// Tooling: registry and governed runner
const toolKnowledge = new ToolKnowledge(path.resolve(process.cwd(), "knowledge/tools.json"));
const toolRegistry = new ToolRegistry(toolKnowledge);
toolRegistry.register(new TsTranspileAdapter());
toolRegistry.register(new SearchRegexAdapter());
toolRegistry.register(new FileListDirAdapter());
toolRegistry.register(new FileReadRangeAdapter());
toolRegistry.register(new DataParseTodoAdapter());
toolRegistry.register(new SchedulePrioritizeAdapter());
toolRegistry.register(new LogAppendAdapter());
toolRegistry.register(new TodoPrioritizeFromDirAdapter());
toolRegistry.register(new WriteFileAdapter());
// Optionally register TypeScript project typecheck tool, if module is available
try {
  // @ts-ignore dynamic import at runtime
  import("./tools/adapters/TsTypecheckProject").then((mod: any) => {
    try { if (mod?.TsTypecheckProjectAdapter) toolRegistry.register(new mod.TsTypecheckProjectAdapter()); } catch {}
  }).catch(() => {});
} catch {}
// Load any generated tools from build output (dist/tools/generated) dynamically
try {
  // @ts-ignore dynamic import at runtime
  import("./tools/GeneratedToolLoader").then((mod: any) => {
    try { mod?.loadGeneratedTools?.(toolRegistry); } catch {}
  }).catch(() => {});
} catch {}
const toolRunner = new GovernedToolRunner(toolRegistry);

// Serve Nuxt dashboard if built; otherwise serve legacy static
const nuxtClientDir = path.resolve(process.cwd(), "dashboard/.output/public");
app.use("/dashboard", express.static(nuxtClientDir));
app.get(["/dashboard", "/dashboard/", "/dashboard/*"], (req, res) => {
  res.sendFile(path.join(nuxtClientDir, "index.html"));
});

// Tools API (read-only registry + governed execute for testing)
app.get("/tools/registry", (req, res) => {
  try { res.json(toolRegistry.listWithStats()); } catch (e: any) { res.status(500).json({ error: e?.message || "tools registry failed" }); }
});

// Tool recommendations
app.get("/tools/recommend", (req, res) => {
  try {
    const prompt = String(req.query.prompt || "");
    const domain = String(req.query.domain || "");
    const tags = String(req.query.tags || "").split(",").map(s => s.trim()).filter(Boolean);
    const rec = toolRegistry.recommend({ prompt, domain, tags }, 3);
    res.json({ recommend: rec });
  } catch (e: any) { res.status(500).json({ error: e?.message || "tools recommend failed" }); }
});

// Alias for recommendations
app.get("/tools/suggest", (req, res) => {
  try {
    const prompt = String(req.query.prompt || "");
    const domain = String(req.query.domain || "");
    const tags = String(req.query.tags || "").split(",").map(s => s.trim()).filter(Boolean);
    const rec = toolRegistry.recommend({ prompt, domain, tags }, 3);
    res.json({ suggest: rec });
  } catch (e: any) { res.status(500).json({ error: e?.message || "tools suggest failed" }); }
});

// Tool knowledge dump
app.get("/tools/knowledge", (req, res) => {
  try { res.json((toolRegistry as any).knowledge?.dump?.() || {}); } catch (e: any) { res.status(500).json({ error: e?.message || "knowledge dump failed" }); }
});

// Policy engine diagnostics
app.get("/policy/state", (req, res) => {
  try { res.json((policyEngine as any).dump?.() || {}); } catch (e: any) { res.status(500).json({ error: e?.message || "policy state failed" }); }
});

// Guarded tool generator: writes adapter source to src/tools/generated and requires a rebuild
app.post("/tools/generate", (req, res) => {
  try {
    if (process.env.TOOLS_ALLOW_GENERATE !== "1") return res.status(403).json({ error: "generation disabled" });
    const { id, code } = req.body || {};
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9_.-]{1,48}$/.test(id)) return res.status(400).json({ error: "invalid id" });
    const dir = path.resolve(process.cwd(), "src/tools/generated");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}.ts`);
    fs.writeFileSync(file, String(code || ""), { encoding: "utf-8" });
    res.json({ ok: true, file, note: "Rebuild required; generated tools load from dist/tools/generated." });
  } catch (e: any) { res.status(500).json({ error: e?.message || "tool generate failed" }); }
});

app.post("/tools/execute", async (req, res) => {
  try {
    const { toolId, input, task } = req.body || {};
    const out = await toolRunner.run(String(toolId || ''), input || {}, { workspaceDir: process.cwd(), task });
    res.json(out);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "tool execute failed" });
  }
});

// Tools metrics (from logs)
app.get("/tools/metrics", (req, res) => {
  try {
    const p = path.resolve(process.cwd(), "logs/tool_events.jsonl");
    if (!fs.existsSync(p)) return res.json({ total: 0, perTool: {} });
    const lines = fs.readFileSync(p, "utf-8").trim().split("\n").filter(Boolean);
    const per: Record<string, { count: number; ok: number; latencySum: number }> = {};
    for (const l of lines) {
      try {
        const ev = JSON.parse(l);
        const id = String(ev.toolId || "unknown");
        const r = per[id] || (per[id] = { count: 0, ok: 0, latencySum: 0 });
        r.count += 1; if (ev.ok) r.ok += 1; r.latencySum += Number(ev.latencyMs || 0);
      } catch {}
    }
    const perTool: Record<string, { count: number; successRate: number; avgLatency: number }> = {};
    for (const [id, v] of Object.entries(per)) {
      perTool[id] = { count: v.count, successRate: v.count ? Math.round((v.ok / v.count) * 100) : 0, avgLatency: v.count ? Math.round(v.latencySum / v.count) : 0 };
    }
    res.json({ total: lines.length, perTool });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "tools metrics failed" });
  }
});

// Robust extractor for a single tool-step JSON object from arbitrary text.
// Strategy:
// 1) Prefer fenced ```json ... ``` blocks (can be multiple; take the first valid tool object)
// 2) If whole text is a JSON object, try parsing it directly
// 3) Balanced-brace scan to locate embedded JSON objects; return the first that contains { tool: { id } }
function tryParseJSONSafe(text: string): any | undefined {
  try { return JSON.parse(text); } catch { return undefined; }
}

function extractToolStep(text: string): any | undefined {
  if (!text || typeof text !== "string") return undefined;

  // 1) fenced code blocks
  try {
    const fenceRe = /```json\s*([\s\S]*?)```/gi;
    let m: RegExpExecArray | null;
    while ((m = fenceRe.exec(text)) !== null) {
      const obj = tryParseJSONSafe(m[1] as string);
      if (obj && obj.tool && typeof obj.tool.id === "string") return obj;
    }
  } catch {}

  // 2) whole-text JSON
  try {
    const whole = tryParseJSONSafe(text.trim());
    if (whole && whole.tool && typeof whole.tool.id === "string") return whole;
  } catch {}

  // 3) balanced-brace scanning (handles nested braces and strings)
  try {
    const s = text;
    const len = s.length;
    let start = -1;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < len; i++) {
      const ch = s[i] as string;
      if (inStr) {
        if (esc) { esc = false; }
        else if (ch === "\\") { esc = true; }
        else if (ch === '"') { inStr = false; }
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') { if (depth === 0) start = i; depth++; continue; }
      if (ch === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          const sub = s.slice(start, i + 1);
          const obj = tryParseJSONSafe(sub);
          if (obj && obj.tool && typeof obj.tool.id === "string") return obj;
          start = -1;
        }
      }
    }
  } catch {}

  return undefined;
}

// POST /act { prompt, router? }
app.post("/act", async (req, res) => {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const { prompt, router, tools } = req.body ?? {};
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return res.status(400).json({ error: "prompt is required" });
  }

  try {
    const policy = await verifyPolicy(prompt);
    try { policyEngine.learn(String(prompt), !!policy.passed, policy.risk); } catch {}
    if (!policy.passed) {
      const latencyMs = Date.now() - startedAt;
      Metrics.record({ requestId, cellId: "(none)", latencyMs, success: false, policyPassed: false, timestamp: new Date().toISOString() });
      try {
        const signedFail = signAction(requestId, "(none)", String(prompt), "", policy, { routerStrategy: "n/a", adaptationReason: "policy-fail" });
        appendActionLog(signedFail);
      } catch {}
      return res.status(400).json({ requestId, error: "Policy rejected request", policy });
    }

    const requestedRouter = String(router || "success_rate");
    const useClassic = ["round_robin","random","keyword"].includes(requestedRouter);
    const useAdaptive = ["success_rate","rl_bandit"].includes(requestedRouter);
    const selectedRouter = useClassic ? requestedRouter : (useAdaptive ? requestedRouter : "success_rate");
    const adaptive = useAdaptive ? learningRouter.route(prompt, selectedRouter as any) : undefined;
    // If client explicitly provides a tools allow-list, force base cell to maximize chance of proper tool JSON
    const forceBaseForTools = Array.isArray(tools) && tools.length > 0;
    const cell = forceBaseForTools ? (cells.find(c => c.id === 'cell-base') || orchestrator.route(prompt, selectedRouter as RouterStrategy))
                                   : (useClassic ? orchestrator.route(prompt, selectedRouter as RouterStrategy) : (adaptive!.cell));
    let responseText: string = await cell.act(prompt);
    // Optional one-step tool run if requested and cell suggests it via simple JSON { tool:{ id, input } }
    let toolUsedId: string | undefined;
    if (Array.isArray(tools) && tools.length > 0) {
      try {
        const step: any | undefined = extractToolStep(responseText);
        if (step && step.tool && typeof step.tool.id === 'string' && tools.includes(step.tool.id)) {
          const out = await toolRunner.run(step.tool.id, step.tool.input || {}, { workspaceDir: process.cwd(), task: { prompt: String(prompt), cellId: String(cell.id) } });
          responseText = `${responseText}\n\n[tool:${step.tool.id}] => ${out.ok ? JSON.stringify(out.data) : `error: ${out.error}`}`;
          toolUsedId = String(step.tool.id);
        }
      } catch {}
    }
    // Extract optional domain JSON from the response (supports fenced blocks or trailing object)
    let suggestedDomain: string | undefined;
    let suggestedTags: string[] | undefined;
    try {
      // 1) fenced ```json ... ```
      let obj: any | undefined;
      const fence = responseText.match(/```json\s*([\s\S]*?)```/i);
      if (fence && fence[1] && fence[0]) {
        const candidate = JSON.parse(fence[1] as string);
        if (candidate && (typeof candidate.domain === 'string' || Array.isArray(candidate.tags))) {
          obj = candidate;
          responseText = responseText.replace(fence[0] as string, '').trim();
        }
      } else {
        // 2) last JSON object anywhere in text, only if it looks like a domain/tags suggestion
        const allObjs = responseText.match(/\{[\s\S]*?\}/g);
        if (allObjs && allObjs.length > 0) {
          const last = allObjs[allObjs.length - 1]!;
          try {
            const candidate = JSON.parse(last);
            if (candidate && (typeof candidate.domain === 'string' || Array.isArray(candidate.tags))) {
              obj = candidate;
              responseText = responseText.replace(last, '').trim();
            }
          } catch {}
        }
      }
      if (obj) {
        if (typeof obj.domain === 'string') suggestedDomain = String(obj.domain).toLowerCase();
        if (Array.isArray(obj.tags)) suggestedTags = obj.tags.map((t: any) => String(t).toLowerCase()).slice(0, 8);
      }
    } catch {}
    // Derive domain/tags from tool usage if not suggested
    if (!suggestedDomain && toolUsedId) {
      // Let the tool registry provide domain/tag suggestions based on tool metadata
      const tool = toolRegistry.get(toolUsedId);
      if (tool) {
        suggestedDomain = tool.spec.tags[0] || 'general';
        suggestedTags = tool.spec.tags.slice(0, 6);
      }
    }

    try { policyEngine.learn(String(prompt), true, policy.risk); } catch {}
    const signed = signAction(requestId, cell.id, prompt, responseText, policy, { routerStrategy: selectedRouter, adaptationReason: adaptive?.reason || "n/a" });
    appendActionLog(signed);

    const latencyMs = Date.now() - startedAt;
    Metrics.record({ requestId, cellId: cell.id, latencyMs, success: true, policyPassed: policy.passed, timestamp: new Date().toISOString(), prompt, response: responseText, domain: suggestedDomain, tags: suggestedTags });
    controller.update(cell, { success: true, latencyMs, policyPassed: policy.passed }, adaptive?.confidence ?? 0.5);
    // Update bandit value with reward = SAI for the cell if using rl_bandit
    try {
      const detailed = Metrics.detailed();
      const perCell: any = (detailed as any).perCell || {};
      const reward = typeof perCell[cell.id]?.SAI === 'number' ? perCell[cell.id].SAI : Math.max(0, 1 - Math.min(1, latencyMs / (Number(process.env.LATENCY_SLO_MS || 2000)))) ;
      if (selectedRouter === 'rl_bandit') {
        (learningRouter as any).update(cell.id, reward);
      }
      // If model suggested a domain not yet present, stage it for synthesis by appending a pseudo-recent event
      if (suggestedDomain) {
        // lightweight hint: include in Metrics.recent via prompt/tags on this record (already done)
      }
    } catch {}

    const payload = {
      requestId,
      router: selectedRouter,
      cellId: cell.id,
      response: responseText,
      signatureAlgo: signed.signatureAlgo,
      signature: signed.signature,
      policy,
      metrics: { latencyMs, success: true, timestamp: new Date().toISOString(), policyRisk: policy.risk },
    };
    res.json(payload);
    // opportunistically try auto-synthesis after responding
    setTimeout(() => { autoSynthesizeIfNeeded().catch(() => {}); }, 0);
  } catch (err: any) {
    const latencyMs = Date.now() - startedAt;
    Metrics.record({ requestId, cellId: "(unknown)", latencyMs, success: false, policyPassed: true, timestamp: new Date().toISOString() });
    logger.error({ err }, "request failed");
    return res.status(500).json({ requestId, error: err?.message || "Internal error" });
  }
});

app.get("/metrics", (req, res) => {
  res.json(Metrics.summary());
});

app.get("/metrics/detailed", (req, res) => {
  res.json(Metrics.detailed());
});

// Level 3 endpoints
app.post("/evolve", async (req, res) => {
  if (!verifyEvolution()) return res.status(403).json({ error: "evolution not permitted" });
  try {
    await evolution.evaluate();
    orchestrator.autoReconfigure(registry, cells);
    res.json({ ok: true, activePattern: registry.getActivePatternId(), perf: Metrics.globalSuccessEMA() });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "evolution failed" });
  }
});

app.get("/evolution/state", (req, res) => {
  const last = stability.getLast();
  const active = registry.getActivePattern();
  const postCx = active ? Math.max(1, active.cells.length) : last.complexity;
  const preview = stability.computeProspective(last.perf, last.perf, last.complexity, postCx);
  res.json({
    activePattern: registry.getActivePatternId(),
    perf: Metrics.globalSuccessEMA(),
    lyapunov: { deltaV: preview.deltaV, alpha: preview.alpha, beta: preview.beta, preSuccess: preview.prePerf, postSuccess: preview.postPerf, preCx: preview.preCx, postCx: preview.postCx }
  });
});

// Synthesize cells dynamically based on observed domains
app.post("/evolution/synthesize", async (req, res) => {
  try {
    const candidates = DomainSynthesis.discover();
    const existing = new Set(cells.map(c => c.id.replace(/^cell-/, "")));
    const created: string[] = [];
    for (const sig of candidates) {
      if (existing.has(sig.id)) continue;
      const cell = CellFactory.createFromDomain(sig);
      const event = signCellCreateEvent(cell.id, sig.tags);
      appendCellEventLog(event);
      cells.push(cell);
      orchestrator.addCell(cell);
      created.push(cell.id);
    }
    // Merge near-duplicates, keep better performer
    const redundant = DomainSynthesis.findRedundantCells(cells.map(c => c.id));
    for (const rid of redundant) {
      orchestrator.removeCell(rid);
      const idx = cells.findIndex(c => c.id === rid);
      if (idx >= 0) cells.splice(idx, 1);
    }
    res.json({ created, removed: redundant, totalCells: cells.length });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "synthesis failed" });
  }
});

// Experiments
app.post("/experiments/baseline", async (req, res) => {
  try {
    // If client supplies overrides, respect them; else load from EXPERIMENT_CONFIG
    let prompts = Array.isArray(req.body?.prompts) ? req.body.prompts : [];
    let iterations = Number(req.body?.iterations || 0);
    const exp = new BaselineComparisonExperiment(new ExperimentRunner());
    const results = await exp.execute(prompts, iterations);
    res.json({ configPath: resolveExperimentConfigPath(), ...results });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "experiment failed" });
  }
});

app.post("/experiments/domain-emergence", async (req, res) => {
  try {
    const exp = new DomainEmergenceExperiment(new ExperimentRunner());
    const results = await exp.execute();
    res.json({ configPath: resolveExperimentConfigPath(), ...results });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "experiment failed" });
  }
});

app.post("/experiments/full", async (req, res) => {
  try {
    const exp = new FullExperiment(new ExperimentRunner());
    const results = await exp.execute();
    res.json(results);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "experiment failed" });
  }
});

// Tool exploration experiment (A/B tools)
app.post("/experiments/tool-explore", async (req, res) => {
  try {
    const exp = new ToolExplorationExperiment(new ExperimentRunner());
    const results = await exp.execute();
    res.json(results);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "tool exploration failed" });
  }
});

// Diagnostics: RL router state
app.get("/router/state", (req, res) => {
  try {
    const state = (learningRouter as any).getBanditState?.() || {};
    const params = (learningRouter as any).getParams?.() || {};
    res.json({ ...state, params });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "router state failed" });
  }
});

// Diagnostics: evolution logs
app.get("/evolution/logs", (req, res) => {
  try {
    const limit = Math.max(1, Math.min(300, Number(req.query.limit || 100)));
    const p = path.resolve(process.cwd(), "logs/pattern_events.jsonl");
    if (!fs.existsSync(p)) return res.json([]);
    const lines = fs.readFileSync(p, "utf-8").trim().split("\n").filter(Boolean);
    const last = lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    res.json(last);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "evolution logs failed" });
  }
});

// Diagnostics: governance actions sample
app.get("/actions/sample", (req, res) => {
  try {
    const limit = Math.max(1, Math.min(300, Number(req.query.limit || 100)));
    const p = path.resolve(process.cwd(), "logs/actions.jsonl");
    if (!fs.existsSync(p)) return res.json([]);
    const lines = fs.readFileSync(p, "utf-8").trim().split("\n").filter(Boolean);
    const last = lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    res.json(last);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "actions sample failed" });
  }
});

// Diagnostics: domain -> cell matrix from recent metrics
app.get("/analytics/domain-matrix", (req, res) => {
  try {
    const det: any = Metrics.detailed();
    const events = Array.isArray(det.recent) ? det.recent : [];
    const matrix: Record<string, Record<string, number>> = {};
    for (const e of events) {
      const d = (e.domain || "unknown").toString().toLowerCase();
      const c = e.cellId || "unknown";
      (matrix[d] ||= {}); matrix[d][c] = (matrix[d][c] ?? 0) + 1;
    }
    res.json({ matrix, total: events.length });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "domain matrix failed" });
  }
});

// Environment snapshot for dashboard/reporting
app.get("/env/snapshot", (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "not found" });
  }
  try {
    const keys = [
      "LATENCY_SLO_MS","RL_EPSILON","RL_EPSILON0","RL_MIN_EPSILON","RL_EPSILON_DECAY","RL_WARMUP_STEPS",
      "RL_DECAY","TAG_GUARD_THRESHOLD","RL_DRIFT_WINDOW","RL_DRIFT_DROP","RL_SPIKE_EPSILON","RL_SPIKE_DECAY","RL_SPIKE_STEPS",
      "MERGE_MIN_NAME_SIM","MERGE_MIN_TAG_JACCARD","MERGE_MIN_OBS","TOOLS_ALLOW","TOOLS_ALLOW_NETWORK"
    ];
    const obj: Record<string,string|number|undefined> = {};
    for (const k of keys) obj[k] = process.env[k];
    obj["EXPERIMENT_CONFIG"] = process.env.EXPERIMENT_CONFIG;
    res.json(obj);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "env snapshot failed" });
  }
});

// Ad-hoc run: accept a prompt, optionally recommend/allow tools, run end-to-end, and return enriched results + metrics
app.post("/adhoc/run", async (req, res) => {
  try {
    const { prompt, router, allow, autoRecommend, recommendK, synthesize } = req.body || {};
    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      return res.status(400).json({ error: "prompt is required" });
    }

    // Resolve allowed tools: explicit allow list wins; otherwise optionally auto-recommend from tool knowledge
    let allowedTools: string[] = [];
    if (Array.isArray(allow) && allow.length > 0) {
      allowedTools = allow.map((t: any) => String(t)).filter(Boolean);
    } else if (autoRecommend) {
      const k = Math.max(1, Math.min(5, Number(recommendK || 3)));
      try {
        allowedTools = toolRegistry.recommend({ prompt: String(prompt), domain: "", tags: [] }, k);
      } catch {}
    }

    const runner = new ExperimentRunner();
    const act = await runner.act(String(prompt), String(router || "success_rate"), allowedTools.length ? allowedTools : undefined);

    // Heuristically detect used tool id from appended response marker
    let usedToolId: string | undefined;
    try {
      const m = String(act?.response || "").match(/\[tool:([a-z0-9_.-]+)\]/i);
      if (m && m[1]) usedToolId = m[1].toLowerCase();
    } catch {}

    // Optionally trigger synthesis step after the run
    if (synthesize === true) {
      try { await runner.synthesize(); } catch {}
    }

    // Compose enriched payload with current metrics/state
    const summary = Metrics.summary();
    const detailed = Metrics.detailed();
    let toolsMetrics: any = { total: 0, perTool: {} };
    try {
      // Reuse existing computation by calling the public endpoint
      toolsMetrics = await runner.getJSON(`/tools/metrics`);
    } catch {}
    let evolutionState: any = {};
    try { evolutionState = await runner.getJSON(`/evolution/state`); } catch {}

    return res.json({
      ok: true,
      router: act?.router,
      allowedTools,
      recommended: allowedTools,
      usedToolId,
      act,
      summary,
      detailed,
      tools: toolsMetrics,
      evolution: evolutionState,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "adhoc run failed" });
  }
});

// Allow editing router parameters at runtime (non-persistent)
app.post("/router/params", (req, res) => {
  try {
    const body = req.body || {};
    (learningRouter as any).setParams?.(body);
    res.json({ ok: true, params: (learningRouter as any).getParams?.() });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "set params failed" });
  }
});

const port = Number(process.env.PORT || 3000);
const shouldListen = (process.env.NODE_ENV !== 'test') && !process.env.VITEST;
if (shouldListen) {
  app.listen(port, () => {
    logger.info({ port }, "SAIA Level 1 server is running");
  });
}


