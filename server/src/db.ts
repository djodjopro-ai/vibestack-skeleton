import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { mkdirSync } from "fs";
import { dirname, join } from "path";

// ── Core schema ─────────────────────────────────────────────
// Domain-specific tables belong in a separate module and should be
// registered via the schema extension hook. Keep this file focused on
// identity, billing, chat, credentials, cron, and quotas.

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  apiKey: text("api_key").notNull().unique(),
  name: text("name").notNull(),
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  subscriptionTier: text("subscription_tier").notNull().default("free"),
  subscriptionStatus: text("subscription_status").notNull().default("none"),
  subscriptionRenewsAt: integer("subscription_renews_at"),
  externalUserId: text("external_user_id"),
  timezone: text("timezone").default("UTC"),
  telegramChatId: text("telegram_chat_id"),
  telegramUsername: text("telegram_username"),
  onboardingComplete: integer("onboarding_complete", { mode: "boolean" }).default(false),
  workingDirectory: text("working_directory"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const usageMeters = sqliteTable("usage_meters", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  metric: text("metric").notNull(),
  period: text("period").notNull(),
  count: integer("count").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  source: text("source", { enum: ["app", "telegram"] }).default("app"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const credentials = sqliteTable("credentials", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  service: text("service").notNull(),
  encryptedData: text("encrypted_data").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const cronLogs = sqliteTable("cron_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  jobType: text("job_type").notNull(),
  status: text("status", { enum: ["success", "error"] }).notNull(),
  details: text("details"),
  runAt: integer("run_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const remindersSent = sqliteTable("reminders_sent", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  kind: text("kind").notNull(),
  refId: text("ref_id"),
  sentAt: integer("sent_at", { mode: "timestamp" }).notNull(),
});

// ── Database connection ─────────────────────────────────────

const DB_PATH = process.env.DATABASE_URL?.replace("sqlite://", "") || "./data/vibestack.db";

mkdirSync(dirname(DB_PATH), { recursive: true });

export const UPLOADS_DIR = join(dirname(DB_PATH), "uploads");
mkdirSync(UPLOADS_DIR, { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite);

// ── Schema extension hook ───────────────────────────────────
// Domain modules register additional DDL here. Run before initDatabase()
// so extra tables are created in the same bootstrap pass.

type Migration = () => void;
const extraDDL: string[] = [];
const extraMigrations: Migration[] = [];

export function registerSchema(opts: { ddl?: string[]; migrations?: Migration[] }) {
  if (opts.ddl) extraDDL.push(...opts.ddl);
  if (opts.migrations) extraMigrations.push(...opts.migrations);
}

// ── Core table DDL ──────────────────────────────────────────

const CORE_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  password_hash TEXT,
  subscription_tier TEXT NOT NULL DEFAULT 'free',
  subscription_status TEXT NOT NULL DEFAULT 'none',
  subscription_renews_at INTEGER,
  external_user_id TEXT,
  timezone TEXT DEFAULT 'UTC',
  telegram_chat_id TEXT,
  telegram_username TEXT,
  onboarding_complete INTEGER DEFAULT 0,
  working_directory TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  source TEXT DEFAULT 'app' CHECK(source IN ('app', 'telegram')),
  created_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_messages(user_id);

CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  service TEXT NOT NULL,
  encrypted_data TEXT NOT NULL,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials(user_id);

CREATE TABLE IF NOT EXISTS cron_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success', 'error')),
  details TEXT,
  run_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_cron_user ON cron_logs(user_id);

CREATE TABLE IF NOT EXISTS reminders_sent (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  ref_id TEXT,
  sent_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reminders_sent_dedupe ON reminders_sent(user_id, kind, ref_id);

CREATE TABLE IF NOT EXISTS usage_meters (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  period TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_meters_unique ON usage_meters(user_id, metric, period);
`;

function runStatements(sql: string) {
  const statements = sql.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
  for (const stmt of statements) sqlite.prepare(stmt).run();
}

export function initDatabase() {
  runStatements(CORE_DDL);
  for (const ddl of extraDDL) runStatements(ddl);
  for (const migrate of extraMigrations) {
    try { migrate(); } catch (e) { console.warn("[DB] migration failed:", e); }
  }
  console.log("[DB] Database initialized");
}
