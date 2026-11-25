//! Servis katmanı: çalışma izni kapısı, depolama modu mantığı ve kuyruk boşaltma.

use super::hub::{self, HubCfg};
use super::settings::{KnowledgeSettings, RunMode, Storage, db_path};
use super::store;
use super::{Entry, NewEntry};

#[derive(Debug, Clone, PartialEq)]
pub struct Disabled(pub String);

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct LogOutcome {
    pub id: Option<i64>,
    pub queued: bool,
}

/// Çalışma izni kapısı. `Off` -> "kapalı"; `AppOpen` + uygulama ölü -> "uygulama kapalı".
pub fn gate(s: &KnowledgeSettings, app_alive: impl Fn() -> bool) -> Result<(), Disabled> {
    match s.run_mode {
        RunMode::Off => Err(Disabled("kapalı".into())),
        RunMode::AppOpen if !app_alive() => Err(Disabled("uygulama kapalı".into())),
        _ => Ok(()),
    }
}

/// Kuyruk yükü: hub'a gidecek kaydın tamamı (etiketler dahil).
fn to_payload(e: &NewEntry) -> String {
    serde_json::json!({
        "service": e.service,
        "title": e.title,
        "summary": e.summary,
        "tags": e.tags,
        "device": e.device,
        "agent": e.agent,
    })
    .to_string()
}

fn from_payload(p: &str) -> Option<NewEntry> {
    let v: serde_json::Value = serde_json::from_str(p).ok()?;
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(String::from);
    Some(NewEntry {
        service: s("service")?,
        title: s("title")?,
        summary: s("summary").unwrap_or_default(),
        tags: v
            .get("tags")
            .and_then(|t| t.as_array())
            .map(|a| a.iter().filter_map(|t| t.as_str().map(String::from)).collect())
            .unwrap_or_default(),
        device: s("device").unwrap_or_default(),
        agent: s("agent").unwrap_or_default(),
    })
}

/// Kaydı moda göre yazar. Yerel yazma hub'dan bağımsızdır; hub hatası kuyruğa düşer, çağırana hata dönmez.
pub fn log(s: &KnowledgeSettings, hub: Option<&HubCfg>, mut e: NewEntry) -> Result<LogOutcome, String> {
    e.service = e.service.trim().to_string();
    e.title = e.title.trim().to_string();
    if e.service.is_empty() || e.title.is_empty() {
        return Err("servis ve başlık zorunlu".into());
    }
    let conn = store::open(&db_path(s))?;
    match s.storage {
        Storage::Local => {
            let id = store::insert(&conn, &e)?;
            Ok(LogOutcome { id: Some(id), queued: false })
        }
        Storage::Both => {
            // Önce yerel: kayıt hub durumundan etkilenmez.
            let id = store::insert(&conn, &e)?;
            let sent = hub.map(|h| hub::post(h, &e).is_ok()).unwrap_or(false);
            if !sent {
                store::enqueue(&conn, &to_payload(&e))?;
            }
            Ok(LogOutcome { id: Some(id), queued: !sent })
        }
        Storage::Hub => {
            let sent = hub.map(|h| hub::post(h, &e).is_ok()).unwrap_or(false);
            if !sent {
                store::enqueue(&conn, &to_payload(&e))?;
            }
            Ok(LogOutcome { id: None, queued: !sent })
        }
    }
}

/// `Hub` modunda hub'dan (hata -> `Err`), `Local/Both` modunda yerel depodan okur.
pub fn read(
    s: &KnowledgeSettings,
    hub: Option<&HubCfg>,
    service: Option<&str>,
    search: Option<&str>,
    tag: Option<&str>,
    limit: usize,
) -> Result<Vec<Entry>, String> {
    match s.storage {
        Storage::Hub => {
            let h = hub.ok_or_else(|| "YDevHub yapılandırılmamış".to_string())?;
            hub::get(h, service, search, tag, limit)
        }
        Storage::Local | Storage::Both => {
            let conn = store::open(&db_path(s))?;
            store::query(&conn, service, search, tag, limit)
        }
    }
}

/// Kiralanmış ama işlenmeyen kayıtların kirasını bırakır (60 sn kilitli kalmasınlar).
fn release_rest(conn: &rusqlite::Connection, rest: &[(i64, String)]) {
    for (id, _) in rest {
        store::release_outbox(conn, *id);
    }
}

