import { StickyNote } from "lucide-react";
import NotesPanel from "../../panels/NotesPanel";
import type { ModuleManifest } from "../../sdk/moduleSdk";

const manifest: ModuleManifest = {
  id: "notes",
  title: "Notlar",
  description: "YDevHub günlük notları",
  icon: StickyNote,
  component: NotesPanel,
  width: 320,
  order: 60,
  requires: "ydevhub",
};

export default manifest;
