import { useState, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { formatError, type ErrorContext } from "../lib/errors";

export function PanelBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`h-full w-full overflow-auto p-3 ${className}`}>{children}</div>;
}

export function Empty({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="h-full min-h-24 flex flex-col items-center justify-center text-center gap-1.5 px-4 py-6 text-[var(--txt-dim)]">
      {icon}
      <div className="text-xs font-medium text-[var(--txt-muted)]">{title}</div>
      {hint && <div className="text-[11px] leading-snug">{hint}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-2 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-[var(--txt-dim)] truncate">{label}</div>
      <div
        className={`text-sm font-semibold font-mono truncate ${accent ? "text-[var(--accent)]" : "text-[var(--txt-main)]"}`}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-[var(--txt-dim)] truncate">{sub}</div>}
    </div>
  );
}

export function Bar({ label, percent, tone = "accent" }: { label: string; percent: number; tone?: "accent" | "ok" | "warn" }) {
  const p = Math.max(0, Math.min(100, percent));
  const color = tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : "var(--accent)";
  return (
    <div>
      <div className="flex justify-between text-[10px] text-[var(--txt-muted)] mb-1">
        <span>{label}</span>
        <span className="font-mono">{p.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${p}%`, background: color }} />
      </div>
    </div>
  );
}

export function Dot({ tone }: { tone: "ok" | "warn" | "err" | "idle" }) {
  const color =
    tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : tone === "err" ? "var(--err)" : "var(--txt-dim)";
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
      style={{ background: color, boxShadow: tone === "ok" ? `0 0 6px ${color}` : undefined }}
    />
  );
}

export function Sparkline({ values, height = 44 }: { values: number[]; height?: number }) {
  if (values.length < 2) {
    return <div style={{ height }} className="rounded-md bg-[var(--surface-raised)] border border-[var(--border)]" />;
  }
  const w = 200;
  const max = Math.max(...values, 1);
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full rounded-md bg-[var(--surface-raised)] border border-[var(--border)]" style={{ height }}>
      <polygon points={`0,${height} ${pts.join(" ")} ${w},${height}`} fill="rgba(0,210,255,0.12)" />
      <polyline points={pts.join(" ")} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function ErrorBanner({
  error,
  context,
  compact = false,
  className = "",
}: {
  error: unknown;
  context?: ErrorContext;
  compact?: boolean;
  className?: string;
}) {
  const [showDetail, setShowDetail] = useState(false);
  if (!error) return null;

  const { message, detail } = formatError(error, context);

  return (
    <div
      className={`rounded-md border border-[var(--err)]/30 bg-[var(--err)]/10 text-[var(--err)] ${
        compact ? "px-2 py-1.5 text-[10px]" : "px-2.5 py-2 text-[11px]"
      } ${className}`}
    >
      <div className="flex items-start gap-1.5">
        <AlertCircle className={`${compact ? "w-3 h-3 mt-0.5" : "w-3.5 h-3.5 mt-0.5"} shrink-0`} />
        <div className="flex-1 min-w-0 leading-snug break-words">{message}</div>
        {detail && detail !== message && (
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            className="shrink-0 underline opacity-80 hover:opacity-100 cursor-pointer text-[10px]"
          >
            {showDetail ? "Gizle" : "Detay"}
          </button>
        )}
      </div>
      {showDetail && detail && (
        <pre className="mt-1.5 pt-1.5 border-t border-[var(--err)]/20 font-mono text-[10px] opacity-85 whitespace-pre-wrap break-all max-h-24 overflow-auto select-text">
          {detail}
        </pre>
      )}
    </div>
  );
}
