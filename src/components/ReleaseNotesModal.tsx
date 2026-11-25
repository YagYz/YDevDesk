import { ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Modal } from "./Modal";
import type { ReleaseNote } from "../lib/releaseNotes";

export function ReleaseNotesModal({
  notes,
  onClose,
  onOpenKnowledgeSettings,
}: {
  notes: ReleaseNote[];
  onClose: () => void;
  onOpenKnowledgeSettings: () => void;
}) {
  if (notes.length === 0) return null;
  const latest = notes[0];
  return (
    <Modal title={`YDevDesk v${latest.version} yenilikleri`} onClose={onClose} width={520}>
      <div className="space-y-4 text-xs">
        {notes.map((n) => (
          <section key={n.version} className="space-y-1.5">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[10px] text-[var(--accent)]">v{n.version}</span>
              <h3 className="font-semibold text-[var(--txt-main)]">{n.title}</h3>
            </div>
            <ul className="list-disc pl-4 space-y-1 text-[var(--txt-muted)] leading-relaxed">
              {n.items.map((it) => (
                <li key={it}>{it}</li>
              ))}
            </ul>
            {n.link && (
              <button
                type="button"
                onClick={() => openUrl(n.link as string).catch(() => {})}
                className="inline-flex items-center gap-1 text-[10px] text-[var(--accent)] hover:underline cursor-pointer"
              >
                <ExternalLink className="w-3 h-3" /> Ayrıntılar
              </button>
            )}
          </section>
        ))}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenKnowledgeSettings();
            }}
            className="px-3 py-1.5 rounded-md border border-[var(--border)] text-[11px] cursor-pointer hover:border-[var(--accent)]/50"
          >
            Bilgi Ağı ayarlarını aç
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md bg-[var(--accent)] text-black text-[11px] font-medium cursor-pointer"
          >
            Tamam
          </button>
        </div>
      </div>
    </Modal>
  );
}
