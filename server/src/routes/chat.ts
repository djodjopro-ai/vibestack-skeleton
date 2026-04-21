import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { chat, resolveConfirm } from "../agent.js";
import { db, chatMessages } from "../db.js";
import { authMiddleware, getUserId } from "../auth.js";
import { trackActive } from "../lib/telemetry.js";

const router = Router();

// POST /api/chat - Send a message and get a response
router.post("/", authMiddleware, async (req, res) => {
  const userId = getUserId(req);
  const { message } = req.body;

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Message is required" });
    return;
  }

  try {
    trackActive(userId);
    const response = await chat(userId, message, "app");
    res.json({ response });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Chat] Error:", msg, err);
    res.status(500).json({ error: msg });
  }
});

// GET /api/chat/history - Get chat history
router.get("/history", authMiddleware, (req, res) => {
  const userId = getUserId(req);
  const limit = parseInt(req.query.limit as string) || 50;

  const result = db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.userId, userId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit)
    .all();

  res.json(result.reverse());
});

// POST /api/chat/confirm/:requestId - approve/deny a destructive action
router.post("/confirm/:requestId", authMiddleware, (req, res) => {
  const requestId = String(req.params.requestId || "");
  const { allow } = req.body as { allow?: boolean };
  if (typeof allow !== "boolean") {
    res.status(400).json({ error: "allow (boolean) required" });
    return;
  }
  const userId = getUserId(req);
  const found = resolveConfirm(requestId, allow, userId);
  if (!found) {
    res.status(404).json({ error: "Request not found, expired, or not owned by you" });
    return;
  }
  res.json({ ok: true });
});

export default router;
