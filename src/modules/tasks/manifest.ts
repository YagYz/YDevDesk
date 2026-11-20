import { ListTodo } from "lucide-react";
import TasksPanel from "../../panels/TasksPanel";
import type { ModuleManifest } from "../../sdk/moduleSdk";

const manifest: ModuleManifest = {
  id: "tasks",
  title: "Görevler",
  description: "YDevHub görevleri: listele, ekle, tamamla",
  icon: ListTodo,
  component: TasksPanel,
  width: 320,
  order: 70,
  requires: "ydevhub",
};

export default manifest;
