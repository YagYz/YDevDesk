export function formatSpeed(bps: number): string {
  if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${bps.toFixed(0)} B/s`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatAgo(secs: number): string {
  if (secs < 60) return `${secs}sn`;
  if (secs < 3600) return `${Math.floor(secs / 60)}dk`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}sa`;
  return `${Math.floor(secs / 86400)}g`;
}

export function formatClock(d: Date): string {
  return d.toTimeString().split(" ")[0];
}

export function toolColor(name: string): string {
  switch (name) {
    case "run_command":
      return "var(--accent)";
    case "read_file":
    case "write_file":
    case "edit_file":
      return "var(--petrol)";
    case "search_web":
      return "var(--ok)";
    default:
      return "#70a1ff";
  }
}
