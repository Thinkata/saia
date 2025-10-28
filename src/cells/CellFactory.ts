import { GenAICell, GenAICellConfig } from "../agents/GenAICell";

export type DomainSignature = {
  id: string;            // stable id e.g. domain-creative
  tags: string[];        // capabilities to match prompts
  temperature: number;   // initial temperature
  systemPrompt: string;  // role prompt
};

export class CellFactory {
  static createFromDomain(sig: DomainSignature): GenAICell {
    // Add tool usage instructions to all synthesized cells
    const toolInstructions = " You are tool-aware. When a tool is applicable (file.list.dir, search.regex, ts.transpile, file.write), output ONLY JSON in the format {\"tool\":{\"id\":\"tool-name\",\"input\":{...}}} with the correct parameters, no extra text. Use: file.list.dir(dir), search.regex(pattern, glob), ts.transpile(code), file.write(file, content).";
    
    const config: GenAICellConfig = {
      id: `cell-${sig.id}`,
      systemPrompt: sig.systemPrompt + toolInstructions,
      temperature: sig.temperature,
      capabilities: sig.tags,
    };
    return new GenAICell(config);
  }
}


