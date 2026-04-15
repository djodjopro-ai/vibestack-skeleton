import { Server as SocketServer, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import { eq } from "drizzle-orm";
import { db, users } from "./db.js";
import { chat } from "./agent.js";

let io: SocketServer;

const authenticatedSockets = new Map<string, string>();

export function initWebSocket(httpServer: HttpServer) {
  io = new SocketServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
  });

  io.on("connection", (socket: Socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);

    socket.on("auth", (apiKey: string, callback: (result: { ok: boolean; error?: string }) => void) => {
      const user = db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.apiKey, apiKey))
        .get();

      if (!user) {
        callback({ ok: false, error: "Invalid API key" });
        return;
      }

      authenticatedSockets.set(socket.id, user.id);
      socket.join(`user:${user.id}`);
      callback({ ok: true });
      console.log(`[WS] Authenticated: ${user.name} (${user.id})`);
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
