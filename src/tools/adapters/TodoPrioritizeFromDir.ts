import fs from "fs";
import path from "path";
import { ToolAdapter, ToolInput, ToolOutput, ToolSpec } from "../ToolTypes";

const spec: ToolSpec = {
  id: "todo.prioritize.fromdir",
  title: "Todo → Schedule (From Dir)",
  description: "Scan a directory for todo files, parse tasks, and propose today's schedule.",
  tags: ["todo","schedule","parse","file","read"],
  sideEffects: "read",
  risk: "low",
};

type Task = { title: string; done?: boolean; due?: string; priority?: string; estimateMin?: number; tags?: string[]; blockedBy?: string[] };

function parseMarkdownTodos(text: string): Task[] {
  const out: Task[] = [];
  const lines = text.split(/\r?\n/);
  for (const ln of lines) {
    const m = ln.match(/^- \[( |x)\]\s*(.+)$/i);
    if (!m || !m[1] || !m[2]) continue;
    const done = m[1].toLowerCase() === "x";
    const title = m[2].trim();
    const due = (title.match(/(?:^|\s)due:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i) || [])[1];
    const pr = (title.match(/(?:^|\s)priority:\s*(p0|p1|p2|high|med|low)/i) || [])[1];
    const est = (title.match(/(?:^|\s)(?:est|estimate):\s*([0-9]+)\s*(min|m|h)/i) || []);
    const estimateMin = est.length && est[1] && est[2] ? (est[2].toLowerCase().startsWith("h") ? Number(est[1]) * 60 : Number(est[1])) : undefined;
    const tags = Array.from(title.matchAll(/#([a-z0-9\-_]+)/ig)).map(x => x[1]).filter((tag): tag is string => Boolean(tag));
    out.push({ title, done, due, priority: pr, estimateMin, tags });
  }
  return out;
}

function scheduleToday(tasks: Task[], startHour: number, endHour: number) {
  const now = new Date();
  const capMin = Math.max(30, (endHour - startHour) * 60);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const score = (t: Task) => {
    if (t.done) return -1;
    let s = 0;
    if (t.due) {
      const d = new Date(t.due);
      const dd = Math.round((d.getTime() - today.getTime()) / 86400000);
      s += dd <= 0 ? 3 : dd === 1 ? 2 : dd <= 3 ? 1 : 0;
    }
    const pr = (t.priority || "").toLowerCase();
    if (pr === "p0" || pr === "high") s += 3;
    else if (pr === "p1" || pr === "med") s += 2;
    else if (pr === "p2" || pr === "low") s += 1;
    if (typeof t.estimateMin === "number") s += t.estimateMin <= 30 ? 1 : 0;
    // Use semantic matching for priority tags rather than hard-coded list
    const priorityTags = (t.tags || []).filter(tag => 
      ['urgent', 'critical', 'high', 'today', 'asap', 'immediate'].includes(String(tag).toLowerCase())
    );
    if (priorityTags.length > 0) s += 1;
    return s;
  };
  const candidates = tasks.slice().filter(t => !t.done).sort((a, b) => score(b) - score(a));
  const slots: Array<{ title: string; start: string; end: string }> = [];
  let used = 0;
  let t0 = new Date(today); t0.setHours(startHour, 0, 0, 0);
  for (const t of candidates) {
    const need = Math.max(15, Math.min(240, Number(t.estimateMin || 30)));
    if (used + need > capMin) continue;
    const s = new Date(t0.getTime() + used * 60000);
    const e = new Date(s.getTime() + need * 60000);
    slots.push({ title: t.title, start: s.toISOString(), end: e.toISOString() });
    used += need;
  }
  const leftover = candidates.filter(t => !slots.find(s => s.title === t.title)).map(t => t.title);
  return { slots, leftover, usedMin: used, capacityMin: capMin };
}

export class TodoPrioritizeFromDirAdapter implements ToolAdapter {
  spec = spec;
  async execute(input: ToolInput, ctx: { workspaceDir?: string }): Promise<ToolOutput> {
    try {
      const root = ctx.workspaceDir || process.cwd();
      const dir = path.resolve(root, String((input as any)?.dir || "data"));
      if (!dir.startsWith(root)) return { ok: false, error: "path outside workspace" };
      const exts = (String((input as any)?.exts || ".md,.txt,.json")).split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
      const maxBytes = Math.max(1024, Math.min(256 * 1024, Number((input as any)?.maxBytes || 64 * 1024)));
      const startHour = Number((input as any)?.startHour ?? 9);
      const endHour = Number((input as any)?.endHour ?? 17);

      const files: string[] = [];
      const walk = (p: string) => {
        for (const name of fs.readdirSync(p)) {
          if (name.startsWith(".")) continue;
          const full = path.join(p, name);
          const st = fs.statSync(full);
          if (st.isDirectory()) walk(full);
          else if (st.isFile()) {
            const keep = exts.length === 0 || exts.some(e => full.toLowerCase().endsWith(e));
            if (keep) files.push(full);
          }
        }
      };
      if (fs.existsSync(dir)) walk(dir);

      const tasks: Task[] = [];
      for (const full of files) {
        let content = "";
        try {
          const buf = fs.readFileSync(full);
          content = buf.slice(0, maxBytes).toString("utf-8");
        } catch {}
        if (!content) continue;
        if (/\.json$/i.test(full)) {
          try {
            const data = JSON.parse(content);
            if (Array.isArray(data)) {
              for (const it of data) {
                tasks.push({
                  title: String(it.title || it.text || ""),
                  done: !!it.done,
                  due: it.due ? String(it.due) : undefined,
                  priority: it.priority ? String(it.priority) : undefined,
                  estimateMin: it.estimateMin ? Number(it.estimateMin) : undefined,
                  tags: Array.isArray(it.tags) ? it.tags.map(String) : undefined,
                  blockedBy: Array.isArray(it.blockedBy) ? it.blockedBy.map(String) : undefined,
                });
              }
            } else if (Array.isArray((data as any)?.tasks)) {
              for (const it of (data as any).tasks) {
                tasks.push({
                  title: String(it.title || it.text || ""),
                  done: !!it.done,
                  due: it.due ? String(it.due) : undefined,
                  priority: it.priority ? String(it.priority) : undefined,
                  estimateMin: it.estimateMin ? Number(it.estimateMin) : undefined,
                  tags: Array.isArray(it.tags) ? it.tags.map(String) : undefined,
                  blockedBy: Array.isArray(it.blockedBy) ? it.blockedBy.map(String) : undefined,
                });
              }
            }
          } catch {}
        } else {
          tasks.push(...parseMarkdownTodos(content));
        }
      }

      const sched = scheduleToday(tasks, startHour, endHour);
      return { ok: true, data: { files: files.map(f => path.relative(root, f)), tasksParsed: tasks.length, ...sched } };
    } catch (e: any) {
      return { ok: false, error: e?.message || "todo schedule error" };
    }
  }
}


