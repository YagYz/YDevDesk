use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

const MAX_ENTRY_BYTES: u64 = 2 * 1024 * 1024;

fn default_version() -> String {
    "1.0.0".to_string()
}

fn default_width() -> u32 {
    320
}

fn default_entry() -> String {
    "index.html".to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    #[serde(default = "default_width")]
    pub width: u32,
    #[serde(default = "default_entry")]
    pub entry: String,
    #[serde(default)]
    pub permissions: Vec<String>,
}

pub(crate) fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn plugins_root_dir() -> PathBuf {
    crate::ydevdesk_config_dir().join("plugins")
}

pub(crate) fn open_dir_in_file_manager(dir: &Path) -> Result<String, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("Klasör oluşturulamadı: {}", e))?;
    let path_str = dir.to_string_lossy().to_string();

    #[cfg(target_os = "linux")]
    let mut cmd = std::process::Command::new("xdg-open");
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut cmd = std::process::Command::new("explorer");

    cmd.arg(dir)
        .spawn()
        .map_err(|e| format!("Dosya yöneticisi açılamadı: {}", e))?;

    Ok(path_str)
}

#[tauri::command]
pub fn list_installed_plugins() -> Vec<PluginManifest> {
    let root = plugins_root_dir();
    let entries = match std::fs::read_dir(&root) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    let mut plugins = Vec::new();
    for entry in entries.flatten() {
        let dir_path = entry.path();
        if !dir_path.is_dir() {
            continue;
        }
        let dir_name = match dir_path.file_name().and_then(|n| n.to_str()) {
            Some(n) if is_safe_id(n) => n,
            _ => continue,
        };
        let manifest_path = dir_path.join("plugin.json");
        let content = match std::fs::read_to_string(&manifest_path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        if let Ok(mut manifest) = serde_json::from_str::<PluginManifest>(&content) {
            if manifest.id.is_empty() {
                manifest.id = dir_name.to_string();
            }
            if !is_safe_id(&manifest.id) {
                continue;
            }
            plugins.push(manifest);
        }
    }

    plugins.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    plugins
}

#[tauri::command]
pub fn read_plugin_entry(plugin_id: String) -> Result<String, String> {
    if !is_safe_id(&plugin_id) {
        return Err("Geçersiz eklenti kimliği.".to_string());
    }
    let plugin_dir = plugins_root_dir().join(&plugin_id);
    let canon_plugin_dir =
        std::fs::canonicalize(&plugin_dir).map_err(|e| format!("Eklenti klasörü bulunamadı: {}", e))?;

    let manifest_path = canon_plugin_dir.join("plugin.json");
    let manifest_content = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("plugin.json okunamadı: {}", e))?;
    let manifest: PluginManifest = serde_json::from_str(&manifest_content)
        .map_err(|e| format!("plugin.json ayrıştırılamadı: {}", e))?;

    let entry_candidate = canon_plugin_dir.join(&manifest.entry);
    let canon_entry = std::fs::canonicalize(&entry_candidate)
        .map_err(|e| format!("Eklenti giriş dosyası bulunamadı: {}", e))?;

    if !canon_entry.starts_with(&canon_plugin_dir) || !canon_entry.is_file() {
        return Err("Eklenti giriş dosyası izin verilmeyen bir yolda.".to_string());
    }

    let meta = std::fs::metadata(&canon_entry)
        .map_err(|e| format!("Dosya bilgisi alınamadı: {}", e))?;
    if meta.len() > MAX_ENTRY_BYTES {
        return Err("Eklenti giriş dosyası 2 MB sınırını aşıyor.".to_string());
    }

    std::fs::read_to_string(&canon_entry)
        .map_err(|e| format!("Eklenti giriş dosyası okunamadı: {}", e))
}

#[tauri::command]
pub fn remove_plugin(plugin_id: String) -> Result<(), String> {
    if !is_safe_id(&plugin_id) {
        return Err("Geçersiz eklenti kimliği.".to_string());
    }
    let root = plugins_root_dir();
    let canon_root =
        std::fs::canonicalize(&root).map_err(|e| format!("Eklenti dizini bulunamadı: {}", e))?;
    let target = root.join(&plugin_id);
    let canon_target =
        std::fs::canonicalize(&target).map_err(|e| format!("Eklenti bulunamadı: {}", e))?;

    if !canon_target.starts_with(&canon_root) || canon_target == canon_root {
        return Err("İzin verilmeyen eklenti yolu.".to_string());
    }

    std::fs::remove_dir_all(&canon_target)
        .map_err(|e| format!("Eklenti kaldırılamadı: {}", e))
}

