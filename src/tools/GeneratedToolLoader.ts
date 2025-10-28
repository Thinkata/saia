import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { ToolRegistry } from "./ToolRegistry";

export async function loadGeneratedTools(registry: ToolRegistry): Promise<void> {
  try {
    const distDir = path.resolve(process.cwd(), "dist/tools/generated");
    if (!fs.existsSync(distDir)) return;
    for (const name of fs.readdirSync(distDir)) {
      if (!/\.js$/.test(name)) continue;
      const mod = await import(pathToFileURL(path.join(distDir, name)).href);
      const adapter = mod?.default || mod?.adapter;
      if (adapter && typeof adapter.execute === "function" && adapter.spec?.id) {
        registry.register(adapter);
      }
    }
  } catch {}
}


