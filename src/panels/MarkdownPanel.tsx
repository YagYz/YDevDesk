import { useCallback, useEffect, useMemo, useState } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { Check, Code2, Copy, Eye, FileText, RefreshCw } from "lucide-react";
import { useData } from "../context/DataContext";
import { api } from "../lib/tauri";
import { MarkdownView } from "../components/MarkdownView";
import type { MarkdownParams } from "../types";

export default function MarkdownPanel({ params }: IDockviewPanelProps<MarkdownParams>) {
  const path = params?.path ?? "";
  const agent = params?.agent;
  const inlineContent = params?.content;
  const { settings } = useData();
  const projectRoots = useMemo(
    () =>
      settings.connections
        .filter((c) => c.type === "projects-root" && c.path)
        .map((c) => c.path as string),
    [settings.connections],
  );
  const [content, setContent] = useState<string>(inlineContent ?? "");
  const [loading, setLoading] = useState(inlineContent === undefined);
  const [error, setError] = useState("");
  const [rawMode, setRawMode] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (inlineContent !== undefined) {
      setContent(inlineContent);
      setError("");
      setLoading(false);
      return;
    }
    if (!path) {
      setError("Dosya yolu belirtilmedi");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const text = await api.readMarkdownFile(path, projectRoots);
      setContent(text);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [path, inlineContent, projectRoots]);

  useEffect(() => {
    load();
  }, [load]);

  const fileName = path.split(/[/\\]/).pop() || "Markdown";

  const copyAll = () => {
    navigator.clipboard?.writeText(content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="h-full w-full flex flex-col bg-[var(--surface)] text-[var(--txt-main)]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--surface-raised)] shrink-0">
        <FileText className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
        <span className="text-xs font-medium truncate" title={path}>
          {fileName}
        </span>
        {agent && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
            {agent}
          </span>
        )}
        <span className="text-[10px] font-mono text-[var(--txt-dim)] truncate hidden sm:inline" title={path}>
          {path}
        </span>
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setRawMode((v) => !v)}
            title={rawMode ? "Önizleme" : "Ham Markdown"}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-[var(--border)] bg-[var(--surface)] text-[var(--txt-muted)] hover:text-[var(--txt-main)] cursor-pointer"
          >
            {rawMode ? <Eye className="w-3 h-3" /> : <Code2 className="w-3 h-3" />}
            <span>{rawMode ? "Önizleme" : "Ham"}</span>
          </button>
          <button
            type="button"
            onClick={copyAll}
            title="İçeriği kopyala"
            className="p-1.5 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--txt-muted)] hover:text-[var(--txt-main)] cursor-pointer"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          </button>
          <button
            type="button"
            onClick={load}
            title="Yenile"
            className="p-1.5 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--txt-muted)] hover:text-[var(--txt-main)] cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="text-xs text-[var(--txt-dim)]">Yükleniyor…</div>
        ) : error ? (
          <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-300">{error}</div>
        ) : rawMode ? (
          <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap text-[var(--txt-main)] select-text">
            {content}
          </pre>
        ) : (
          <div className="max-w-3xl">
            <MarkdownView content={content} />
          </div>
        )}
      </div>
    </div>
  );
}
