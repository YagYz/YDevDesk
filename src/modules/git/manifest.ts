import { GitBranch } from "lucide-react";
import GitPanel from "../../panels/GitPanel";
import type { ModuleManifest } from "../../sdk/moduleSdk";

const manifest: ModuleManifest = {
  id: "git",
  title: "Git",
  description: "Proje branch, değişen dosyalar, PR durumu",
  icon: GitBranch,
  component: GitPanel,
  width: 320,
  order: 80,
  requires: "projects-root",
};

export default manifest;
