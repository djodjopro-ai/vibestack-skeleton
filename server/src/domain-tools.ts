import Anthropic from "@anthropic-ai/sdk";
import { readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { FsProxy, ConfirmFn } from "./core-tools.js";

// ── Domain tool plugin contract ────────────────────────────
// A domain tool is a single .ts file in `server/src/domain-tools/`
// that exports `definition` (Anthropic.Tool) and `handler`.

export interface DomainToolContext {
  userId: string;
  workingDir: string | null;
  fsProxy: FsProxy;
  confirmFn?: ConfirmFn;
  source?: "app" | "telegram";
}

export type DomainToolHandler = (
  input: Record<string, unknown>,
  ctx: DomainToolContext,
) => Promise<string>;

export interface DomainTool {
  definition: Anthropic.Tool;
  handler: DomainToolHandler;
}

// ── Registry ───────────────────────────────────────────────

const registry = new Map<string, DomainToolHandler>();
const definitions: Anthropic.Tool[] = [];

export function registerDomainTool(tool: DomainTool): void {
  const name = tool.definition.name;
  if (registry.has(name)) {
    console.warn(`[domain-tools] Skipping '${name}': already registered`);
    return;
  }
  registry.set(name, tool.handler);
  definitions.push(tool.definition);
}

export function getDomainToolDefinitions(): Anthropic.Tool[] {
  return definitions;
}

export function hasDomainTool(name: string): boolean {
  return registry.has(name);
}

export async function executeDomainTool(
  name: string,
  input: Record<string, unknown>,
  ctx: DomainToolContext,
): Promise<string> {
  const handler = registry.get(name);
  if (!handler) return JSON.stringify({ ok: false, error: `Unknown domain tool: ${name}` });
  return handler(input, ctx);
}

// ── Auto-loader ────────────────────────────────────────────
// Scans `server/src/domain-tools/` on boot and imports every .ts
// file that exports { definition, handler }. Call this once during
// server startup, before the agent reads the tool list.

export async function loadDomainTools(dir?: string): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const toolsDir = dir || join(here, "domain-tools");
  if (!existsSync(toolsDir)) return;

  let entries: string[];
  try {
    entries = readdirSync(toolsDir).filter((f) => (f.endsWith(".ts") || f.endsWith(".js")) && !f.startsWith("."));
  } catch (err) {
    console.warn("[domain-tools] failed to read dir:", err);
    return;
  }

  for (const file of entries) {
    const abs = join(toolsDir, file);
    try {
      const mod = await import(abs);
      const def = mod.definition as Anthropic.Tool | undefined;
      const handler = mod.handler as DomainToolHandler | undefined;
      if (!def?.name || typeof handler !== "function") {
        console.warn(`[domain-tools] ${file}: missing definition/handler export`);
        continue;
      }
      registerDomainTool({ definition: def, handler });
      console.log(`[domain-tools] loaded ${def.name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[domain-tools] failed to load ${file}: ${msg}`);
    }
  }
}
