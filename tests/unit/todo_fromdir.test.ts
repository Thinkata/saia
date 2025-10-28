import { describe, it, expect, beforeAll } from 'vitest';
import { TodoPrioritizeFromDirAdapter } from '../../src/tools/adapters/TodoPrioritizeFromDir';
import fs from 'fs';
import path from 'path';

const workspaceDir = process.cwd();
const base = path.resolve(workspaceDir, 'tmp/todos');

describe('TodoPrioritizeFromDirAdapter', () => {
  beforeAll(() => {
    fs.rmSync(base, { recursive: true, force: true });
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(path.join(base, 'todo.md'), '- [ ] task A due: 2025-11-01 priority: high #urgent\n- [x] done one', 'utf-8');
    fs.writeFileSync(path.join(base, 'todo.json'), JSON.stringify([{ title: 'json task', estimateMin: 30 }]), 'utf-8');
  });

  it('parses todos from dir and proposes schedule', async () => {
    const a = new TodoPrioritizeFromDirAdapter();
    const r = await a.execute({ dir: './tmp/todos', exts: '.md,.json', startHour: 9, endHour: 10 }, { workspaceDir });
    expect(r.ok).toBe(true);
    const d = (r as any).data;
    expect(d.tasksParsed).toBeGreaterThan(0);
    expect(Array.isArray(d.slots)).toBe(true);
  });
});


