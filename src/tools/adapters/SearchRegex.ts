import fs from "fs";
import path from "path";
import { ToolAdapter, ToolInput, ToolOutput, ToolSpec } from "../ToolTypes";

const spec: ToolSpec = {
  id: "search.regex",
  title: "Regex Search (Workspace)",
  description: "Search files in a workspace directory with a regex pattern (read-only).",
  tags: ["search", "regex", "code"],
  sideEffects: "read",
  risk: "low",
};

export class SearchRegexAdapter implements ToolAdapter {
  spec = spec;

  async execute(input: ToolInput, ctx: { workspaceDir?: string }): Promise<ToolOutput> {
    const dir = ctx.workspaceDir || process.cwd();
    const pattern = String((input as any)?.pattern || "");
    const glob = String((input as any)?.glob || "");
    if (!pattern) return { ok: false, error: "pattern required" };
    const re = new RegExp(pattern, "i");
    const results: Array<{ file: string; line: number; text: string }> = [];
    const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", ".next", ".nuxt", ".cache"]);
    function scan(p: string) {
      let st: fs.Stats;
      try {
        st = fs.lstatSync(p);
      } catch {
        return; // ignore unreadable entries
      }
      // Skip symlinks to avoid loops
      if (st.isSymbolicLink()) return;
      if (st.isDirectory()) {
        const base = path.basename(p);
        if (IGNORE_DIRS.has(base)) return;
        let names: string[] = [];
        try {
          names = fs.readdirSync(p);
        } catch {
          return;
        }
        for (const name of names) scan(path.join(p, name));
      } else if (st.isFile()) {
        if (glob && !p.includes(glob)) return;
        let content = "";
        try {
          content = fs.readFileSync(p, "utf-8");
        } catch {
          return; // ignore unreadable files
        }
        const lines = content.split(/\r?\n/);
        lines.forEach((text, idx) => { if (re.test(text)) results.push({ file: path.relative(dir, p), line: idx + 1, text }); });
      }
    }
    try {
      scan(dir);
      return { ok: true, data: { count: results.length, results: results.slice(0, 200) } };
    } catch (e: any) {
      return { ok: false, error: e?.message || "search error" };
    }
  }
}


