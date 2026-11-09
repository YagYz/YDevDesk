import { CloudOff, Loader2, PlugZap } from "lucide-react";
import { useData } from "../context/DataContext";
import { Empty, PanelBody } from "./ui";

export function HubEmpty() {
  const { hubStatus, hubError, refreshHub } = useData();
  if (hubStatus === "loading") {
    return (
      <PanelBody>
        <Empty icon={<Loader2 className="w-5 h-5 animate-spin" />} title="YDevHub'a bağlanılıyor…" />
      </PanelBody>
    );
  }
  if (hubStatus === "error") {
    return (
      <PanelBody>
        <Empty icon={<CloudOff className="w-5 h-5 text-[var(--err)]" />} title="YDevHub'a ulaşılamadı" hint={hubError} />
        <button onClick={refreshHub} className="mx-auto block text-[11px] text-[var(--accent)] hover:underline">
          Yeniden dene
        </button>
      </PanelBody>
    );
  }
  return (
    <PanelBody>
      <Empty icon={<PlugZap className="w-5 h-5" />} title="YDevHub bağlı değil" hint="Ayarlar'dan URL ve API anahtarını gir." />
    </PanelBody>
  );
}
