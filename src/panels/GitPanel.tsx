import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, GitBranch, GitPullRequest, RefreshCw } from "lucide-react";
import { PanelBody } from "../components/ui";
import { api } from "../lib/tauri";

type GitInfo = {
  branch: string;
  ahead: number;
  behind: number;
  changes: { status: string; path: string }[];
  last_commit: string;
  pr: { number: number; title: string; state: string; url: string; isDraft: boolean } | null;
};

const STORE_KEY = "ydevdesk.git.project";
const STATUS_COLOR: Record<string, string> = { M: "var(--warn)", A: "var(--ok)", D: "var(--err)", "??": "var(--txt-dim)" };

export default function GitPanel() {
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState(() => localStorage.getItem(STORE_KEY) ?? "");
  const [info, setInfo] = useState<GitInfo | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .gitProjects()
      .then((p) => {
        setProjects(p);
        setProject((cur) => (cur && p.includes(cur) ? cur : (p[0] ?? "")));
      })
      .catch((e) => setError(String(e)));
  }, []);

  const load = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    try {
      setInfo(await api.gitStatus(project));
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  const prColor = (s: string) => (s === "OPEN" ? "var(--ok)" : s === "MERGED" ? "var(--accent)" : "var(--txt-dim)");

  return (
    <PanelBody>
      <div className="flex gap-1 mb-2">
        <select
          value={project}
          onChange={(e) => {
            setProject(e.target.value);
            localStorage.setItem(STORE_KEY, e.target.value);
          }}
          className="flex-1 min-w-0 rounded-md px-1.5 py-1 text-xs bg-[var(--surface-raised)] border border-[var(--border)]"
        >
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button onClick={load} title="Yenile" className="px-1.5 rounded-md border border-[var(--border)] hover:bg-[var(--surface-raised)]">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      {error && <div className="text-[10px] text-[var(--err)] mb-1 break-all">{error}</div>}
      {info && (
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <GitBranch className="w-3.5 h-3.5 shrink-0" />
            <span className="font-mono truncate">{info.branch}</span>
            {info.ahead > 0 && (
              <span className="flex items-center text-[var(--ok)] font-mono">
                <ArrowUp className="w-3 h-3" />
                {info.ahead}
              </span>
            )}
            {info.behind > 0 && (
              <span className="flex items-center text-[var(--warn)] font-mono">
                <ArrowDown className="w-3 h-3" />
                {info.behind}
              </span>
            )}
          </div>
          <div className="text-[10px] text-[var(--txt-dim)] font-mono truncate">{info.last_commit}</div>
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5 bg-[var(--surface-raised)] border border-[var(--border)]">
            <GitPullRequest className="w-3.5 h-3.5 shrink-0" style={{ color: info.pr ? prColor(info.pr.state) : "var(--txt-dim)" }} />
            {info.pr ? (
              <div className="min-w-0">
                <div className="truncate">
                  #{info.pr.number} {info.pr.title}
                </div>
                <div className="text-[10px] font-mono" style={{ color: prColor(info.pr.state) }}>
                  {info.pr.isDraft ? "DRAFT" : info.pr.state}
                </div>
              </div>
            ) : (
              <span className="text-[var(--txt-dim)]">Bu branch için PR yok</span>
            )}
          </div>
          <div>
            <div className="text-[10px] text-[var(--txt-dim)] mb-1">Değişen dosyalar ({info.changes.length})</div>
            {info.changes.length === 0 ? (
              <div className="text-[var(--txt-dim)]">Çalışma ağacı temiz.</div>
            ) : (
              <ul className="space-y-0.5 max-h-60 overflow-auto">
                {info.changes.map((c) => (
                  <li key={c.path} className="flex gap-2 font-mono text-[11px]">
                    <span className="w-5 shrink-0" style={{ color: STATUS_COLOR[c.status] ?? "var(--txt)" }}>
                      {c.status}
                    </span>
                    <span className="truncate">{c.path}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </PanelBody>
  );
}
