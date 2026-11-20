import { Flame } from "lucide-react";
import FileHeatPanel from "../../panels/FileHeatPanel";
import type { ModuleManifest } from "../../sdk/moduleSdk";

const manifest: ModuleManifest = {
  id: "file_heat",
  title: "Dosya Yoğunluğu",
  description: "En çok dokunulan dosyalar",
  icon: Flame,
  component: FileHeatPanel,
  width: 320,
  order: 40,
};

export default manifest;
