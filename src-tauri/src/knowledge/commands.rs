//! Bilgi Ağı için Tauri komutları ve uygulama açıkken çalışan arka plan işleri (nabız, kuyruk boşaltma).
//! Paneli kullanıcı yönettiği için buradaki komutlara çalışma izni kapısı (`gate`) uygulanmaz.

use std::time::Duration;

use serde::Serialize;

use super::hub::{self, HubCfg};
use super::service::{self, LogOutcome};
use super::settings::{self, KnowledgeSettings, RunMode, Storage};
use super::{heartbeat, store, Entry, NewEntry};

#[derive(Serialize, Debug)]
pub struct KnowledgeStatus {
    pub db_path: String,
    pub entries: i64,
    pub outbox: i64,
    pub hub_configured: bool,
    pub hub_url: String,
}

/// Kayıt/kuyruk sayıları ve hub durumu (hub'a ağ isteği atmaz).
pub(crate) fn compute_status(s: &KnowledgeSettings, hub: Option<&HubCfg>) -> Result<KnowledgeStatus, String> {
    let path = settings::db_path(s);
    let c = store::open(&path)?;
    let entries: i64 = c
        .query_row("SELECT COUNT(*) FROM entries", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(KnowledgeStatus {
        db_path: path.to_string_lossy().to_string(),
        entries,
        outbox: store::outbox_len(&c)?,
        hub_configured: hub.is_some(),
        hub_url: hub.map(|h| h.url.clone()).unwrap_or_default(),
    })
}

/// Kaydetmeden önce DB yolunun açılabildiğini doğrular; hata mesajı yolu içerir.
pub(crate) fn validate_settings(s: &KnowledgeSettings) -> Result<(), String> {
    if let Some(e) = settings::custom_path_error(s) {
        return Err(e);
    }
    store::open(&settings::db_path(s)).map(|_| ())
}

fn device_name() -> String {
    hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_else(|| "unknown".to_string())
}

#[tauri::command(async)]
pub fn knowledge_get_settings() -> KnowledgeSettings {
    settings::load()
}

#[tauri::command(async)]
pub fn knowledge_save_settings(settings: KnowledgeSettings) -> Result<(), String> {
    validate_settings(&settings)?;
    settings::save(&settings)
}

/// Hub okuması engelleyici HTTP kullandığı için ayrı iş parçacığında çalışır (arayüzü dondurmaz).
#[tauri::command]
pub async fn knowledge_list(
    service: Option<String>,
    search: Option<String>,
    tag: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<Entry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let s = settings::load();
        let hub = if s.storage == Storage::Local { None } else { hub::cfg() };
        service::read(
            &s,
            hub.as_ref(),
            service.as_deref(),
            search.as_deref(),
            tag.as_deref(),
            limit.unwrap_or(50).clamp(1, 500),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
pub fn knowledge_tags() -> Result<Vec<(String, i64)>, String> {
    let s = settings::load();
    let c = store::open(&settings::db_path(&s))?;
    store::tag_counts(&c)
}

#[tauri::command(async)]
pub fn knowledge_status() -> Result<KnowledgeStatus, String> {
    let s = settings::load();
    compute_status(&s, hub::cfg().as_ref())
}

/// Arayüzdeki "Hızlı Kayıt" için; ajan `user` olarak yazılır.
#[tauri::command]
pub async fn knowledge_add(service: String, title: String, summary: String) -> Result<LogOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let s = settings::load();
        let hub = if s.storage == Storage::Local { None } else { hub::cfg() };
        service::log(
            &s,
            hub.as_ref(),
            NewEntry { service, title, summary, tags: vec![], device: device_name(), agent: "user".to_string() },
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Uygulama açıkken: 5 sn'de bir nabız, 30 sn'de bir hub kuyruğu boşaltma.
pub fn start_background() {
    let _ = heartbeat::beat();
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(5));
        let _ = heartbeat::beat();
    });
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(30));
        let s = settings::load();
        // "Kapalı" modda arka plan da ağa çıkmaz.
        if s.run_mode != RunMode::Off && s.storage != Storage::Local {
            if let Some(h) = hub::cfg() {
                let _ = service::flush(&s, &h);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("ydesk_cmd_{}_{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn entry(title: &str) -> NewEntry {
        NewEntry { service: "s".into(), title: title.into(), summary: "x".into(), tags: vec![], device: "d".into(), agent: "a".into() }
    }

    #[test]
    fn status_counts_match_store() {
        let path = tmp("status").join("k.db");
        let s = KnowledgeSettings { db_path: Some(path.to_string_lossy().to_string()), ..Default::default() };
        let c = store::open(&path).unwrap();
        store::insert(&c, &entry("bir")).unwrap();
        store::insert(&c, &entry("iki")).unwrap();
        store::enqueue(&c, "{}").unwrap();
        let st = compute_status(&s, None).unwrap();
        assert_eq!((st.entries, st.outbox, st.hub_configured), (2, 1, false));
        assert_eq!(st.hub_url, "");
        let hub = HubCfg { url: "http://x".into(), key: "k".into() };
        let st = compute_status(&s, Some(&hub)).unwrap();
        assert!(st.hub_configured && st.hub_url == "http://x");
    }

    #[test]
    fn save_settings_rejects_relative_db_path() {
        let s = KnowledgeSettings { db_path: Some("knowledge.db".into()), ..Default::default() };
        let err = validate_settings(&s).unwrap_err();
        assert!(err.contains("mutlak"), "{err}");
    }

    #[test]
    fn save_settings_rejects_unwritable_db_path() {
        // Üst "klasör" aslında düz dosya: açılamaz.
        let file = tmp("unwritable").join("dosya");
        std::fs::write(&file, "x").unwrap();
        let bad = file.join("alt").join("k.db");
        let s = KnowledgeSettings { db_path: Some(bad.to_string_lossy().to_string()), ..Default::default() };
        let err = validate_settings(&s).unwrap_err();
        assert!(err.contains("dosya"), "hata yolu içermeli: {}", err);
    }
}
