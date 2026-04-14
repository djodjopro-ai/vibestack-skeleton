import cron from "node-cron";
import { and, eq } from "drizzle-orm";
import { db, cronLogs, remindersSent } from "./db.js";
import { v4 as uuid } from "uuid";

// ── Dedupe helpers ─────────────────────────────────────────
// Use refId = a stable key (e.g. "YYYY-MM-DD", eventId) so the same
// reminder is not sent twice.

export function hasReminder(userId: string, kind: string, refId: string): boolean {
  const row = db.select({ id: remindersSent.id }).from(remindersSent)
    .where(and(
      eq(remindersSent.userId, userId),
      eq(remindersSent.kind, kind),
      eq(remindersSent.refId, refId),
    ))
    .get();
  return !!row;
}

export function recordReminder(userId: string, kind: string, refId: string): void {
  db.insert(remindersSent).values({
    id: uuid(),
    userId,
    kind,
    refId,
    sentAt: new Date(),
  }).run();
}

export function logCronRun(
  userId: string | null,
  jobType: string,
  status: "success" | "error",
  details?: string,
): void {
  db.insert(cronLogs).values({
    id: uuid(),
    userId: userId || "system",
    jobType,
    status,
    details: details || null,
    runAt: new Date(),
  }).run();
}

// ── Job registry ───────────────────────────────────────────
// Domain modules register cron jobs here. The skeleton provides
// no jobs by default — that's domain-specific territory.

interface CronJob {
  name: string;
  schedule: string;
  timezone?: string;
  run: () => Promise<void> | void;
}

const jobs: CronJob[] = [];

export function registerCronJob(job: CronJob): void {
  jobs.push(job);
}

export function initCronJobs(): void {
  if (jobs.length === 0) {
    console.log("[Cron] No jobs registered");
    return;
  }
  for (const job of jobs) {
    cron.schedule(job.schedule, () => {
      Promise.resolve(job.run()).catch((err) => {
        console.error(`[Cron] ${job.name} failed:`, err);
      });
    }, job.timezone ? { timezone: job.timezone } : undefined);
    console.log(`[Cron] Scheduled ${job.name} (${job.schedule}${job.timezone ? ` @ ${job.timezone}` : ""})`);
  }
}
