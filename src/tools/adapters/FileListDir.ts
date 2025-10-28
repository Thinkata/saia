import fs from "fs";
import path from "path";
import { ToolAdapter, ToolInput, ToolOutput, ToolSpec } from "../ToolTypes";

const spec: ToolSpec = {
  id: "file.list.dir",
  title: "List Directory (Safe)",
  description: "List files under a directory with simple include filters.",
  tags: ["file","list","read"],
  sideEffects: "read",
  risk: "low",
};

export class FileListDirAdapter implements ToolAdapter {
  spec = spec;
  async execute(input: ToolInput, ctx: { workspaceDir?: string }): Promise<ToolOutput> {
    try {
      const root = ctx.workspaceDir || process.cwd();
      const dir = path.resolve(root, String((input as any)?.dir || "data"));
      if (!dir.startsWith(root)) return { ok: false, error: "path outside workspace" };
      const exts = (String((input as any)?.exts || ".md,.txt,.json,.csv")).split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
      const max = Math.max(1, Math.min(2000, Number((input as any)?.max || 500)));
      const out: Array<{ file: string; size: number }> = [];
      const walk = (p: string) => {
        for (const name of fs.readdirSync(p)) {
          if (name.startsWith(".")) continue;
          const full = path.join(p, name);
          const st = fs.statSync(full);
          if (st.isDirectory()) walk(full);
          else if (st.isFile()) {
            const keep = exts.length === 0 || exts.some(e => full.toLowerCase().endsWith(e));
            if (keep) out.push({ file: path.relative(root, full), size: st.size });
            if (out.length >= max) return;
          }
          if (out.length >= max) return;
        }
      };
      if (!fs.existsSync(dir)) return { ok: true, data: { files: [] } };
      walk(dir);
      return { ok: true, data: { files: out } };
    } catch (e: any) {
      return { ok: false, error: e?.message || "list error" };
    }
  }
}


