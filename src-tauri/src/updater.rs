use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Serialize, Deserialize, Clone)]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub release_name: String,
    pub release_notes: String,
    pub html_url: String,
    pub asset_name: String,
    pub asset_url: String,
}

pub(crate) fn parse_semver(v: &str) -> (u64, u64, u64) {
    let clean = v.trim().trim_start_matches('v');
    let mut parts = clean.split(|c: char| !c.is_ascii_digit());
    let major = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    let minor = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    let patch = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    (major, minor, patch)
}

pub(crate) fn target_asset_suffix() -> &'static str {
    if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "aarch64.app.tar.gz"
        } else {
            "x64.app.tar.gz"
        }
    } else if cfg!(target_os = "windows") {
        "x64-setup.exe"
    } else {
        "amd64.AppImage"
    }
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub async fn check_app_update() -> Result<UpdateCheckResult, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let client = reqwest::Client::builder()
        .user_agent("YDevDesk-Updater")
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get("https://api.github.com/repos/YagYz/YDevDesk/releases?per_page=5")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("GitHub API HTTP {}", res.status()));
    }

    let releases = res.json::<Vec<serde_json::Value>>().await.map_err(|e| e.to_string())?;
    let suffix = target_asset_suffix();

    // Henüz asset'i yüklenmiş en güncel sürümü bul
    for rel in &releases {
        if rel.get("draft").and_then(|b| b.as_bool()).unwrap_or(false) {
            continue;
        }
        let tag = rel.get("tag_name").and_then(|s| s.as_str()).unwrap_or("");
        if tag.is_empty() {
            continue;
        }
        let mut asset_name = String::new();
        let mut asset_url = String::new();
        if let Some(assets) = rel.get("assets").and_then(|a| a.as_array()) {
            for a in assets {
                let name = a.get("name").and_then(|s| s.as_str()).unwrap_or("");
                if name.ends_with(suffix) {
                    asset_name = name.to_string();
                    asset_url = a.get("browser_download_url").and_then(|s| s.as_str()).unwrap_or("").to_string();
                    break;
                }
            }
        }
        if asset_url.is_empty() {
            continue;
        }
        let latest = tag.trim_start_matches('v').to_string();
        let has_update = parse_semver(&latest) > parse_semver(&current);
        return Ok(UpdateCheckResult {
            current_version: current,
            latest_version: latest,
            has_update,
            release_name: rel.get("name").and_then(|s| s.as_str()).unwrap_or(tag).to_string(),
            release_notes: rel.get("body").and_then(|s| s.as_str()).unwrap_or("").to_string(),
            html_url: rel.get("html_url").and_then(|s| s.as_str()).unwrap_or("").to_string(),
            asset_name,
            asset_url,
        });
    }

    Ok(UpdateCheckResult {
        current_version: current.clone(),
        latest_version: current,
        has_update: false,
        release_name: String::new(),
        release_notes: String::new(),
        html_url: String::new(),
        asset_name: String::new(),
        asset_url: String::new(),
    })
}

#[tauri::command]
pub async fn install_app_update(app: AppHandle, asset_url: String) -> Result<String, String> {
    let allowed = asset_url.starts_with("https://github.com/YagYz/YDevDesk/releases/download/")
        || asset_url.starts_with("https://objects.githubusercontent.com/");
    if !allowed {
        return Err("Geçersiz veya güvensiz güncelleme adresi".into());
    }
    let client = reqwest::Client::builder()
        .user_agent("YDevDesk-Updater")
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client.get(&asset_url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("İndirme başarısız: HTTP {}", res.status()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        let tmp_tar = std::env::temp_dir().join("ydevdesk_update.app.tar.gz");
        std::fs::write(&tmp_tar, &bytes).map_err(|e| e.to_string())?;

        // Çalışan .app dizinini bul (yoksa /Applications/ydevdesk.app)
        let app_bundle = std::env::current_exe()
            .ok()
            .and_then(|p| {
                p.ancestors()
                    .find(|a| a.extension().and_then(|e| e.to_str()) == Some("app"))
                    .map(|a| a.to_path_buf())
            })
            .unwrap_or_else(|| std::path::PathBuf::from("/Applications/ydevdesk.app"));

        let install_dir = app_bundle
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::path::PathBuf::from("/Applications"));

        let status = std::process::Command::new("tar")
            .args(["-xzf", &tmp_tar.to_string_lossy(), "-C", &install_dir.to_string_lossy()])
            .status()
            .map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&tmp_tar);
        if !status.success() {
            return Err("Arşiv çıkartılamadı".into());
        }

        let _ = std::process::Command::new("xattr")
            .args(["-cr", &app_bundle.to_string_lossy()])
            .status();

        // Yeni sürümü başlat ve mevcut süreci kapat
        let _ = std::process::Command::new("open")
            .args(["-n", &app_bundle.to_string_lossy()])
            .spawn();
        app.exit(0);
        return Ok("Güncellendi, yeniden başlatılıyor…".into());
    }

    #[cfg(target_os = "windows")]
    {
        let out = std::env::temp_dir().join("ydevdesk-setup.exe");
        std::fs::write(&out, &bytes).map_err(|e| e.to_string())?;
        std::process::Command::new(&out)
            .spawn()
            .map_err(|e| format!("Kurulum sihirbazı başlatılamadı: {}", e))?;
        app.exit(0);
        return Ok("Windows kurulum sihirbazı başlatılıyor…".into());
    }

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        if let Ok(appimage_path) = std::env::var("APPIMAGE") {
            use std::os::unix::fs::PermissionsExt;
            let target = std::path::PathBuf::from(&appimage_path);
            let tmp = target.with_extension("AppImage.new");
            std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
            std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
            std::fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
            let _ = std::process::Command::new(&target).spawn();
            app.exit(0);
            return Ok("AppImage güncellendi, yeniden başlatılıyor…".into());
        } else {
            use std::os::unix::fs::PermissionsExt;
            let dl_dir = dirs::download_dir()
                .or_else(dirs::home_dir)
                .unwrap_or_else(std::env::temp_dir);
            let out = dl_dir.join("ydevdesk-latest.AppImage");
            std::fs::write(&out, &bytes).map_err(|e| e.to_string())?;
            let _ = std::fs::set_permissions(&out, std::fs::Permissions::from_mode(0o755));
            return Ok(format!("Yeni sürüm indirildi: {}", out.display()));
        }
    }
}

