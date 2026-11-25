//! Bilgi Ağı ayarları (`knowledge.json`) ve DB yolu çözümü.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Storage {
    Local,
    Hub,
    Both,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum RunMode {
    Off,
    AppOpen,
    Always,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(default)]
pub struct KnowledgeSettings {
    pub storage: Storage,
    pub run_mode: RunMode,
    pub db_path: Option<String>,
}

impl Default for KnowledgeSettings {
    fn default() -> Self {
        Self { storage: Storage::Local, run_mode: RunMode::Always, db_path: None }
    }
}

/// Ayar dosyası: `ydevdesk_config_dir()/knowledge.json`.
pub fn settings_path() -> PathBuf {
    crate::config::ydevdesk_config_dir().join("knowledge.json")
}

/// Dosya yoksa varsayılan; dosya var ama okunamıyor/ayrıştırılamıyorsa **fail-closed** (`Off`).
/// Aksi halde yarım yazılmış ya da bozuk bir dosya, kullanıcının kapattığı özelliği sessizce açardı.
pub fn load_from(path: &Path) -> KnowledgeSettings {
    let fail_closed = || KnowledgeSettings { run_mode: RunMode::Off, ..KnowledgeSettings::default() };
    match std::fs::read_to_string(path) {
        Ok(c) => serde_json::from_str(&c).unwrap_or_else(|e| {
            eprintln!("knowledge: ayar dosyası ayrıştırılamadı ({}): {e}; devre dışı", path.display());
            fail_closed()
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => KnowledgeSettings::default(),
        Err(e) => {
            eprintln!("knowledge: ayar dosyası okunamadı ({}): {e}; devre dışı", path.display());
            fail_closed()
        }
    }
}

/// Önce geçici dosyaya yazar, sonra yeniden adlandırır: okuyan süreç asla yarım dosya görmez.
pub fn save_to(path: &Path, s: &KnowledgeSettings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    crate::config::write_private_file(&tmp, &json)?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

pub fn load() -> KnowledgeSettings {
    load_from(&settings_path())
}

pub fn save(s: &KnowledgeSettings) -> Result<(), String> {
    save_to(&settings_path(), s)
}

/// Çözülen DB yolu: kullanıcı yolu (`~/` açılır) ya da `data_dir()/com.yagyz.ydevdesk/knowledge.db`.
/// Tauri'siz çözülür; uygulama ve MCP süreci aynı yolu bulur.
/// Göreli özel yol (ör. `knowledge.db`) süreç çalışma dizinine göre çözülür; uygulama ve ajan süreci
/// farklı dizinlerde olduğundan ayrı DB'lere yazarlardı. Bu yüzden yok sayılıp varsayılana düşülür.
pub fn db_path(s: &KnowledgeSettings) -> PathBuf {
    match s.db_path.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        Some(p) => {
            let expanded = crate::config::expand_home(p);
            if expanded.is_absolute() { expanded } else { default_db_path() }
        }
        None => default_db_path(),
    }
}

fn default_db_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".local").join("share"))
        .join("com.yagyz.ydevdesk")
        .join("knowledge.db")
}

