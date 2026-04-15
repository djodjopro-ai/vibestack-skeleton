import { LogOut, Moon, Sun, MessageSquare, Box } from "lucide-react";
import { useTheme } from "../lib/theme";
import type { SectionConfig } from "../lib/types";
import type { SubscriptionInfo } from "../lib/api";

interface SidebarProps {
  sections: SectionConfig[];
  active: string;
  onSelect: (id: string) => void;
  userName?: string;
  connected: boolean;
  onLogout?: () => void;
  chatOpen?: boolean;
  onToggleChat?: () => void;
  subscription?: SubscriptionInfo | null;
  onOpenUpgrade?: () => void;
  appName?: string;
}

function getInitials(name: string | undefined): string {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Sidebar({
  sections,
  active,
  onSelect,
  userName,
  connected,
  onLogout,
  chatOpen,
  onToggleChat,
  subscription,
  onOpenUpgrade,
  appName = "Vibestack",
}: SidebarProps) {
  const { theme, toggleTheme } = useTheme();
  const initials = getInitials(userName);

  return (
    <aside className="w-64 h-full border-r border-border bg-gradient-to-b from-card to-surface flex flex-col">
      <div className="h-16 px-6 flex items-center gap-2 shadow-[0_1px_0_0_var(--color-border-subtle)]">
        <Box className="h-6 w-6 text-primary" />
        <span className="text-lg font-bold text-foreground">{appName}</span>
      </div>

      <nav className="flex-1 flex flex-col gap-1 p-4 overflow-y-auto">
        {sections.map((section) => {
          const isActive = active === section.id;
          const Icon = section.icon;
          const badge = section.badge ? section.badge() : null;
          const classes = [
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
            "hover:scale-[1.01] active:scale-[0.98] border-l-[3px] cursor-pointer w-full text-left",
            isActive
              ? "bg-primary/8 text-primary font-semibold border-l-primary"
              : "text-muted border-l-transparent hover:bg-surface hover:text-foreground",
          ].join(" ");
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onSelect(section.id)}
              className={classes}
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1 text-left">{section.label}</span>
              {badge !== null && badge !== undefined && badge > 0 && (
                <span
                  className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                  style={{
                    background: "var(--color-primary, #2563eb)",
                    color: "#fff",
                    minWidth: "1.25rem",
                    textAlign: "center",
                  }}
                >
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </button>
          );
        })}

        {onToggleChat && (
          <>
            <div className="my-2 h-px bg-[color:var(--color-border-subtle)]" />
            <button
              type="button"
              onClick={onToggleChat}
              className={[
                "flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                "hover:scale-[1.01] active:scale-[0.98] border-l-[3px] cursor-pointer w-full text-left",
                chatOpen
                  ? "bg-primary/8 text-primary font-semibold border-l-primary"
                  : "text-muted border-l-transparent hover:bg-surface hover:text-foreground",
              ].join(" ")}
              aria-pressed={chatOpen}
              title="Toggle chat (Cmd+L)"
            >
              <span className="flex items-center gap-3">
                <MessageSquare className="h-4 w-4" />
                <span>Chat</span>
              </span>
              <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-surface text-muted font-mono">
                ⌘L
              </kbd>
            </button>
          </>
        )}
      </nav>

      <div className="border-t border-[color:var(--color-border-subtle)] p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: connected ? "#22c55e" : "#ef4444" }}
                title={connected ? "Connected" : "Offline"}
              />
              <span className="text-sm text-foreground truncate">{userName || "User"}</span>
            </div>
            {subscription && onOpenUpgrade && (
              <button
                type="button"
                onClick={onOpenUpgrade}
                className={[
                  "mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold cursor-pointer transition-colors",
                  subscription.tier === "pro"
                    ? "bg-primary text-white hover:bg-[color:var(--color-primary-hover)]"
                    : "bg-surface text-muted border border-border hover:text-foreground",
                ].join(" ")}
              >
                {subscription.tier === "pro" ? "Pro" : "Free"}
              </button>
            )}
          </div>
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              aria-label="Log out"
              className="rounded-lg p-1.5 text-muted hover:text-destructive hover:bg-surface transition-colors cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="h-px bg-[color:var(--color-border-subtle)]" />

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">Theme</span>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="rounded-lg p-1.5 text-muted hover:text-foreground hover:bg-surface transition-colors cursor-pointer"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </aside>
  );
}
