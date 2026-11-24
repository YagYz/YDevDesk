import { Activity } from "lucide-react";
import ToolsPanel from "../../panels/ToolsPanel";
import type { ModuleManifest } from "../../sdk/moduleSdk";

const manifest: ModuleManifest = {
  id: "recent_tools",
  title: "Araç Akışı",
  description: "AGY, Claude ve Codex son araç çağrıları",
  icon: Activity,
  component: ToolsPanel,
  width: 320,
  order: 30,
};

export default manifest;
