import { useState } from "react";
import { CloudOff, Loader2, PlugZap } from "lucide-react";
import { useData } from "../context/DataContext";
import { formatError } from "../lib/errors";
import { Empty, PanelBody } from "./ui";

export function HubEmpty() {
  const { hubStatus, hubError, refreshHub } = useData();
  const [showDetail, setShowDetail] = useState(false);

  if (hubStatus === "loading") {
    return (
      <PanelBody>
        <Empty icon={<Loader2 className="w-5 h-5 animate-spin" />} title="YDevHub'a bağlanılıyor…" />
      </PanelBody>
    );
  }
  if (hubStatus === "error") {
    const formatted = formatError(hubError, "hub");
    return (
      <PanelBody>
        <Empty icon={<CloudOff className="w-5 h-5 text-[var(--err)]" />} title="YDevHub'a ulaşılamadı" hint={formatted.message} />
        <div className="flex items-center justify-center gap-3">
          <button onClick={refreshHub} className="text-[11px] text-[var(--accent)] hover:underline cursor-pointer">
            Yeniden dene
          </button>
          {formatted.detail && formatted.detail !== formatted.message && (
            <button
              type="button"
              onClick={() => setShowDetail((v) => !v)}
              className="text-[11px] text-[var(--txt-dim)] hover:text-[var(--txt-muted)] hover:underline cursor-pointer"
            >
              {showDetail ? "Detayı gizle" : "Teknik detay"}
            </button>
          )}
        </div>
        {showDetail && formatted.detail && (
          <pre className="mt-2 mx-auto max-w-xs rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-[10px] font-mono text-[var(--txt-muted)] whitespace-pre-wrap break-all select-text">
            {formatted.detail}
          </pre>
        )}
      </PanelBody>
    );
  }
  return (
    <PanelBody>
      <Empty icon={<PlugZap className="w-5 h-5" />} title="YDevHub bağlı değil" hint="Ayarlar'dan URL ve API anahtarını gir." />
    </PanelBody>
  );
}
