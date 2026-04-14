import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db, users } from "./db.js";
import { extractText, getFormatFromPath } from "./utils/document-extract.js";
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { resolve, normalize, dirname } from "path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── Filesystem safety ──────────────────────────────────────
// The "working directory" is a per-user path the desktop app picks. All
// fs_* tools enforce that resolved paths stay inside it.

function getWorkingDirectory(userId: string): string | null {
  const row = db.select({ workingDirectory: users.workingDirectory })
    .from(users).where(eq(users.id, userId)).get();
  return row?.workingDirectory || null;
}

function resolveUserPath(userId: string, relativePath: string): string | null {
  const workDir = getWorkingDirectory(userId);
  if (!workDir) return null;
  const resolved = resolve(workDir, relativePath);
  const normalized = normalize(resolved);
  const normalizedWorkDir = normalize(workDir);
  if (normalized !== normalizedWorkDir && !normalized.startsWith(normalizedWorkDir + "/")) return null;
  return normalized;
}

// Shell allowlist — no curl/wget/nc/ssh.
const SHELL_ALLOWLIST = new Set([
  "npm", "npx", "pnpm", "yarn",
  "node", "tsx", "tsc",
  "git",
  "ls", "cat", "head", "tail", "wc", "grep", "find", "file", "stat",
  "echo", "pwd", "which",
]);

function safeSubprocessEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH || "/usr/bin:/bin:/usr/local/bin",
    HOME: process.env.HOME || "/tmp",
    LANG: process.env.LANG || "en_US.UTF-8",
    NODE_ENV: process.env.NODE_ENV || "development",
    TERM: "dumb",
  };
}

// ── File-size gate ─────────────────────────────────────────
// Hard ceiling: 350 MB. Above soft threshold, ask user to confirm.
const FS_HARD_MAX_BYTES = 350 * 1024 * 1024;
const FS_CONFIRM_TEXT_BYTES = 2_700_000;
const FS_CONFIRM_BINARY_BYTES = 7_500_000;

function fmtMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export type ConfirmFn = (userId: string, toolName: string, reason: string) => Promise<boolean>;

async function checkFileSizeGate(
  absPath: string,
  isBinary: boolean,
  userId: string,
  confirmFn?: ConfirmFn,
): Promise<string | null> {
  let size = 0;
  try { size = statSync(absPath).size; } catch { return null; }

  if (size > FS_HARD_MAX_BYTES) {
    return JSON.stringify({
      ok: false,
      error: `File too large (${fmtMB(size)}). Maximum is 350 MB per read.`,
      bytes: size,
    });
  }

  const threshold = isBinary ? FS_CONFIRM_BINARY_BYTES : FS_CONFIRM_TEXT_BYTES;
  if (size > threshold && confirmFn) {
    const reason = `This file is large (${fmtMB(size)}). Reading it will consume a significant chunk of your token budget. Continue?`;
    const allowed = await confirmFn(userId, "fs_read_file", reason);
    if (!allowed) {
      return JSON.stringify({
        ok: false,
        error: "User declined: file too large. Ask them to narrow the request.",
        bytes: size,
      });
    }
  }
  return null;
}

function truncateResult(result: string, maxLen = 4000): string {
  if (result.length <= maxLen) return result;
  return result.slice(0, maxLen) + "\n...[truncated]";
}

// ── Tool definitions ───────────────────────────────────────

