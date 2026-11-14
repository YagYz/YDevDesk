import { useState } from "react";
import { Download, ExternalLink, Loader2, Sparkles, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useData } from "../context/DataContext";
import { api } from "../lib/tauri";

export function UpdatePopup({ onOpenDetails }: { onOpenDetails: () => void }) {
  const { availableUpdate, dismissUpdate } = useData();
  const [installing, setInstalling] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  if (!availableUpdate) return null;

  const handleInstall = async () => {
    if (!availableUpdate.asset_url) {
      openUrl(availableUpdate.html_url).catch(() => {});
      return;
    }
    setInstalling(true);
    setStatusMsg("");
    try {
      const msg = await api.installUpdate(availableUpdate.asset_url);
      setStatusMsg(msg);
    } catch (e) {
      setStatusMsg(String(e));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="fixed bottom-9 right-4 z-50 w-80 rounded-xl border border-[var(--accent)]/40 bg-[var(--surface)]/95 backdrop-blur-md shadow-2xl p-3 space-y-2.5 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-[var(--accent)]/15 text-[var(--accent)] shrink-0">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-[var(--txt-main)] truncate">
              Yeni Sürüm: v{availableUpdate.latest_version}
            </div>
            <div className="text-[10px] font-mono text-[var(--txt-dim)]">
              Mevcut: v{availableUpdate.current_version}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={dismissUpdate}
          title="Sonra"
          className="p-1 rounded text-[var(--txt-dim)] hover:text-[var(--txt-main)] hover:bg-[var(--surface-raised)] cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {statusMsg && (
        <div className="text-[11px] font-mono text-[var(--accent)] bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 break-words">
          {statusMsg}
        </div>
      )}

      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onOpenDetails}
          className="px-2 py-1 rounded-md border border-[var(--border)] text-[var(--txt-muted)] hover:text-[var(--txt-main)] hover:bg-[var(--surface-raised)] flex items-center gap-1 cursor-pointer"
        >
          <ExternalLink className="w-3 h-3" />
          Detaylar
        </button>
        <button
          type="button"
          disabled={installing}
          onClick={handleInstall}
          className="px-2.5 py-1 rounded-md bg-[var(--accent)] text-black font-semibold hover:brightness-110 disabled:opacity-60 flex items-center gap-1 cursor-pointer"
        >
          {installing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
          {installing ? "Kuruluyor..." : "Şimdi Güncelle"}
        </button>
      </div>
    </div>
  );
}
