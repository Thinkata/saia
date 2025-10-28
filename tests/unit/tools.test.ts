import { describe, it, expect } from 'vitest';
import { TsTranspileAdapter } from '../../src/tools/adapters/TsTranspile';
import { SearchRegexAdapter } from '../../src/tools/adapters/SearchRegex';
import { FileListDirAdapter } from '../../src/tools/adapters/FileListDir';
import { FileReadRangeAdapter } from '../../src/tools/adapters/FileReadRange';
import { WriteFileAdapter } from '../../src/tools/adapters/WriteFile';
import { DataParseTodoAdapter } from '../../src/tools/adapters/DataParseTodo';
import { SchedulePrioritizeAdapter } from '../../src/tools/adapters/SchedulePrioritize';

import fs from 'fs';
import path from 'path';

const workspaceDir = process.cwd();

describe('Tool adapters', () => {
  it('ts.transpile transpiles simple code', async () => {
    const a = new TsTranspileAdapter();
    const o = await a.execute({ code: 'const x:number=1; export const y=x+1;' });
    expect(o.ok).toBe(true);
    expect(String((o as any).data?.js || '')).toContain('export const y');
  });

  it('file.write writes and append works', async () => {
    const a = new WriteFileAdapter();
    const file = 'tmp/test_file.txt';
    const full = path.resolve(workspaceDir, file);
    try { fs.rmSync(path.dirname(full), { recursive: true, force: true }); } catch {}
    const w1 = await a.execute({ file, content: 'hello' }, { workspaceDir });
    expect(w1.ok).toBe(true);
    const w2 = await a.execute({ file, content: ' world', append: true }, { workspaceDir });
    expect(w2.ok).toBe(true);
    const content = fs.readFileSync(full, 'utf-8');
    expect(content).toBe('hello world');
  });

  it('file.read.range reads bytes safely', async () => {
    const fr = new FileReadRangeAdapter();
    const r = await fr.execute({ file: 'tmp/test_file.txt', start: 0, bytes: 5 }, { workspaceDir });
    expect(r.ok).toBe(true);
    expect((r as any).data?.content).toBe('hello');
  });

  it('file.list.dir lists files with filter', async () => {
    const fl = new FileListDirAdapter();
    const r = await fl.execute({ dir: './tmp', exts: '.txt' }, { workspaceDir });
    expect(r.ok).toBe(true);
    const files = (r as any).data.files as Array<{file:string}>;
    expect(Array.isArray(files)).toBe(true);
    expect(files.some(f => f.file.endsWith('test_file.txt'))).toBe(true);
  });

  it('search.regex finds a known string', async () => {
    const sr = new SearchRegexAdapter();
    const r = await sr.execute({ pattern: 'Write File', glob: 'WriteFile' }, { workspaceDir });
    expect(r.ok).toBe(true);
    expect(((r as any).data?.count || 0)).toBeGreaterThan(0);
  });

  it('data.parse.todo parses markdown tasks', async () => {
    const dp = new DataParseTodoAdapter();
    const text = '- [ ] ship feature due: 2025-10-30 priority: high #urgent\n- [x] done task';
    const r = await dp.execute({ content: text });
    expect(r.ok).toBe(true);
    const tasks = (r as any).data?.tasks || [];
    expect(tasks.length).toBe(2);
    expect(tasks[0].tags).toContain('urgent');
  });

  it('schedule.prioritize ranks and fits tasks into today', async () => {
    const sp = new SchedulePrioritizeAdapter();
    const tasks = [
      { title: 'urgent small', estimateMin: 15, tags: ['urgent'] },
      { title: 'big later', estimateMin: 240 }
    ];
    const r = await sp.execute({ tasks, startHour: 9, endHour: 10 });
    expect(r.ok).toBe(true);
    const slots = (r as any).data?.slots || [];
    expect(slots.length).toBeGreaterThan(0);
  });
});


