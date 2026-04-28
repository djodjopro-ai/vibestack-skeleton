import { Server as SocketServer, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import { createClerkClient } from "@clerk/express";
import { verifyToken } from "@clerk/backend";
import { eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { randomBytes } from "crypto";
import { db, users } from "./db.js";
import { chat } from "./agent.js";

let io: SocketServer;

const authenticatedSockets = new Map<string, string>();

function getClerkClient() {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) return null;
  return createClerkClient({ secretKey: key });
}

export function initWebSocket(httpServer: HttpServer) {
  io = new SocketServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
  });

  io.on("connection", (socket: Socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);

    socket.on("auth", async (token: string, callback: (result: { ok: boolean; error?: string }) => void) => {
      // Preview mode: auto-authenticate
      if (process.env.PREVIEW_MODE === "true") {
        let previewUser = db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.email, "preview@peply.dev"))
          .get();

        if (!previewUser) {
          const id = uuid();
          db.insert(users)
            .values({
              id,
              name: "Preview User",
              email: "preview@peply.dev",
              apiKey: randomBytes(24).toString("hex"),
              onboardingComplete: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .run();
          previewUser = { id, name: "Preview User" };
        }

        authenticatedSockets.set(socket.id, previewUser.id);
        socket.join(`user:${previewUser.id}`);
        callback({ ok: true });
        console.log(`[WS] Authenticated: ${previewUser.name} (preview mode)`);
        return;
      }

      // Clerk token verification
      const secretKey = process.env.CLERK_SECRET_KEY;
      const clerk = getClerkClient();
      if (!secretKey || !clerk || !token) {
        callback({ ok: false, error: "Auth not configured or missing token" });
        return;
      }

      try {
        const payload = await verifyToken(token, { secretKey });
        const clerkUserId = payload.sub;

        let localUser = db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.clerkUserId, clerkUserId))
          .get();

        if (!localUser) {
          const clerkUser = await clerk.users.getUser(clerkUserId);
          const email = clerkUser.emailAddresses[0]?.emailAddress ?? "";
          const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || "User";
          const id = uuid();
          db.insert(users)
            .values({ id, clerkUserId, name, email, apiKey: randomBytes(24).toString("hex"), onboardingComplete: true, createdAt: new Date(), updatedAt: new Date() })
            .run();
          localUser = { id, name };
        }

        authenticatedSockets.set(socket.id, localUser.id);
        socket.join(`user:${localUser.id}`);
        callback({ ok: true });
        console.log(`[WS] Authenticated: ${localUser.name} (${localUser.id})`);
      } catch {
        callback({ ok: false, error: "Invalid token" });
      }
    });

    socket.on("chat:message", async (message: string, callback: (response: string) => void) => {
      const userId = authenticatedSockets.get(socket.id);
      if (!userId) {
        callback("Error: Not authenticated");
        return;
      }
      try {
        const response = await chat(userId, message, "app");
        callback(response);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[WS] Chat error:`, err);
        callback(`Error: ${errorMsg}`);
      }
    });

    socket.on("disconnect", () => {
      authenticatedSockets.delete(socket.id);
      console.log(`[WS] Client disconnected: ${socket.id}`);
    });
  });

  console.log("[WS] WebSocket server initialized");
  return io;
}

export function emitToUser(userId: string, event: string, data: unknown) {
  if (io) io.to(`user:${userId}`).emit(event, data);
}

export function getIO() {
  return io;
}

export function getSocketByUserId(userId: string): string | null {
  for (const [socketId, uid] of authenticatedSockets.entries()) {
    if (uid === userId) return socketId;
  }
  return null;
}

export function proxyFilesystemCommand(
  userId: string,
  command: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!io) {
      reject(new Error("WebSocket server not initialized"));
      return;
    }
    const socketId = getSocketByUserId(userId);
    if (!socketId) {
      reject(new Error("User not connected - no active socket found"));
      return;
    }
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) {
      reject(new Error("Socket connection lost"));
      return;
    }
    const timeout = setTimeout(() => {
      reject(new Error(`Filesystem command '${command}' timed out after 60 seconds`));
    }, 60000);

    socket.emit("fs:command", { command, args }, (response: { ok: boolean; data?: unknown; error?: string }) => {
      clearTimeout(timeout);
      if (response.ok) resolve(response.data);
      else reject(new Error(response.error || "Filesystem command failed"));
    });
  });
}
