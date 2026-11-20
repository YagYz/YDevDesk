import { useRef } from "react";
import { FileText, FolderOpen, RefreshCw } from "lucide-react";
import { formatAgo } from "../../lib/format";
import { Empty } from "../../components/ui";
import { getAgentMeta } from "./meta";
import type { AgentMarkdownFile } from "../../types";

type Props = {
  docs: AgentMarkdownFile[];
  onRefresh: () => void;
  onOpenMarkdown: (opts: { path: string; title?: string; agent?: string; content?: string }) => void;
};

export function DocsSection({ docs, onRefresh, onOpenMarkdown }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <section>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--txt-dim)] mb-1.5">
        <span>Ajan Markdown Dosyaları</span>
        <div className="flex items-center gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,text/markdown"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              const text = await file.text();
              onOpenMarkdown({ path: `external:${file.name}`, title: file.name, content: text });
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Bilgisayardan .md dosyası aç"
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--border)] bg-[var(--surface-raised)] text-[10px] normal-case text-[var(--txt-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)]/40 cursor-pointer"
          >
            <FolderOpen className="w-3 h-3" />
            <span>Dosya Aç</span>
          </button>
          <span className="font-mono">{docs.length}</span>
          <button
            type="button"
            onClick={onRefresh}
            title="Listeyi yenile"
            className="p-0.5 rounded hover:text-[var(--accent)] cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {docs.length === 0 ? (
        <Empty
          icon={<FileText className="w-5 h-5" />}
          title="Markdown dosyası bulunamadı"
          hint="AGY, Claude, Codex veya proje dizinlerindeki .md dosyaları burada listelenir."
        />
      ) : (
        <ul className="space-y-1.5">
          {docs.map((m) => {
            const meta = getAgentMeta(m.agent);
            return (
              <li key={m.path}>
                <button
                  type="button"
                  onClick={() => onOpenMarkdown({ path: m.path, title: m.name, agent: m.agent })}
                  title={`Yeni sekmede aç: ${m.path}`}
                  className="w-full text-left rounded-md px-2.5 py-2 bg-[var(--surface-raised)] border border-[var(--border)] hover:border-[var(--accent)]/50 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${meta.badgeClass}`}>
                      {meta.label}
                    </span>
                    {m.session_id && (
                      <span className="font-mono text-[10px] text-[var(--txt-dim)]">{m.session_id}</span>
                    )}
                    <span className="ml-auto text-[10px] text-[var(--txt-dim)] font-mono shrink-0">
                      {formatAgo(m.modified_ago_secs)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-[var(--txt-main)] font-medium truncate">{m.name}</div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
