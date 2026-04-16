import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, users } from "../db.js";
import { authMiddleware, getUserId } from "../auth.js";

const router = Router();

function polarBaseUrl(): string {
  return process.env.POLAR_SERVER === "production"
    ? "https://api.polar.sh"
    : "https://sandbox-api.polar.sh";
}

function mockEnabled(): boolean {
  return process.env.MOCK_SUBSCRIPTION_BYPASS === "true";
}

// GET /api/subscription - Current tier/status/renewsAt.
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

// POST /api/subscription/checkout - Creates a Polar checkout session and returns the hosted URL.
router.post("/checkout", authMiddleware, async (req, res) => {
  const userId = getUserId(req);
  const token = process.env.POLAR_ACCESS_TOKEN;
  const productId = process.env.POLAR_PRO_PRODUCT_ID;

  if (!token || !productId) {
    res.status(503).json({ error: "billing_not_configured", hint: "POLAR_ACCESS_TOKEN/POLAR_PRO_PRODUCT_ID not set" });
    return;
  }

  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const origin = (req.headers.origin as string) || process.env.APP_BASE_URL || "";
  const successUrl = `${origin}/?upgrade=success`;

  try {
    const response = await fetch(`${polarBaseUrl()}/v1/checkouts/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        products: [productId],
        success_url: successUrl,
        customer_email: user.email ?? undefined,
        external_customer_id: userId,
        metadata: { userId },
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      console.error("[polar] checkout failed:", response.status, text);
      res.status(502).json({ error: "polar_checkout_failed", detail: text });
      return;
    }
    const checkout = (await response.json()) as { url?: string; id?: string };
    res.json({ url: checkout.url, id: checkout.id });
  } catch (err) {
    console.error("[polar] checkout error:", err);
    res.status(502).json({ error: "polar_unreachable" });
  }
});

// POST /api/subscription/mock-upgrade - Dev-only. Requires MOCK_SUBSCRIPTION_BYPASS=true.
router.post("/mock-upgrade", authMiddleware, (req, res) => {
  if (!mockEnabled()) {
    res.status(403).json({ error: "mock_disabled" });
    return;
  }
  const userId = getUserId(req);
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

  res.json({ ok: true, tier: "pro", status: "active", renewsAt });
});

// POST /api/subscription/mock-cancel - Dev-only. Requires MOCK_SUBSCRIPTION_BYPASS=true.
router.post("/mock-cancel", authMiddleware, (req, res) => {
  if (!mockEnabled()) {
    res.status(403).json({ error: "mock_disabled" });
    return;
  }
  const userId = getUserId(req);

  db.update(users)
    .set({ subscriptionStatus: "canceled", updatedAt: new Date() })
    .where(eq(users.id, userId))
    .run();

  const row = db
    .select({ renewsAt: users.subscriptionRenewsAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  res.json({ ok: true, status: "canceled", renewsAt: row?.renewsAt ?? null });
});

export default router;
