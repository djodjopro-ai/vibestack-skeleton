import { useState, useRef, useEffect, useCallback } from "react";
import { sendMessage, getChatHistory, confirmAction } from "../lib/api";
import { onServerEvent } from "../lib/socket";
import { Send, Loader2, Bot, User as UserIcon, ShieldAlert } from "lucide-react";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

interface PendingConfirm {
  requestId: string;
  toolName: string;
  reason: string;
}

export default function ChatSection() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (historyLoaded) return;
    getChatHistory(50)
      .then((history) => {
        setMessages(history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })));
        setHistoryLoaded(true);
      })
      .catch(() => setHistoryLoaded(true));
  }, [historyLoaded]);

  useEffect(() => {
    const off = onServerEvent("confirm_required", (data: unknown) => {
      const d = data as PendingConfirm;
      setConfirm(d);
    });
    return off;
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);

    try {
      const { response } = await sendMessage(text);
      setMessages((prev) => [...prev, { role: "assistant", content: response }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${msg}` }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading]);

  const handleConfirm = async (allow: boolean) => {
    if (!confirm) return;
    try {
      await confirmAction(confirm.requestId, allow);
    } catch {}
    setConfirm(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-3rem)]">
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-muted">
            <Bot className="h-12 w-12 mb-3 opacity-40" />
            <p className="text-sm">Send a message to start chatting</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
            {msg.role === "assistant" && (
              <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="h-4 w-4" />
              </div>
            )}
            <div
              className={[
                "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
                msg.role === "user"
                  ? "bg-primary text-white rounded-br-sm"
                  : "bg-surface border border-border text-foreground rounded-bl-sm",
              ].join(" ")}
            >
              {msg.content}
            </div>
            {msg.role === "user" && (
              <div className="h-7 w-7 rounded-full bg-surface border border-border flex items-center justify-center shrink-0 mt-0.5">
                <UserIcon className="h-4 w-4 text-muted" />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Bot className="h-4 w-4" />
            </div>
            <div className="bg-surface border border-border rounded-2xl rounded-bl-sm px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {confirm && (
        <div className="mx-auto mb-3 max-w-md w-full bg-card border border-border rounded-xl p-4 shadow-lg">
          <div className="flex items-center gap-2 mb-2">
            <ShieldAlert className="h-4 w-4 text-yellow-500" />
            <span className="text-sm font-semibold text-foreground">Confirmation required</span>
          </div>
          <p className="text-xs text-muted mb-1">
            Tool: <span className="font-mono">{confirm.toolName}</span>
          </p>
          <p className="text-sm text-foreground mb-3">{confirm.reason}</p>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => handleConfirm(false)}
              className="px-3 py-1.5 rounded-lg text-xs cursor-pointer bg-surface text-foreground border border-border hover:bg-card transition-colors"
            >
              Deny
            </button>
            <button
              onClick={() => handleConfirm(true)}
              className="px-3 py-1.5 rounded-lg text-xs cursor-pointer bg-primary text-white hover:bg-[color:var(--color-primary-hover)] transition-colors"
            >
              Allow
            </button>
          </div>
        </div>
      )}

      <div className="border-t border-border pt-3">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            className="flex-1 resize-none rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            style={{ maxHeight: "120px" }}
            disabled={loading}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="h-10 w-10 rounded-xl bg-primary text-white flex items-center justify-center shrink-0 hover:bg-[color:var(--color-primary-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
