import fs from "fs";
import path from "path";
import { ToolAdapter, ToolInput, ToolOutput, ToolSpec } from "../ToolTypes";

const spec: ToolSpec = {
  id: "file.read.range",
  title: "Read File Range",
  description: "Read a small byte range of a file from workspace (safe).",
  tags: ["file","read","range"],
  sideEffects: "read",
  risk: "low",
};

export class FileReadRangeAdapter implements ToolAdapter {
  spec = spec;
  async execute(input: ToolInput, ctx: { workspaceDir?: string }): Promise<ToolOutput> {
    try {
      const root = ctx.workspaceDir || process.cwd();
      const rel = String((input as any)?.file || "");
      if (!rel || rel.startsWith("..") || rel.includes("..")) return { ok: false, error: "invalid path" };
      if (/(^|\/)\./.test(rel) || /(^|\/)\.env/.test(rel)) return { ok: false, error: "hidden or env paths not allowed" };
      const full = path.resolve(root, rel);
      if (!full.startsWith(root)) return { ok: false, error: "path outside workspace" };
      const start = Math.max(0, Number((input as any)?.start || 0));
      const bytes = Math.max(1, Math.min(64 * 1024, Number((input as any)?.bytes || 4096)));
      const fd = fs.openSync(full, "r");
      const buf = Buffer.alloc(bytes);
      const read = fs.readSync(fd, buf, 0, bytes, start);
      fs.closeSync(fd);
      return { ok: true, data: { content: buf.toString("utf-8", 0, read), start, bytes: read } };
    } catch (e: any) {
      return { ok: false, error: e?.message || "read error" };
    }
  }
}