/// Kuyruktan 20 kayıt kiralar (60 sn) ve hub'a gönderir; başarıda siler; kalıcı hatada kaydı atlar, geçici hatada durur.
/// Gönderilen kayıt sayısını döner. Kira dolmadan biten iş garantisi için süre 45 sn ile sınırlıdır.
pub fn flush(s: &KnowledgeSettings, hub: &HubCfg) -> Result<usize, String> {
    if s.storage == Storage::Local {
        return Ok(0);
    }
    let conn = store::open(&db_path(s))?;
    let started = std::time::Instant::now();
    let mut sent = 0usize;
    let items = store::claim_outbox(&conn, 20, 60)?;
    for (i, (id, payload)) in items.iter().enumerate() {
        let (id, payload) = (*id, payload);
        // Kira (60 sn) dolarsa başka süreç aynı kaydı alıp çift gönderim olabilir.
        if started.elapsed() > std::time::Duration::from_secs(45) {
            release_rest(&conn, &items[i..]);
            break;
        }
        let Some(e) = from_payload(payload) else {
            // Okunamayan yük kuyruğu sonsuza dek tıkamasın.
            eprintln!("knowledge: bozuk kuyruk kaydı #{id} atıldı");
            store::ack_outbox(&conn, id);
            continue;
        };
        match hub::post(hub, &e) {
            Ok(()) => {
                store::ack_outbox(&conn, id);
                sent += 1;
            }
            // Kalıcı hata: bu kayıt sayacı artırılıp atlanır, sonrakiler engellenmez.
            Err(hub::PostError::Permanent(m)) => {
                eprintln!("knowledge: kuyruk kaydı #{id} kalıcı hata: {m}");
                store::bump_outbox(&conn, id);
            }
            // Geçici hata: hub erişilemez; kalan kayıtların kirası bırakılır ve durulur.
            Err(hub::PostError::Transient(_)) => {
                release_rest(&conn, &items[i..]);
                break;
            }
        }
    }
    Ok(sent)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    static SEQ: AtomicU32 = AtomicU32::new(0);

    struct Mock {
        url: String,
        bodies: Arc<Mutex<Vec<String>>>,
        paths: Arc<Mutex<Vec<String>>>,
    }

    /// Tek iş parçacıklı sahte hub: her isteğe `status` ve `reply` ile yanıt verir, gövdeyi yakalar.
    fn mock_hub(status: u16, reply: &'static str) -> Mock {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", l.local_addr().unwrap());
        let bodies = Arc::new(Mutex::new(Vec::new()));
        let paths = Arc::new(Mutex::new(Vec::new()));
        let (b2, p2) = (bodies.clone(), paths.clone());
        std::thread::spawn(move || {
            for stream in l.incoming() {
                let Ok(mut st) = stream else { continue };
                let _ = st.set_read_timeout(Some(Duration::from_secs(5)));
                let mut buf: Vec<u8> = Vec::new();
                let mut tmp = [0u8; 4096];
                let (head_end, clen) = loop {
                    let Ok(n) = st.read(&mut tmp) else { break (0, 0) };
                    if n == 0 {
                        break (0, 0);
                    }
                    buf.extend_from_slice(&tmp[..n]);
                    if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        let head = String::from_utf8_lossy(&buf[..p]).to_lowercase();
                        let clen = head
                            .lines()
                            .find_map(|l| l.strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
                            .unwrap_or(0);
                        break (p + 4, clen);
                    }
                };
                if head_end == 0 {
                    continue;
                }
                while buf.len() < head_end + clen {
                    let Ok(n) = st.read(&mut tmp) else { break };
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&tmp[..n]);
                }
                let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
                p2.lock().unwrap().push(head.lines().next().unwrap_or("").to_string());
                b2.lock().unwrap().push(String::from_utf8_lossy(&buf[head_end..]).to_string());
                let resp = format!(
                    "HTTP/1.1 {} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    status,
                    reply.len(),
                    reply
                );
                let _ = st.write_all(resp.as_bytes());
            }
        });
        Mock { url, bodies, paths }
    }

    fn settings(name: &str, storage: Storage, run_mode: RunMode) -> KnowledgeSettings {
        let n = SEQ.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("ydevdesk-kn-svc-{}-{}-{}", std::process::id(), name, n));
        let _ = std::fs::remove_dir_all(&dir);
        KnowledgeSettings {
            storage,
            run_mode,
            db_path: Some(dir.join("knowledge.db").to_string_lossy().into()),
        }
    }

    fn ne(service: &str, title: &str, summary: &str) -> NewEntry {
        NewEntry {
            service: service.into(),
            title: title.into(),
            summary: summary.into(),
            tags: vec![],
            device: "dev".into(),
            agent: "claude".into(),
        }
    }

    fn hubcfg(url: &str) -> HubCfg {
        HubCfg { url: url.into(), key: "k".into() }
    }

    fn conn(s: &KnowledgeSettings) -> rusqlite::Connection {
        store::open(&db_path(s)).unwrap()
    }

    #[test]
    fn gate_matrix() {
        let mk = |rm| KnowledgeSettings { run_mode: rm, ..Default::default() };
        assert!(gate(&mk(RunMode::Off), || true).is_err());
        assert!(gate(&mk(RunMode::AppOpen), || false).is_err());
        assert!(gate(&mk(RunMode::AppOpen), || true).is_ok());
        assert!(gate(&mk(RunMode::Always), || false).is_ok());
        assert_eq!(gate(&mk(RunMode::Off), || true).unwrap_err().0, "kapalı");
        assert_eq!(gate(&mk(RunMode::AppOpen), || false).unwrap_err().0, "uygulama kapalı");
    }

    #[test]
    fn log_rejects_blank_service_or_title_without_writing() {
        let s = settings("blank", Storage::Both, RunMode::Always);
        let m = mock_hub(200, "{\"success\":true}");
        let h = hubcfg(&m.url);
        for (sv, ti) in [("", "t"), ("  \t", "t"), ("s", ""), ("s", " \n ")] {
            let r = log(&s, Some(&h), ne(sv, ti, "x"));
            assert_eq!(r.unwrap_err(), "servis ve başlık zorunlu");
        }
        let c = conn(&s);
        assert_eq!(store::query(&c, None, None, None, 10).unwrap().len(), 0);
        assert_eq!(store::outbox_len(&c).unwrap(), 0);
        assert!(m.bodies.lock().unwrap().is_empty());
    }

    #[test]
    fn local_mode_never_touches_hub() {
        let s = settings("local", Storage::Local, RunMode::Always);
        let m = mock_hub(200, "{\"success\":true}");
        let h = hubcfg(&m.url);
        let r = log(&s, Some(&h), ne("svc", "baş", "özet [[a/b]]")).unwrap();
        assert!(r.id.is_some());
        assert!(!r.queued);
        let rows = read(&s, Some(&h), None, None, Some("a/b"), 10).unwrap();
        assert_eq!(rows.len(), 1);
        assert!(m.bodies.lock().unwrap().is_empty());
        assert_eq!(store::outbox_len(&conn(&s)).unwrap(), 0);
        // Local modda flush da hub'a dokunmaz
        assert_eq!(flush(&s, &h).unwrap(), 0);
    }

    #[test]
    fn both_mode_hub_down_keeps_local_and_queues() {
        let s = settings("bothdown", Storage::Both, RunMode::Always);
        let h = hubcfg("http://127.0.0.1:1");
        let t = Instant::now();
        let r = log(&s, Some(&h), ne("svc", "baş", "özet")).unwrap();
        assert!(t.elapsed() < Duration::from_secs(8));
        assert!(r.id.is_some());
        assert!(r.queued);
        let c = conn(&s);
        assert_eq!(store::query(&c, None, None, None, 10).unwrap().len(), 1);
        assert_eq!(store::outbox_len(&c).unwrap(), 1);
    }

    #[test]
    fn both_mode_hub_up_posts_directly() {
        let s = settings("bothup", Storage::Both, RunMode::Always);
        let m = mock_hub(200, "{\"success\":true}");
        let r = log(&s, Some(&hubcfg(&m.url)), ne("svc", "baş", "özet")).unwrap();
        assert!(r.id.is_some());
        assert!(!r.queued);
        assert_eq!(m.bodies.lock().unwrap().len(), 1);
        assert_eq!(store::outbox_len(&conn(&s)).unwrap(), 0);
    }

    #[test]
    fn hub_mode_down_queues_and_returns_ok_queued() {
        let s = settings("hubdown", Storage::Hub, RunMode::Always);
        let r = log(&s, Some(&hubcfg("http://127.0.0.1:1")), ne("svc", "baş", "özet")).unwrap();
        assert_eq!(r.id, None);
        assert!(r.queued);
        let c = conn(&s);
        assert_eq!(store::outbox_len(&c).unwrap(), 1);
        // hub modunda yerel entries tablosuna yazılmaz
        assert_eq!(store::query(&c, None, None, None, 10).unwrap().len(), 0);
        // hub hiç yapılandırılmamış: kayıt yine kuyrukta bekler
        let r = log(&s, None, ne("svc", "baş2", "özet")).unwrap();
        assert!(r.queued);
        assert_eq!(store::outbox_len(&conn(&s)).unwrap(), 2);
    }

    #[test]
    fn flush_drains_queue_when_hub_up() {
        let s = settings("flush", Storage::Both, RunMode::Always);
        // hub kapalıyken kuyruğa düşür
        let mut e = ne("svc", "Başlık", "özet [[a/b]]");
        e.tags = vec!["c/d".into()];
        log(&s, Some(&hubcfg("http://127.0.0.1:1")), e).unwrap();
        assert_eq!(store::outbox_len(&conn(&s)).unwrap(), 1);

        let m = mock_hub(200, "{\"success\":true}");
        let n = flush(&s, &hubcfg(&m.url)).unwrap();
        assert_eq!(n, 1);
        assert_eq!(store::outbox_len(&conn(&s)).unwrap(), 0);
        let bodies = m.bodies.lock().unwrap();
        assert_eq!(bodies.len(), 1);
        assert!(bodies[0].contains("service_tag"));
        assert!(bodies[0].contains("\"title\":\"Başlık\""));
        assert!(bodies[0].contains("summary"));
        assert!(bodies[0].contains("[[a/b]]"));
        assert!(bodies[0].contains("[[c/d]]"));
        assert!(m.paths.lock().unwrap()[0].starts_with("POST /api/v1/knowledge"));
    }

    #[test]
    fn hub_5xx_keeps_queue_and_local_write_intact() {
        let s = settings("5xx", Storage::Both, RunMode::Always);
        let m = mock_hub(500, "{\"success\":false}");
        let h = hubcfg(&m.url);
        let r = log(&s, Some(&h), ne("svc", "baş", "özet")).unwrap();
        assert!(r.id.is_some());
        assert!(r.queued);
        let c = conn(&s);
        assert_eq!(store::query(&c, None, None, None, 10).unwrap().len(), 1);
        assert_eq!(store::outbox_len(&c).unwrap(), 1);
        // flush da 5xx'te kuyruğu korur ve hata vermeden 0 döner
        assert_eq!(flush(&s, &h).unwrap(), 0);
        assert_eq!(store::outbox_len(&c).unwrap(), 1);
    }

    #[test]
    fn two_flushers_do_not_double_send() {
        let s = settings("twoflush", Storage::Both, RunMode::Always);
        let down = hubcfg("http://127.0.0.1:1");
        for i in 0..6 {
            log(&s, Some(&down), ne("svc", &format!("k{i}"), "ö")).unwrap();
        }
        let m = mock_hub(200, "{\"success\":true}");
        let h = hubcfg(&m.url);
        let (s1, s2, h1, h2) = (s.clone(), s.clone(), h.clone(), h.clone());
        let t1 = std::thread::spawn(move || flush(&s1, &h1).unwrap());
        let t2 = std::thread::spawn(move || flush(&s2, &h2).unwrap());
        let total = t1.join().unwrap() + t2.join().unwrap();
        assert_eq!(total, 6);
        assert_eq!(m.bodies.lock().unwrap().len(), 6);
        assert_eq!(store::outbox_len(&conn(&s)).unwrap(), 0);
    }

    #[test]
    fn hub_read_uses_link_param_and_parses() {
        let s = settings("hubread", Storage::Hub, RunMode::Always);
        let m = mock_hub(
            200,
            "{\"success\":true,\"count\":1,\"knowledge\":[{\"id\":7,\"service_tag\":\"x\",\"title\":\"T\",\"summary\":\"S [[x/y]]\",\"linked_topics\":[\"x/y\"],\"source_device\":\"mac\",\"created_at\":\"2026-11-25 07:54:09\"}]}",
        );
        let rows = read(&s, Some(&hubcfg(&m.url)), Some("x"), Some("ara"), Some("x/y"), 5).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, 7);
        assert_eq!(rows[0].tags, vec!["x/y".to_string()]);
        assert_eq!(rows[0].created_at, 1795593249);
        let req = m.paths.lock().unwrap()[0].clone();
        assert!(req.contains("limit=5"), "{req}");
        assert!(req.contains("service=x"), "{req}");
        assert!(req.contains("search=ara"), "{req}");
        assert!(req.contains("link=x%2Fy") || req.contains("link=x/y"), "{req}");
        // hub hatasında Err
        assert!(read(&s, Some(&hubcfg("http://127.0.0.1:1")), None, None, None, 5).is_err());
        assert!(read(&s, None, None, None, None, 5).is_err());
    }

    /// Sıralı yanıt veren sahte hub: i. istek `statuses[i]` (taşarsa sonuncusu) ile yanıtlanır.
    fn seq_hub(statuses: Vec<u16>) -> Mock {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", l.local_addr().unwrap());
        let bodies = Arc::new(Mutex::new(Vec::new()));
        let paths = Arc::new(Mutex::new(Vec::new()));
        let b2 = bodies.clone();
        std::thread::spawn(move || {
            let mut i = 0usize;
            for stream in l.incoming() {
                let Ok(mut st) = stream else { continue };
                let _ = st.set_read_timeout(Some(Duration::from_secs(2)));
                let mut buf = vec![0u8; 16384];
                let n = st.read(&mut buf).unwrap_or(0);
                b2.lock().unwrap().push(String::from_utf8_lossy(&buf[..n]).to_string());
                let code = statuses[i.min(statuses.len() - 1)];
                i += 1;
                let _ = st.write_all(
                    format!("HTTP/1.1 {code} X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes(),
                );
            }
        });
        Mock { url, bodies, paths }
    }

    fn queue_n(s: &KnowledgeSettings, n: usize) {
        let down = hubcfg("http://127.0.0.1:1");
        for i in 0..n {
            log(s, Some(&down), ne("svc", &format!("k{i}"), "ö")).unwrap();
        }
    }

    #[test]
    fn flush_permanent_error_skips_to_next_record() {
        let s = settings("perm", Storage::Both, RunMode::Always);
        queue_n(&s, 2);
        let m = seq_hub(vec![400, 200]);
        assert_eq!(flush(&s, &hubcfg(&m.url)).unwrap(), 1);
        // ikinci gitti; birinci kuyrukta (attempts=1)
        assert_eq!(m.bodies.lock().unwrap().len(), 2);
        let c = conn(&s);
        assert_eq!(store::outbox_len(&c).unwrap(), 1);
        let a: i64 = c.query_row("SELECT attempts FROM outbox", [], |r| r.get(0)).unwrap();
        assert_eq!(a, 1);
    }

    #[test]
    fn flush_transient_error_releases_remaining_leases() {
        let s = settings("trans", Storage::Both, RunMode::Always);
        queue_n(&s, 3);
        let m = seq_hub(vec![500]);
        assert_eq!(flush(&s, &hubcfg(&m.url)).unwrap(), 0);
        assert_eq!(m.bodies.lock().unwrap().len(), 1, "geçici hatada durmalı");
        // kalan kayıtlar (ve hatalı olan) hemen yeniden alınabilir
        assert_eq!(store::claim_outbox(&conn(&s), 10, 60).unwrap().len(), 3);
    }

    #[test]
    fn flush_poison_record_dropped_from_claims_after_10_permanent() {
        let s = settings("poison", Storage::Both, RunMode::Always);
        queue_n(&s, 1);
        let m = seq_hub(vec![400]);
        let h = hubcfg(&m.url);
        for _ in 0..10 {
            assert_eq!(flush(&s, &h).unwrap(), 0);
        }
        assert_eq!(m.bodies.lock().unwrap().len(), 10);
        assert_eq!(flush(&s, &h).unwrap(), 0);
        assert_eq!(m.bodies.lock().unwrap().len(), 10, "11. deneme yapılmamalı");
        assert_eq!(store::outbox_len(&conn(&s)).unwrap(), 1);
    }
}
