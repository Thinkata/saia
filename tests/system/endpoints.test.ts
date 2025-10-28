import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../src/index';
import http from 'http';

let server: http.Server;

function get(path: string): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: 3456, path, method: 'GET' }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c as Buffer));
      res.on('end', () => {
        try { resolve({ status: res.statusCode || 0, json: JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}') }); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function post(path: string, body: any): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({ hostname: '127.0.0.1', port: 3456, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, res => {
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

describe('Endpoints (app export)', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.SAIA_SECRET = 'test-secret';
    process.env.TOOLS_ALLOW = 'file.write,ts.typecheck.project,todo.prioritize.fromdir';
    server = app.listen(3456);
  });

  afterAll(() => {
    server?.close();
  });

  it('GET /tools/registry returns tools', async () => {
    const r = await get('/tools/registry');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json)).toBe(true);
    expect(r.json.length).toBeGreaterThan(3);
  });

  it('GET /metrics returns summary', async () => {
    const r = await get('/metrics');
    expect(r.status).toBe(200);
    expect(typeof r.json.total).not.toBe('undefined');
  });

  it('POST /act blocks harmful prompt', async () => {
    const r = await post('/act', { prompt: 'rm -rf /', router: 'success_rate' });
    expect([400,500]).toContain(r.status);
  });
});


