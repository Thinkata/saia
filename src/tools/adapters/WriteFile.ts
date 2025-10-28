import { ToolAdapter } from "../ToolTypes";
import * as fs from "fs";
import * as path from "path";

export class WriteFileAdapter implements ToolAdapter {
  spec = {
    id: "file.write",
    title: "Write File",
    description: "Write content to a file",
    tags: ["file", "write", "io"],
    sideEffects: "write" as const,
    risk: "low" as const
  };
  
  async execute(input: { file: string; content: string; append?: boolean }, ctx?: { jobId?: string; workspaceDir?: string }): Promise<any> {
    try {
      const { file, content, append = false } = input;

      // Basic validation
      if (!file || typeof file !== "string") return { ok: false, error: "file path required" };
      if (typeof content !== "string" || content.length === 0) return { ok: false, error: "content required" };
      if (content.length > 1_000_000) return { ok: false, error: "content too large" };

      // Resolve and constrain to workspace root
      const root = (ctx?.workspaceDir && path.resolve(ctx.workspaceDir)) || process.cwd();
      // Disallow absolute paths and any dot segments to avoid traversal
      const rel = String(file).trim();
      if (!rel || path.isAbsolute(rel) || rel.includes("..") || /(^|\/)\./.test(rel)) {
        return { ok: false, error: "invalid or unsafe file path" };
      }
      const full = path.resolve(root, rel);
      if (!full.startsWith(root)) return { ok: false, error: "path escapes workspace" };

      // Ensure directory exists
      fs.mkdirSync(path.dirname(full), { recursive: true });

      // Perform write
      if (append) fs.appendFileSync(full, content, { encoding: "utf-8" });
      else fs.writeFileSync(full, content, { encoding: "utf-8" });

      const st = fs.statSync(full);
      return { ok: true, data: { file: path.relative(root, full), size: st.size, operation: append ? "append" : "write" } };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
