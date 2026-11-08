import { Bot } from "lucide-react";
import { useData } from "../context/DataContext";
import { formatTokens } from "../lib/format";
import { Bar, Dot, PanelBody, Stat } from "../components/ui";

export default function AgentUsagePanel() {
  const { agent } = useData();
  const working = agent.agent_state === "working";
  const quotaTone = (p: number) => (p < 15 ? "warn" : "ok");
  return (
    <PanelBody className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <Bot className="w-4 h-4 text-[var(--accent)]" />
        <span className="font-semibold truncate">{agent.model}</span>
        <span className="ml-auto flex items-center gap-1.5 text-[var(--txt-muted)]">
          <Dot tone={working ? "ok" : "idle"} />
          {working ? "çalışıyor" : "boşta"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Girdi" value={formatTokens(agent.total_input_tokens)} sub="token" />
        <Stat label="Çıktı" value={formatTokens(agent.total_output_tokens)} sub="token" />
        <Stat label="Maliyet" value={`$${agent.session_cost.toFixed(3)}`} accent />
        <Stat label="Araç/dk" value={agent.tools_per_minute} />
      </div>
      <div className="space-y-2.5">
        <Bar label="Bağlam kullanımı" percent={agent.used_percentage} tone={agent.used_percentage > 85 ? "warn" : "accent"} />
        <Bar label="5 saatlik kota (kalan)" percent={agent.quota_5h_percent} tone={quotaTone(agent.quota_5h_percent)} />
        <Bar label="Haftalık kota (kalan)" percent={agent.quota_weekly_percent} tone={quotaTone(agent.quota_weekly_percent)} />
      </div>
    </PanelBody>
  );
}
