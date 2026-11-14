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

## Kurulum

### Linux (AppImage)
GitHub Releases üzerinden `.AppImage` dosyasını indirip çalıştırılabilir yapın:

```bash
mkdir -p ~/.local/bin
mv ydevdesk_*.AppImage ~/.local/bin/ydevdesk.AppImage
chmod +x ~/.local/bin/ydevdesk.AppImage
~/.local/bin/ydevdesk.AppImage
```

#### Wayland / NVIDIA Mavi Ekran Çözümü
Wayland veya NVIDIA sürücülerinde WebKitGTK DMA-BUF kaynaklı mavi/boş ekran oluşursa `WEBKIT_DISABLE_DMABUF_RENDERER=1` ortam değişkeni ile başlatın:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 ~/.local/bin/ydevdesk.AppImage
```

Uygulama menüsüne eklemek için `~/.local/share/applications/ydevdesk.desktop` dosyası oluşturabilirsiniz:

```ini
[Desktop Entry]
Name=YDevDesk
Comment=Homelab ve yapay zeka ajanları için masaüstü komuta merkezi
Exec=env WEBKIT_DISABLE_DMABUF_RENDERER=1 /home/KULLANICI/.local/bin/ydevdesk.AppImage
Terminal=false
Type=Application
Categories=Development;System;
```

### macOS (.dmg)
GitHub Releases üzerinden `.dmg` paketini indirin, açın ve `ydevdesk` uygulamasını **Applications** klasörüne sürükleyin.

## Geliştirme ve Derleme
Yerel geliştirme veya kaynak koddan paket derleme (`AppImage`, `.dmg`, vb.) için:

```bash
npm install
npm run tauri dev     # Geliştirme modu
npm run tauri build   # Üretim paketi (src-tauri/target/release/bundle/)
```

## Desteklenen Ajan CLI Kurulumu
Gömülü ajan terminalleri için ilgili CLI araçlarının sistem PATH'inde bulunması gerekir:

- **AGY (Antigravity CLI):**
  ```bash
  curl -fsSL https://antigravity.google/cli/install.sh | bash
  # veya Arch Linux (AUR):
  yay -S antigravity-cli
  ```
- **Claude Code:**
  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  ```
- **OpenAI Codex:**
  ```bash
  npm install -g @openai/codex
  ```
