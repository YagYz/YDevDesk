import { useEffect, useState } from "react";
import { useData } from "../context/DataContext";
import { formatClock, formatSpeed } from "../lib/format";
import { Dot } from "./ui";

export function StatusBar() {
  const { agent, network, hubStatus } = useData();
  const [clock, setClock] = useState(() => formatClock(new Date()));

  useEffect(() => {
    const id = setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

  const hubTone = hubStatus === "ok" ? "ok" : hubStatus === "error" ? "err" : hubStatus === "loading" ? "warn" : "idle";
  const netTone = network.status === "live" ? "ok" : network.status === "offline" ? "err" : network.status === "connecting" ? "warn" : "idle";

  return (
    <footer className="h-6 shrink-0 flex items-center gap-4 px-3 border-t border-[var(--border)] bg-[var(--surface)] text-[10px] text-[var(--txt-muted)] font-mono">
      <span className="flex items-center gap-1.5 min-w-0 truncate">
        <Dot tone={agent.agent_state === "working" ? "ok" : "idle"} />
        <span className="truncate">{agent.marquee_text}</span>
      </span>
      <span className="ml-auto flex items-center gap-1.5 shrink-0">
        <Dot tone={hubTone} /> YDevHub
      </span>
      <span className="flex items-center gap-1.5 shrink-0">
        <Dot tone={netTone} /> YNetMon{network.status === "live" ? ` ↓${formatSpeed(network.rx_bps)} ↑${formatSpeed(network.tx_bps)}` : ""}
      </span>
      <span className="shrink-0">{agent.active_sessions_count} oturum</span>
      <span className="shrink-0 text-[var(--txt-main)]">{clock}</span>
    </footer>
  );
}
