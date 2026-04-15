import { Router } from "express";

const router = Router();

// GET /api/config/public - Public config for the frontend.
router.get("/public", (_req, res) => {
  res.json({
    telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME || null,
  });
});

export default router;
