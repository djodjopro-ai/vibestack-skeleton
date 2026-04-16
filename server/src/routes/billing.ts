import { Router, raw } from "express";
import { eq } from "drizzle-orm";
import { Webhook } from "standardwebhooks";
import { db, users } from "../db.js";

const router = Router();

type PolarEvent = {
  type: string;
  data?: {
    id?: string;
    status?: string;
    current_period_end?: string | null;
    customer?: { id?: string; external_id?: string | null; email?: string | null };
    metadata?: Record<string, unknown>;
  };
};

function resolveUserId(event: PolarEvent): string | null {
  const metaUserId = event.data?.metadata?.userId;
  if (typeof metaUserId === "string" && metaUserId) return metaUserId;
  const externalId = event.data?.customer?.external_id;
  if (typeof externalId === "string" && externalId) return externalId;
  const email = event.data?.customer?.email;
  if (typeof email === "string" && email) {
    const row = db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
    if (row) return row.id;
  }
  return null;
}

function toRenewsAt(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

router.post("/webhook", raw({ type: "*/*" }), (req, res) => {
  const secret = process.env.POLAR_WEBHOOK_SECRET;
  if (!secret) {
    res.status(503).json({ error: "webhook_not_configured" });
    return;
  }

  const body = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? "");
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers[k] = v;
    else if (Array.isArray(v)) headers[k] = v.join(",");
  }

  let event: PolarEvent;
  try {
    const base64Secret = Buffer.from(secret, "utf-8").toString("base64");
    const wh = new Webhook(base64Secret);
    event = wh.verify(body, headers) as PolarEvent;
  } catch (err) {
    console.warn("[billing] webhook signature verification failed:", err);
    res.status(401).json({ error: "invalid_signature" });
    return;
  }

  const userId = resolveUserId(event);
  if (!userId) {
    console.warn(`[billing] event ${event.type} has no resolvable userId, ignoring`);
    res.json({ ok: true, ignored: true });
    return;
  }

  const renewsAt = toRenewsAt(event.data?.current_period_end);

  switch (event.type) {
    case "subscription.created":
    case "subscription.active":
    case "subscription.updated": {
      const status = event.data?.status === "active" ? "active" : event.data?.status === "canceled" ? "canceled" : "active";
      db.update(users)
        .set({
          subscriptionTier: "pro",
          subscriptionStatus: status,
          subscriptionRenewsAt: renewsAt,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .run();
      console.log(`[billing] ${event.type} userId=${userId} status=${status}`);
      break;
    }
    case "subscription.canceled": {
      db.update(users)
        .set({ subscriptionStatus: "canceled", subscriptionRenewsAt: renewsAt, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .run();
      console.log(`[billing] subscription.canceled userId=${userId}`);
      break;
    }
    case "subscription.revoked": {
      db.update(users)
        .set({ subscriptionTier: "free", subscriptionStatus: "none", subscriptionRenewsAt: null, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .run();
      console.log(`[billing] subscription.revoked userId=${userId}`);
      break;
    }
    default:
      console.log(`[billing] unhandled event: ${event.type}`);
  }

  res.json({ ok: true });
});

export default router;
