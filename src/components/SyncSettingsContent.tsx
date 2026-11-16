import { useEffect, useState } from "react";
import { Cloud, Copy, Eye, EyeOff, ExternalLink, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useData } from "../context/DataContext";
import { api } from "../lib/tauri";
import { generateSyncKey } from "../lib/syncCrypto";
import { ErrorBanner } from "./ui";
import { Modal } from "./Modal";
import type { DeviceFlowStart } from "../types";

const SYNC_DOCS_URL = "https://yagyz.github.io/YDevDesk/sync.html";
const HIDE_SYNC_LAUNCH_KEY = "ydevdesk_hide_sync_setup_on_launch";

export function shouldShowSyncSetupOnLaunch(): boolean {
  return localStorage.getItem(HIDE_SYNC_LAUNCH_KEY) !== "true";
}

export function SyncSettingsContent() {
  const {
    syncStatus,
    syncPrefs,
    updateSyncPrefs,
    syncing,
    needsSyncKey,
    lastSyncedAt,
    syncError,
    refreshSyncStatus,
    syncNow,
    submitSyncKey,
  } = useData();

  const [deviceFlow, setDeviceFlow] = useState<DeviceFlowStart | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);
  const [syncKeyInput, setSyncKeyInput] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copiedSyncKey, setCopiedSyncKey] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);

  useEffect(() => {
    if (!deviceFlow) return;
    let cancelled = false;
    let delayMs = Math.max(deviceFlow.interval, 5) * 1000;
    let timer: number | undefined;

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await api.syncPollAuth(deviceFlow.device_code);
        if (cancelled) return;
        if (res.status === "authorized") {
          setDeviceFlow(null);
          setAuthBusy(false);
          setAuthError("");
          await refreshSyncStatus();
          void syncNow(true);
          return;
        }
        if (res.status === "slow_down") {
          delayMs = Math.max((res.interval ?? 10) * 1000, delayMs + 5000);
        }
        timer = window.setTimeout(poll, delayMs);
      } catch (e) {
        if (!cancelled) {
          setAuthError(String(e));
          setDeviceFlow(null);
          setAuthBusy(false);
        }
      }
    };

    timer = window.setTimeout(poll, delayMs);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [deviceFlow, refreshSyncStatus, syncNow]);

  const handleStartGitHubAuth = async () => {
    setAuthBusy(true);
    setAuthError("");
    try {
      const flow = await api.syncStartAuth();
      setDeviceFlow(flow);
      openUrl(flow.verification_uri).catch(() => {});
    } catch (e) {
      setAuthError(String(e));
      setAuthBusy(false);
    }
  };

  const handleDisconnectGitHub = async () => {
    setAuthError("");
    setRevealedKey(null);
    try {
      await api.syncDisconnect();
      await refreshSyncStatus();
    } catch (e) {
      setAuthError(String(e));
    }
  };

  const handleUnlockWithKey = async () => {
    const k = syncKeyInput.trim();
    if (!k) return;
    setKeyBusy(true);
    setAuthError("");
    try {
      await submitSyncKey(k);
      setSyncKeyInput("");
    } catch (e) {
      setAuthError(String(e));
    } finally {
      setKeyBusy(false);
    }
  };

  const handleToggleRevealKey = async () => {
    if (revealedKey) {
      setRevealedKey(null);
      return;
    }
    try {
      const k = await api.syncGetKey();
      setRevealedKey(k ?? "");
    } catch (e) {
      setAuthError(String(e));
    }
  };

  const handleCopySyncKey = async () => {
    try {
      const k = revealedKey ?? (await api.syncGetKey());
      if (!k) return;
      await navigator.clipboard?.writeText(k);
      setCopiedSyncKey(true);
      setTimeout(() => setCopiedSyncKey(false), 1500);
    } catch {
      // ignore
    }
  };

  const handleRotateSyncKey = async () => {
    setAuthError("");
    try {
      const next = generateSyncKey();
      await api.syncSetKey(next);
      setRevealedKey(next);
      await refreshSyncStatus();
      await syncNow(true);
    } catch (e) {
      setAuthError(String(e));
    }
  };

  return (
    <div className="space-y-3 text-xs">
      <div className="rounded-lg border border-[var(--border)] p-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Cloud className="w-4 h-4 text-[var(--accent)] shrink-0" />
            <div className="min-w-0">
              <div className="font-medium text-[var(--txt-main)]">GitHub Gist Canlı Senkronizasyon</div>
              <div className="text-[11px] text-[var(--txt-dim)]">
                Ayarlar, çalışma alanları, oturum tercihleri ve birleşik token analitiği.{" "}
                <button
                  type="button"
                  onClick={() => openUrl(SYNC_DOCS_URL).catch(() => {})}
                  className="text-[var(--accent)] hover:underline inline-flex items-center gap-0.5 cursor-pointer"
                >
                  Nasıl çalışır?
                  <ExternalLink className="w-2.5 h-2.5" />
                </button>
              </div>
            </div>
          </div>
          {syncStatus?.connected && (
            <span className="px-2 py-0.5 rounded bg-[var(--surface-raised)] border border-[var(--border)] text-emerald-400 text-[10px] font-mono shrink-0">
              @{syncStatus.login}
            </span>
          )}
        </div>

        {!syncStatus?.connected ? (
          <div className="pt-1">
            {!deviceFlow ? (
              <button
                type="button"
                disabled={authBusy}
                onClick={handleStartGitHubAuth}
                className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-black font-medium hover:opacity-90 disabled:opacity-60 inline-flex items-center gap-1.5 cursor-pointer"
              >
                {authBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Cloud className="w-3.5 h-3.5" />}
                GitHub ile Bağlan
              </button>
            ) : (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5 space-y-2">
                <div className="text-[11px] text-[var(--txt-muted)]">
                  Tarayıcıda açılan GitHub sayfasına doğrulama kodunu gir:
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="px-2.5 py-1 rounded-md bg-[var(--surface-raised)] border border-[var(--border)] font-mono text-sm font-bold tracking-widest text-[var(--accent)] select-all">
                    {deviceFlow.user_code}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(deviceFlow.user_code).catch(() => {});
                      setCopiedCode(true);
                      setTimeout(() => setCopiedCode(false), 1500);
                    }}
                    className="px-2 py-1 rounded-md border border-[var(--border)] text-[11px] text-[var(--txt-muted)] hover:text-[var(--txt-main)] hover:bg-[var(--surface-raised)] inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    {copiedCode ? "Kopyalandı" : "Kopyala"}
                  </button>
                  <button
                    type="button"
                    onClick={() => openUrl(deviceFlow.verification_uri).catch(() => {})}
                    className="px-2 py-1 rounded-md border border-[var(--border)] text-[11px] text-[var(--accent)] hover:bg-[var(--surface-raised)] inline-flex items-center gap-1 cursor-pointer"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Sayfayı Aç
                  </button>
                </div>
                <div className="flex items-center justify-between text-[10px] text-[var(--txt-dim)] pt-0.5">
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    GitHub onayı bekleniyor…
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setDeviceFlow(null);
                      setAuthBusy(false);
                    }}
                    className="text-[var(--err)] hover:underline cursor-pointer"
                  >
                    İptal
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2.5 pt-1 border-t border-[var(--border)]">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--txt-muted)]">
              <span>
                Bu cihaz: <span className="text-[var(--txt-main)] font-mono">{syncStatus.device_name}</span>
              </span>
              <span className="font-mono text-[10px] text-[var(--txt-dim)]">
                {lastSyncedAt
                  ? `Son sync: ${new Date(lastSyncedAt).toLocaleTimeString("tr-TR")}`
                  : "Henüz senkronize edilmedi"}
              </span>
            </div>

            <label className="flex items-center gap-2 text-[11px] text-[var(--txt-muted)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={syncPrefs.sync_layout}
                onChange={(e) => updateSyncPrefs({ ...syncPrefs, sync_layout: e.target.checked })}
                className="accent-[var(--accent)]"
              />
              <span>Panel düzenini (Layout) cihazlar arası senkronize et</span>
            </label>

            {needsSyncKey && (
              <div className="rounded-lg border border-[var(--warn)]/40 bg-[var(--bg)] p-2.5 space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] text-[var(--warn)] font-medium">
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Şifreli Sync Anahtarı Gerekli</span>
                </div>
                <p className="text-[10px] text-[var(--txt-dim)]">
                  GitHub'daki veriler uçtan uca şifreli. İlk cihazındaki <code>YDEV-...</code> anahtarını gir:
                </p>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={syncKeyInput}
                    onChange={(e) => setSyncKeyInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleUnlockWithKey();
                      }
                    }}
                    placeholder="YDEV-XXXX-XXXX-XXXX-XXXX"
                    className="flex-1 min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1 text-xs font-mono outline-none focus:border-[var(--accent)] select-text"
                  />
                  <button
                    type="button"
                    disabled={keyBusy || !syncKeyInput.trim()}
                    onClick={() => void handleUnlockWithKey()}
                    className="px-2.5 py-1 rounded-md bg-[var(--accent)] text-black text-[11px] font-medium disabled:opacity-50 cursor-pointer"
                  >
                    {keyBusy ? "Çözülüyor…" : "Çöz"}
                  </button>
                </div>
              </div>
            )}

            {syncStatus.has_sync_key && !needsSyncKey && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] text-[var(--txt-dim)]">Uçtan Uca Şifreleme Anahtarı (2. cihaz için)</div>
                  <div className="font-mono text-[11px] text-[var(--txt-main)] truncate select-all">
                    {revealedKey ?? "YDEV-••••-••••-••••-••••"}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleToggleRevealKey()}
                    title={revealedKey ? "Gizle" : "Göster"}
                    className="p-1.5 rounded-md border border-[var(--border)] text-[var(--txt-muted)] hover:text-[var(--txt-main)] cursor-pointer"
                  >
                    {revealedKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopySyncKey()}
                    className="px-2 py-1 rounded-md border border-[var(--border)] text-[10px] text-[var(--txt-muted)] hover:text-[var(--txt-main)] inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    {copiedSyncKey ? "Kopyalandı" : "Kopyala"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRotateSyncKey()}
                    title="Yeni şifreleme anahtarı üret ve Gist'i güncelle"
                    className="px-2 py-1 rounded-md border border-[var(--border)] text-[10px] text-[var(--txt-muted)] hover:text-[var(--txt-main)] cursor-pointer"
                  >
                    Yenile
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={syncing}
                onClick={() => void syncNow(true)}
                className="px-2.5 py-1 rounded-lg border border-[var(--border)] text-[11px] text-[var(--txt-main)] hover:bg-[var(--surface-raised)] disabled:opacity-60 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Senkronize ediliyor…" : "Şimdi Senkronize Et"}
              </button>
              <button
                type="button"
                onClick={handleDisconnectGitHub}
                className="ml-auto px-2.5 py-1 rounded-lg border border-[var(--border)] text-[11px] text-[var(--err)] hover:bg-[var(--err)]/10 cursor-pointer"
              >
                Bağlantıyı Kes
              </button>
            </div>
          </div>
        )}
      </div>

      <ErrorBanner error={authError || syncError} context="update" />

      <p className="text-[10px] text-[var(--txt-dim)]">
        Gizlilik: Yerel proje yolları (<code>projects-root</code>) ve API anahtarları senkronize edilmez.{" "}
        <button
          type="button"
          onClick={() => openUrl(SYNC_DOCS_URL).catch(() => {})}
          className="text-[var(--accent)] hover:underline cursor-pointer"
        >
          Senkronizasyon detaylarını incele
        </button>
      </p>
    </div>
  );
}

