import { useData } from "../context/DataContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { HubEmpty } from "../components/HubEmpty";
import { PanelBody } from "../components/ui";

export default function KnowledgePanel() {
  const { knowledge, hubStatus } = useData();
  const { openKnowledge } = useWorkspace();
  if (hubStatus !== "ok") return <HubEmpty />;
  return (
    <PanelBody>
      <ul className="flex flex-col gap-1.5">
        {knowledge.map((k) => (
          <li key={k.id} className="min-w-0">
            <button
              onClick={() => openKnowledge(k)}
              className="block w-full min-w-0 text-left rounded-md px-2 py-1.5 bg-[var(--surface-raised)] border border-[var(--border)] hover:border-[var(--accent)]/50 transition-colors"
            >
              <div className="flex items-center gap-1.5 text-[10px] text-[var(--accent)] font-mono">{k.service_tag}</div>
              <div className="text-xs font-medium truncate">{k.title}</div>
              <div className="text-[10px] text-[var(--txt-dim)] line-clamp-2">{k.summary}</div>
            </button>
          </li>
        ))}
      </ul>
    </PanelBody>
  );
}
