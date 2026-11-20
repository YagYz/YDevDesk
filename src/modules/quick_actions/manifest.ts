import { Zap } from "lucide-react";
import QuickActionsPanel from "../../panels/QuickActionsPanel";
import type { ModuleManifest } from "../../sdk/moduleSdk";

const manifest: ModuleManifest = {
  id: "quick_actions",
  title: "Hızlı Eylemler",
  description: "Terminale tek tık komut",
  icon: Zap,
  component: QuickActionsPanel,
  width: 260,
  order: 100,
};

export default manifest;
