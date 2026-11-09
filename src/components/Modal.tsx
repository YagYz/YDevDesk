import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

export function Modal({ title, onClose, children, width = 480 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="rounded-2xl border border-[var(--border-glow)] bg-[var(--surface)] shadow-2xl max-h-[85vh] flex flex-col"
        style={{ width, maxWidth: "92vw" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="p-1 rounded-md text-[var(--txt-muted)] hover:text-white hover:bg-[var(--surface-raised)]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 overflow-auto">{children}</div>
      </div>
    </div>
  );
}
