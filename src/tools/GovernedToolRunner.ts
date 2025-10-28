import { ToolInput, ToolOutput } from "./ToolTypes";
import { ToolRegistry } from "./ToolRegistry";
import type { TaskContext } from "./ToolKnowledge";
import { appendToolEventLog, signToolEvent, verifyToolCall } from "../governance/SAGA";

export class GovernedToolRunner {
  constructor(private registry: ToolRegistry) {}

  async run(toolId: string, input: ToolInput, ctx: { jobId?: string; workspaceDir?: string; task?: TaskContext }): Promise<ToolOutput> {
    const tool = this.registry.get(toolId);
    if (!tool) return { ok: false, error: `unknown tool: ${toolId}` };
    const policy = verifyToolCall(tool.spec, input);
    if (!policy.passed) return { ok: false, error: `policy_fail: ${policy.reason}` };
    const started = Date.now();
    let out: ToolOutput;
    try {
      out = await tool.execute(input, ctx);
    } catch (e: any) {
      out = { ok: false, error: e?.message || "tool error" };
    }
    const latencyMs = Date.now() - started;
    try {
      const signed = signToolEvent(toolId, input, out, latencyMs);
      appendToolEventLog(signed);
      this.registry.recordOutcome(toolId, !!out.ok, latencyMs, ctx?.task || {});
    } catch {}
    return { ...out, latencyMs };
  }
}


