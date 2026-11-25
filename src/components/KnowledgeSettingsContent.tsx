import { useCallback, useEffect, useState } from "react";
import { Brain, Loader2 } from "lucide-react";
import { api } from "../lib/tauri";
import { ErrorBanner } from "./ui";
import type { KnowledgeRunMode, KnowledgeSettings, KnowledgeStatus, KnowledgeStorage } from "../types";

const STORAGE_OPTIONS: { id: KnowledgeStorage; label: string; hint: string; needsHub: boolean }[] = [
  { id: "local", label: "Yerel", hint: "Yalnızca bu cihazdaki SQLite veritabanı", needsHub: false },
  { id: "hub", label: "YDevHub", hint: "Yalnızca YDevHub", needsHub: true },
  { id: "both", label: "İkisi birden", hint: "Yerel kayıt + YDevHub'a eşleme", needsHub: true },
];

const RUN_MODE_OPTIONS: { id: KnowledgeRunMode; label: string }[] = [
  { id: "off", label: "Kapalı" },
  { id: "app_open", label: "Yalnızca uygulama açıkken" },
  { id: "always", label: "Her zaman" },
];

const input =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs font-mono outline-none focus:border-[var(--accent)] select-text";

export function KnowledgeSettingsContent() {
  const [settings, setSettings] = useState<KnowledgeSettings | null>(null);
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [dbPath, setDbPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.knowledgeStatus());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    api
      .knowledgeGetSettings()
      .then((s) => {
        setSettings(s);
        setDbPath(s.db_path ?? "");
      })
      .catch((e) => setError(String(e)));
    void refreshStatus();
  }, [refreshStatus]);

  const hubConfigured = status?.hub_configured ?? false;

  const persist = async (next: KnowledgeSettings) => {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await api.knowledgeSaveSettings(next);
      setSettings(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      await refreshStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return (
      <div className="space-y-3 text-xs">
        <div className="inline-flex items-center gap-1.5 text-[var(--txt-dim)]">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Yükleniyor…
        </div>
        <ErrorBanner error={error} context="settings" />
      </div>
    );
  }

  const radio = (checked: boolean, disabled = false) =>
    `flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-[11px] select-none ${
      disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
    } ${checked ? "border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--txt-main)]" : "border-[var(--border)] text-[var(--txt-muted)]"}`;

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center gap-2">
        <Brain className="w-4 h-4 text-[var(--accent)] shrink-0" />
        <div className="font-medium text-[var(--txt-main)]">Bilgi Ağı</div>
        {saved && <span className="text-[10px] text-[var(--ok)]">Kaydedildi</span>}
      </div>

      <div className="rounded-lg border border-[var(--border)] p-3 space-y-2">
        <div className="text-[11px] font-medium text-[var(--txt-main)]">Depolama</div>
        <div className="space-y-1.5">
          {STORAGE_OPTIONS.map((o) => {
            const disabled = busy || (o.needsHub && !hubConfigured);
            return (
              <label key={o.id} className={radio(settings.storage === o.id, o.needsHub && !hubConfigured)}>
                <input
                  type="radio"
                  name="knowledge-storage"
                  checked={settings.storage === o.id}
                  disabled={disabled}
                  onChange={() => void persist({ ...settings, storage: o.id })}
                  className="mt-0.5 accent-[var(--accent)]"
                />
                <span>
                  <span className="font-medium">{o.label}</span>
                  <span className="block text-[10px] text-[var(--txt-dim)]">{o.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
        {hubConfigured ? (
          <div className="text-[10px] text-[var(--txt-dim)]">
            Hub: <span className="font-mono text-[var(--txt-muted)]">{status?.hub_url}</span>
          </div>
        ) : (
          <div className="text-[10px] text-[var(--warn)]">
            YDevHub yapılandırılmamış. Bağlantılar sekmesinden ekleyin.
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[var(--border)] p-3 space-y-2">
        <div className="text-[11px] font-medium text-[var(--txt-main)]">Çalışma izni</div>
        <div className="space-y-1.5">
          {RUN_MODE_OPTIONS.map((o) => (
            <label key={o.id} className={radio(settings.run_mode === o.id)}>
              <input
                type="radio"
                name="knowledge-run-mode"
                checked={settings.run_mode === o.id}
                disabled={busy}
                onChange={() => void persist({ ...settings, run_mode: o.id })}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <span className="font-medium">{o.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] p-3 space-y-2">
        <div className="text-[11px] font-medium text-[var(--txt-main)]">Veritabanı yolu</div>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={dbPath}
            onChange={(e) => setDbPath(e.target.value)}
            placeholder={status?.db_path || "Varsayılan konum"}
            className={input}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void persist({ ...settings, db_path: dbPath.trim() || null })}
            className="px-3 py-1 rounded-md bg-[var(--accent)] text-black text-[11px] font-medium disabled:opacity-50 cursor-pointer shrink-0"
          >
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </div>
        <div className="text-[10px] text-[var(--txt-dim)]">Boş bırakılırsa varsayılan konum kullanılır.</div>
      </div>

      {status && (
        <div className="text-[11px] text-[var(--txt-muted)] font-mono">
          {status.entries} kayıt · kuyrukta {status.outbox}
        </div>
      )}

      <ErrorBanner error={error} context="settings" />

      <p className="text-[10px] text-[var(--txt-dim)]">
        MCP sunucusu arka plan servisi değildir; yalnızca ajan oturumu açıkken ajan tarafından başlatılır ve oturumla kapanır.
      </p>
    </div>
  );
}
