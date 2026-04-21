import { Router } from "express";
import { eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import bcrypt from "bcryptjs";
import { db, users } from "../db.js";
import { trackSignup, trackActive } from "../lib/telemetry.js";

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/auth/signup - Create account with email + password.
router.post("/signup", async (req, res) => {
  const { email, password, name } = req.body ?? {};

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    typeof name !== "string" ||
    !EMAIL_RE.test(email) ||
    password.length < 8 ||
    name.trim().length === 0
  ) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();

  const existing = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .get();

  if (existing) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const userId = uuid();
  const apiKey = `vs_${uuid().replace(/-/g, "")}`;

  db.insert(users)
    .values({
      id: userId,
      apiKey,
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      onboardingComplete: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();

  trackSignup(userId, normalizedEmail);
  res.json({ userId, apiKey, needsOnboarding: true });
});

// POST /api/auth/signin - Verify email + password, return apiKey.
router.post("/signin", async (req, res) => {
  const { email, password } = req.body ?? {};

  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();

  const user = db
    .select({
      id: users.id,
      apiKey: users.apiKey,
      passwordHash: users.passwordHash,
      onboardingComplete: users.onboardingComplete,
    })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .get();

  if (!user || !user.passwordHash) {
    res.status(401).json({ error: "Incorrect email or password" });
    return;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Incorrect email or password" });
    return;
  }

  trackActive(user.id);
  res.json({
    userId: user.id,
    apiKey: user.apiKey,
    needsOnboarding: !user.onboardingComplete,
  });
});

export default router;
