use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct HomelabConfig {
    pub ydevhub_url: String,
    pub ydevhub_key: String,
    pub ynetmon_url: String,
    pub ynetmon_key: String,
}


#[derive(Serialize, Deserialize, Default)]
pub struct SessionPrefs {
    #[serde(default)]
    pub pinned: HashMap<String, bool>,
    #[serde(default)]
    pub aliases: HashMap<String, String>,
}


#[tauri::command]
pub fn load_homelab_config() -> HomelabConfig {
    let home = dirs::home_dir().unwrap_or_default();
    let config_path = home.join(".config").join("ydevhub").join("config.json");

    if let Ok(content) = std::fs::read_to_string(config_path) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
            return HomelabConfig {
                ydevhub_url: v.get("api_url").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                ydevhub_key: v.get("api_key").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                ynetmon_url: v.get("ynetmon_url").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                ynetmon_key: v.get("ynetmon_key").and_then(|s| s.as_str()).unwrap_or("").to_string(),
            };
        }
    }

    HomelabConfig {
        ydevhub_url: "".to_string(),
        ydevhub_key: "".to_string(),
        ynetmon_url: "".to_string(),
        ynetmon_key: "".to_string(),
    }
}

/// Hassas yapılandırma dosyalarını Unix'te 0700 klasör / 0600 dosya izniyle yazar.
pub(crate) fn write_private_file(path: &std::path::Path, content: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
        }
    }
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .map_err(|e| e.to_string())?;
        f.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
        Ok(())
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, content).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn save_homelab_config(cfg: HomelabConfig) -> Result<(), String> {
    let home = dirs::home_dir().unwrap_or_default();
    let config_path = home.join(".config").join("ydevhub").join("config.json");

    let val = serde_json::json!({
        "api_url": cfg.ydevhub_url,
        "api_key": cfg.ydevhub_key,
        "ynetmon_url": cfg.ynetmon_url,
        "ynetmon_key": cfg.ynetmon_key
    });

    let json = serde_json::to_string_pretty(&val).map_err(|e| e.to_string())?;
    write_private_file(&config_path, &json)
}


pub(crate) fn expand_home(p: &str) -> std::path::PathBuf {
    if let Some(rest) = p.strip_prefix("~/") {
        return dirs::home_dir().unwrap_or_default().join(rest);
    }
    std::path::PathBuf::from(p)
}

pub(crate) fn ydevdesk_config_dir() -> std::path::PathBuf {
    // Test ve izole çalıştırma için ayar klasörü env ile geçersiz kılınabilir.
    if let Ok(dir) = std::env::var("YDEVDESK_CONFIG_DIR") {
        if !dir.trim().is_empty() {
            return std::path::PathBuf::from(dir);
        }
    }
    dirs::home_dir().unwrap_or_default().join(".config").join("ydevdesk")
}

fn app_settings_path() -> std::path::PathBuf {
    ydevdesk_config_dir().join("settings.json")
}

fn session_prefs_path() -> std::path::PathBuf {
    ydevdesk_config_dir().join("session_prefs.json")
}

/// Kayıtlı uygulama ayarları; dosya yoksa null döner (arayüz varsayılanları üretir).
#[tauri::command]
pub fn load_app_settings() -> Option<serde_json::Value> {
    let content = std::fs::read_to_string(app_settings_path()).ok()?;
    serde_json::from_str(&content).ok()
}

#[tauri::command]
pub fn save_app_settings(settings: serde_json::Value) -> Result<(), String> {
    let path = app_settings_path();
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    write_private_file(&path, &json)
}

#[tauri::command]
pub fn load_session_prefs() -> Result<SessionPrefs, String> {
    let path = session_prefs_path();
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(SessionPrefs::default()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn save_session_prefs(prefs: SessionPrefs) -> Result<(), String> {
    let path = session_prefs_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&prefs).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

/// İlk kurulumda önerilecek proje kök dizini (yoksa boş).
#[tauri::command]
pub fn default_projects_root() -> String {
    for c in ["/mnt/Depo/Projeler"] {
        if std::path::Path::new(c).is_dir() {
            return c.to_string();
        }
    }
    let home = dirs::home_dir().unwrap_or_default();
    for c in ["Projects", "projects", "dev", "src", "Projeler"] {
        let p = home.join(c);
        if p.is_dir() {
            return p.to_string_lossy().to_string();
        }
    }
    String::new()
}

