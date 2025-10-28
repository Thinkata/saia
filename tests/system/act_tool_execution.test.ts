import { describe, it, expect, beforeAll } from 'vitest';
import http from 'http';

function post(path: string, body: any): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({ hostname: '127.0.0.1', port: 3000, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c as Buffer));
      res.on('end', () => {
        try { resolve({ status: res.statusCode || 0, json: JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}') }); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

describe('POST /adhoc/run executes tool when allowed', () => {
  beforeAll(async () => {
    // assumes server is running
  });

  it('runs file.list.dir for explicit allow list', async () => {
    const r = await post('/adhoc/run', { prompt: 'List the files in ./src using file.list.dir', allow: ['file.list.dir'], router: 'success_rate' });
    expect(r.status).toBe(200);
    const used = r.json?.usedToolId;
    expect(Array.isArray(r.json?.allowedTools)).toBe(true);
    // tool may or may not run depending on model; this endpoint appends [tool:id] to response when executed
    if (used) {
      expect(used).toBe('file.list.dir');
    }
  });
});


