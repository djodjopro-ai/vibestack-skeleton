import { io, Socket } from "socket.io-client";
import { getSessionToken } from "./api";
import { initFsBridge } from "./fs-bridge";

const SERVER_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ||
  (import.meta.env.PROD ? window.location.origin : "http://localhost:4000");

let socket: Socket | null = null;
let authenticated = false;

type EventHandler = (data: unknown) => void;
const eventHandlers = new Map<string, Set<EventHandler>>();
const wiredEvents = new Set<string>();

function wireEvent(name: string) {
  if (!socket || wiredEvents.has(name)) return;
  socket.on(name, (data: unknown) => {
    const handlers = eventHandlers.get(name);
    if (!handlers) return;
    for (const handler of handlers) handler(data);
  });
  wiredEvents.add(name);
}

export function connectSocket(): Socket {
  if (socket?.connected) return socket;

  socket = io(SERVER_URL, {
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });

  socket.on("connect", () => {
    console.log("[Socket] Connected");
    authenticateSocket();
  });

  socket.on("disconnect", () => {
    console.log("[Socket] Disconnected");
    authenticated = false;
  });

  // Re-wire any events registered before connect()
  for (const name of eventHandlers.keys()) wireEvent(name);

  return socket;
}

function authenticateSocket() {
  const token = getSessionToken();
  if (!socket) return;

  // In preview mode token may be null -- send empty string, server handles it
  socket.emit("auth", token ?? "", (result: { ok: boolean; error?: string }) => {
    if (result.ok) {
      authenticated = true;
      console.log("[Socket] Authenticated");
      initFsBridge(socket!);
    } else {
      console.error("[Socket] Auth failed:", result.error);
    }
  });
}

export function onServerEvent(event: string, handler: EventHandler) {
  if (!eventHandlers.has(event)) {
    eventHandlers.set(event, new Set());
  }
  eventHandlers.get(event)!.add(handler);
  wireEvent(event);

  return () => {
    eventHandlers.get(event)?.delete(handler);
  };
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    authenticated = false;
    wiredEvents.clear();
  }
}

export function isConnected() {
  return socket?.connected && authenticated;
}
