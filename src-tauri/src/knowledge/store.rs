//! SQLite depo: şema, WAL, ekleme, sorgu, etiket sayımı ve hub gönderim kuyruğu (outbox).

use std::collections::BTreeSet;
use std::path::Path;

use rusqlite::functions::FunctionFlags;
use rusqlite::{Connection, params, params_from_iter};

use super::{Entry, NewEntry};

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Arama katlaması: küçük harf + `İ` küçültülürken oluşan birleşik nokta (U+0307) atılır.
fn fold(s: &str) -> String {
    s.to_lowercase().replace('\u{307}', "")
}

fn err(e: rusqlite::Error) -> String {
    e.to_string()
}

/// Veritabanını açar: klasörü oluşturur, WAL + busy_timeout ayarlar, şemayı kurar.
/// Hata metni yolu içerir (kullanıcı özel yol seçmiş olabilir).
pub fn open(path: &Path) -> Result<Connection, String> {
    if let Some(dir) = path.parent() {
        if !dir.as_os_str().is_empty() {
            let existed = dir.exists();
            std::fs::create_dir_all(dir)
                .map_err(|e| format!("klasör oluşturulamadı {}: {}", dir.display(), e))?;
            // Yeni oluşturulan klasör yalnızca sahibine açık; mevcut klasörün iznine dokunulmaz.
            #[cfg(unix)]
            if !existed {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
            }
            #[cfg(not(unix))]
            let _ = existed;
        }
    }
    // Yeni DB dosyası SQLite açmadan önce 0600 ile oluşturulur (varsayılan umask'a bırakılmaz).
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let _ = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(path);
    }
    let c = Connection::open(path).map_err(|e| format!("veritabanı açılamadı {}: {}", path.display(), e))?;
    // Önce bekleme süresi: eşzamanlı açılışlarda WAL geçişi kilide takılabilir.
    c.busy_timeout(std::time::Duration::from_millis(5000)).map_err(err)?;
    c.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("WAL etkinleştirilemedi {}: {}", path.display(), e))?;
    c.pragma_update(None, "foreign_keys", "ON").map_err(err)?;
    // SQLite LIKE/lower yalnızca ASCII'de büyük/küçük harf duyarsız; Unicode için kendi fonksiyonumuz.
    c.create_scalar_function(
        "ulower",
        1,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| {
            let s: String = ctx.get(0)?;
            Ok(fold(&s))
        },
    )
    .map_err(err)?;
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            service TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT NOT NULL,
            device TEXT NOT NULL DEFAULT '',
            agent TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_entries_service ON entries(service);
        CREATE INDEX IF NOT EXISTS idx_entries_created ON entries(created_at, id);
        CREATE TABLE IF NOT EXISTS entry_tags (
            entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
            tag TEXT NOT NULL,
            PRIMARY KEY (entry_id, tag)
        );
        CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag);
        CREATE TABLE IF NOT EXISTS outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            payload TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            claimed_until INTEGER NOT NULL DEFAULT 0
        );",
    )
    .map_err(err)?;
    Ok(c)
}

/// Metindeki iyi biçimli, boş olmayan `[[etiket]]` ifadelerini döner (tekrarsız, sıralı).
/// Kapanmamış `[[`, boş `[[ ]]` ve satır sonu içeren aralıklar etiket sayılmaz.
pub fn parse_tags(text: &str) -> Vec<String> {
    let mut out = BTreeSet::new();
    let mut rest = text;
    while let Some(i) = rest.find("[[") {
        let after = &rest[i + 2..];
        let Some(j) = after.find("]]") else { break };
        let inner = &after[..j];
        // İç içe açılış varsa en son `[[` esas alınır (`[[a [[b]]` -> `b`).
        if let Some(k) = inner.rfind("[[") {
            rest = &after[k..];
            continue;
        }
        let t = inner.trim();
        if !t.is_empty() && !t.contains('\n') {
            out.insert(t.to_string());
        }
        rest = &after[j + 2..];
    }
    out.into_iter().collect()
}

