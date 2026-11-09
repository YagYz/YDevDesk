import { Terminal } from "lucide-react";
import { useWorkspace } from "../context/WorkspaceContext";
import { useData } from "../context/DataContext";
import { PanelBody } from "../components/ui";

export default function QuickActionsPanel() {
  const { runInTerminal } = useWorkspace();
  const { settings } = useData();
  const actions = settings.quick_actions;
  return (
    <PanelBody>
      <div className="text-[10px] text-[var(--txt-dim)] mb-2">Etkin terminalde çalıştırır. Liste Ayarlar'dan düzenlenir.</div>
      <div className="grid gap-1.5">
        {actions.length === 0 && <div className="text-xs text-[var(--txt-dim)]">Eylem yok.</div>}
        {actions.map((a) => (
          <button
            key={a.id}
            onClick={() => runInTerminal(a.cmd)}
            title={a.cmd}
            className="flex items-center gap-2 rounded-md px-2.5 py-2 text-xs text-left bg-[var(--surface-raised)] border border-[var(--border)] hover:border-[var(--accent)]/50 hover:text-[var(--accent)] transition-colors"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span className="font-mono truncate">{a.title}</span>
          </button>
        ))}
      </div>
    </PanelBody>
  );
}
