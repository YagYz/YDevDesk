import { useEffect, useState } from "react";
import { CheckCircle2, Download, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api } from "../lib/tauri";
import { useData } from "../context/DataContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { Modal } from "./Modal";
import { AgentSetupContent } from "./AgentSetupModal";
import { MODULES } from "../panels/registry";
import { CONNECTION_TYPES, hasConnection, newId } from "../lib/settings";
import type { AppSettings, Connection, ConnectionType, UpdateCheckResult } from "../types";

type Tab = "connections" | "modules" | "commands" | "notifications" | "agents" | "update";

const TABS: { id: Tab; label: string }[] = [
  { id: "connections", label: "Bağlantılar" },
  { id: "modules", label: "Modüller" },
  { id: "commands", label: "Komutlar" },
  { id: "notifications", label: "Bildirimler" },
  { id: "agents", label: "Ajanlar" },
  { id: "update", label: "Sürüm" },
];

const input =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs font-mono outline-none focus:border-[var(--accent)] select-text";
const iconBtn = "p-1.5 rounded-md text-[var(--txt-dim)] hover:text-[var(--err)] hover:bg-[var(--surface-raised)]";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { settings, saveSettings } = useData();
  const ws = useWorkspace();
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [tab, setTab] = useState<Tab>("connections");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState("");
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateMsg, setUpdateMsg] = useState("");

  useEffect(() => {
    api.appVersion().then(setVersion).catch(() => {});
  }, []);

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateMsg("");
    setError("");
    try {
      const info = await api.checkUpdate();
      setUpdateInfo(info);
    } catch (e) {
      setError(String(e));
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!updateInfo?.asset_url) return;
    setInstallingUpdate(true);
    setUpdateMsg("");
    setError("");
    try {
      const msg = await api.installUpdate(updateInfo.asset_url);
      setUpdateMsg(msg);
    } catch (e) {
      setError(String(e));
      setInstallingUpdate(false);
    }
  };

  const patch = (p: Partial<AppSettings>) => setDraft((d) => ({ ...d, ...p }));

  const updateConn = (id: string, p: Partial<Connection>) =>
    patch({ connections: draft.connections.map((c) => (c.id === id ? { ...c, ...p } : c)) });

  const addConn = (type: ConnectionType) =>
    patch({ connections: [...draft.connections, { id: newId(), name: CONNECTION_TYPES[type].label, type }] });

  const toggleModuleEnabled = (id: string) =>
    patch({
      disabled_modules: draft.disabled_modules.includes(id) ? draft.disabled_modules.filter((m) => m !== id) : [...draft.disabled_modules, id],
    });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await saveSettings(draft);
      // Devre dışı bırakılan veya bağlantısı kalmayan açık modülleri kapat
      for (const m of MODULES) {
        const off = draft.disabled_modules.includes(m.id) || !hasConnection(draft, m.requires);
        if (off && ws.isModuleOpen(m.id)) ws.toggleModule(m.id);
      }
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="YDevDesk" className="w-5 h-5 rounded-md object-contain shadow-sm" />
          <span>Ayarlar</span>
        </div>
      }
      onClose={onClose}
      width={580}
    >
      <form onSubmit={submit} className="space-y-3">
        <div className="flex gap-1 border-b border-[var(--border)]">
          {TABS.map((t) => (
            <button
              type="button"
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-xs -mb-px border-b-2 ${tab === t.id ? "border-[var(--accent)] text-[var(--txt-main)]" : "border-transparent text-[var(--txt-muted)]"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "connections" && (
          <div className="space-y-2.5">
            {draft.connections.length === 0 && <p className="text-xs text-[var(--txt-dim)]">Bağlantı yok. Aşağıdan ekle.</p>}
            {draft.connections.map((c) => {
              const def = CONNECTION_TYPES[c.type];
              return (
                <div key={c.id} className="rounded-xl border border-[var(--border)] p-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-[var(--accent)] shrink-0">{def.label}</span>
                    <input value={c.name} onChange={(e) => updateConn(c.id, { name: e.target.value })} className={input} placeholder="Ad" />
                    <button type="button" title="Sil" className={iconBtn} onClick={() => patch({ connections: draft.connections.filter((x) => x.id !== c.id) })}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {def.fields.map((f) => (
                    <label key={f.key} className="block">
                      <span className="text-[11px] text-[var(--txt-muted)]">{f.label}</span>
                      <input
                        type={f.secret ? "password" : "text"}
                        value={c[f.key] ?? ""}
                        placeholder={f.placeholder}
                        onChange={(e) => updateConn(c.id, { [f.key]: e.target.value })}
                        className={`${input} mt-1`}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                  ))}
                </div>
              );
            })}
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(CONNECTION_TYPES) as ConnectionType[]).map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => addConn(t)}
                  title={CONNECTION_TYPES[t].hint}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] border border-[var(--border)] text-[var(--txt-muted)] hover:text-[var(--txt-main)] hover:bg-[var(--surface-raised)]"
                >
                  <Plus className="w-3 h-3" /> {CONNECTION_TYPES[t].label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-[var(--txt-dim)]">
              Ayarlar ~/.config/ydevdesk/settings.json içinde tutulur. İlk YDevHub/YNetMon bağlantıları ~/.config/ydevhub/config.json ile (ydev CLI) senkron kalır.
            </p>
          </div>
        )}

        {tab === "modules" && (
          <div className="space-y-1.5">
            {MODULES.map((m) => {
              const enabled = !draft.disabled_modules.includes(m.id);
              const ok = hasConnection(draft, m.requires);
              return (
                <label key={m.id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 border border-[var(--border)] cursor-pointer">
                  <input type="checkbox" checked={enabled} onChange={() => toggleModuleEnabled(m.id)} />
                  <m.icon className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-[var(--txt-main)]">{m.title}</span>
                    <span className="block text-[10px] text-[var(--txt-dim)] truncate">{m.description}</span>
                  </span>
                  {m.requires && (
                    <span className={`text-[10px] shrink-0 ${ok ? "text-[var(--ok)]" : "text-[var(--warn)]"}`}>
                      {CONNECTION_TYPES[m.requires].label}
                      {ok ? "" : " yok"}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}

        {tab === "commands" && (
          <div className="space-y-4">
            <section className="space-y-1.5">
              <h3 className="text-[11px] text-[var(--txt-muted)]">Hızlı eylemler</h3>
              {draft.quick_actions.map((a) => (
                <div key={a.id} className="flex gap-1.5">
                  <input
                    value={a.title}
                    placeholder="Ad"
                    onChange={(e) => patch({ quick_actions: draft.quick_actions.map((x) => (x.id === a.id ? { ...x, title: e.target.value } : x)) })}
                    className={`${input} w-1/3`}
                  />
                  <input
                    value={a.cmd}
                    placeholder="Komut"
                    onChange={(e) => patch({ quick_actions: draft.quick_actions.map((x) => (x.id === a.id ? { ...x, cmd: e.target.value } : x)) })}
                    className={input}
                    spellCheck={false}
                  />
                  <button type="button" className={iconBtn} onClick={() => patch({ quick_actions: draft.quick_actions.filter((x) => x.id !== a.id) })}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => patch({ quick_actions: [...draft.quick_actions, { id: newId(), title: "", cmd: "" }] })}
                className="flex items-center gap-1 text-[11px] text-[var(--accent)]"
              >
                <Plus className="w-3 h-3" /> Eylem ekle
              </button>
            </section>

            <section className="space-y-1.5">
              <h3 className="text-[11px] text-[var(--txt-muted)]">Yeni oturum ön ayarları</h3>
              {draft.terminal_presets.map((p) => {
                const set = (v: Partial<typeof p>) => patch({ terminal_presets: draft.terminal_presets.map((x) => (x.id === p.id ? { ...x, ...v } : x)) });
                return (
                  <div key={p.id} className="flex gap-1.5">
                    <input value={p.title} placeholder="Ad" onChange={(e) => set({ title: e.target.value })} className={`${input} w-1/4`} />
                    <input
                      value={p.initCmd ?? ""}
                      placeholder="Başlangıç komutu (boş = kabuk)"
                      onChange={(e) => set({ initCmd: e.target.value || undefined })}
                      className={input}
                      spellCheck={false}
                    />
                    <select value={p.kind} onChange={(e) => set({ kind: e.target.value as typeof p.kind })} className={`${input} w-24`}>
                      <option value="shell">kabuk</option>
                      <option value="agent">ajan</option>
                      <option value="server">sunucu</option>
                    </select>
                    <button type="button" className={iconBtn} onClick={() => patch({ terminal_presets: draft.terminal_presets.filter((x) => x.id !== p.id) })}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => patch({ terminal_presets: [...draft.terminal_presets, { id: newId(), title: "", description: "", kind: "shell" }] })}
                className="flex items-center gap-1 text-[11px] text-[var(--accent)]"
              >
                <Plus className="w-3 h-3" /> Ön ayar ekle
              </button>
            </section>
          </div>
        )}

        {tab === "notifications" && (
          <div className="space-y-1.5">
            {(
              [
                ["enabled", "Masaüstü bildirimleri"],
                ["agent_done", "Ajan bitti"],
                ["quota_low", "Kota azaldı"],
                ["service_down", "Servis koptu"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 border border-[var(--border)] text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.notifications[k]}
                  onChange={(e) => patch({ notifications: { ...draft.notifications, [k]: e.target.checked } })}
                />
                {label}
              </label>
            ))}
            <label className="flex items-center gap-2.5 px-2.5 text-xs text-[var(--txt-muted)]">
              Kota eşiği (%)
              <input
                type="number"
                min={1}
                max={99}
                value={draft.notifications.quota_threshold}
                onChange={(e) => patch({ notifications: { ...draft.notifications, quota_threshold: Number(e.target.value) || 20 } })}
                className={`${input} w-20`}
              />
            </label>
          </div>
        )}

        {tab === "agents" && (
          <div className="pt-1">
            <AgentSetupContent />
          </div>
        )}

        {tab === "update" && (
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <img src="/logo.png" alt="YDevDesk" className="w-10 h-10 rounded-xl object-contain shadow-md" />
                <div>
                  <div className="text-[11px] text-[var(--txt-muted)]">YDevDesk Sürümü</div>
                  <div className="font-mono text-sm font-semibold text-[var(--txt-main)]">v{version || "…"}</div>
                </div>
              </div>
              <button
                type="button"
                disabled={checkingUpdate || installingUpdate}
                onClick={handleCheckUpdate}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-xs text-[var(--txt-main)] hover:border-[var(--accent)] disabled:opacity-50"
              >
                {checkingUpdate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {checkingUpdate ? "Denetleniyor…" : "Güncellemeleri Denetle"}
              </button>
            </div>

            {updateInfo && (
              <div className="rounded-xl border border-[var(--border)] p-3 space-y-2.5">
                {updateInfo.has_update ? (
                  <>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-[var(--accent)]">Yeni sürüm mevcut: v{updateInfo.latest_version}</div>
                        <div className="text-[10px] text-[var(--txt-dim)] font-mono">{updateInfo.asset_name}</div>
                      </div>
                      <button
                        type="button"
                        disabled={installingUpdate}
                        onClick={handleInstallUpdate}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-black font-medium text-xs disabled:opacity-60"
                      >
                        {installingUpdate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                        {installingUpdate ? "İndiriliyor ve kuruluyor…" : "Güncelle ve Yeniden Başlat"}
                      </button>
                    </div>
                    {updateInfo.release_notes && (
                      <div className="text-[11px] text-[var(--txt-muted)] whitespace-pre-wrap border-t border-[var(--border)] pt-2">
                        {updateInfo.release_notes}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-[var(--ok)]">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Güncel sürümü kullanıyorsunuz (v{updateInfo.current_version}).</span>
                  </div>
                )}
              </div>
            )}

            {updateMsg && <p className="text-[11px] text-[var(--ok)]">{updateMsg}</p>}
            <p className="text-[10px] text-[var(--txt-dim)]">
              Otomatik güncelleme kapalıdır; yalnızca buradan tetiklediğinizde GitHub Releases üzerinden indirip kurar.
            </p>
          </div>
        )}

        {error && <p className="text-[11px] text-[var(--err)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-[var(--txt-muted)] hover:bg-[var(--surface-raised)]">
            Vazgeç
          </button>
          <button disabled={saving} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent)] text-black disabled:opacity-60">
            {saving ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
