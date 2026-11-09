import { Activity } from "lucide-react";
import { useData } from "../context/DataContext";
import { toolColor } from "../lib/format";
import { Empty, PanelBody } from "../components/ui";

export default function ToolsPanel() {
  const { agent } = useData();
  return (
    <PanelBody className="space-y-3">
      {agent.ticker_squares.length > 0 && (
        <div className="flex flex-wrap gap-[3px]" title="Son araç çağrıları">
          {agent.ticker_squares.slice(0, 60).map((name, i) => (
            <span key={i} title={name} className="w-2.5 h-2.5 rounded-[2px]" style={{ background: toolColor(name), opacity: 1 - i / 90 }} />
          ))}
        </div>
      )}
      {agent.recent_tools.length === 0 ? (
        <Empty icon={<Activity className="w-5 h-5" />} title="Henüz araç çağrısı yok" hint="AGY çalıştığında canlı akış burada görünür." />
      ) : (
        <ul className="space-y-1">
          {agent.recent_tools.map((t, i) => (
            <li key={`${t.timestamp}-${i}`} className="flex items-start gap-2 rounded-md px-2 py-1.5 bg-[var(--surface-raised)] border border-[var(--border)] text-xs">
              <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: toolColor(t.name) }} />
              <div className="min-w-0">
                <div className="font-mono text-[11px] text-[var(--txt-main)]">{t.name}</div>
                <div className="text-[10px] text-[var(--txt-dim)] truncate">{t.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PanelBody>
  );
}
