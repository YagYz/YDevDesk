use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

const MAX_CACHE_ENTRIES: usize = 256;

#[derive(Clone)]
struct CacheEntry<T> {
    mtime: SystemTime,
    len: u64,
    value: T,
}

/// Dosya (mtime, boyut) anahtarıyla çalışan genel önbellek.
/// Değişmeyen JSONL/transcript dosyalarının her 2 sn'de bir tekrar okunup heap şişirmesini önler.
pub struct MtimeCache<T: Clone> {
    map: Mutex<HashMap<PathBuf, CacheEntry<T>>>,
}

impl<T: Clone> MtimeCache<T> {
    pub fn new() -> Self {
        Self {
            map: Mutex::new(HashMap::new()),
        }
    }

    pub fn get_or_load<F>(&self, path: &Path, loader: F) -> Option<T>
    where
        F: FnOnce(&Path) -> Option<T>,
    {
        let meta = std::fs::metadata(path).ok()?;
        let mtime = meta.modified().ok()?;
        let len = meta.len();

        if let Ok(guard) = self.map.lock() {
            if let Some(entry) = guard.get(path) {
                if entry.mtime == mtime && entry.len == len {
                    return Some(entry.value.clone());
                }
            }
        }

        let value = loader(path)?;
        if let Ok(mut guard) = self.map.lock() {
            if guard.len() >= MAX_CACHE_ENTRIES {
                guard.clear();
            }
            guard.insert(
                path.to_path_buf(),
                CacheEntry {
                    mtime,
                    len,
                    value: value.clone(),
                },
            );
        }
        Some(value)
    }
}

static HEAD_CACHE: OnceLock<MtimeCache<String>> = OnceLock::new();
static TAIL_CACHE: OnceLock<MtimeCache<String>> = OnceLock::new();

pub fn cached_read_head(path: &Path, max_bytes: usize) -> Option<String> {
    let cache = HEAD_CACHE.get_or_init(MtimeCache::new);
    cache.get_or_load(path, |p| {
        let mut f = std::fs::File::open(p).ok()?;
        let mut buf = vec![0u8; max_bytes];
        let n = f.read(&mut buf).ok()?;
        buf.truncate(n);
        Some(String::from_utf8_lossy(&buf).to_string())
    })
}

pub fn cached_read_tail(path: &Path, max_bytes: u64) -> Option<String> {
    let cache = TAIL_CACHE.get_or_init(MtimeCache::new);
    cache.get_or_load(path, |p| {
        let mut f = std::fs::File::open(p).ok()?;
        let len = f.metadata().ok()?.len();
        let start = len.saturating_sub(max_bytes);
        f.seek(SeekFrom::Start(start)).ok()?;
        let mut bytes = Vec::new();
        f.read_to_end(&mut bytes).ok()?;
        let mut text = String::from_utf8_lossy(&bytes).to_string();
        if start > 0 {
            if let Some(idx) = text.find('\n') {
                text = text[idx + 1..].to_string();
            }
        }
        Some(text)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn mtime_cache_hits_on_unchanged_file() {
        let tmp = std::env::temp_dir().join(format!("ydevdesk_mtime_test_{}.txt", std::process::id()));
        std::fs::write(&tmp, "hello world").unwrap();
        let cache: MtimeCache<String> = MtimeCache::new();
        let loads = AtomicUsize::new(0);

        let v1 = cache.get_or_load(&tmp, |p| {
            loads.fetch_add(1, Ordering::SeqCst);
            std::fs::read_to_string(p).ok()
        });
        let v2 = cache.get_or_load(&tmp, |p| {
            loads.fetch_add(1, Ordering::SeqCst);
            std::fs::read_to_string(p).ok()
        });

        assert_eq!(v1.as_deref(), Some("hello world"));
        assert_eq!(v2.as_deref(), Some("hello world"));
        assert_eq!(loads.load(Ordering::SeqCst), 1);

        let _ = std::fs::remove_file(&tmp);
    }
}
