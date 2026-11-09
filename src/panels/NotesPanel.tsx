import { CheckCircle2, Circle, StickyNote } from "lucide-react";
import { useData } from "../context/DataContext";
import { HubEmpty } from "../components/HubEmpty";
import { PanelBody } from "../components/ui";

const PRIORITY: Record<string, string> = { high: "var(--err)", med: "var(--warn)", medium: "var(--warn)", low: "var(--txt-dim)" };

export default function NotesPanel() {
  const { notes, hubStatus } = useData();
  if (hubStatus !== "ok") return <HubEmpty />;
  if (notes.length === 0) {
    return (
      <PanelBody>
        <div className="text-center text-xs text-[var(--txt-dim)] py-6">
          <StickyNote className="w-5 h-5 mx-auto mb-1.5" />
          Not yok. Ctrl+K ile ekle.
        </div>
      </PanelBody>
    );
  }
  return (
    <PanelBody>
      <ul className="space-y-1">
        {notes.map((n) => (
          <li key={n.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 bg-[var(--surface-raised)] border border-[var(--border)] text-xs">
            {n.is_done ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-[var(--ok)] shrink-0" /> : <Circle className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: PRIORITY[n.priority] ?? "var(--txt-dim)" }} />}
            <div className="min-w-0">
              <div className={n.is_done ? "line-through text-[var(--txt-dim)]" : ""}>{n.content}</div>
              <div className="text-[10px] text-[var(--txt-dim)] font-mono">{n.date}</div>
            </div>
          </li>
        ))}
      </ul>
    </PanelBody>
  );
}
