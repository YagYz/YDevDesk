import { Bot, Users } from "lucide-react";
import { useData } from "../context/DataContext";
import { formatAgo } from "../lib/format";
import { Dot, Empty, PanelBody } from "../components/ui";

export default function SessionsPanel() {
  const { agent } = useData();
  return (
    <PanelBody className="space-y-4">
      <section>
        <div className="text-[10px] uppercase tracking-wider text-[var(--txt-dim)] mb-1.5">AGY oturumları</div>
        {agent.sessions.length === 0 ? (
          <Empty icon={<Bot className="w-5 h-5" />} title="Oturum bulunamadı" hint="~/.gemini/antigravity-cli/brain altında transcript yok." />
        ) : (
          <ul className="space-y-1">
            {agent.sessions.map((s) => (
              <li key={s.session_id} className="flex items-center gap-2 rounded-md px-2 py-1.5 bg-[var(--surface-raised)] border border-[var(--border)] text-xs">
                <Dot tone={s.is_active ? "ok" : "idle"} />
                <span className="font-mono">{s.session_id}</span>
                <span className="ml-auto text-[var(--txt-dim)] font-mono">{formatAgo(s.updated_ago_secs)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <div className="text-[10px] uppercase tracking-wider text-[var(--txt-dim)] mb-1.5">Alt ajanlar</div>
        {agent.subagents.length === 0 ? (
          <Empty icon={<Users className="w-5 h-5" />} title="Aktif alt ajan yok" />
        ) : (
          <ul className="space-y-1">
            {agent.subagents.map((s, i) => (
              <li key={`${s.name}-${i}`} className="rounded-md px-2 py-1.5 bg-[var(--surface-raised)] border border-[var(--border)] text-xs">
                <div className="flex items-center gap-2">
                  <Dot tone={s.status === "running" || s.status === "working" ? "ok" : "idle"} />
                  <span className="font-medium truncate">{s.name}</span>
                  <span className="ml-auto text-[var(--txt-dim)]">{s.status}</span>
                </div>
                {s.role && <div className="text-[10px] text-[var(--txt-dim)] truncate mt-0.5">{s.role}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </PanelBody>
  );
}
