# vibestack-skeleton

Skeleton template for Vibestack-generated AI-assistant apps. Generated apps clone from this at a pinned semver tag (`v1.0.0`+).

**Ships with:** email/password auth + API keys, mock subscription tiers + quotas, Claude-powered chat agent loop with tool-use, core filesystem tools, Telegram bridge scaffolding, cron infra, plugin registry for domain extensions, UI kit (Modal/ConfirmDialog/EmptyState/ImageViewer), theme system, Tailwind v4, WebSocket realtime, Tauri 2 desktop wrapper.

**Domain layer is pluggable.** Sections, agent tools, DB tables, Telegram commands, and cron jobs all register through hooks — the skeleton itself stays generic.

## Run it

```bash
# 1. Install
cd server && npm install && cd ..
cd app    && npm install && cd ..

# 2. Configure
cp server/.env.example server/.env
# Edit server/.env — set ANTHROPIC_API_KEY (required for chat).
# TELEGRAM_BOT_TOKEN is optional; leave blank to skip the bot.

# 3. Run (two terminals)
cd server && npm run dev    # → http://localhost:4000
cd app    && npm run dev    # → http://localhost:1420 (Vite)

# Or, for the Tauri desktop window:
cd app && npm run tauri dev
```

You should see the Vibestack auth form. Sign up → land on a blank dashboard reading "No sections registered. Add a domain plugin to get started." Theme toggle and chat infra are wired but unused until a domain plugin mounts something.

## Extending it (domain plugins)

A domain plugin is just code that runs at boot and calls the registry hooks. Drop modules into `server/src/domain-tools/` for auto-loading; mount sections from your domain app entry.

```ts
// Database tables
import { registerSchema } from "./db.js";
registerSchema({
  ddl: [`CREATE TABLE IF NOT EXISTS my_table (...)`],
});

// Agent tools
import { registerDomainTool } from "./domain-tools.js";
registerDomainTool({
  definition: { name: "my_tool", description: "...", input_schema: {...} },
  handler: async (input, ctx) => "result string",
});

// Telegram commands
import { registerTelegramCommand } from "./telegram.js";
registerTelegramCommand({
  name: "status",
  description: "Show current status",
  handler: async (ctx, userId) => { await ctx.reply("..."); },
});

// Cron jobs
import { registerCronJob } from "./cron.js";
registerCronJob({
  name: "daily-digest",
  schedule: "0 9 * * *",
  handler: async () => { /* ... */ },
});

// Sidebar sections (frontend)
import App from "vibestack-skeleton/app";
const sections = [
  { id: "home", label: "Home", icon: HomeIcon, render: () => <HomePage /> },
];
<App sections={sections} appName="MyApp" />
```

## Stack

- **Frontend:** React 19, Vite 7, Tailwind 4, Tauri 2
- **Backend:** Express, Socket.IO, drizzle-orm + better-sqlite3, grammy (Telegram), node-cron
- **AI:** `@anthropic-ai/sdk` (Claude Sonnet 4.6 by default)

## License

Private. Don't redistribute the skeleton itself; ship what you build with it.
