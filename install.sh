#!/usr/bin/env bash
set -euo pipefail

REPO="YagYz/YDevDesk"
APP_NAME="ydevdesk"
BIN_DIR="${HOME}/.local/bin"
APP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons/hicolor/256x256/apps"

info()  { printf "\033[1;34m[YDevDesk]\033[0m %s\n" "$*"; }
ok()    { printf "\033[1;32m✔\033[0m %s\n" "$*"; }
warn()  { printf "\033[1;33m!\033[0m %s\n" "$*"; }
err()   { printf "\033[1;31m✖\033[0m %s\n" "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || err "curl gerekli."

OS="$(uname -s)"
ARCH="$(uname -m)"

info "En son YDevDesk sürümü sorgulanıyor..."
RELEASE_JSON="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases?per_page=5")"
TAG="$(printf '%s' "$RELEASE_JSON" | grep -m1 '"tag_name":' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
[ -n "$TAG" ] || err "GitHub Release etiketi alınamadı."
VERSION="${TAG#v}"
info "Bulunan sürüm: ${TAG}"

extract_url() {
  local pattern="$1"
  printf '%s' "$RELEASE_JSON" | grep -E '"browser_download_url":' | sed -E 's/.*"browser_download_url": *"([^"]+)".*/\1/' | grep -E "$pattern" | head -n1 || true
}

if [ "$OS" = "Darwin" ]; then
  if [ "$ARCH" = "arm64" ]; then
    DMG_URL="$(extract_url 'aarch64\.dmg$')"
  else
    DMG_URL="$(extract_url 'x64\.dmg$')"
  fi
  [ -n "$DMG_URL" ] || err "macOS DMG paketi bulunamadı."
  TMP_DMG="/tmp/ydevdesk-${VERSION}.dmg"
  info "İndiriliyor: $DMG_URL"
  curl -fL "$DMG_URL" -o "$TMP_DMG"
  MNT_DIR="$(hdiutil attach "$TMP_DMG" -nobrowse | grep -o '/Volumes/.*' | head -n1)"
  [ -n "$MNT_DIR" ] || err "DMG bağlanamadı."
  trap 'hdiutil detach "$MNT_DIR" -quiet || true; rm -f "$TMP_DMG"' EXIT
  rm -rf "/Applications/${APP_NAME}.app"
  cp -R "${MNT_DIR}/${APP_NAME}.app" /Applications/
  xattr -cr "/Applications/${APP_NAME}.app" || true
  ok "YDevDesk /Applications/${APP_NAME}.app konumuna kuruldu!"
  exit 0
fi

if [ "$OS" != "Linux" ]; then
  err "Desteklenmeyen işletim sistemi: $OS"
fi

# Distro algılama
DISTRO_ID=""
DISTRO_LIKE=""
if [ -f /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  DISTRO_ID="${ID:-}"
  DISTRO_LIKE="${ID_LIKE:-}"
fi

install_appimage() {
  local url
  url="$(extract_url '\.AppImage$')"
  [ -n "$url" ] || err "AppImage paketi bulunamadı."

  mkdir -p "$BIN_DIR" "$APP_DIR" "$ICON_DIR"
  local target_appimage="${BIN_DIR}/${APP_NAME}.AppImage"
  local wrapper="${BIN_DIR}/${APP_NAME}"

  info "AppImage indiriliyor..."
  curl -fL "$url" -o "${target_appimage}.tmp"
  chmod +x "${target_appimage}.tmp"
  mv "${target_appimage}.tmp" "$target_appimage"

  # Wayland / NVIDIA beyaz ekran düzeltmeli başlatıcı
  cat > "$wrapper" <<EOF
#!/usr/bin/env bash
export WEBKIT_DISABLE_DMABUF_RENDERER="\${WEBKIT_DISABLE_DMABUF_RENDERER:-1}"
exec "${target_appimage}" "\$@"
EOF
  chmod +x "$wrapper"

  curl -fsSL "https://raw.githubusercontent.com/${REPO}/main/src-tauri/icons/128x128@2x.png" -o "${ICON_DIR}/${APP_NAME}.png" || true

  cat > "${APP_DIR}/${APP_NAME}.desktop" <<EOF
[Desktop Entry]
Name=YDevDesk
Comment=Homelab & Multi-Agent Desktop Command Center
Exec=${wrapper}
Icon=${APP_NAME}
Terminal=false
Type=Application
Categories=Development;Utility;System;
StartupWMClass=ydevdesk
EOF

  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APP_DIR" >/dev/null 2>&1 || true
  ok "YDevDesk kuruldu! Başlatmak için: ${wrapper} (veya uygulama menüsünden YDevDesk)"
}

case "${DISTRO_ID} ${DISTRO_LIKE}" in
  *arch*|*cachyos*|*manjaro*|*endeavouros*)
    if command -v paru >/dev/null 2>&1 && paru -Si ydevdesk-bin >/dev/null 2>&1; then
      info "AUR üzerinden ydevdesk-bin kuruluyor (paru)..."
      paru -S --needed --noconfirm ydevdesk-bin
      ok "AUR kurulumu tamamlandı!"
    elif command -v yay >/dev/null 2>&1 && yay -Si ydevdesk-bin >/dev/null 2>&1; then
      info "AUR üzerinden ydevdesk-bin kuruluyor (yay)..."
      yay -S --needed --noconfirm ydevdesk-bin
      ok "AUR kurulumu tamamlandı!"
    else
      warn "AUR paketi henüz yayında değil veya AUR yardımcısı yok; AppImage + masaüstü entegrasyonu kuruluyor."
      install_appimage
    fi
    ;;
  *ubuntu*|*debian*|*pop*|*linuxmint*)
    DEB_URL="$(extract_url '_amd64\.deb$')"
    if [ -n "$DEB_URL" ]; then
      TMP_DEB="/tmp/ydevdesk_${VERSION}_amd64.deb"
      info ".deb paketi indiriliyor..."
      curl -fL "$DEB_URL" -o "$TMP_DEB"
      sudo apt-get update -qq
      sudo apt-get install -y "$TMP_DEB"
      rm -f "$TMP_DEB"
      ok "YDevDesk .deb paketiyle kuruldu!"
    else
      install_appimage
    fi
    ;;
  *fedora*|*rhel*|*centos*)
    RPM_URL="$(extract_url '\.x86_64\.rpm$')"
    if [ -n "$RPM_URL" ]; then
      TMP_RPM="/tmp/ydevdesk-${VERSION}.x86_64.rpm"
      info ".rpm paketi indiriliyor..."
      curl -fL "$RPM_URL" -o "$TMP_RPM"
      sudo dnf install -y "$TMP_RPM"
      rm -f "$TMP_RPM"
      ok "YDevDesk .rpm paketiyle kuruldu!"
    else
      install_appimage
    fi
    ;;
  *)
    install_appimage
    ;;
esac
