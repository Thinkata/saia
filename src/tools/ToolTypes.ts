export type ToolInput = Record<string, unknown>;

export type ToolOutput = {
  ok: boolean;
  data?: unknown;
  error?: string;
  latencyMs?: number;
};

export interface ToolSpec {
  id: string; // e.g., 'ts.transpile', 'search.regex'
  title: string;
  description: string;
  schema?: Record<string, unknown>; // optional JSON schema for input
  tags: string[];
  sideEffects: "none" | "read" | "write" | "network";
  risk: "low" | "med" | "high";
}

export interface ToolAdapter {
  spec: ToolSpec;
  execute(input: ToolInput, ctx: { jobId?: string; workspaceDir?: string }): Promise<ToolOutput>;
}