/// `BEGIN IMMEDIATE` altında çalıştırır: yazma kilidi baştan alınır, kilit yükseltme çıkmazı olmaz.
fn immediate<T>(c: &Connection, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    c.execute_batch("BEGIN IMMEDIATE").map_err(err)?;
    match f(c) {
        Ok(v) => match c.execute_batch("COMMIT") {
            Ok(()) => Ok(v),
            Err(e) => {
                let _ = c.execute_batch("ROLLBACK");
                Err(err(e))
            }
        },
        Err(e) => {
            let _ = c.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

fn clean_tag(t: &str) -> String {
    t.trim().trim_start_matches("[[").trim_end_matches("]]").trim().to_string()
}

/// Kaydı ekler; etiketler = `e.tags` birleşim `parse_tags(summary)`. Yeni satır id'sini döner.
pub fn insert(c: &Connection, e: &NewEntry) -> Result<i64, String> {
    let mut tags: BTreeSet<String> = parse_tags(&e.summary).into_iter().collect();
    for t in &e.tags {
        let t = clean_tag(t);
        if !t.is_empty() {
            tags.insert(t);
        }
    }
    immediate(c, |c| {
        c.execute(
            "INSERT INTO entries (service, title, summary, device, agent, created_at) VALUES (?1,?2,?3,?4,?5,?6)",
            params![e.service, e.title, e.summary, e.device, e.agent, now_secs()],
        )
        .map_err(err)?;
        let id = c.last_insert_rowid();
        for t in &tags {
            c.execute("INSERT OR IGNORE INTO entry_tags (entry_id, tag) VALUES (?1, ?2)", params![id, t])
                .map_err(err)?;
        }
        Ok(id)
    })
}

/// Kayıtları yeniden eskiye döner. `search` başlık+özette büyük/küçük harf duyarsız alt dize arar.
pub fn query(
    c: &Connection,
    service: Option<&str>,
    search: Option<&str>,
    tag: Option<&str>,
    limit: usize,
) -> Result<Vec<Entry>, String> {
    let mut sql = String::from(
        "SELECT e.id, e.service, e.title, e.summary, e.device, e.agent, e.created_at FROM entries e WHERE 1=1",
    );
    let mut args: Vec<rusqlite::types::Value> = Vec::new();
    if let Some(s) = service.filter(|s| !s.is_empty()) {
        sql.push_str(" AND e.service = ?");
        args.push(s.to_string().into());
    }
    if let Some(q) = search.filter(|s| !s.is_empty()) {
        sql.push_str(" AND (instr(ulower(e.title), ?) > 0 OR instr(ulower(e.summary), ?) > 0)");
        let q = fold(q);
        args.push(q.clone().into());
        args.push(q.into());
    }
    if let Some(t) = tag.map(clean_tag).filter(|t| !t.is_empty()) {
        sql.push_str(" AND EXISTS (SELECT 1 FROM entry_tags t WHERE t.entry_id = e.id AND t.tag = ?)");
        args.push(t.into());
    }
    sql.push_str(" ORDER BY e.created_at DESC, e.id DESC LIMIT ?");
    args.push((limit.min(i64::MAX as usize) as i64).into());

    let mut stmt = c.prepare(&sql).map_err(err)?;
    let mut rows: Vec<Entry> = stmt
        .query_map(params_from_iter(args.iter()), |r| {
            Ok(Entry {
                id: r.get(0)?,
                service: r.get(1)?,
                title: r.get(2)?,
                summary: r.get(3)?,
                tags: vec![],
                device: r.get(4)?,
                agent: r.get(5)?,
                created_at: r.get(6)?,
            })
        })
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    let mut tstmt = c.prepare("SELECT tag FROM entry_tags WHERE entry_id = ?1 ORDER BY tag").map_err(err)?;
    for row in &mut rows {
        row.tags = tstmt
            .query_map(params![row.id], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<Result<_, _>>()
            .map_err(err)?;
    }
    Ok(rows)
}

/// Etiket -> kullanım sayısı (çoktan aza, eşitlikte ada göre).
pub fn tag_counts(c: &Connection) -> Result<Vec<(String, i64)>, String> {
    let mut stmt = c
        .prepare("SELECT tag, COUNT(*) AS n FROM entry_tags GROUP BY tag ORDER BY n DESC, tag ASC LIMIT 200")
        .map_err(err)?;
    stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)
}

/// Bir kaydın en çok bu kadar kalıcı hatadan sonra artık kiralanmaz (zehirli kayıt).
pub const MAX_ATTEMPTS: i64 = 10;

/// Hub'a gönderilecek yükü kuyruğa ekler.
pub fn enqueue(c: &Connection, payload: &str) -> Result<(), String> {
    c.execute("INSERT INTO outbox (payload) VALUES (?1)", params![payload]).map_err(err)?;
    Ok(())
}

/// Kuyruktan en çok `max` kaydı tek `BEGIN IMMEDIATE` işleminde kiralar (`claimed_until = şimdi + lease_secs`).
/// Kirası dolmamış kayıtlar başka süreçlere verilmez.
pub fn claim_outbox(c: &Connection, max: usize, lease_secs: i64) -> Result<Vec<(i64, String)>, String> {
    immediate(c, |c| {
        let now = now_secs();
        let mut stmt = c
            .prepare("SELECT id, payload FROM outbox WHERE claimed_until <= ?1 AND attempts < ?3 ORDER BY id LIMIT ?2")
            .map_err(err)?;
        let items: Vec<(i64, String)> = stmt
            .query_map(params![now, max as i64, MAX_ATTEMPTS], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(err)?
            .collect::<Result<_, _>>()
            .map_err(err)?;
        for (id, _) in &items {
            c.execute(
                "UPDATE outbox SET claimed_until = ?1 WHERE id = ?2",
                params![now + lease_secs, id],
            )
            .map_err(err)?;
        }
        Ok(items)
    })
}

/// Kalıcı hata: deneme sayısını artırır ve kirayı bırakır (kayıt `MAX_ATTEMPTS`'e dek yeniden alınabilir).
pub fn bump_outbox(c: &Connection, id: i64) {
    let _ = c.execute("UPDATE outbox SET attempts = attempts + 1, claimed_until = 0 WHERE id = ?1", params![id]);
}

/// Kirayı bırakır (deneme sayısı değişmez); kayıt hemen yeniden alınabilir.
pub fn release_outbox(c: &Connection, id: i64) {
    let _ = c.execute("UPDATE outbox SET claimed_until = 0 WHERE id = ?1", params![id]);
}

/// Başarıyla gönderilen kuyruk kaydını siler.
pub fn ack_outbox(c: &Connection, id: i64) {
    let _ = c.execute("DELETE FROM outbox WHERE id = ?1", params![id]);
}

pub fn outbox_len(c: &Connection) -> Result<i64, String> {
    c.query_row("SELECT COUNT(*) FROM outbox", [], |r| r.get(0)).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static SEQ: AtomicU32 = AtomicU32::new(0);

    /// Her test için benzersiz geçici DB yolu.
    fn tmp_db(name: &str) -> std::path::PathBuf {
        let n = SEQ.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("ydevdesk-kn-store-{}-{}-{}", std::process::id(), name, n));
        let _ = std::fs::remove_dir_all(&dir);
        dir.join("knowledge.db")
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

    #[test]
    fn wal_mode_enabled() {
        let c = open(&tmp_db("wal")).unwrap();
        let mode: String = c.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
        assert_eq!(mode.to_lowercase(), "wal");
    }

    #[test]
    fn insert_and_query_filters() {
        let c = open(&tmp_db("filters")).unwrap();
        insert(&c, &ne("alpha", "Birinci Kayıt", "Merhaba DÜNYA [[a/x]]")).unwrap();
        insert(&c, &ne("beta", "İkinci", "başka bir şey [[b/y]]")).unwrap();
        insert(&c, &ne("alpha", "Üçüncü", "dünya ikinci kez")).unwrap();

        let all = query(&c, None, None, None, 10).unwrap();
        assert_eq!(all.len(), 3);
        // yeniden eskiye: en son eklenen başta (aynı saniyede id ile ayrılır)
        assert_eq!(all[0].title, "Üçüncü");
        assert_eq!(all[2].title, "Birinci Kayıt");

        let alpha = query(&c, Some("alpha"), None, None, 10).unwrap();
        assert_eq!(alpha.len(), 2);

        // büyük/küçük harf duyarsız; başlık + özet
        assert_eq!(query(&c, None, Some("MERHABA"), None, 10).unwrap().len(), 1);
        assert_eq!(query(&c, None, Some("birinci"), None, 10).unwrap().len(), 1);

        let t = query(&c, None, None, Some("b/y"), 10).unwrap();
        assert_eq!(t.len(), 1);
        assert_eq!(t[0].title, "İkinci");
        assert_eq!(t[0].tags, vec!["b/y".to_string()]);

        assert_eq!(query(&c, None, None, None, 2).unwrap().len(), 2);
    }

    #[test]
    fn parse_tags_only_wellformed() {
        assert_eq!(parse_tags("a [[x/y]] [[ ]] [[kapanmamış"), vec!["x/y".to_string()]);
    }

    #[test]
    fn parse_tags_dedup_sorted_and_nested() {
        assert_eq!(
            parse_tags("[[b]] [[a]] [[b]] [[x [[y]] [[satır\nsonu]]"),
            vec!["a".to_string(), "b".to_string(), "y".to_string()]
        );
    }

    #[test]
    fn unicode_multiline_long_roundtrip() {
        let c = open(&tmp_db("unicode")).unwrap();
        let s1 = "çğıöşü\n🧠";
        insert(&c, &ne("svc", "başlık", s1)).unwrap();
        let big = "x".repeat(200 * 1024);
        insert(&c, &ne("svc", "uzun", &big)).unwrap();
        let rows = query(&c, None, None, None, 10).unwrap();
        assert_eq!(rows[0].summary.len(), 200 * 1024);
        assert_eq!(rows[1].summary, s1);
    }

    #[test]
    fn unicode_search_is_case_insensitive() {
        let c = open(&tmp_db("ulower")).unwrap();
        insert(&c, &ne("svc", "ÇİĞ Köfte", "özet")).unwrap();
        assert_eq!(query(&c, None, Some("çiğ"), None, 10).unwrap().len(), 1);
        assert_eq!(query(&c, None, Some("ÖZET"), None, 10).unwrap().len(), 1);
    }

    #[test]
    fn concurrent_writers_no_busy_errors() {
        let path = tmp_db("concurrent");
        open(&path).unwrap();
        let handles: Vec<_> = (0..8)
            .map(|t| {
                let p = path.clone();
                std::thread::spawn(move || {
                    let c = open(&p).unwrap();
                    for i in 0..25 {
                        insert(&c, &ne("svc", &format!("t{t}-{i}"), "s [[c/t]]")).unwrap();
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        let c = open(&path).unwrap();
        assert_eq!(query(&c, None, None, None, 1000).unwrap().len(), 200);
    }

    #[test]
    fn outbox_claim_is_exclusive() {
        let path = tmp_db("outbox");
        let a = open(&path).unwrap();
        let b = open(&path).unwrap();
        enqueue(&a, "p1").unwrap();
        enqueue(&a, "p2").unwrap();
        assert_eq!(outbox_len(&a).unwrap(), 2);

        // kira süresi içinde ikinci bağlantı boş döner
        assert_eq!(claim_outbox(&a, 10, 60).unwrap().len(), 2);
        assert!(claim_outbox(&b, 10, 60).unwrap().is_empty());
    }

    #[test]
    fn outbox_zero_lease_is_reclaimable_and_ack_deletes() {
        let path = tmp_db("outbox0");
        let a = open(&path).unwrap();
        let b = open(&path).unwrap();
        enqueue(&a, "p1").unwrap();
        enqueue(&a, "p2").unwrap();

        // lease_secs=0: kira hemen dolar, tekrar alınabilir
        assert_eq!(claim_outbox(&a, 10, 0).unwrap().len(), 2);
        let re = claim_outbox(&b, 10, 60).unwrap();
        assert_eq!(re.len(), 2);
        assert!(claim_outbox(&a, 10, 60).unwrap().is_empty());

        for (id, _) in &re {
            ack_outbox(&b, *id);
        }
        assert_eq!(outbox_len(&a).unwrap(), 0);
    }

    #[test]
    fn tag_counts_limited_to_200() {
        let c = open(&tmp_db("tagcap")).unwrap();
        let tags: Vec<String> = (0..250).map(|i| format!("t/{i:03}")).collect();
        let mut e = ne("svc", "çok etiket", "x");
        e.tags = tags;
        insert(&c, &e).unwrap();
        assert_eq!(tag_counts(&c).unwrap().len(), 200);
    }

    #[test]
    fn foreign_keys_enabled() {
        let c = open(&tmp_db("fk")).unwrap();
        let on: i64 = c.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(on, 1);
        // Olmayan kayda etiket eklenemez
        assert!(c.execute("INSERT INTO entry_tags (entry_id, tag) VALUES (999, 'x')", []).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn new_db_file_is_0600_and_new_dir_0700() {
        use std::os::unix::fs::PermissionsExt;
        let p = tmp_db("perm");
        let c = open(&p).unwrap();
        insert(&c, &ne("svc", "t", "s")).unwrap();
        let mode = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "db modu {:o}", mode);
        let dmode = std::fs::metadata(p.parent().unwrap()).unwrap().permissions().mode() & 0o777;
        assert_eq!(dmode, 0o700, "klasör modu {:o}", dmode);
    }

    #[cfg(unix)]
    #[test]
    fn existing_dir_perm_untouched() {
        use std::os::unix::fs::PermissionsExt;
        let p = tmp_db("permexist");
        let dir = p.parent().unwrap().to_path_buf();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        open(&p).unwrap();
        let dmode = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
        assert_eq!(dmode, 0o755);
    }

    #[test]
    fn bump_outbox_counts_and_poison_excluded() {
        let a = open(&tmp_db("poison")).unwrap();
        enqueue(&a, "p1").unwrap();
        let (id, _) = claim_outbox(&a, 10, 60).unwrap().remove(0);
        // claim attempts'i artırmaz; bump kirayı bırakır
        bump_outbox(&a, id);
        for _ in 1..MAX_ATTEMPTS {
            assert_eq!(claim_outbox(&a, 10, 60).unwrap().len(), 1);
            bump_outbox(&a, id);
        }
        // 10 kalıcı hatadan sonra artık alınmaz, ama silinmez
        assert!(claim_outbox(&a, 10, 60).unwrap().is_empty());
        assert_eq!(outbox_len(&a).unwrap(), 1);
    }

    #[test]
    fn release_outbox_makes_reclaimable() {
        let a = open(&tmp_db("release")).unwrap();
        enqueue(&a, "p1").unwrap();
        let (id, _) = claim_outbox(&a, 10, 60).unwrap().remove(0);
        assert!(claim_outbox(&a, 10, 60).unwrap().is_empty());
        release_outbox(&a, id);
        assert_eq!(claim_outbox(&a, 10, 60).unwrap().len(), 1);
    }
}
