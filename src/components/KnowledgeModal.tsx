import type { Knowledge } from "../types";
import { Modal } from "./Modal";

export function KnowledgeModal({ item, onClose }: { item: Knowledge; onClose: () => void }) {
  return (
    <Modal title={item.title} onClose={onClose} width={560}>
      <div className="text-[11px] font-mono text-[var(--accent)] mb-2">{item.service_tag}</div>
      <p className="text-xs leading-relaxed whitespace-pre-wrap select-text">{item.summary}</p>
      {item.linked_topics.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {item.linked_topics.map((t) => (
            <span key={t} className="px-2 py-0.5 rounded-full text-[10px] font-mono border border-[var(--border-glow)] text-[var(--txt-muted)]">
              {t}
            </span>
          ))}
        </div>
      )}
    </Modal>
  );
}
