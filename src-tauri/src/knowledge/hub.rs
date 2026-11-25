//! YDevHub istemcisi (blocking). Uç nokta: `/api/v1/knowledge`, kimlik: `X-API-Key`.
//!
//! GET sorgu parametreleri canlı hub üzerinde doğrulandı: `limit`, `service`, `search`, `link`.
//! Etiket süzgeci hub'da `link` adıyla (tam eşleşme, ör. `proje/konu`) çalışır; `tag` adı kullanılmaz.
//! NOT: `reqwest::blocking` tokio çalışma zamanı bağlamında (async komut içinde) çağrılmamalı;
//! senkron komut, `spawn_blocking` ya da ayrı iş parçacığı kullanın.

use std::time::Duration;

use super::{Entry, NewEntry};
use super::store::parse_tags;

const TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Debug)]
pub struct HubCfg {
    pub url: String,
    pub key: String,
}

/// `~/.config/ydevhub/config.json` kaynağından; URL boşsa `None`.
pub fn cfg() -> Option<HubCfg> {
    let c = crate::config::load_homelab_config();
    cfg_from(&c.ydevhub_url, &c.ydevhub_key)
}

fn cfg_from(url: &str, key: &str) -> Option<HubCfg> {
    let url = url.trim().trim_end_matches('/').to_string();
    if url.is_empty() {
        return None;
    }
    Some(HubCfg { url, key: key.trim().to_string() })
}

/// Paylaşılan istemci (bağlantı havuzu yeniden kullanılır). Yönlendirme KAPALI: `X-API-Key`
/// başlığı hub'ın döndürdüğü başka bir konuma gitmesin (updater.rs ile aynı politika).
fn client() -> Result<&'static reqwest::blocking::Client, String> {
    static CLIENT: std::sync::OnceLock<Result<reqwest::blocking::Client, String>> = std::sync::OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::blocking::Client::builder()
                .timeout(TIMEOUT)
                .connect_timeout(TIMEOUT)
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|e| e.without_url().to_string())
        })
        .as_ref()
        .map_err(|e| e.clone())
}

/// Gönderim hatası: `Transient` yeniden denenir, `Permanent` (HTTP 4xx; 408/429 hariç) denenmez.
#[derive(Debug, Clone, PartialEq)]
pub enum PostError {
    Transient(String),
    Permanent(String),
}

impl std::fmt::Display for PostError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PostError::Transient(m) | PostError::Permanent(m) => f.write_str(m),
        }
    }
}

impl From<PostError> for String {
    fn from(e: PostError) -> String {
        e.to_string()
    }
}

/// Hata metninden URL (iç adres, arama metni) atılır.
fn net_err(e: reqwest::Error) -> String {
    e.without_url().to_string()
}

/// Hub özeti: etiketler özetin içinde `[[...]]` olarak taşınır; özette olmayan etiketler sona eklenir.
pub fn hub_summary(e: &NewEntry) -> String {
    let have = parse_tags(&e.summary);
    let mut s = e.summary.clone();
    for t in &e.tags {
        let t = t.trim().trim_start_matches("[[").trim_end_matches("]]").trim().to_string();
        if !t.is_empty() && !have.contains(&t) {
            s.push_str(&format!(" [[{}]]", t));
        }
    }
    s
}

pub fn post(cfg: &HubCfg, e: &NewEntry) -> Result<(), PostError> {
    let body = serde_json::json!({
        "service_tag": e.service,
        "title": e.title,
        "summary": hub_summary(e),
        "source_device": e.device,
    });
    let res = client().map_err(PostError::Transient)?
        .post(format!("{}/api/v1/knowledge", cfg.url))
        .header("X-API-Key", &cfg.key)
        .json(&body)
        .send()
        .map_err(|e| PostError::Transient(net_err(e)))?;
    let code = res.status().as_u16();
    if !res.status().is_success() {
        let m = format!("HTTP {code}");
        // Kalıcı: 4xx (408 ve 429 hariç). Ağ/5xx/3xx geçici sayılır.
        return Err(if (400..500).contains(&code) && code != 408 && code != 429 {
            PostError::Permanent(m)
        } else {
            PostError::Transient(m)
        });
    }
    Ok(())
}

/// Hub okuması. `tag` hub'da `link` parametresine eşlenir.
pub fn get(
    cfg: &HubCfg,
    service: Option<&str>,
    search: Option<&str>,
    tag: Option<&str>,
    limit: usize,
) -> Result<Vec<Entry>, String> {
    let mut q: Vec<(&str, String)> = vec![("limit", limit.to_string())];
    if let Some(s) = service.filter(|s| !s.is_empty()) {
        q.push(("service", s.to_string()));
    }
    if let Some(s) = search.filter(|s| !s.is_empty()) {
        q.push(("search", s.to_string()));
    }
    if let Some(t) = tag.map(|t| t.trim().trim_start_matches("[[").trim_end_matches("]]").trim()).filter(|t| !t.is_empty()) {
        q.push(("link", t.to_string()));
    }
    let url = reqwest::Url::parse_with_params(&format!("{}/api/v1/knowledge", cfg.url), q.iter())
        .map_err(|_| "geçersiz hub adresi".to_string())?;
    let res = client()?
        .get(url)
        .header("X-API-Key", &cfg.key)
        .send()
        .map_err(net_err)?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status().as_u16()));
    }
    let v: serde_json::Value = res.json().map_err(net_err)?;
    Ok(parse_entries(&v))
}