export function SyncSetupModal({ onClose }: { onClose: () => void }) {
  const { syncStatus } = useData();
  const [dontShowAgain, setDontShowAgain] = useState(
    () => localStorage.getItem(HIDE_SYNC_LAUNCH_KEY) === "true",
  );

  useEffect(() => {
    if (syncStatus?.connected) {
      localStorage.setItem(HIDE_SYNC_LAUNCH_KEY, "true");
    }
  }, [syncStatus?.connected]);

  const toggleDontShow = (val: boolean) => {
    setDontShowAgain(val);
    localStorage.setItem(HIDE_SYNC_LAUNCH_KEY, String(val));
  };

  return (
    <Modal title="Çoklu Cihaz Senkronizasyonu" onClose={onClose} width={520}>
      <div className="space-y-3">
        <p className="text-xs text-[var(--txt-muted)]">
          Ayarlarını, çalışma alanlarını ve token analitiğini tüm cihazlarında canlı tutmak için GitHub hesabını bağlayabilirsin.
        </p>
        <SyncSettingsContent />
        <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
          <label className="flex items-center gap-2 text-xs text-[var(--txt-muted)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => toggleDontShow(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <span>Açılışta tekrar gösterme</span>
          </label>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs text-[var(--txt-muted)] hover:bg-[var(--surface-raised)] cursor-pointer"
          >
            {syncStatus?.connected ? "Tamam" : "Sonra"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
