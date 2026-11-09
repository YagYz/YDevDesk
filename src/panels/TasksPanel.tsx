import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, ListTodo, Loader2, Plus, RefreshCw } from "lucide-react";
import { useData } from "../context/DataContext";
import { HubEmpty } from "../components/HubEmpty";
import { PanelBody } from "../components/ui";
import { api } from "../lib/tauri";
import type { Task } from "../types";

const PRIORITY: Record<string, string> = { high: "var(--err)", med: "var(--warn)", medium: "var(--warn)", low: "var(--txt-dim)" };

export default function TasksPanel() {
  const { config, hubStatus } = useData();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("med");
  const [busyId, setBusyId] = useState<number | null>(null);
  const cfgRef = useRef(config);
  cfgRef.current = config;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.tasks(cfgRef.current);
      setTasks(r?.success ? (r.tasks ?? []) : []);
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hubStatus !== "ok") return;
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [hubStatus, config.ydevhub_url, config.ydevhub_key, load]);

  if (hubStatus !== "ok") return <HubEmpty />;

  const add = async () => {
    const t = title.trim();
    if (!t) return;
    try {
      await api.createTask(cfgRef.current, t, priority);
      setTitle("");
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const complete = async (id: number) => {
    setBusyId(id);
    try {
      await api.completeTask(cfgRef.current, id);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const open = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");

  return (
    <PanelBody>
      <div className="flex gap-1 mb-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Yeni görev…"
          className="flex-1 min-w-0 rounded-md px-2 py-1 text-xs bg-[var(--surface-raised)] border border-[var(--border)] outline-none"
        />
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="rounded-md px-1 text-xs bg-[var(--surface-raised)] border border-[var(--border)]"
        >
          <option value="low">düşük</option>
          <option value="med">orta</option>
          <option value="high">yüksek</option>
        </select>
        <button onClick={add} title="Ekle" className="px-1.5 rounded-md border border-[var(--border)] hover:bg-[var(--surface-raised)]">
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button onClick={load} title="Yenile" className="px-1.5 rounded-md border border-[var(--border)] hover:bg-[var(--surface-raised)]">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      {error && <div className="text-[10px] text-[var(--err)] mb-1 break-all">{error}</div>}
      {tasks.length === 0 && !loading ? (
        <div className="text-center text-xs text-[var(--txt-dim)] py-6">
          <ListTodo className="w-5 h-5 mx-auto mb-1.5" />
          Görev yok.
        </div>
      ) : (
        <ul className="space-y-1">
          {[...open, ...done].map((t) => (
            <li key={t.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 bg-[var(--surface-raised)] border border-[var(--border)] text-xs">
              {t.status === "done" ? (
                <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-[var(--ok)] shrink-0" />
              ) : busyId === t.id ? (
                <Loader2 className="w-3.5 h-3.5 mt-0.5 animate-spin shrink-0" />
              ) : (
                <button onClick={() => complete(t.id)} title="Tamamla" className="shrink-0 mt-0.5">
                  <Circle className="w-3.5 h-3.5" style={{ color: PRIORITY[t.priority] ?? "var(--txt-dim)" }} />
                </button>
              )}
              <div className="min-w-0">
                <div className={t.status === "done" ? "line-through text-[var(--txt-dim)]" : ""}>{t.title}</div>
                <div className="text-[10px] text-[var(--txt-dim)] font-mono">
                  #{t.id} · {t.status}
                  {t.due_date ? ` · ⏰ ${t.due_date}` : ""}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PanelBody>
  );
}
