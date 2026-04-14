import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, users } from "../db.js";
import { authMiddleware, getUserId } from "../auth.js";

const router = Router();

// GET /api/subscription - Current tier/status/renewsAt (raw DB values).
router.get("/", authMiddleware, (req, res) => {
  const userId = getUserId(req);

  const row = db
    .select({
      tier: users.subscriptionTier,
      status: users.subscriptionStatus,
      renewsAt: users.subscriptionRenewsAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (!row) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({
    tier: row.tier,
    status: row.status,
    renewsAt: row.renewsAt ?? null,
  });
});

// POST /api/subscription/mock-upgrade - Flip to Pro (mock, no real payment).
// Replace with real Polar/Stripe webhook in skeleton v1.1.
router.post("/mock-upgrade", authMiddleware, (req, res) => {
  const userId = getUserId(req);
  const { tier } = req.body ?? {};

  if (tier !== "pro") {
    res.status(400).json({ error: "Invalid tier" });
    return;
  }

  const renewsAt = Date.now() + 30 * 24 * 3600 * 1000;

  db.update(users)
    .set({
      subscriptionTier: "pro",
      subscriptionStatus: "active",
      subscriptionRenewsAt: renewsAt,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .run();

  console.log("[MOCK] Upgraded userId=%s to pro", userId);

  res.json({ ok: true, tier: "pro", status: "active", renewsAt });
});

// POST /api/subscription/mock-cancel - Cancel but retain access until renewsAt.
router.post("/mock-cancel", authMiddleware, (req, res) => {
  const userId = getUserId(req);

  db.update(users)
    .set({
      subscriptionStatus: "canceled",
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .run();

  const row = db
    .select({ renewsAt: users.subscriptionRenewsAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  console.log("[MOCK] Canceled subscription for userId=%s", userId);

  res.json({ ok: true, status: "canceled", renewsAt: row?.renewsAt ?? null });
});

export default router;
