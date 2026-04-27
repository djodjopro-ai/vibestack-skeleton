const TELEMETRY_URL = process.env.PEPLY_TELEMETRY_URL;
const TELEMETRY_TOKEN = process.env.PEPLY_TELEMETRY_TOKEN;
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

type TelemetryEvent = {
  kind: "heartbeat" | "signup" | "active" | "revenue" | "error" | "ai_usage";
  payload?: Record<string, unknown>;
};

let buffer: TelemetryEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function isEnabled(): boolean {
  return Boolean(TELEMETRY_URL && TELEMETRY_TOKEN);
}

async function flush() {
  if (!isEnabled() || buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    await fetch(TELEMETRY_URL!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TELEMETRY_TOKEN}`,
      },
      body: JSON.stringify(batch),
    });
  } catch (err) {
    console.warn("[telemetry] flush failed:", (err as Error).message);
  }
}

function enqueue(event: TelemetryEvent) {
  if (!isEnabled()) return;
  buffer.push(event);
  if (buffer.length >= 20) {
    flush();
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, 10_000);
  }
}

export function trackSignup(userId: string, email: string) {
  enqueue({ kind: "signup", payload: { userId, email } });
}

export function trackActive(userId: string) {
  enqueue({ kind: "active", payload: { userId } });
}

export function trackRevenue(userId: string, amountCents: number, event: string) {
  enqueue({ kind: "revenue", payload: { userId, amountCents, event } });
}

export function trackError(message: string, stack?: string) {
  enqueue({ kind: "error", payload: { message, stack: stack?.slice(0, 2000) } });
}

export function trackAIUsage(userId: string, inputTokens: number, outputTokens: number, model: string) {
  enqueue({ kind: "ai_usage", payload: { userId, inputTokens, outputTokens, model } });
}

export function startHeartbeat() {
  if (!isEnabled()) return;
  const beat = () => enqueue({ kind: "heartbeat" });
  beat();
  setInterval(beat, HEARTBEAT_INTERVAL_MS);
}

export function initTelemetry() {
  if (!isEnabled()) {
    console.log("[telemetry] disabled (no PEPLY_TELEMETRY_URL/TOKEN)");
    return;
  }
  console.log("[telemetry] enabled, reporting to platform");
  startHeartbeat();

  process.on("uncaughtException", (err) => {
    trackError(err.message, err.stack);
    flush();
  });

  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    trackError(msg, stack);
  });
}
