import { Users } from "lucide-react";
import SessionsPanel from "../../panels/SessionsPanel";
import type { ModuleManifest } from "../../sdk/moduleSdk";

const manifest: ModuleManifest = {
  id: "sessions",
  title: "Oturumlar",
  description: "AGY, Claude Code ve Codex oturumları",
  icon: Users,
  component: SessionsPanel,
  width: 280,
  order: 50,
};

export default manifest;
