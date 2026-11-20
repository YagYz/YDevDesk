import { Network } from "lucide-react";
import NetworkPanel from "../../panels/NetworkPanel";
import type { ModuleManifest } from "../../sdk/moduleSdk";

const manifest: ModuleManifest = {
  id: "network",
  title: "YNetMon Ağ",
  description: "Canlı trafik ve cihazlar",
  icon: Network,
  component: NetworkPanel,
  width: 320,
  order: 20,
  requires: "ynetmon",
};

export default manifest;
