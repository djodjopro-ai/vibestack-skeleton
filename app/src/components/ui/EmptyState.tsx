interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="text-center py-16">
      {icon && <div className="mb-3 flex justify-center" style={{ color: "var(--text-muted)" }}>{icon}</div>}
      <p className="text-lg mb-2" style={{ color: "var(--text-muted)" }}>{title}</p>
      <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 rounded-lg text-sm cursor-pointer"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
