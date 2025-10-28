import ts from "typescript";
import { ToolAdapter, ToolInput, ToolOutput, ToolSpec } from "../ToolTypes";

const spec: ToolSpec = {
  id: "ts.typecheck.project",
  title: "TypeScript Typecheck (Project/Globs)",
  description: "Run TypeScript typecheck for the workspace or selected globs; returns diagnostics count and messages.",
  tags: ["ts","typecheck","quality"],
  sideEffects: "read",
  risk: "low",
};

export class TsTypecheckProjectAdapter implements ToolAdapter {
  spec = spec;
  async execute(input: ToolInput, ctx: { workspaceDir?: string }): Promise<ToolOutput> {
    try {
      const root = ctx.workspaceDir || process.cwd();
      const patterns: string[] = Array.isArray((input as any)?.globs) ? (input as any).globs : [];
      const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
      const configFile = configPath ? ts.readConfigFile(configPath, ts.sys.readFile) : { config: {} as any };
      const parsed = ts.parseJsonConfigFileContent(configFile.config || {}, ts.sys, root, {}, configPath || "tsconfig.json");
      const fileNames = patterns.length ? parsed.fileNames.filter(f => patterns.some(g => f.includes(g))) : parsed.fileNames;
      const program = ts.createProgram(fileNames, parsed.options);
      const diagnostics = ts.getPreEmitDiagnostics(program);
      const formatted = diagnostics.slice(0, 200).map(d => ({
        file: d.file?.fileName ? d.file.fileName.replace(root + "/", "") : undefined,
        message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
        code: d.code,
        category: ts.DiagnosticCategory[d.category],
        line: d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : undefined
      }));
      return { ok: true, data: { count: diagnostics.length, diagnostics: formatted } };
    } catch (e: any) {
      return { ok: false, error: e?.message || "typecheck error" };
    }
  }
}


