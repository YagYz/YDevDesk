import { Network } from "lucide-react";
import { useData } from "../context/DataContext";
import { formatSpeed } from "../lib/format";
import { Dot, Empty, PanelBody, Sparkline, Stat } from "../components/ui";

const LABEL = { unconfigured: "yapılandırılmadı", connecting: "bağlanıyor", live: "canlı", offline: "kopuk" } as const;

export default function NetworkPanel() {
  const { network, bandwidth } = useData();
  if (network.status === "unconfigured") {
    return (
      <PanelBody>
        <Empty icon={<Network className="w-5 h-5" />} title="YNetMon bağlı değil" hint="Ayarlar'dan YNetMon URL ve API anahtarını gir." />
      </PanelBody>
    );
  }
  return (
    <PanelBody className="space-y-3">
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--txt-muted)]">
        <Dot tone={network.status === "live" ? "ok" : network.status === "offline" ? "err" : "warn"} />
        {LABEL[network.status]}
      </div>
      <Sparkline values={bandwidth} />
      <div className="grid grid-cols-2 gap-2">
        <Stat label="İndirme" value={formatSpeed(network.rx_bps)} accent />
        <Stat label="Yükleme" value={formatSpeed(network.tx_bps)} />
        <Stat label="Bağlantı" value={network.active_conns} />
        <Stat label="Cihaz" value={network.devices} sub={`${network.db_packets} paket`} />
      </div>
    </PanelBody>
  );
}
