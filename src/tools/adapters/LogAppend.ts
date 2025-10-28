import fs from "fs";
import path from "path";
import { ToolAdapter, ToolInput, ToolOutput, ToolSpec } from "../ToolTypes";

const spec: ToolSpec = {
  id: "log.append",
  title: "Append Log (Workspace ./logs)",
  description: "Append a line of text to a file under the workspace ./logs directory.",
  tags: ["log", "write", "file"],
  sideEffects: "write",
  risk: "med",
};

export class LogAppendAdapter implements ToolAdapter {
  spec = spec;

  async execute(input: ToolInput, ctx: { workspaceDir?: string }): Promise<ToolOutput> {
    try {
      const root = ctx.workspaceDir || process.cwd();
      const logsDir = path.resolve(root, "logs");
      const rel = String((input as any)?.file || "");
      const content = String((input as any)?.content || "");
      const withTs = (input as any)?.timestamp === false ? false : true;
      if (!rel || /(^|\/)\./.test(rel) || rel.includes("..")) return { ok: false, error: "invalid file path" };
      if (content.length === 0) return { ok: false, error: "content required" };
      if (content.length > 10_000) return { ok: false, error: "content too large" };
      const safeRel = rel.startsWith("logs/") ? rel.slice(5) : rel;
      const full = path.resolve(logsDir, safeRel);
      if (!full.startsWith(logsDir)) return { ok: false, error: "path must be under ./logs" };
      fs.mkdirSync(path.dirname(full), { recursive: true });
      const line = withTs ? `${new Date().toISOString()} ${content}\n` : `${content}\n`;
      fs.appendFileSync(full, line, { encoding: "utf-8" });
      const st = fs.statSync(full);
      return { ok: true, data: { file: path.relative(root, full), size: st.size } };
    } catch (e: any) {
      return { ok: false, error: e?.message || "append error" };
    }
  }
}



