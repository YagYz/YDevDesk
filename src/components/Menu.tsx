import { useEffect, useRef, useState, type ReactNode } from "react";

export function Menu({ trigger, children, align = "left" }: { trigger: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen((o) => !o)}>{trigger(open)}</div>
      {open && (
        <div
          className={`absolute top-full mt-1.5 z-50 min-w-60 rounded-xl border border-[var(--border-glow)] bg-[var(--surface)] shadow-2xl p-1 ${align === "right" ? "right-0" : "left-0"}`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon, title, description, checked, onClick }: { icon?: ReactNode; title: string; description?: string; checked?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--surface-raised)] transition-colors">
      <span className="w-4 h-4 text-[var(--accent)] shrink-0 flex items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-[var(--txt-main)]">{title}</span>
        {description && <span className="block text-[10px] text-[var(--txt-dim)] truncate">{description}</span>}
      </span>
      {checked !== undefined && (
        <span className={`w-3.5 h-3.5 rounded-sm border text-[9px] leading-[12px] text-center ${checked ? "bg-[var(--accent)] border-[var(--accent)] text-black" : "border-[var(--border-glow)]"}`}>
          {checked ? "✓" : ""}
        </span>
      )}
    </button>
  );
}
