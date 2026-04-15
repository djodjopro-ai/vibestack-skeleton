import Anthropic from "@anthropic-ai/sdk";
import { eq, desc } from "drizzle-orm";
import { db, users, chatMessages } from "./db.js";
import { v4 as uuid } from "uuid";
import { CORE_TOOLS, executeCoreTool, TELEGRAM_BLOCKED_TOOLS, type ConfirmFn, type FsProxy } from "./core-tools.js";
import {
  getDomainToolDefinitions,
  executeDomainTool,
  hasDomainTool,
} from "./domain-tools.js";
import { emitToUser } from "./websocket.js";

const SONNET_MODEL = "claude-sonnet-4-6";
if (SONNET_MODEL.includes("[1m]") || process.env.CLAUDE_MODEL?.includes("[1m]")) {
  throw new Error("1M-context Sonnet variant is not permitted — too expensive");
}

const client = new Anthropic();
const MAX_TOOL_ITERATIONS = 6;
const HISTORY_LIMIT = 10;

// ── Destructive-op confirmation ──────────────────────────

type PendingConfirm = {
  userId: string;
  resolve: (allow: boolean) => void;
  timer: NodeJS.Timeout;
};

export const pendingConfirms = new Map<string, PendingConfirm>();

export function resolveConfirm(requestId: string, allow: boolean, userId: string): boolean {
  const entry = pendingConfirms.get(requestId);
  if (!entry) return false;
  if (entry.userId !== userId) return false;
  clearTimeout(entry.timer);
  pendingConfirms.delete(requestId);
  entry.resolve(allow);
  return true;
}

const defaultConfirmFn: ConfirmFn = (userId, toolName, reason) => {
  for (const [oldId, entry] of pendingConfirms.entries()) {
    if (entry.userId === userId) {
      clearTimeout(entry.timer);
      pendingConfirms.delete(oldId);
      entry.resolve(false);
    }
  }
  const requestId = uuid();
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      if (pendingConfirms.delete(requestId)) resolve(false);
    }, 60_000);
    pendingConfirms.set(requestId, { userId, resolve, timer });
    emitToUser(userId, "confirm_required", { requestId, toolName, reason });
  });
};

// No-op FS proxy. A real desktop integration would route these through
// the Tauri WebSocket bridge; the skeleton falls back to server-side
// filesystem access via core-tools' own resolveUserPath logic.
const noopFsProxy: FsProxy = async () => ({ ok: false, error: "fs bridge not wired in skeleton" });

// ── Chat context ─────────────────────────────────────────

interface UserContext {
  name: string;
}

function buildSystemPrompt(ctx: UserContext): string {
  return `You are an AI assistant for ${ctx.name}.

Be concise and helpful. Use tools when they help the user directly.

## Honesty Rules (non-negotiable)
1. Never claim success without a successful tool result.
2. If a tool returns an error, report it verbatim — do not fabricate success.
3. Verify edits with run_typecheck before claiming completion.`;
}

async function getUserContext(userId: string): Promise<UserContext | null> {
  const row = db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!row) return null;
  return { name: row.name };
}

async function getChatHistory(userId: string, limit = HISTORY_LIMIT) {
  const messages = db
    .select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.userId, userId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit)
    .all();
  return messages.reverse() as Array<{ role: "user" | "assistant"; content: string }>;
}

function saveMessage(userId: string, role: "user" | "assistant", content: string) {
  db.insert(chatMessages)
    .values({ id: uuid(), userId, role, content, createdAt: new Date() })
    .run();
}

export async function chat(
  userId: string,
  userMessage: string,
  source: "app" | "telegram" = "app",
): Promise<string> {
  const ctx = await getUserContext(userId);
  if (!ctx) throw new Error("user_not_found");

  saveMessage(userId, "user", userMessage);
  const history = await getChatHistory(userId);

  const tools = [...CORE_TOOLS, ...getDomainToolDefinitions()].filter((t) =>
    source === "telegram" ? !TELEGRAM_BLOCKED_TOOLS.has(t.name) : true,
  );

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  let finalText = "";

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: SONNET_MODEL,
      max_tokens: 4096,
      system: buildSystemPrompt(ctx),
      tools,
      messages,
    });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );
    finalText = textBlocks.map((b) => b.text).join("\n").trim();

    if (toolUses.length === 0 || response.stop_reason !== "tool_use") break;

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      try {
        const input = tu.input as Record<string, unknown>;
        let result: string;
        if (hasDomainTool(tu.name)) {
          result = await executeDomainTool(tu.name, input, {
            userId,
            workingDir: null,
            fsProxy: noopFsProxy,
            confirmFn: defaultConfirmFn,
            source,
          });
        } else {
          result = await executeCoreTool(
            tu.name,
            input,
            userId,
            noopFsProxy,
            defaultConfirmFn,
            source,
          );
        }
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: `Error: ${msg}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  saveMessage(userId, "assistant", finalText);
  return finalText;
}
