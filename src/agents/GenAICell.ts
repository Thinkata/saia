import OpenAI from "openai";

export interface GenAICellConfig {
  id: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  memorySize?: number;
  capabilities?: string[]; // tags like "creative", "coder", "analyst"
}

import { canonicalize, tokenizeNormalized, jaccardIndex, fuzzyStringSim } from "../utils/text";

export class GenAICell {
  public readonly id: string;
  private readonly systemPrompt: string;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly memorySize: number;
  private readonly memory: string[] = [];
  private readonly openaiApiKey: string | undefined;
  private readonly openaiModel: string;
  private openaiClient: OpenAI | null;
  private readonly openaiBaseUrl: string | undefined;
  private capabilities: string[];

  constructor(config: GenAICellConfig) {
    this.id = config.id;
    this.systemPrompt = config.systemPrompt ?? "You are a helpful AI assistant.";
    this.temperature = config.temperature ?? 0.6;
    this.maxTokens = config.maxTokens ?? 300;
    this.memorySize = Math.max(0, config.memorySize ?? 6);
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.openaiModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
    this.openaiBaseUrl = process.env.OPENAI_ENDPOINT?.trim() || undefined;
    this.openaiClient = this.openaiApiKey
      ? new OpenAI({ apiKey: this.openaiApiKey, baseURL: this.openaiBaseUrl })
      : null;
    this.capabilities = (config.capabilities ?? []).map(t => t.toLowerCase());
  }

  private pushMemory(turn: string): void {
    this.memory.push(turn);
    if (this.memory.length > this.memorySize) {
      this.memory.shift();
    }
  }

  async act(input: string): Promise<string> {
    // Ephemeral memory keeps short context within the process lifetime
    this.pushMemory(`user: ${input}`);

    if (!this.openaiClient) {
      const stub = `STUB(${this.id}): ${input}`;
      this.pushMemory(`assistant: ${stub}`);
      return stub;
    }

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: this.systemPrompt },
    ];

    // Include short ephemeral memory
    for (const m of this.memory) {
      if (m.startsWith("user:")) messages.push({ role: "user", content: m.slice(5).trim() });
      else if (m.startsWith("assistant:")) messages.push({ role: "assistant", content: m.slice(10).trim() });
    }

    // Always end with current user input and request a compact domain suggestion
    const classifyHint = "\n\nAt the end, output a JSON object with keys domain (1-2 words) and tags (3-6 short tags).";
    messages.push({ role: "user", content: input + classifyHint });

    const completion = await this.openaiClient.chat.completions.create({
      model: this.openaiModel,
      messages,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
    });

    const text = completion.choices?.[0]?.message?.content?.trim() ?? "";
    const responseText = text.length > 0 ? text : "(no content)";
    this.pushMemory(`assistant: ${responseText}`);
    return responseText;
  }

  matchTags(input: string): number {
    if (!this.capabilities.length) return 0;
    const inTokens = new Set(tokenizeNormalized(input));
    const tagTokens = new Set<string>();
    for (const tag of this.capabilities) {
      const toks = tokenizeNormalized(tag);
      for (const t of toks) tagTokens.add(t);
    }
    const j = jaccardIndex(inTokens, tagTokens);
    // also consider best fuzzy match between any tag token and any input token
    let bestFuzzy = 0;
    for (const t of tagTokens) for (const w of inTokens) bestFuzzy = Math.max(bestFuzzy, fuzzyStringSim(t, w));
    // blend to 0..1
    return Math.min(1, 0.7 * j + 0.3 * bestFuzzy);
  }

  adjustParameters(confidence: number, bounds?: { minTemp?: number; maxTemp?: number }): void {
    const minT = bounds?.minTemp ?? 0.1;
    const maxT = bounds?.maxTemp ?? 0.9;
    // Map confidence (0..1) to temperature within bounds
    // Use capabilities to determine temperature adjustment rather than hard-coded cell IDs
    const isPrecisionFocused = this.capabilities.some(cap => ['code', 'analysis', 'technical'].includes(cap.toLowerCase()));
    const base = isPrecisionFocused ? maxT - confidence * (maxT - minT) : minT + confidence * (maxT - minT);
    const clamped = Math.max(minT, Math.min(maxT, Number(base.toFixed(2))));
    // Note: adjusting a readonly would violate typing; keep internal mutable values separate if needed
    (this as any).temperature = clamped;
  }
}


