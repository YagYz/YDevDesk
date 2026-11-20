import { Brain } from "lucide-react";
import KnowledgePanel from "../../panels/KnowledgePanel";
import type { ModuleManifest } from "../../sdk/moduleSdk";

const manifest: ModuleManifest = {
  id: "knowledge",
  title: "Bilgi Ağı",
  description: "YDevHub hafıza kayıtları",
  icon: Brain,
  component: KnowledgePanel,
  width: 320,
  order: 90,
  requires: "ydevhub",
};

export default manifest;
