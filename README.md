# YDevDesk

Homelab ve yapay zeka ajanları için masaüstü komuta merkezi. Tauri v2 (Rust PTY) + React + TypeScript + Dockview.

## Özellikler
- Çoklu gömülü terminal: kabuk, AGY, Claude Code, Debian SSH, konteyner logları.
- Dockview ile serbest yerleşim: paneller sürüklenir, sağa/sola/alta dock edilir, boyutlandırılır. Düzen kaydedilir.
- Modüller (Modüller menüsünden ekle/kaldır): Ajan Durumu, YNetMon Ağ, Araç Akışı, Dosya Yoğunluğu, Oturumlar, Notlar, Bilgi Ağı, Hızlı Eylemler.
- Ctrl+K komut paleti: komut çalıştır, YDevHub'a not ekle, bilgi ağına kayıt yaz.

## Yapı
```
src/
  App.tsx, Workspace.tsx   Dockview iskeleti, düzen yönetimi
  context/                 DataContext (API/telemetri), WorkspaceContext (eylemler)
  lib/                     terminalManager (xterm+PTY), layout, tauri sarmalayıcıları
  panels/                  terminal ve modül panelleri, registry.ts kataloğu
  components/              TitleBar, StatusBar, OmniBar, modallar
src-tauri/src/lib.rs       PTY, ajan telemetrisi, YDevHub/YNetMon istekleri
```

Yeni modül: `src/panels/` altına bileşen ekle, `registry.ts` içindeki `MODULES` listesine kaydet.

## Geliştirme
```
npm install
npm run tauri dev
```
