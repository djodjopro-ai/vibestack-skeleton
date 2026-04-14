import Modal from "./Modal";

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  variant?: "danger" | "default";
}

export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirm",
  variant = "default",
}: ConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="400px">
      <p className="text-sm mb-5" style={{ color: "var(--text-muted)" }}>
        {message}
      </p>
      <div className="flex gap-3 justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-sm cursor-pointer"
          style={{ background: "var(--border)", color: "var(--text)" }}
        >
          Cancel
        </button>
        <button
          onClick={() => { onConfirm(); onClose(); }}
          className="px-4 py-2 rounded-lg text-sm cursor-pointer"
          style={{
            background: variant === "danger" ? "rgba(239,68,68,0.15)" : "var(--accent)",
            color: variant === "danger" ? "#ef4444" : "#fff",
          }}
        >
          {confirmText}
        </button>
      </div>
    </Modal>
  );
}
