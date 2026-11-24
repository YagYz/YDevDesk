import { Activity } from "lucide-react";
import { useAgent } from "../context/AgentContext";
import { toolColor } from "../lib/format";
import { Dot, Empty, PanelBody } from "../components/ui";
import type { AgentLiveView } from "../types";

const AGENT_META: Record<string, { label: string; color: string }> = {
  agy: { label: "AGY", color: "var(--accent)" },
  claude: { label: "Claude", color: "var(--ok)" },
  codex: { label: "Codex", color: "var(--warn)" },
};
const AGENT_ORDER = ["agy", "claude", "codex"];

function AgentFlow({ view }: { view: AgentLiveView }) {
  const meta = AGENT_META[view.agent] ?? { label: view.agent, color: "var(--txt-muted)" };
  const working = view.state === "working";
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold" style={{ color: meta.color }}>{meta.label}</span>
        <span className="truncate text-[10px] text-[var(--txt-dim)]" title={view.model}>{view.model}</span>
        <span className="ml-auto flex items-center gap-1.5 shrink-0 text-[10px] text-[var(--txt-muted)]">
          <Dot tone={working ? "ok" : "idle"} />
          {working ? "çalışıyor" : "boşta"}
        </span>
      </div>
      {view.ticker_squares.length > 0 && (
        <div className="flex flex-wrap gap-[3px]" title="Son araç çağrıları">
          {view.ticker_squares.slice(0, 60).map((name, i) => (
            <span key={i} title={name} className="w-2.5 h-2.5 rounded-[2px]" style={{ background: toolColor(name), opacity: 1 - i / 90 }} />
          ))}
        </div>
      )}
      <ul className="space-y-1">
        {view.recent_tools.map((t, i) => (
          <li key={`${t.timestamp}-${i}`} className="flex items-start gap-2 rounded-md px-2 py-1.5 bg-[var(--surface-raised)] border border-[var(--border)] text-xs">
            <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: toolColor(t.name) }} />
            <div className="min-w-0">
              <div className="font-mono text-[11px] text-[var(--txt-main)]">{t.name}</div>
              <div className="text-[10px] text-[var(--txt-dim)] truncate">{t.detail}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ToolsPanel() {
  const { agent } = useAgent();
  // Çalışan ajanlar üstte, sonra sabit sıra: AGY, Claude, Codex.
  const flows = [...(agent.flows ?? [])]
    .filter((v) => v.recent_tools.length > 0)
    .sort((a, b) => {
      const wa = a.state === "working" ? 0 : 1;
      const wb = b.state === "working" ? 0 : 1;
      if (wa !== wb) return wa - wb;
      return AGENT_ORDER.indexOf(a.agent) - AGENT_ORDER.indexOf(b.agent);
    });

  return (
    <PanelBody className="space-y-4">
      {flows.length === 0 ? (
        <Empty icon={<Activity className="w-5 h-5" />} title="Henüz araç çağrısı yok" hint="AGY, Claude Code veya Codex çalıştığında canlı akış burada görünür." />
      ) : (
        flows.map((v) => <AgentFlow key={v.agent} view={v} />)
      )}
    </PanelBody>
  );
}
