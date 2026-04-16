import { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import {
  getApiKey,
  clearApiKey,
  checkHealth,
  getProfile,
  getSubscription,
  signIn,
  signUp,
  startCheckout,
  subscribeToPaywall,
  type SubscriptionInfo,
  type PaywallEventDetail,
} from "./lib/api";
import { connectSocket, isConnected } from "./lib/socket";
import type { SectionConfig, User } from "./lib/types";

// Domain apps import this and pass their sections via `<App sections={[...]} />`.
// The skeleton defaults to an empty array → blank dashboard with working auth + chat + theme.
interface AppProps {
  sections?: SectionConfig[];
  appName?: string;
}

export default function App({ sections = [], appName = "Vibestack" }: AppProps) {
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? "");
  const [hasApiKey, setHasApiKey] = useState<boolean>(() => getApiKey() !== null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [paywall, setPaywall] = useState<PaywallEventDetail | null>(null);
  const [serverUp, setServerUp] = useState(false);
  const [checking, setChecking] = useState(true);
  const [userName, setUserName] = useState<string>("");

  useEffect(() => {
    const off = subscribeToPaywall((d) => setPaywall(d));
    return off;
  }, []);

  useEffect(() => {
    (async () => {
      const healthy = await checkHealth();
      setServerUp(healthy);
      const key = getApiKey();
      if (key && healthy) {
        try {
          const profile = (await getProfile()) as User;
          setUserName(profile.name);
          setLoggedIn(true);
          connectSocket();
          const sub = await getSubscription().catch(() => null);
          setSubscription(sub);
        } catch {
          clearApiKey();
          setHasApiKey(false);
        }
      }
      setChecking(false);
    })();
  }, []);

  function handleLogout() {
    clearApiKey();
    setHasApiKey(false);
    setLoggedIn(false);
    setUserName("");
    setSubscription(null);
  }

  if (checking) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <p className="text-muted">Loading...</p>
      </div>
    );
  }

  if (!serverUp) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="text-center">
          <h2 className="text-xl font-bold mb-2 text-primary">{appName}</h2>
          <p className="text-sm mb-4 text-muted">Cannot connect to server</p>
          <p className="text-xs text-muted">Check that the server is running on localhost:4000</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 rounded-lg text-sm cursor-pointer bg-primary text-white hover:bg-[color:var(--color-primary-hover)]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!hasApiKey || !loggedIn) {
    return (
      <AuthForm
        appName={appName}
        onAuthed={async (name) => {
          setHasApiKey(true);
          setUserName(name);
          setLoggedIn(true);
          connectSocket();
          const sub = await getSubscription().catch(() => null);
          setSubscription(sub);
        }}
      />
    );
  }

  const active = sections.find((s) => s.id === activeId);

  return (
    <div className="flex h-full">
      <Sidebar
        sections={sections}
        active={activeId}
        onSelect={setActiveId}
        userName={userName}
        connected={isConnected() ?? false}
        onLogout={handleLogout}
        subscription={subscription}
        appName={appName}
      />
      <main className="flex-1 overflow-y-auto p-6 bg-background text-foreground">
        {active ? active.render() : (
          <div className="h-full flex items-center justify-center text-muted">
            <div className="text-center">
              <p className="text-lg font-medium mb-2">Welcome, {userName}</p>
              <p className="text-sm">No sections registered. Add a domain plugin to get started.</p>
            </div>
          </div>
        )}
      </main>
      {paywall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="rounded-xl p-6 max-w-md w-full mx-4 bg-card border border-border">
            <h2 className="text-lg font-semibold mb-2 text-foreground">Upgrade required</h2>
            <p className="text-sm mb-4 text-muted">
              {paywall.reason === "quota" ? `Quota reached for ${paywall.metric}` : "This feature is Pro-only"}
            </p>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  try {
                    const { url } = await startCheckout();
                    window.location.href = url;
                  } catch (err) {
                    alert(`Checkout failed: ${err instanceof Error ? err.message : String(err)}`);
                  }
                }}
                className="px-4 py-2 rounded-lg text-sm cursor-pointer bg-primary text-white"
              >
                Upgrade to Pro
              </button>
              <button
                onClick={() => setPaywall(null)}
                className="px-4 py-2 rounded-lg text-sm cursor-pointer bg-surface text-foreground border border-border"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AuthForm({ appName, onAuthed }: { appName: string; onAuthed: (name: string) => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        await signUp({ email, password, name });
        onAuthed(name);
      } else {
        await signIn({ email, password });
        const profile = (await getProfile()) as User;
        onAuthed(profile.name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auth failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-center h-full bg-background">
      <form onSubmit={submit} className="w-full max-w-sm p-6 rounded-xl bg-card border border-border space-y-4">
        <h1 className="text-2xl font-bold text-foreground">{appName}</h1>
        {mode === "signup" && (
          <input
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-foreground"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        )}
        <input
          type="email"
          className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-foreground"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-foreground"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full px-4 py-2 rounded-lg bg-primary text-white font-medium disabled:opacity-50 cursor-pointer"
        >
          {busy ? "..." : mode === "signup" ? "Sign up" : "Sign in"}
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="w-full text-sm text-muted hover:text-foreground cursor-pointer"
        >
          {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
