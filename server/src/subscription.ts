import { and, eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { db, users, usageMeters } from "./db.js";

export type Tier = "free" | "pro";
export type Status = "none" | "active" | "canceled" | "past_due";

function bypass(): boolean {
  return process.env.MOCK_SUBSCRIPTION_BYPASS === "true";
}

function currentPeriod(): string {
  return new Date()
    .toLocaleDateString("sv-SE", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
    })
    .slice(0, 7);
}

export function getCurrentTier(userId: string): Tier {
  if (bypass()) return "pro";

  const row = db
    .select({
      tier: users.subscriptionTier,
      status: users.subscriptionStatus,
      renewsAt: users.subscriptionRenewsAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (!row) return "free";
  if (row.tier !== "pro") return "free";
  if (row.status === "active") return "pro";
  if (row.status === "canceled" && row.renewsAt && row.renewsAt > Date.now()) return "pro";
  return "free";
}

export function requireTier(userId: string, _min: "pro"): { ok: boolean; reason?: string } {
  if (bypass()) return { ok: true };
  if (getCurrentTier(userId) === "pro") return { ok: true };
  return { ok: false, reason: "pro_required" };
}

export function checkQuota(
  userId: string,
  metric: string,
  freeLimit: number,
): { allowed: boolean; used: number; limit: number | null } {
  if (bypass()) return { allowed: true, used: 0, limit: null };
  if (getCurrentTier(userId) === "pro") return { allowed: true, used: 0, limit: null };

  const period = currentPeriod();
  const row = db
    .select({ count: usageMeters.count })
    .from(usageMeters)
    .where(
      and(
        eq(usageMeters.userId, userId),
        eq(usageMeters.metric, metric),
        eq(usageMeters.period, period),
      ),
    )
    .get();

  const used = row?.count ?? 0;
  return { allowed: used < freeLimit, used, limit: freeLimit };
}

export function incrementUsage(userId: string, metric: string): number {
  const period = currentPeriod();
  const now = Date.now();

  const existing = db
    .select({ id: usageMeters.id, count: usageMeters.count })
    .from(usageMeters)
    .where(
      and(
        eq(usageMeters.userId, userId),
        eq(usageMeters.metric, metric),
        eq(usageMeters.period, period),
      ),
    )
    .get();

  if (existing) {
    const next = existing.count + 1;
    db.update(usageMeters)
      .set({ count: next, updatedAt: now })
      .where(eq(usageMeters.id, existing.id))
      .run();
    return next;
  }

  db.insert(usageMeters)
    .values({ id: uuid(), userId, metric, period, count: 1, updatedAt: now })
    .run();
  return 1;
}
