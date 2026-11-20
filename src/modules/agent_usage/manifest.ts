import { Bot } from "lucide-react";
import AgentUsagePanel from "../../panels/AgentUsagePanel";
import type { ModuleManifest } from "../../sdk/moduleSdk";

const manifest: ModuleManifest = {
  id: "agent_usage",
  title: "Ajan Durumu",
  description: "Model, token, maliyet, kota",
  icon: Bot,
  component: AgentUsagePanel,
  width: 320,
  order: 10,
};

export default manifest;
