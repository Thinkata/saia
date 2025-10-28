import { ToolAdapter, ToolInput, ToolOutput, ToolSpec } from "../ToolTypes";

const spec: ToolSpec = {
  id: "data.parse.todo",
  title: "Parse TODOs",
  description: "Parse TODO items from Markdown or JSON into normalized tasks.",
  tags: ["todo","parse","md","json"],
  sideEffects: "none",
  risk: "low",
};

type Task = { title: string; done?: boolean; due?: string; priority?: string; estimateMin?: number; tags?: string[]; blockedBy?: string[] };

export class DataParseTodoAdapter implements ToolAdapter {
  spec = spec;
  async execute(input: ToolInput): Promise<ToolOutput> {
    try {
      const text = String((input as any)?.content || "");
      const json = (input as any)?.json;
      const out: Task[] = [];
      if (json && Array.isArray(json)) {
        for (const it of json) {
          out.push({
            title: String(it.title || it.text || ""),
            done: !!it.done,
            due: it.due ? String(it.due) : undefined,
            priority: it.priority ? String(it.priority) : undefined,
            estimateMin: it.estimateMin ? Number(it.estimateMin) : undefined,
            tags: Array.isArray(it.tags) ? it.tags.map(String) : undefined,
            blockedBy: Array.isArray(it.blockedBy) ? it.blockedBy.map(String) : undefined,
          });
        }
      } else {
        const lines = text.split(/\r?\n/);
        for (const ln of lines) {
          const m = ln.match(/^- \[( |x)\]\s*(.+)$/i);
          if (!m) continue;
          const done = m[1]?.toLowerCase() === "x";
          const title = m[2]?.trim() || "";
          const due = (title.match(/(?:^|\s)due:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i) || [])[1];
          const pr = (title.match(/(?:^|\s)priority:\s*(p0|p1|p2|high|med|low)/i) || [])[1];
          const est = (title.match(/(?:^|\s)(?:est|estimate):\s*([0-9]+)\s*(min|m|h)/i) || []);
          const estimateMin = est.length && est[1] && est[2] ? (est[2].toLowerCase().startsWith("h") ? Number(est[1]) * 60 : Number(est[1])) : undefined;
          const tags = Array.from(title.matchAll(/#([a-z0-9\-_]+)/ig)).map(x => x[1]).filter((x): x is string => Boolean(x));
          out.push({ title, done, due, priority: pr, estimateMin, tags });
        }
      }
      return { ok: true, data: { tasks: out } };
    } catch (e: any) {
      return { ok: false, error: e?.message || "parse error" };
    }
  }
}


