export type ActResponse = {
  requestId: string;
  router: string;
  cellId: string;
  response: string;
  metrics?: { latencyMs?: number; success?: boolean; timestamp?: string };
};

export class ExperimentRunner {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    const port = Number(process.env.PORT || 3000);
    this.baseUrl = baseUrl ?? `http://127.0.0.1:${port}`;
  }

  async postJSON<T = any>(url: string, body: any): Promise<T> {
    const res = await fetch(`${this.baseUrl}${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    });
    // Never throw so experiment loops continue on policy-fail (HTTP 400)
    const text = await res.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
    (data || {}).status = res.status;
    return data as T;
  }

  async getJSON<T = any>(url: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${url}`);
    const text = await res.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
    (data || {}).status = res.status;
    return data as T;
  }

  async act(prompt: string, router: string = "rl_bandit", tools?: string[]): Promise<ActResponse> {
    return await this.postJSON<ActResponse>(`/act`, { prompt, router, tools });
  }

  async synthesize(): Promise<any> {
    return await this.postJSON(`/evolution/synthesize`, {});
  }

  async evolve(): Promise<any> {
    return await this.postJSON(`/evolve`, {});
  }

  async getMetrics(): Promise<any> {
    return await this.getJSON(`/metrics/detailed`);
  }

  async getEvolutionLogs(limit = 200): Promise<any> {
    return await this.getJSON(`/evolution/logs?limit=${limit}`);
  }

  async getActions(limit = 200): Promise<any> {
    return await this.getJSON(`/actions/sample?limit=${limit}`);
  }

  async sleep(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }
}