export const CORE_TOOLS: Anthropic.Tool[] = [
  {
    name: "fs_list_files",
    description: "List files in the user's working directory.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Relative path within working directory (optional)" },
      },
      required: [],
    },
  },
  {
    name: "fs_read_file",
    description: "Read a file from the working dir. Auto-extracts text from PDF/DOCX/XLSX/PPTX/CSV/code.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Relative path to the file" },
      },
      required: ["path"],
    },
  },
  {
    name: "fs_write_file",
    description: "Write or create a file in the user's working directory.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Relative path to the file" },
        content: { type: "string", description: "File content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "fs_move_file",
    description: "Move or rename a file in the working directory.",
    input_schema: {
      type: "object" as const,
      properties: {
        from_path: { type: "string", description: "Current relative path" },
        to_path: { type: "string", description: "New relative path" },
      },
      required: ["from_path", "to_path"],
    },
  },
  {
    name: "fs_copy_file",
    description: "Copy a file in the working directory.",
    input_schema: {
      type: "object" as const,
      properties: {
        from_path: { type: "string", description: "Source relative path" },
        to_path: { type: "string", description: "Destination relative path" },
      },
      required: ["from_path", "to_path"],
    },
  },
  {
    name: "fs_delete_file",
    description: "Delete a file from the working directory.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Relative path to the file" },
      },
      required: ["path"],
    },
  },
  {
    name: "fs_create_directory",
    description: "Create a directory in the working directory.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Relative path to the directory" },
      },
      required: ["path"],
    },
  },
  {
    name: "shell",
    description: "Run an allowlisted shell command. Allowed binaries: npm/npx/node/tsx/tsc/git + common read-only utils. No curl/wget/ssh.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: { type: "string", description: "Binary to run (must be on allowlist)" },
        args: { type: "array", items: { type: "string" }, description: "Arguments" },
        cwd: { type: "string", description: "Working directory (optional)" },
        timeoutMs: { type: "number", description: "Timeout in ms, capped at 300000" },
      },
      required: ["command"],
    },
  },
  {
    name: "run_typecheck",
    description: "Run `tsc --noEmit` against the app or server workspace. Returns errorCount + output.",
    input_schema: {
      type: "object" as const,
      properties: {
        target: { type: "string", enum: ["app", "server"], description: "Which workspace to typecheck" },
      },
      required: ["target"],
    },
  },
];

// ── Tool execution ─────────────────────────────────────────
// Tools that mutate data; refuse these from non-interactive sources.
export const TELEGRAM_BLOCKED_TOOLS = new Set<string>([
  "shell",
  "fs_write_file",
  "fs_move_file",
  "fs_delete_file",
  "fs_create_directory",
]);

export type FsProxy = (command: string, args: Record<string, unknown>) => Promise<unknown>;

