import { eq } from "drizzle-orm";
import { db, users } from "./db.js";
import { chat } from "./agent.js";
import { requireTier } from "./subscription.js";

// Grammy's Context type without importing grammy eagerly.
// The real types are resolved when the bot initializes.
type TgCtx = {
  match?: string;
  chat: { id: number | string };
  from?: { username?: string };
  message?: { text?: string };
  reply: (text: string) => Promise<unknown>;
};

type BotHandle = {
  command: (name: string, handler: (ctx: TgCtx) => Promise<void> | void) => void;
  on: (event: string, handler: (ctx: TgCtx) => Promise<void> | void) => void;
  start: () => Promise<void>;
  api: { sendMessage: (chatId: string, text: string) => Promise<unknown> };
};

let bot: BotHandle | null = null;

const TELEGRAM_MAX = 4000;

function splitForTelegram(text: string): string[] {
  if (text.length <= TELEGRAM_MAX) return [text];

  const paragraphs = text.split("\n\n");
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.length > 0) { chunks.push(current); current = ""; }
  };

  for (const para of paragraphs) {
    if (para.length > TELEGRAM_MAX) {
      pushCurrent();
      for (let i = 0; i < para.length; i += TELEGRAM_MAX) {
        chunks.push(para.slice(i, i + TELEGRAM_MAX));
      }
      continue;
    }
    const sep = current.length > 0 ? "\n\n" : "";
    if (current.length + sep.length + para.length > TELEGRAM_MAX) {
      pushCurrent();
      current = para;
    } else {
      current += sep + para;
    }
  }
  pushCurrent();
  return chunks;
}

// ── Command plugin registry ────────────────────────────────
// Domain modules register extra commands (e.g. "/progress", "/due")
// via registerTelegramCommand. Handlers receive the resolved userId
// so they can query their own tables.

type CommandHandler = (ctx: TgCtx, userId: string) => Promise<void>;

interface CommandEntry {
  name: string;
  description: string;
  handler: CommandHandler;
}

const extraCommands: CommandEntry[] = [];

export function registerTelegramCommand(entry: CommandEntry): void {
  extraCommands.push(entry);
}

function userIdFromChat(chatId: string): string | null {
  const row = db.select({ id: users.id })
    .from(users)
    .where(eq(users.telegramChatId, chatId))
    .get();
  return row?.id || null;
}

export async function initTelegram(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === "your-telegram-bot-token") {
    console.log("[Telegram] No bot token set, skipping initialization");
    return;
  }

  try {
    const { Bot } = await import("grammy");
    bot = new Bot(token) as unknown as BotHandle;

    // /start — link Telegram to user account via deep-link API key.
    bot.command("start", async (ctx) => {
      const args = ctx.match;
      if (!args) {
        await ctx.reply("Hi! To link your account, use the deep link from the desktop app settings.");
        return;
      }

      const user = db.select({ id: users.id, name: users.name })
        .from(users).where(eq(users.apiKey, args)).get();

      if (!user) {
        await ctx.reply("Invalid link. Try again from the desktop app.");
        return;
      }

      const chatId = String(ctx.chat.id);
      const username: string | null = ctx.from?.username ? String(ctx.from.username) : null;
      db.update(users)
        .set({ telegramChatId: chatId, telegramUsername: username, updatedAt: new Date() })
        .where(eq(users.id, user.id))
        .run();

      const extraLines = extraCommands.map((c) => `/${c.name} — ${c.description}`).join("\n");
      await ctx.reply(
        `Connected. Hi ${user.name}, I'm your assistant. You can message me anytime.\n` +
        (extraLines ? `${extraLines}\n` : "") +
        `/unlink — disconnect Telegram from account\n/help — show all commands`
      );
    });

    // /unlink — disconnect
    bot.command("unlink", async (ctx) => {
      const chatId = String(ctx.chat.id);
      const user = db.select({ id: users.id })
        .from(users).where(eq(users.telegramChatId, chatId)).get();
      if (!user) { await ctx.reply("No account linked."); return; }
      db.update(users)
        .set({ telegramChatId: null, telegramUsername: null, updatedAt: new Date() })
        .where(eq(users.id, user.id))
        .run();
      await ctx.reply("Disconnected. Relink from the desktop app to reconnect.");
    });

    // /help — list commands
    bot.command("help", async (ctx) => {
      const extraLines = extraCommands.map((c) => `/${c.name} — ${c.description}`).join("\n");
      await ctx.reply(
        "Commands:\n" +
        (extraLines ? `${extraLines}\n` : "") +
        "/unlink — disconnect Telegram from account\n" +
        "/help — this message\n\n" +
        "Or just send me a message and I'll reply as your AI assistant.\n\n" +
        "Note: destructive actions are not available here — use the desktop app."
      );
    });

    // Domain-registered commands
    for (const cmd of extraCommands) {
      bot.command(cmd.name, async (ctx) => {
        const userId = userIdFromChat(String(ctx.chat.id));
        if (!userId) {
          await ctx.reply("Account not linked. Use the deep link from the desktop app.");
          return;
        }
        try {
          await cmd.handler(ctx, userId);
        } catch (err) {
          console.error(`[Telegram] /${cmd.name} error:`, err);
          await ctx.reply("Something went wrong. Try again.");
        }
      });
    }

    // Regular messages → agent
    bot.on("message:text", async (ctx) => {
      const userId = userIdFromChat(String(ctx.chat.id));
      if (!userId) {
        await ctx.reply("Account not linked. Use the deep link from the desktop app.");
        return;
      }

      const gate = requireTier(userId, "pro");
      if (!gate.ok) {
        await ctx.reply("This is a Pro feature. Upgrade in the desktop app.");
        return;
      }

      const text = ctx.message?.text;
      if (!text) return;

      try {
        const response = await chat(userId, text, "telegram");
        for (const chunk of splitForTelegram(response)) await ctx.reply(chunk);
      } catch (err) {
        console.error("[Telegram] Chat error:", err);
        await ctx.reply("Sorry, something went wrong. Try again.");
      }
    });

    console.log("[Telegram] Bot starting (long-polling)...");
    bot.start().catch((err: unknown) => console.error("[Telegram] Polling stopped:", err));
  } catch (err) {
    console.error("[Telegram] Failed to start:", err);
  }
}

export async function sendTelegramNotification(userId: string, message: string): Promise<void> {
  if (!bot) return;
  const user = db.select({ telegramChatId: users.telegramChatId })
    .from(users).where(eq(users.id, userId)).get();
  if (!user?.telegramChatId) return;
  try {
    await bot.api.sendMessage(user.telegramChatId, message);
  } catch (err) {
    console.error("[Telegram] Notification error:", err);
  }
}

export { bot };