fn parse_entries(v: &serde_json::Value) -> Vec<Entry> {
    let Some(items) = v.get("knowledge").and_then(|k| k.as_array()) else {
        return vec![];
    };
    items
        .iter()
        .map(|it| {
            let s = |k: &str| it.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
            let tags = it
                .get("linked_topics")
                .and_then(|x| x.as_array())
                .map(|a| a.iter().filter_map(|t| t.as_str().map(String::from)).collect())
                .unwrap_or_default();
            Entry {
                id: it.get("id").and_then(|x| x.as_i64()).unwrap_or(0),
                service: s("service_tag"),
                title: s("title"),
                summary: s("summary"),
                tags,
                device: s("source_device"),
                agent: "hub".to_string(),
                created_at: parse_hub_time(&s("created_at")),
            }
        })
        .collect()
}

/// `YYYY-MM-DD HH:MM:SS` (UTC varsayılır) -> unix sn; çözülemezse 0.
fn parse_hub_time(t: &str) -> i64 {
    let t = t.trim().replace('T', " ");
    let t = t.trim_end_matches('Z');
    let (d, tm) = t.split_once(' ').unwrap_or((t, "00:00:00"));
    let dp: Vec<i64> = d.split('-').filter_map(|x| x.parse().ok()).collect();
    let tp: Vec<i64> = tm.split(['.', ':']).take(3).filter_map(|x| x.parse().ok()).collect();
    if dp.len() != 3 || tp.len() != 3 {
        return 0;
    }
    // Hinnant days_from_civil
    let (mut y, m, dd) = (dp[0], dp[1], dp[2]);
    if m <= 2 {
        y -= 1;
    }
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + dd - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    days * 86400 + tp[0] * 3600 + tp[1] * 60 + tp[2]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hub_time_parses() {
        assert_eq!(parse_hub_time("1970-01-01 00:00:00"), 0);
        assert_eq!(parse_hub_time("2026-11-25 07:54:09"), 1795593249);
        assert_eq!(parse_hub_time("bozuk"), 0);
    }

    #[test]
    fn cfg_blank_url_is_none() {
        assert!(cfg_from("  ", "k").is_none());
        assert_eq!(cfg_from("http://h:1/", "k").unwrap().url, "http://h:1");
    }

    #[test]
    fn summary_appends_missing_tags_only() {
        let e = NewEntry {
            service: "s".into(),
            title: "t".into(),
            summary: "x [[a]]".into(),
            tags: vec!["a".into(), "b".into()],
            device: "d".into(),
            agent: "g".into(),
        };
        assert_eq!(hub_summary(&e), "x [[a]] [[b]]");
    }

    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    /// Tek istek yakalayan sahte sunucu: ham istek metnini kaydeder, verilen ham yanıtı döner.
    fn raw_server(resp: String) -> (String, Arc<Mutex<Vec<String>>>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", l.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let s2 = seen.clone();
        std::thread::spawn(move || {
            for st in l.incoming() {
                let Ok(mut st) = st else { continue };
                let _ = st.set_read_timeout(Some(Duration::from_secs(2)));
                let mut buf = vec![0u8; 8192];
                let n = st.read(&mut buf).unwrap_or(0);
                s2.lock().unwrap().push(String::from_utf8_lossy(&buf[..n]).to_string());
                let _ = st.write_all(resp.as_bytes());
            }
        });
        (url, seen)
    }

    fn status_resp(code: u16) -> String {
        format!("HTTP/1.1 {code} X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
    }

    fn sample() -> NewEntry {
        NewEntry {
            service: "s".into(),
            title: "t".into(),
            summary: "x".into(),
            tags: vec![],
            device: "d".into(),
            agent: "g".into(),
        }
    }

    #[test]
    fn redirect_not_followed_and_key_not_leaked() {
        let (b_url, b_seen) = raw_server(status_resp(200));
        let (a_url, a_seen) = raw_server(format!(
            "HTTP/1.1 302 Found\r\nLocation: {b_url}/api/v1/knowledge\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        ));
        let cfg = HubCfg { url: a_url, key: "GIZLI-ANAHTAR".into() };
        assert!(post(&cfg, &sample()).is_err());
        assert_eq!(a_seen.lock().unwrap().len(), 1);
        std::thread::sleep(Duration::from_millis(200));
        assert!(b_seen.lock().unwrap().is_empty(), "ikinci sunucuya istek gitti");
        // get de takip etmemeli
        assert!(get(&cfg, None, None, None, 5).is_err());
        assert!(b_seen.lock().unwrap().is_empty());
    }

    #[test]
    fn error_messages_do_not_leak_url() {
        let cfg = HubCfg { url: "http://127.0.0.1:1".into(), key: "k".into() };
        let e = post(&cfg, &sample()).unwrap_err().to_string();
        assert!(!e.contains("127.0.0.1:1") && !e.contains("/api/v1"), "{e}");
        let e = get(&cfg, None, Some("gizli-arama"), None, 5).unwrap_err();
        assert!(!e.contains("127.0.0.1:1") && !e.contains("gizli-arama"), "{e}");
    }

    #[test]
    fn post_error_classification() {
        for (code, perm) in [(400u16, true), (401, true), (404, true), (422, true), (408, false), (429, false), (500, false), (503, false)] {
            let (url, _) = raw_server(status_resp(code));
            let r = post(&HubCfg { url, key: "k".into() }, &sample()).unwrap_err();
            assert_eq!(matches!(r, PostError::Permanent(_)), perm, "HTTP {code}: {r:?}");
        }
        // ağ hatası geçici
        let r = post(&HubCfg { url: "http://127.0.0.1:1".into(), key: "k".into() }, &sample()).unwrap_err();
        assert!(matches!(r, PostError::Transient(_)), "{r:?}");
        let (url, _) = raw_server(status_resp(200));
        assert!(post(&HubCfg { url, key: "k".into() }, &sample()).is_ok());
    }
}
