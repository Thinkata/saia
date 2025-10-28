import { ToolAdapter, ToolInput, ToolOutput, ToolSpec } from "../ToolTypes";

const spec: ToolSpec = {
  id: "schedule.prioritize",
  title: "Prioritize Schedule (Today)",
  description: "Rank tasks by due/priority/estimate and fit into today's capacity.",
  tags: ["schedule","prioritize","todo"],
  sideEffects: "none",
  risk: "low",
};

type Task = { title: string; done?: boolean; due?: string; priority?: string; estimateMin?: number; tags?: string[]; blockedBy?: string[] };

export class SchedulePrioritizeAdapter implements ToolAdapter {
  spec = spec;
  async execute(input: ToolInput): Promise<ToolOutput> {
    try {
      const tasks: Task[] = Array.isArray((input as any)?.tasks) ? (input as any).tasks : [];
      const now = new Date();
      const startHour = Number((input as any)?.startHour ?? 9);
      const endHour = Number((input as any)?.endHour ?? 17);
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
      return { ok: true, data: { slots, leftover, usedMin: used, capacityMin: capMin } };
    } catch (e: any) {
      return { ok: false, error: e?.message || "schedule error" };
    }
  }
}


