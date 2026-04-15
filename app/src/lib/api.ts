const API_URL = "http://localhost:4000/api";
const SERVER_ORIGIN = "http://localhost:4000";

export function imageUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${SERVER_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

let apiKey: string | null = null;

export function setApiKey(key: string) {
  apiKey = key;
  localStorage.setItem("vibestack_api_key", key);
}

export function getApiKey(): string | null {
  if (apiKey) return apiKey;
  apiKey = localStorage.getItem("vibestack_api_key");
  return apiKey;
}

export function clearApiKey() {
  apiKey = null;
  localStorage.removeItem("vibestack_api_key");
}

// ── Paywall event emitter ──────────────────────────────────

export interface PaywallEventDetail {
  reason: "quota" | "pro_only";
  metric?: string;
  used?: number;
  limit?: number;
}

const paywallTarget = typeof window !== "undefined" ? new EventTarget() : null;

export function subscribeToPaywall(cb: (detail: PaywallEventDetail) => void): () => void {
  if (!paywallTarget) return () => {};
  const handler = (ev: Event) => {
    const e = ev as CustomEvent<PaywallEventDetail>;
    cb(e.detail);
  };
  paywallTarget.addEventListener("paywall", handler);
  return () => paywallTarget.removeEventListener("paywall", handler);
}

function emitPaywall(detail: PaywallEventDetail) {
  if (!paywallTarget) return;
  paywallTarget.dispatchEvent(new CustomEvent("paywall", { detail }));
}

export class QuotaExceededError extends Error {
  metric?: string;
  used?: number;
  limit?: number;
  constructor(metric?: string, used?: number, limit?: number) {
    super("quota_exceeded");
    this.name = "QuotaExceededError";
    this.metric = metric;
    this.used = used;
    this.limit = limit;
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const key = getApiKey();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (key) headers["Authorization"] = `Bearer ${key}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 402 && error?.error === "quota_exceeded") {
      emitPaywall({ reason: "quota", metric: error.metric, used: error.used, limit: error.limit });
      throw new QuotaExceededError(error.metric, error.used, error.limit);
    }
    throw new Error(error.error || "Request failed");
  }
  return res.json();
}

// ── Auth ────────────────────────────────────────────────────

export async function signUp(data: { email: string; password: string; name: string }) {
  const result = await request<{ userId: string; apiKey: string; needsOnboarding: boolean }>(
    "/auth/signup",
    { method: "POST", body: JSON.stringify(data) }
  );
  setApiKey(result.apiKey);
  return { userId: result.userId, needsOnboarding: result.needsOnboarding };
}

export async function signIn(data: { email: string; password: string }) {
  const result = await request<{ userId: string; apiKey: string; needsOnboarding: boolean }>(
    "/auth/signin",
    { method: "POST", body: JSON.stringify(data) }
  );
  setApiKey(result.apiKey);
  return { userId: result.userId, needsOnboarding: result.needsOnboarding };
}

// ── Profile ─────────────────────────────────────────────────

export async function getProfile() {
  return request<unknown>("/settings/profile");
}

export async function updateProfile(data: Record<string, unknown>) {
  return request<{ ok: boolean }>("/settings/profile", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// ── Subscription ────────────────────────────────────────────

export interface SubscriptionInfo {
  tier: "free" | "pro";
  status: "none" | "active" | "canceled" | "past_due";
  renewsAt: number | null;
}

export async function getSubscription() {
  return request<SubscriptionInfo>("/subscription");
}

export async function mockUpgradeSubscription(tier: "pro" = "pro") {
  return request<{ ok: boolean; tier: string; status: string; renewsAt: number | null }>(
    "/subscription/mock-upgrade",
    { method: "POST", body: JSON.stringify({ tier }) }
  );
}

export async function mockCancelSubscription() {
  return request<{ ok: boolean; status: string; renewsAt: number | null }>(
    "/subscription/mock-cancel",
    { method: "POST" }
  );
}

// ── Chat ────────────────────────────────────────────────────

export async function sendMessage(message: string) {
  return request<{ response: string }>("/chat", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export async function confirmAction(requestId: string, allow: boolean) {
  return request<{ ok: boolean }>(`/chat/confirm/${requestId}`, {
    method: "POST",
    body: JSON.stringify({ allow }),
  });
}

export async function getChatHistory(limit = 50) {
  return request<Array<{ role: string; content: string; createdAt: number }>>(
    `/chat/history?limit=${limit}`
  );
}

// ── Public Config ──────────────────────────────────────────

export async function getPublicConfig(): Promise<{ telegramBotUsername: string | null }> {
  try {
    const res = await fetch(`${API_URL}/config/public`);
    if (!res.ok) return { telegramBotUsername: null };
    const data = await res.json();
    return { telegramBotUsername: data?.telegramBotUsername ?? null };
  } catch {
    return { telegramBotUsername: null };
  }
}

// ── Health ──────────────────────────────────────────────────

export async function checkHealth() {
  try {
    const res = await fetch(`${API_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
