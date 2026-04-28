import { useState, useEffect, useCallback } from "react";
import { useAuth, useUser, SignIn } from "@clerk/clerk-react";
import Sidebar from "./components/Sidebar";
import ChatSection from "./components/ChatSection";
import { MessageSquare } from "lucide-react";
import {
  clearSessionToken,
  setSessionToken,
  checkHealth,
  getProfile,
  getSubscription,
  startCheckout,
  subscribeToPaywall,
  type SubscriptionInfo,
  type PaywallEventDetail,
} from "./lib/api";
import { connectSocket, isConnected } from "./lib/socket";
import type { SectionConfig, User } from "./lib/types";

const isPreview = import.meta.env.VITE_PREVIEW_MODE === "true";
const hasClerk = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const BUILT_IN_CHAT_SECTION: SectionConfig = {
  id: "chat",
  label: "Chat",
  icon: MessageSquare,
  render: () => <ChatSection />,
};

// Domain apps import this and pass their sections via `<App sections={[...]} />`.
// The skeleton defaults to an empty array -> blank dashboard with working auth + chat + theme.
interface AppProps {
  sections?: SectionConfig[];
  appName?: string;
}

export default function App({ sections = [], appName = "Peply" }: AppProps) {
  // In preview mode or when Clerk is not configured, render the inner app directly.
  // When Clerk is active, wrap with the auth gate.
  if (isPreview || !hasClerk) {
    return <AppInner sections={sections} appName={appName} mode="preview" />;
  }
  return <ClerkGate sections={sections} appName={appName} />;
}

/** Clerk auth gate: waits for Clerk to load, shows SignIn or the app */
function ClerkGate({ sections, appName }: AppProps) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const [token, setToken] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    getToken().then((t) => {
      setToken(t);
      setSessionToken(t);
      setTokenReady(true);
    });
  }, [isLoaded, isSignedIn, getToken]);

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <p className="text-muted">Loading...</p>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <SignIn routing="hash" fallbackRedirectUrl="/" />
      </div>
    );
  }

  if (!tokenReady) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <p className="text-muted">Loading...</p>
      </div>
    );
  }

  const clerkName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || undefined;

  return (
    <AppInner
      sections={sections}
      appName={appName}
      mode="clerk"
      initialToken={token}
      clerkDisplayName={clerkName}
    />
  );
}

interface AppInnerProps extends AppProps {
  mode: "preview" | "clerk";
  initialToken?: string | null;
  clerkDisplayName?: string;
}

function AppInner({ sections = [], appName = "Peply", mode, initialToken, clerkDisplayName }: AppInnerProps) {
  const hasChatSection = sections.some((s) => s.id === "chat");
  const allSections = hasChatSection ? sections : [...sections, BUILT_IN_CHAT_SECTION];

  const [activeId, setActiveId] = useState<string>(allSections[0]?.id || "chat");
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

  const bootstrap = useCallback(async () => {
    if (mode === "clerk" && initialToken) {
      setSessionToken(initialToken);
    }

    const healthy = await checkHealth();
    setServerUp(healthy);

    if (!healthy) {
      setChecking(false);
      return;
    }

    try {
      const profile = (await getProfile()) as User;
      setUserName(profile.name);
      setLoggedIn(true);
      connectSocket();
      const sub = await getSubscription().catch(() => null);
      setSubscription(sub);
    } catch {
      clearSessionToken();
      setLoggedIn(false);
    }

    setChecking(false);
  }, [mode, initialToken]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  function handleLogout() {
    clearSessionToken();
    setLoggedIn(false);
    setUserName("");
    setSubscription(null);
    // In Clerk mode, a full reload will trigger the Clerk sign-out flow
    if (mode === "clerk") {
      window.location.reload();
    }
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

  if (!loggedIn && mode !== "preview") {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <p className="text-muted">Loading...</p>
      </div>
    );
  }

  const active = allSections.find((s) => s.id === activeId);
  const displayName = userName || clerkDisplayName || "User";

  return (
    <div className="flex h-full">
      <Sidebar
        sections={allSections}
        active={activeId}
        onSelect={setActiveId}
        userName={displayName}
        connected={isConnected() ?? false}
        onLogout={handleLogout}
        subscription={subscription}
        appName={appName}
      />
      <main className="flex-1 overflow-y-auto p-6 bg-background text-foreground">
        {active ? active.render() : (
          <div className="h-full flex items-center justify-center text-muted">
            <div className="text-center">
              <p className="text-lg font-medium mb-2">Welcome, {displayName}</p>
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
