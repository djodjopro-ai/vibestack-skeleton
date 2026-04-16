import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { existsSync } from "fs";
import { join, resolve } from "path";
import { initDatabase, UPLOADS_DIR } from "./db.js";
import { initWebSocket } from "./websocket.js";
import { initTelegram } from "./telegram.js";
import { initCronJobs } from "./cron.js";
import { loadDomainTools } from "./domain-tools.js";

import authRoutes from "./routes/auth.js";
import chatRoutes from "./routes/chat.js";
import subscriptionRoutes from "./routes/subscription.js";
import configRoutes from "./routes/config.js";
import billingRoutes from "./routes/billing.js";

const PORT = parseInt(process.env.PORT || "4000");
const HOST = process.env.HOST || "0.0.0.0";

initDatabase();

const app = express();
app.use(cors());

// Billing webhook must be mounted BEFORE express.json so the raw body is preserved
// for signature verification.
app.use("/api/billing", billingRoutes);

app.use(express.json({ limit: "50mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, timestamp: Date.now() });
});

app.use("/uploads", express.static(UPLOADS_DIR));

app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.use("/api/config", configRoutes);

const APP_DIST = resolve(process.env.APP_DIST_DIR || "../app/dist");
if (existsSync(APP_DIST)) {
  app.use(express.static(APP_DIST));
  app.get(/^(?!\/api\/|\/uploads\/).*/, (_req, res) => {
    res.sendFile(join(APP_DIST, "index.html"));
  });
  console.log(`[Vibestack] Serving static app from ${APP_DIST}`);
}

const httpServer = createServer(app);
initWebSocket(httpServer);

httpServer.listen(PORT, HOST, async () => {
  console.log(`[Vibestack] Server on :${PORT}`);

  await loadDomainTools();
  await initTelegram();
  initCronJobs();
});
