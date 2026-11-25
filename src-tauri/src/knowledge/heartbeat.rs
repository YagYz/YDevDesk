//! Uygulama nabız dosyası: MCP süreci "yalnızca uygulama açıkken" modunda uygulamanın canlı olup olmadığını buradan anlar.

use std::path::{Path, PathBuf};

/// Gelecek tarihli `mtime` için kabul edilen en büyük saat sapması.
const FUTURE_SKEW_SECS: u64 = 5;

/// Nabız dosyası: `ydevdesk_config_dir()/app.alive`.
pub fn heartbeat_path() -> PathBuf {
    crate::config::ydevdesk_config_dir().join("app.alive")
}

/// Dosyayı yeniden yazar (mtime güncellenir). İçerik: pid + unix sn, yalnızca teşhis içindir.
pub fn beat_at(path: &Path) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    crate::config::write_private_file(path, &format!("{} {}\n", std::process::id(), now))
}

pub fn clear_at(path: &Path) {
    let _ = std::fs::remove_file(path);
}

/// Bayatlık dosyanın `mtime` değeriyle ölçülür; dosya yok ya da yaş > `max_age_secs` ise false.
pub fn is_alive_at(path: &Path, max_age_secs: u64) -> bool {
    let Ok(modified) = std::fs::metadata(path).and_then(|m| m.modified()) else {
        return false;
    };
    match std::time::SystemTime::now().duration_since(modified) {
        Ok(age) => age.as_secs() <= max_age_secs,
        // mtime gelecekte: yalnızca küçük saat sapması toleransı; `touch -d 2099` ile kapıyı kalıcı açmayı engeller
        Err(e) => e.duration().as_secs() <= FUTURE_SKEW_SECS,
    }
}

pub fn beat() -> Result<(), String> {
    beat_at(&heartbeat_path())
}

pub fn clear() {
    clear_at(&heartbeat_path())
}

pub fn is_alive(max_age_secs: u64) -> bool {
    is_alive_at(&heartbeat_path(), max_age_secs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    #[test]
    fn heartbeat_missing_stale_fresh() {
        let d = std::env::temp_dir().join(format!("ydevdesk-kn-hb-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let p = d.join("app.alive");

        assert!(!is_alive_at(&p, 15)); // dosya yok

        beat_at(&p).unwrap(); // klasör de oluşur
        assert!(is_alive_at(&p, 15)); // yeni

        // 60 sn önceye çek -> bayat
        let f = std::fs::OpenOptions::new().write(true).open(&p).unwrap();
        f.set_modified(SystemTime::now() - Duration::from_secs(60)).unwrap();
        drop(f);
        assert!(!is_alive_at(&p, 15));

        beat_at(&p).unwrap(); // mtime yenilenir
        assert!(is_alive_at(&p, 15));

        // gelecek tarihli mtime: küçük sapma tamam, büyük sapma (kapıyı kalıcı açma girişimi) değil
        let f = std::fs::OpenOptions::new().write(true).open(&p).unwrap();
        f.set_modified(SystemTime::now() + Duration::from_secs(2)).unwrap();
        assert!(is_alive_at(&p, 15));
        f.set_modified(SystemTime::now() + Duration::from_secs(3600)).unwrap();
        drop(f);
        assert!(!is_alive_at(&p, 15));
        beat_at(&p).unwrap();

        clear_at(&p);
        assert!(!is_alive_at(&p, 15));
        let _ = std::fs::remove_dir_all(&d);
    }
}
