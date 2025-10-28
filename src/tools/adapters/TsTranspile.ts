import ts from "typescript";
import { ToolAdapter, ToolInput, ToolOutput, ToolSpec } from "../ToolTypes";

const spec: ToolSpec = {
  id: "ts.transpile",
  title: "TypeScript Transpile",
  description: "Transpile a small TypeScript snippet to JavaScript using TypeScript compiler API.",
  tags: ["ts", "code", "compile"],
  sideEffects: "none",
  risk: "low",
};

export class TsTranspileAdapter implements ToolAdapter {
  spec = spec;

  async execute(input: ToolInput): Promise<ToolOutput> {
    try {
      const code = String((input as any)?.code || "");
      const jsx = String((input as any)?.jsx || "");
      if (!code || code.length > 10000) return { ok: false, error: "invalid code length" };
      const compilerOptions: ts.CompilerOptions = { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext };
      if (jsx === 'react') compilerOptions.jsx = ts.JsxEmit.React;
      const out = ts.transpileModule(code, { compilerOptions });
      return { ok: true, data: { js: out.outputText, diagnostics: out.diagnostics?.length ? out.diagnostics : undefined } };
    } catch (e: any) {
      return { ok: false, error: e?.message || "transpile error" };
    }
  }
}


