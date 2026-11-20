# YDevDesk Modül Geliştirme Rehberi

Yeni bir modül eklemek için çekirdek dosyalara (`registry.ts`, `Workspace.tsx`, `TitleBar.tsx`) dokunmanız gerekmez.

## 1. Klasör ve Manifest Oluşturun

`src/modules/<modul-id>/manifest.ts` dosyasını oluşturun:

```ts
import { Box } from "lucide-react";
import type { ModuleManifest } from "../../sdk/moduleSdk";
import MyPanel from "./MyPanel";

const manifest: ModuleManifest = {
  id: "my_module",
  title: "Modül Başlığı",
  description: "Kısa açıklama",
  icon: Box,
  component: MyPanel,
  width: 320,
  order: 100,
};

export default manifest;
```

## 2. Çekirdek Servislere Erişin

Modül bileşeninizde `useModuleSDK("my_module")` kullanın:

- `sdk.terminal.run("...")` — aktif terminalde komut çalıştırır
- `sdk.markdown.open({ path })` — merkez sekmede Markdown açar
- `sdk.notify(title, body)` — masaüstü bildirimi gönderir
- `sdk.storage.get / set` — modüle özel izole `localStorage`
- `sdk.connections.projectRoots` — Ayarlar'daki proje dizinleri
- `useVisibilityPoll(fn, ms)` — pencere gizliyken otomatik duran polling