/// Kullanıcının girdiği özel yol geçersizse (göreli) açıklayıcı hata döner; kaydetmeden önce çağrılır.
pub fn custom_path_error(s: &KnowledgeSettings) -> Option<String> {
    let p = s.db_path.as_deref().map(str::trim).filter(|p| !p.is_empty())?;
    if crate::config::expand_home(p).is_absolute() {
        None
    } else {
        Some(format!("DB yolu mutlak olmalı ya da ~/ ile başlamalı: {p}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static SEQ: AtomicU32 = AtomicU32::new(0);

    fn tmp_dir(name: &str) -> PathBuf {
        let n = SEQ.fetch_add(1, Ordering::SeqCst);
        let d = std::env::temp_dir().join(format!("ydevdesk-kn-set-{}-{}-{}", std::process::id(), name, n));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn missing_file_is_default_but_corrupt_is_fail_closed() {
        let d = tmp_dir("defaults");
        let p = d.join("knowledge.json");
        // dosya yok -> varsayılan
        assert_eq!(load_from(&p), KnowledgeSettings::default());
        // bozuk, boş (yazma anında kesilmiş) ve tanınmayan değer -> fail-closed: Off
        for bad in ["{ bozuk json", "", "{\"run_mode\":\"paused\"}"] {
            std::fs::write(&p, bad).unwrap();
            let s = load_from(&p);
            assert_eq!(s.run_mode, RunMode::Off, "girdi: {bad:?}");
            assert_eq!(s.storage, Storage::Local);
            assert_eq!(s.db_path, None);
        }
        let def = KnowledgeSettings::default();
        assert_eq!(def.storage, Storage::Local);
        assert_eq!(def.run_mode, RunMode::Always);
        assert_eq!(def.db_path, None);
    }

    #[test]
    fn save_is_atomic_and_leaves_no_tmp_file() {
        let d = tmp_dir("atomic");
        let p = d.join("knowledge.json");
        save_to(&p, &KnowledgeSettings::default()).unwrap();
        save_to(&p, &KnowledgeSettings { run_mode: RunMode::Off, ..Default::default() }).unwrap();
        assert_eq!(load_from(&p).run_mode, RunMode::Off);
        let names: Vec<String> = std::fs::read_dir(&d).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
        assert_eq!(names, vec!["knowledge.json".to_string()], "geçici dosya kalmamalı: {names:?}");
    }

    #[test]
    fn relative_db_path_is_rejected_and_falls_back_to_default() {
        let def = db_path(&KnowledgeSettings::default());
        let s = KnowledgeSettings { db_path: Some("knowledge.db".into()), ..Default::default() };
        assert_eq!(db_path(&s), def, "göreli yol süreçler arası farklı DB'ye yazdırır");
        assert!(custom_path_error(&s).is_some());
        let abs = KnowledgeSettings { db_path: Some("/tmp/x/k.db".into()), ..Default::default() };
        assert!(custom_path_error(&abs).is_none());
        let home = KnowledgeSettings { db_path: Some("~/x/k.db".into()), ..Default::default() };
        assert!(custom_path_error(&home).is_none());
        assert!(custom_path_error(&KnowledgeSettings::default()).is_none());
    }

    #[test]
    fn roundtrip_all_enum_values() {
        let d = tmp_dir("roundtrip");
        let p = d.join("sub").join("knowledge.json");
        for st in [Storage::Local, Storage::Hub, Storage::Both] {
            for rm in [RunMode::Off, RunMode::AppOpen, RunMode::Always] {
                let s = KnowledgeSettings { storage: st.clone(), run_mode: rm.clone(), db_path: Some("~/x/k.db".into()) };
                save_to(&p, &s).unwrap();
                assert_eq!(load_from(&p), s);
            }
        }
        // snake_case seri hale getirme (ön yüz sözleşmesi)
        let raw = std::fs::read_to_string(&p).unwrap();
        assert!(raw.contains("\"app_open\"") || raw.contains("\"always\""));
        // eksik alanlar varsayılana düşer
        std::fs::write(&p, "{\"storage\":\"both\"}").unwrap();
        let s = load_from(&p);
        assert_eq!(s.storage, Storage::Both);
        assert_eq!(s.run_mode, RunMode::Always);
    }

    #[test]
    fn db_path_expands_tilde_and_defaults_to_app_data_dir() {
        let def = db_path(&KnowledgeSettings::default());
        assert!(def.ends_with("com.yagyz.ydevdesk/knowledge.db"), "{def:?}");
        let s = KnowledgeSettings { db_path: Some("~/kn/x.db".into()), ..Default::default() };
        let p = db_path(&s);
        assert!(!p.to_string_lossy().starts_with('~'));
        assert!(p.ends_with("kn/x.db"));
        // boş/boşluk yol varsayılana düşer
        let s = KnowledgeSettings { db_path: Some("   ".into()), ..Default::default() };
        assert_eq!(db_path(&s), def);
    }

    #[test]
    fn custom_db_path_in_missing_dir_is_created_by_open() {
        let d = tmp_dir("customdb");
        let target = d.join("a").join("b").join("c").join("knowledge.db");
        let s = KnowledgeSettings { db_path: Some(target.to_string_lossy().into()), ..Default::default() };
        let c = crate::knowledge::store::open(&db_path(&s)).unwrap();
        drop(c);
        assert!(target.exists());
    }

    #[cfg(unix)]
    #[test]
    fn unwritable_db_dir_returns_err_with_path() {
        use std::os::unix::fs::PermissionsExt;
        let d = tmp_dir("ro");
        let ro = d.join("ro");
        std::fs::create_dir_all(&ro).unwrap();
        std::fs::set_permissions(&ro, std::fs::Permissions::from_mode(0o555)).unwrap();
        // root her yerde yazabilir; o durumda test anlamsız
        if std::fs::write(ro.join(".probe"), "x").is_ok() {
            let _ = std::fs::remove_file(ro.join(".probe"));
            return;
        }
        let target = ro.join("alt").join("knowledge.db");
        let err = crate::knowledge::store::open(&target).unwrap_err();
        assert!(err.contains(&ro.to_string_lossy().to_string()), "{err}");
        std::fs::set_permissions(&ro, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
}