export async function executeCoreTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  userId: string,
  fsProxy: FsProxy,
  confirmFn?: ConfirmFn,
  source?: "app" | "telegram",
  repoRoot?: string,
): Promise<string> {
  if (source === "telegram" && TELEGRAM_BLOCKED_TOOLS.has(toolName)) {
    return JSON.stringify({
      ok: false,
      error: "This action mutates data and must be confirmed in the desktop app.",
    });
  }

  switch (toolName) {
    case "fs_list_files": {
      const listPath = (toolInput.path as string) || ".";
      const resolved = resolveUserPath(userId, listPath);
      if (resolved && existsSync(resolved)) {
        try {
          const entries = readdirSync(resolved, { withFileTypes: true });
          return truncateResult(JSON.stringify(entries.map((e) => ({
            name: e.name,
            isDirectory: e.isDirectory(),
          }))));
        } catch {
          // fall through to proxy
        }
      }
      const result = await fsProxy("list_files", toolInput);
      return truncateResult(JSON.stringify(result));
    }

    case "fs_read_file": {
      const filePath = toolInput.path as string;
      const format = getFormatFromPath(filePath);
      const FS_READ_MAX = 50000;
      const resolved = resolveUserPath(userId, filePath);
      if (resolved && existsSync(resolved)) {
        const isBinary = !!(format && format !== "text" && format !== "csv");
        const gate = await checkFileSizeGate(resolved, isBinary, userId, confirmFn);
        if (gate) return gate;
        try {
          if (isBinary) {
            const buffer = readFileSync(resolved);
            const result = await extractText(buffer, resolved);
            const header = `[${result.format.toUpperCase()} document${result.pageCount ? `, ${result.pageCount} pages` : ""}]\n\n`;
            return truncateResult(header + result.text, FS_READ_MAX);
          }
          return truncateResult(readFileSync(resolved, "utf-8"), FS_READ_MAX);
        } catch (err) {
          console.warn("[core-tools] direct read failed, falling back to proxy:", err);
        }
      }
      if (format && format !== "text" && format !== "csv") {
        const base64Data = (await fsProxy("read_binary_file", { path: filePath })) as string;
        const buffer = Buffer.from(base64Data, "base64");
        const result = await extractText(buffer, filePath);
        const header = `[${result.format.toUpperCase()} document${result.pageCount ? `, ${result.pageCount} pages` : ""}]\n\n`;
        return truncateResult(header + result.text, FS_READ_MAX);
      }
      const result = await fsProxy("read_file", toolInput);
      return truncateResult(typeof result === "string" ? result : JSON.stringify(result), FS_READ_MAX);
    }

    case "fs_write_file":
    case "fs_move_file":
    case "fs_copy_file":
    case "fs_delete_file":
    case "fs_create_directory": {
      const result = await fsProxy(toolName.replace("fs_", ""), toolInput);
      return truncateResult(JSON.stringify(result));
    }

    case "shell": {
      const command = toolInput.command as string;
      const args = Array.isArray(toolInput.args) ? (toolInput.args as string[]) : [];
      const root = repoRoot || process.cwd();
      const cwd = (toolInput.cwd as string) || root;
      const requestedTimeout = typeof toolInput.timeoutMs === "number" ? toolInput.timeoutMs : 60000;
      const timeout = Math.min(Math.max(requestedTimeout, 1000), 300000);

      const binBasename = command.split("/").pop() || command;
      if (!SHELL_ALLOWLIST.has(binBasename)) {
        return JSON.stringify({
          ok: false,
          error: `Command '${binBasename}' not allowed. Allowed: ${[...SHELL_ALLOWLIST].join(", ")}`,
        });
      }

      const cwdResolved = resolve(cwd);
      if (cwdResolved !== root && !cwdResolved.startsWith(root + "/")) {
        return JSON.stringify({ ok: false, error: "cwd outside repo root" });
      }

      try {
        const { stdout, stderr } = await execFileAsync(command, args, {
          cwd: cwdResolved,
          timeout,
          maxBuffer: 20 * 1024 * 1024,
          env: safeSubprocessEnv(),
        });
        return JSON.stringify({
          ok: true, exitCode: 0,
          stdout: stdout.slice(0, 20000),
          stderr: stderr.slice(0, 20000),
        });
      } catch (err: unknown) {
        const e = err as { code?: number | string; stdout?: string; stderr?: string; message?: string; killed?: boolean };
        return JSON.stringify({
          ok: false,
          exitCode: typeof e.code === "number" ? e.code : -1,
          killed: !!e.killed,
          stdout: (e.stdout || "").slice(0, 20000),
          stderr: (e.stderr || e.message || "").slice(0, 20000),
        });
      }
    }

    case "run_typecheck": {
      const target = String(toolInput.target || "").toLowerCase();
      if (target !== "app" && target !== "server") {
        return JSON.stringify({ ok: false, error: "target must be 'app' or 'server'" });
      }
      const root = repoRoot || process.cwd();
      const cwd = `${root}/${target}`;
      const tsc = `${cwd}/node_modules/.bin/tsc`;
      try {
        await execFileAsync(tsc, ["--noEmit", "-p", cwd], { cwd: root, maxBuffer: 10 * 1024 * 1024, timeout: 120_000 });
        return JSON.stringify({ ok: true, target, errors: 0 });
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; code?: number };
        const output = ((err.stdout || "") + (err.stderr || "")).slice(0, 10000);
        const errorCount = (output.match(/error TS\d+/g) || []).length;
        return JSON.stringify({ ok: false, target, errorCount, exitCode: err.code ?? -1, output });
      }
    }
  }

  return JSON.stringify({ ok: false, error: `Unknown core tool: ${toolName}` });
}

// Kept as an export because the mkdir/writeFile re-exports are used by domain helpers.
export { writeFileSync, mkdirSync, dirname };