#[tauri::command]
pub fn create_sample_plugin() -> Result<PluginManifest, String> {
    let dir = plugins_root_dir().join("hello-widget");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Eklenti klasörü oluşturulamadı: {}", e))?;

    let manifest = PluginManifest {
        id: "hello-widget".to_string(),
        name: "Hello Widget".to_string(),
        version: "1.0.0".to_string(),
        description: "YDevDesk eklenti API'sini (tema, bildirim, terminal, depolama) gösteren örnek widget.".to_string(),
        author: "YDevDesk".to_string(),
        width: 320,
        entry: "index.html".to_string(),
        permissions: vec![
            "notify".to_string(),
            "terminal".to_string(),
            "storage".to_string(),
        ],
    };

    let manifest_json =
        serde_json::to_string_pretty(&manifest).map_err(|e| format!("JSON hatası: {}", e))?;
    std::fs::write(dir.join("plugin.json"), manifest_json)
        .map_err(|e| format!("plugin.json yazılamadı: {}", e))?;

    let sample_html = r#"<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <title>Hello Widget</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 14px;
      background: var(--bg, #06090e);
      color: var(--txt-main, #f0f6fc);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
    }
    .card {
      background: var(--surface, #0a111a);
      border: 1px solid var(--border, #162638);
      border-radius: 10px;
      padding: 12px;
      margin-bottom: 10px;
    }
    h2 {
      margin: 0 0 6px 0;
      font-size: 14px;
      color: var(--accent, #00d2ff);
    }
    p {
      margin: 0 0 10px 0;
      color: var(--txt-muted, #7d8b99);
      line-height: 1.4;
    }
    .row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    button {
      background: var(--surface-raised, #0f1926);
      color: var(--txt-main, #f0f6fc);
      border: 1px solid var(--border-glow, #1f3a56);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 12px;
      cursor: pointer;
    }
    button:hover {
      border-color: var(--accent, #00d2ff);
      color: var(--accent, #00d2ff);
    }
    input {
      width: 100%;
      background: var(--bg, #06090e);
      color: var(--txt-main, #f0f6fc);
      border: 1px solid var(--border, #162638);
      border-radius: 6px;
      padding: 6px 8px;
      margin-bottom: 8px;
      font-size: 12px;
    }
    .status {
      font-size: 11px;
      color: var(--ok, #2ed573);
      margin-top: 6px;
      min-height: 14px;
    }
  </style>
</head>
<body>
  <div class="card">
    <h2>Hello Widget</h2>
    <p>Aktif YDevDesk temasını CSS değişkenleriyle otomatik kullanır.</p>
    <div class="row">
      <button id="btn-notify">Bildirim Gönder</button>
      <button id="btn-term">Terminalde Çalıştır</button>
    </div>
  </div>

  <div class="card">
    <h2>Hızlı Not (Storage)</h2>
    <input id="note-input" type="text" placeholder="Bir not yaz..." />
    <div class="row">
      <button id="btn-save">Kaydet</button>
      <button id="btn-load">Yükle</button>
    </div>
    <div id="status" class="status"></div>
  </div>

  <script>
    const statusEl = document.getElementById("status");
    const noteEl = document.getElementById("note-input");
    const api = window.YDevDesk || {};

    document.getElementById("btn-notify").addEventListener("click", () => {
      if (api.notify) {
        api.notify("Hello Widget", "Eklenti bildirimi başarıyla tetiklendi.");
      }
      statusEl.textContent = "Bildirim gönderildi.";
    });

    document.getElementById("btn-term").addEventListener("click", () => {
      if (api.runInTerminal) {
        api.runInTerminal("echo 'Hello from YDevDesk Plugin!'");
      }
      statusEl.textContent = "Komut terminale gönderildi.";
    });

    document.getElementById("btn-save").addEventListener("click", async () => {
      if (api.storage && api.storage.set) {
        await api.storage.set("quick_note", noteEl.value);
      }
      statusEl.textContent = "Kaydedildi.";
    });

    document.getElementById("btn-load").addEventListener("click", async () => {
      if (api.storage && api.storage.get) {
        const val = await api.storage.get("quick_note");
        noteEl.value = val || "";
        statusEl.textContent = "Yüklendi.";
      }
    });
  </script>
</body>
</html>
"#;

    std::fs::write(dir.join("index.html"), sample_html)
        .map_err(|e| format!("index.html yazılamadı: {}", e))?;

    Ok(manifest)
}

#[tauri::command]
pub fn open_plugins_dir() -> Result<String, String> {
    open_dir_in_file_manager(&plugins_root_dir())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_safe_id() {
        assert!(is_safe_id("hello-widget"));
        assert!(is_safe_id("my_plugin_123"));
        assert!(is_safe_id("A"));
        assert!(!is_safe_id(""));
        assert!(!is_safe_id("../evil"));
        assert!(!is_safe_id("foo/bar"));
        assert!(!is_safe_id("foo\\bar"));
        assert!(!is_safe_id("with space"));
        assert!(!is_safe_id("dot.name"));
    }

    #[test]
    fn test_plugin_manifest_parsing_defaults() {
        let raw = r#"{"id": "demo", "name": "Demo Plugin"}"#;
        let parsed: PluginManifest = serde_json::from_str(raw).expect("parse manifest");
        assert_eq!(parsed.id, "demo");
        assert_eq!(parsed.name, "Demo Plugin");
        assert_eq!(parsed.version, "1.0.0");
        assert_eq!(parsed.width, 320);
        assert_eq!(parsed.entry, "index.html");
        assert!(parsed.description.is_empty());
        assert!(parsed.author.is_empty());
        assert!(parsed.permissions.is_empty());
    }
}
