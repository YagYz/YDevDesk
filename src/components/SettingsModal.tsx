import { useEffect, useState } from "react";
import {
  Bell,
  Bot,
  Brain,
  CheckCircle2,
  Download,
  LayoutGrid,
  Link2,
  Loader2,
  Palette,
  Plug,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { api } from "../lib/tauri";
import { useData } from "../context/DataContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { ErrorBanner } from "./ui";
import { AgentSetupContent } from "./AgentSetupModal";
import { KnowledgeSettingsContent } from "./KnowledgeSettingsContent";
import { SyncSettingsContent } from "./SyncSettingsContent";
import { PluginsSettingsTab, ThemesSettingsTab } from "./ThemesPluginsTabs";
import { MODULES } from "../panels/registry";
import { CONNECTION_TYPES, hasConnection, newId } from "../lib/settings";
import { playChime } from "../lib/sound";
import { notify } from "../lib/notify";
import type { AppSettings, Connection, ConnectionType, UpdateCheckResult } from "../types";

export type SettingsTab = "connections" | "modules" | "themes" | "plugins" | "commands" | "notifications" | "agents" | "knowledge" | "sync" | "update";

const TABS: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  { id: "connections", label: "Bağlantılar", icon: Link2 },
  { id: "modules", label: "Modüller", icon: LayoutGrid },
  { id: "themes", label: "Temalar", icon: Palette },
  { id: "plugins", label: "Eklentiler", icon: Plug },
  { id: "commands", label: "Komutlar", icon: Terminal },
  { id: "notifications", label: "Bildirimler", icon: Bell },
  { id: "agents", label: "Ajanlar", icon: Bot },
  { id: "knowledge", label: "Bilgi Ağı", icon: Brain },
  { id: "sync", label: "Senkronizasyon", icon: RefreshCw },
  { id: "update", label: "Sürüm", icon: Download },
];

const input =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs font-mono outline-none focus:border-[var(--accent)] select-text";
const iconBtn = "p-1.5 rounded-md text-[var(--txt-dim)] hover:text-[var(--err)] hover:bg-[var(--surface-raised)]";

export function SettingsModal({ onClose, initialTab = "connections" }: { onClose: () => void; initialTab?: SettingsTab }) {
  const { settings, saveSettings } = useData();
  const ws = useWorkspace();
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [tab, setTab] = useState<SettingsTab>(initialTab);
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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 backdrop-blur-sm"
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-[920px] max-w-[94vw] h-[640px] max-h-[88vh] rounded-lg border border-[var(--border-glow)] bg-[var(--surface)] shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface-raised)] shrink-0">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--txt-main)]">
            <img src="/logo.png" alt="YDevDesk" className="w-5 h-5 rounded-md object-contain shadow-sm" />
            <span>Ayarlar</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="p-1 rounded-md text-[var(--txt-muted)] hover:text-[var(--txt-main)] hover:bg-[var(--bg)]/60 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <nav className="w-48 shrink-0 border-r border-[var(--border)] bg-[var(--bg)]/60 p-2 overflow-y-auto flex flex-col gap-0.5">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md text-xs text-left transition-colors cursor-pointer ${
                    active
                      ? "bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30 font-medium"
                      : "border border-transparent text-[var(--txt-muted)] hover:text-[var(--txt-main)] hover:bg-[var(--surface-raised)]"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{t.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-5">

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
                ["sound_enabled", "Sesli bildirim (Chime)"],
                ["agent_done", "Ajan bitti"],
                ["quota_low", "Kota azaldı"],
                ["service_down", "Servis koptu"],
                ["app_update", "Uygulama güncellemesi"],
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
            <div className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 border border-[var(--border)] text-xs">
              <span className="text-[var(--txt-muted)]">Bildirim Sesi</span>
              <select
                value={draft.notifications.sound_preset ?? "notify2"}
                onChange={(e) =>
                  patch({
                    notifications: {
                      ...draft.notifications,
                      sound_preset: e.target.value as "notify" | "notify2",
                    },
                  })
                }
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs outline-none focus:border-[var(--accent)]"
              >
                <option value="notify">Bildirim Sesi 1 (Kristal)</option>
                <option value="notify2">Bildirim Sesi 2 (Yumuşak)</option>
              </select>
            </div>
            <div className="flex items-center justify-between px-2.5 pt-1">
              <label className="flex items-center gap-2.5 text-xs text-[var(--txt-muted)]">
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
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => playChime("done")}
                  className="px-2.5 py-1 rounded-lg border border-[var(--border)] text-xs text-[var(--txt-muted)] hover:text-[var(--txt-main)] hover:bg-[var(--surface-raised)]"
                >
                  Ajan Sesi Test
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const preset = draft.notifications.sound_preset ?? "notify2";
                    playChime(preset);
                    notify("YDevDesk", "Masaüstü bildirimi ve seçili bildirim sesi aktif.");
                  }}
                  className="px-2.5 py-1 rounded-lg border border-[var(--border)] text-xs text-[var(--txt-muted)] hover:text-[var(--txt-main)] hover:bg-[var(--surface-raised)]"
                >
                  Bildirim + Sesi Test Et
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === "agents" && (
          <div className="pt-1">
            <AgentSetupContent />
          </div>
        )}

        {tab === "knowledge" && <KnowledgeSettingsContent />}

        {tab === "sync" && <SyncSettingsContent />}

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

            {tab === "themes" && <ThemesSettingsTab draft={draft} onChange={setDraft} />}

            {tab === "plugins" && <PluginsSettingsTab onCloseModal={onClose} />}
          </div>
        </div>

        <div className="border-t border-[var(--border)] bg-[var(--surface-raised)]/60 px-5 py-2.5 flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0 flex-1">
            <ErrorBanner error={error} context={tab === "update" ? "update" : "settings"} />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-[var(--txt-muted)] hover:bg-[var(--surface-raised)] cursor-pointer">
              Vazgeç
            </button>
            <button disabled={saving} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent)] text-black disabled:opacity-60 cursor-pointer">
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
