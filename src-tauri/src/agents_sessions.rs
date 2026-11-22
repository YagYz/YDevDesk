use std::collections::HashMap;
use crate::agents_usage::estimate_agy_transcript_tokens;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct ActiveAgentSession {
    pub session_id: String,
    pub full_session_id: String,
    pub agent: String,
    pub title: String,
    pub cwd: Option<String>,
    pub is_active: bool,
    pub model: String,
    pub last_tool: String,
    pub updated_ago_secs: u64,
    pub subagent_count: u32,
}


#[derive(Serialize, Deserialize, Clone)]
pub struct SubagentInfo {
    pub name: String,
    pub role: String,
    pub status: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RecentToolCall {
    pub name: String,
    pub timestamp: String,
    pub detail: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FileHeatItem {
    pub name: String,
    pub count: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AgentStatus {
    pub model: String,
    pub used_percentage: f64,
    pub session_cost: f64,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub mode: String,
    pub agent_state: String,
    pub active_sessions_count: usize,
    pub quota_5h_percent: f64,
    pub quota_weekly_percent: f64,
    pub tools_per_minute: u32,
    pub marquee_text: String,
    pub ticker_squares: Vec<String>,
    pub file_heat: Vec<FileHeatItem>, // En çok dokunulan dosyalar
    pub sessions: Vec<ActiveAgentSession>,
    pub subagents: Vec<SubagentInfo>,
    pub recent_tools: Vec<RecentToolCall>,
}


// Büyük transcript dosyalarının tamamını okumamak için mtime önbellekli son bayt okuyucu.
pub(crate) fn read_tail(path: &std::path::Path, max_bytes: u64) -> Option<String> {
    crate::agents::cache::cached_read_tail(path, max_bytes)
}

// Büyük transcript dosyalarının yalnızca başındaki baytları mtime önbelleğiyle okur.
pub(crate) fn read_head(path: &std::path::Path, max_bytes: usize) -> Option<String> {
    crate::agents::cache::cached_read_head(path, max_bytes)
}

fn short_id(id: &str) -> String {
    id.chars().take(8).collect()
}

fn clean_prompt_preview(raw: &str, max_chars: usize) -> String {
    let stripped = raw
        .replace("<USER_REQUEST>", "")
        .replace("</USER_REQUEST>", "");
    let stripped = stripped
        .split("<ADDITIONAL_METADATA>")
        .next()
        .unwrap_or(&stripped);
    let collapsed: String = stripped.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let count = trimmed.chars().count();
    if count <= max_chars {
        trimmed.to_string()
    } else {
        let prefix: String = trimmed.chars().take(max_chars.saturating_sub(1)).collect();
        format!("{}…", prefix)
    }
}

pub(crate) fn mtime_ago_secs(path: &std::path::Path, now: std::time::SystemTime) -> Option<u64> {
    let meta = std::fs::metadata(path).ok()?;
    let mtime = meta.modified().ok()?;
    now.duration_since(mtime).ok().map(|d| d.as_secs())
}

fn is_uuid_like(s: &str) -> bool {
    s.len() == 36
        && s.bytes().enumerate().all(|(i, b)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}

// Tüm transcript'i satır satır taradığı için (mtime, boyut) değişmedikçe önbellekten döner.
fn extract_agy_subagent_ids(t_path: &std::path::Path) -> std::collections::HashSet<String> {
    static CACHE: std::sync::OnceLock<crate::agents::cache::MtimeCache<std::collections::HashSet<String>>> =
        std::sync::OnceLock::new();
    CACHE
        .get_or_init(crate::agents::cache::MtimeCache::new)
        .get_or_load(t_path, |p| Some(scan_agy_subagent_ids(p)))
        .unwrap_or_default()
}

fn scan_agy_subagent_ids(t_path: &std::path::Path) -> std::collections::HashSet<String> {
    let mut ids = std::collections::HashSet::new();
    let Ok(file) = std::fs::File::open(t_path) else {
        return ids;
    };
    let reader = std::io::BufReader::new(file);
    for line in std::io::BufRead::lines(reader).map_while(Result::ok) {
        if !line.contains("conversationId")
            || (!line.contains("Created the following subagent") && !line.contains("invoke_subagent"))
        {
            continue;
        }
        let mut search_from = 0;
        while let Some(pos) = line[search_from..].find("conversationId") {
            let after_key = &line[search_from + pos + "conversationId".len()..];
            if let Some(colon) = after_key.find(':') {
                let rest = after_key[colon + 1..]
                    .trim_start_matches(|c: char| c.is_whitespace() || c == '\\' || c == '"');
                if let Some(candidate) = rest.get(..36) {
                    if is_uuid_like(candidate) {
                        ids.insert(candidate.to_string());
                    }
                }
            }
            search_from += pos + "conversationId".len();
        }
    }
    ids
}

fn collect_agy_sessions(
    agy_dir: &std::path::Path,
    now: std::time::SystemTime,
) -> (Vec<ActiveAgentSession>, Option<std::path::PathBuf>) {
    let brain_dir = agy_dir.join("brain");
    let mut found = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&brain_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let t_path = path.join(".system_generated").join("logs").join("transcript.jsonl");
                if let Some(diff_secs) = mtime_ago_secs(&t_path, now) {
                    let id = entry.file_name().to_string_lossy().to_string();
                    found.push((diff_secs, id, t_path));
                }
            }
        }
    }
    found.sort_by_key(|s| s.0);

    let mut known_subagents = std::collections::HashSet::new();
    let mut parent_subagent_counts: HashMap<String, u32> = HashMap::new();
    for (_, parent_id, t_path) in &found {
        let mut sub_ids = extract_agy_subagent_ids(t_path);
        sub_ids.remove(parent_id);
        if !sub_ids.is_empty() {
            parent_subagent_counts.insert(parent_id.clone(), sub_ids.len() as u32);
            known_subagents.extend(sub_ids);
        }
    }

    let mut primary_transcript_path: Option<std::path::PathBuf> = None;
    let mut sessions = Vec::new();

    for (diff_secs, full_id, t_path) in found {
        if sessions.len() >= 30 {
            break;
        }
        if known_subagents.contains(&full_id) {
            continue;
        }
        let head = read_head(&t_path, 16 * 1024);
        if let Some(ref head_str) = head {
            let starts_with_system_sdk = head_str
                .lines()
                .next()
                .is_some_and(|first| first.contains("SYSTEM_SDK"));
            if starts_with_system_sdk && !head_str.contains("USER_EXPLICIT") {
                continue;
            }
        }
        if primary_transcript_path.is_none() {
            primary_transcript_path = Some(t_path.clone());
        }

        let mut title = String::new();
        if let Some(head_str) = head {
            for line in head_str.lines() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                    if v.get("type").and_then(|t| t.as_str()) == Some("USER_INPUT") {
                        if let Some(content) = v.get("content").and_then(|c| c.as_str()) {
                            title = clean_prompt_preview(content, 72);
                            if !title.is_empty() {
                                break;
                            }
                        }
                    }
                }
            }
        }
        if title.is_empty() {
            title = "AGY Oturumu".to_string();
        }
        let subagent_count = *parent_subagent_counts.get(&full_id).unwrap_or(&0);
        sessions.push(ActiveAgentSession {
            session_id: short_id(&full_id),
            full_session_id: full_id,
            agent: "agy".to_string(),
            title,
            cwd: None,
            is_active: diff_secs < 300,
            model: "AGY".to_string(),
            last_tool: "working".to_string(),
            updated_ago_secs: diff_secs,
            subagent_count,
        });
    }

    (sessions, primary_transcript_path)
}

fn extract_claude_user_text(v: &serde_json::Value) -> Option<String> {
    let msg = v.get("message")?;
    let content = msg.get("content")?;
    if let Some(s) = content.as_str() {
        let c = clean_prompt_preview(s, 72);
        if !c.is_empty() && !c.starts_with('<') {
            return Some(c);
        }
    } else if let Some(arr) = content.as_array() {
        for item in arr {
            if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                if let Some(s) = item.get("text").and_then(|t| t.as_str()) {
                    let c = clean_prompt_preview(s, 72);
                    if !c.is_empty() && !c.starts_with('<') {
                        return Some(c);
                    }
                }
            }
        }
    }
    None
}

fn extract_claude_subagent_parent_id(f_path: &std::path::Path) -> Option<String> {
    let head = read_head(f_path, 4096)?;
    for line in head.lines() {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(sid) = v.get("sessionId").and_then(|s| s.as_str()) {
                if !sid.is_empty() {
                    return Some(sid.to_string());
                }
            }
        }
    }
    None
}

fn collect_claude_sessions(home: &std::path::Path, now: std::time::SystemTime) -> Vec<ActiveAgentSession> {
    let projects_dir = home.join(".claude").join("projects");
    let mut files = Vec::new();
    let mut subagent_counts: HashMap<String, u32> = HashMap::new();
    if let Ok(proj_entries) = std::fs::read_dir(&projects_dir) {
        for proj in proj_entries.flatten() {
            let p_path = proj.path();
            if p_path.is_dir() {
                if let Ok(sess_entries) = std::fs::read_dir(&p_path) {
                    for s_entry in sess_entries.flatten() {
                        let f_path = s_entry.path();
                        let fname = s_entry.file_name().to_string_lossy().to_string();
                        if fname.ends_with(".jsonl") {
                            if fname.starts_with("agent-") {
                                if let Some(parent_sid) = extract_claude_subagent_parent_id(&f_path) {
                                    *subagent_counts.entry(parent_sid).or_insert(0) += 1;
                                }
                            } else if let Some(diff_secs) = mtime_ago_secs(&f_path, now) {
                                files.push((diff_secs, f_path));
                            }
                        } else if f_path.is_dir() {
                            let sub_dir = f_path.join("subagents");
                            if let Ok(sub_entries) = std::fs::read_dir(&sub_dir) {
                                for sub_entry in sub_entries.flatten() {
                                    let sub_fname = sub_entry.file_name().to_string_lossy().to_string();
                                    if sub_fname.starts_with("agent-") && sub_fname.ends_with(".jsonl") {
                                        let parent_sid = extract_claude_subagent_parent_id(&sub_entry.path())
                                            .unwrap_or_else(|| fname.clone());
                                        *subagent_counts.entry(parent_sid).or_insert(0) += 1;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    files.sort_by_key(|f| f.0);

    let mut sessions = Vec::new();
    for (diff_secs, f_path) in files.into_iter().take(30) {
        let stem = f_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let mut full_id = stem.clone();
        let mut cwd: Option<String> = None;
        let mut title = String::new();
        let mut model = "Claude Code".to_string();

        if let Some(head) = read_head(&f_path, 24 * 1024) {
            for line in head.lines() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                    if let Some(sid) = v.get("sessionId").and_then(|s| s.as_str()) {
                        if !sid.is_empty() {
                            full_id = sid.to_string();
                        }
                    }
                    if cwd.is_none() {
                        if let Some(c) = v.get("cwd").and_then(|s| s.as_str()) {
                            if !c.is_empty() {
                                cwd = Some(c.to_string());
                            }
                        }
                    }
                    if let Some(m) = v.get("message").and_then(|m| m.get("model")).and_then(|m| m.as_str()) {
                        model = m.to_string();
                    }
                    if title.is_empty() && v.get("type").and_then(|t| t.as_str()) == Some("user") {
                        if let Some(t) = extract_claude_user_text(&v) {
                            title = t;
                        }
                    }
                }
            }
        }
        // Oturum içinde /model ile değiştirilen model için dosya sonundaki son değeri kullan
        if let Some(tail) = read_tail(&f_path, 128 * 1024) {
            for line in tail.lines().rev() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                    if let Some(m) = v.get("message").and_then(|m| m.get("model")).and_then(|m| m.as_str()) {
                        if !m.is_empty() && !m.starts_with('<') {
                            model = m.to_string();
                            break;
                        }
                    }
                }
            }
        }
        if full_id.is_empty() {
            continue;
        }
        if title.is_empty() {
            title = "Claude Code Oturumu".to_string();
        }
        let subagent_count = *subagent_counts.get(&full_id).unwrap_or(&0);
        sessions.push(ActiveAgentSession {
            session_id: short_id(&full_id),
            full_session_id: full_id,
            agent: "claude".to_string(),
            title,
            cwd,
            is_active: diff_secs < 300,
            model,
            last_tool: "working".to_string(),
            updated_ago_secs: diff_secs,
            subagent_count,
        });
    }
    sessions
}

pub(crate) fn walk_jsonl_depth(
    dir: &std::path::Path,
    depth: usize,
    now: std::time::SystemTime,
    out: &mut Vec<(u64, std::path::PathBuf)>,
) {
    if depth == 0 {
        return;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                walk_jsonl_depth(&p, depth - 1, now, out);
            } else if p.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                if let Some(diff) = mtime_ago_secs(&p, now) {
                    out.push((diff, p));
                }
            }
        }
    }
}

fn collect_codex_sessions(home: &std::path::Path, now: std::time::SystemTime) -> Vec<ActiveAgentSession> {
    let codex_dir = home.join(".codex");
    let mut index_titles: HashMap<String, String> = HashMap::new();
    let index_path = codex_dir.join("session_index.jsonl");
    if let Ok(content) = std::fs::read_to_string(&index_path) {
        for line in content.lines() {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                if let (Some(id), Some(name)) = (
                    v.get("id").and_then(|s| s.as_str()),
                    v.get("thread_name").and_then(|s| s.as_str()),
                ) {
                    if !name.trim().is_empty() {
                        index_titles.insert(id.to_string(), clean_prompt_preview(name, 72));
                    }
                }
            }
        }
    }

    let mut files = Vec::new();
    walk_jsonl_depth(&codex_dir.join("sessions"), 4, now, &mut files);
    files.sort_by_key(|f| f.0);

    let mut sessions = Vec::new();
    for (diff_secs, f_path) in files.into_iter().take(30) {
        let mut full_id = String::new();
        let mut cwd: Option<String> = None;
        let mut title = String::new();
        let mut model = "Codex".to_string();

        if let Some(head) = read_head(&f_path, 32 * 1024) {
            for line in head.lines() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                    let kind = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    if kind == "session_meta" {
                        if let Some(payload) = v.get("payload") {
                            if let Some(id) = payload.get("id").or_else(|| payload.get("session_id")).and_then(|s| s.as_str()) {
                                full_id = id.to_string();
                            }
                            if let Some(c) = payload.get("cwd").and_then(|s| s.as_str()) {
                                if !c.is_empty() {
                                    cwd = Some(c.to_string());
                                }
                            }
                            if let Some(m) = payload.get("model_provider").and_then(|s| s.as_str()) {
                                model = format!("Codex ({})", m);
                            }
                        }
                    } else if kind == "turn_context" {
                        if let Some(m) = v.get("payload").and_then(|p| p.get("model")).and_then(|m| m.as_str()) {
                            model = m.to_string();
                        }
                    } else if title.is_empty() && kind == "event_msg" {
                        if let Some(payload) = v.get("payload") {
                            if payload.get("type").and_then(|t| t.as_str()) == Some("user_message") {
                                if let Some(msg) = payload.get("message").and_then(|s| s.as_str()) {
                                    title = clean_prompt_preview(msg, 72);
                                }
                            }
                        }
                    }
                }
            }
        }

        if full_id.is_empty() {
            // Dosya adından UUID çıkar (rollout-...-<uuid>.jsonl)
            if let Some(stem) = f_path.file_stem().and_then(|s| s.to_str()) {
                if let Some(idx) = stem.len().checked_sub(36) {
                    if let Some(tail) = stem.get(idx..) {
                        full_id = tail.to_string();
                    }
                }
            }
        }
        if full_id.is_empty() {
            continue;
        }
        if let Some(idx_title) = index_titles.get(&full_id) {
            title = idx_title.clone();
        }
        if title.is_empty() {
            title = "Codex Oturumu".to_string();
        }

        sessions.push(ActiveAgentSession {
            session_id: short_id(&full_id),
            full_session_id: full_id,
            agent: "codex".to_string(),
            title,
            cwd,
            is_active: diff_secs < 300,
            model,
            last_tool: "working".to_string(),
            updated_ago_secs: diff_secs,
            subagent_count: 0,
        });
    }
    sessions
}

// 5. Antigravity, Claude Code ve Codex Ajan Durumu, Telemetri ve Oturum Verisini Okuma
// ---- Claude Code odak oturumu telemetrisi -------------------------------------------------
// Claude jsonl'inde aynı message.id birden çok kayıtta tekrarlanır (içerik bloğu başına).
// Son görülen usage değeri esas alınır; dosya artımlı okunur (offset önbelleği), böylece
// 2 sn'lik pollingde sadece eklenen baytlar işlenir.
#[derive(Default)]
struct ClaudeAgg {
    offset: u64,
    // message.id -> (fresh_input, output, cost)
    per_msg: HashMap<String, (u64, u64, f64)>,
    input: u64,
    output: u64,
    cost: f64,
    last_ctx: u64,
    model: String,
}

static CLAUDE_AGG: std::sync::OnceLock<std::sync::Mutex<HashMap<std::path::PathBuf, ClaudeAgg>>> =
    std::sync::OnceLock::new();

struct FocusTelemetry {
    model: String,
    input: u64,
    output: u64,
    cost: f64,
    used_percentage: f64,
    recent_tools: Vec<RecentToolCall>,
    ticker: Vec<String>,
    files: HashMap<String, u32>,
    tool_times: Vec<i64>,
}

fn find_claude_session_file(home: &std::path::Path, session_id: &str) -> Option<std::path::PathBuf> {
    let name = format!("{}.jsonl", session_id);
    for proj in std::fs::read_dir(home.join(".claude").join("projects")).ok()?.flatten() {
        let candidate = proj.path().join(&name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn claude_aggregate(path: &std::path::Path) -> Option<(String, u64, u64, f64, u64)> {
    use std::io::{Read, Seek, SeekFrom};
    let len = std::fs::metadata(path).ok()?.len();
    let cache = CLAUDE_AGG.get_or_init(Default::default);
    let mut map = cache.lock().ok()?;
    if map.len() > 16 && !map.contains_key(path) {
        map.clear();
    }
    let agg = map.entry(path.to_path_buf()).or_default();
    if len < agg.offset {
        *agg = ClaudeAgg::default();
    }
    if len > agg.offset {
        let mut f = std::fs::File::open(path).ok()?;
        f.seek(SeekFrom::Start(agg.offset)).ok()?;
        let mut buf = Vec::new();
        f.take(len - agg.offset).read_to_end(&mut buf).ok()?;
        // Yalnızca tamamlanmış satırları işle; yarım satır sonraki turda okunur.
        let end = buf.iter().rposition(|b| *b == b'\n').map(|i| i + 1).unwrap_or(0);
        for line in String::from_utf8_lossy(&buf[..end]).lines() {
            let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
            if v.get("type").and_then(|t| t.as_str()) != Some("assistant") {
                continue;
            }
            let Some(rec) = v.get("message").and_then(crate::agents_usage::parse_claude_usage) else { continue };
            if !rec.model.is_empty() && !rec.model.starts_with('<') {
                agg.model = rec.model.clone();
            }
            if rec.is_empty() {
                continue;
            }
            let (fresh, out, cost) = (rec.fresh_input(), rec.output, rec.cost_usd());
            if let Some(old) = agg.per_msg.insert(rec.id.clone(), (fresh, out, cost)) {
                agg.input -= old.0;
                agg.output -= old.1;
                agg.cost -= old.2;
            }
            agg.input += fresh;
            agg.output += out;
            agg.cost += cost;
            agg.last_ctx = rec.prompt_tokens();
        }
        agg.offset += end as u64;
    }
    Some((agg.model.clone(), agg.input, agg.output, agg.cost, agg.last_ctx))
}

fn claude_tool_detail(name: &str, input: Option<&serde_json::Value>) -> (String, Option<String>) {
    let s = |k: &str| input.and_then(|i| i.get(k)).and_then(|v| v.as_str()).map(|v| v.to_string());
    let clip = |t: String| -> String {
        let one: String = t.split_whitespace().collect::<Vec<_>>().join(" ");
        if one.chars().count() > 80 {
            format!("{}…", one.chars().take(79).collect::<String>())
        } else {
            one
        }
    };
    match name {
        "Bash" => (clip(s("description").or_else(|| s("command")).unwrap_or_else(|| "Komut yürütüldü".into())), None),
        "Read" | "Edit" | "Write" | "MultiEdit" | "NotebookEdit" => {
            let raw = s("file_path").or_else(|| s("notebook_path")).unwrap_or_else(|| "dosya".into());
            let file = raw.rsplit('/').next().unwrap_or(&raw).to_string();
            (file.clone(), Some(file))
        }
        "Grep" | "Glob" => (clip(s("pattern").unwrap_or_default()), None),
        "WebSearch" => (clip(s("query").unwrap_or_default()), None),
        "WebFetch" => (clip(s("url").unwrap_or_default()), None),
        "Task" | "Agent" => (clip(s("description").unwrap_or_default()), None),
        _ => ("İşlem yapıldı".to_string(), None),
    }
}

// Bağlam penceresi: 5.x ailesi, Opus 4.6+ ve Sonnet 4.6 için 1M; Haiku 4.5 ve eski modeller 200K.
fn claude_context_window(model: &str) -> u64 {
    let m = model.to_lowercase();
    let one_million = m.contains("[1m]")
        || m.contains("fable")
        || m.contains("mythos")
        || ["opus-5", "sonnet-5", "haiku-5", "opus-4-6", "opus-4-7", "opus-4-8", "sonnet-4-6"]
            .iter()
            .any(|k| m.contains(k));
    if one_million { 1_000_000 } else { 200_000 }
}

fn claude_focus_telemetry(path: &std::path::Path) -> Option<FocusTelemetry> {
    let (model, input, output, cost, last_ctx) = claude_aggregate(path)?;
    let window = claude_context_window(&model);
    let used_percentage = ((last_ctx as f64 / window as f64) * 100.0).min(100.0);

    let mut recent_tools = Vec::new();
    let mut ticker = Vec::new();
    let mut files: HashMap<String, u32> = HashMap::new();
    let mut tool_times: Vec<i64> = Vec::new();
    if let Some(tail) = read_tail(path, 512 * 1024) {
        for line in tail.lines().rev().take(200) {
            let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
            if v.get("type").and_then(|t| t.as_str()) != Some("assistant") {
                continue;
            }
            let ts = v.get("timestamp").and_then(|t| t.as_str()).unwrap_or("").to_string();
            let Some(blocks) = v.get("message").and_then(|m| m.get("content")).and_then(|c| c.as_array()) else {
                continue;
            };
            for b in blocks.iter().rev() {
                if b.get("type").and_then(|t| t.as_str()) != Some("tool_use") {
                    continue;
                }
                let name = b.get("name").and_then(|n| n.as_str()).unwrap_or("tool").to_string();
                let (detail, file) = claude_tool_detail(&name, b.get("input"));
                if let Some(t) = parse_iso_epoch(&ts) {
                    tool_times.push(t);
                }
                if let Some(f) = file {
                    *files.entry(f).or_insert(0) += 1;
                }
                if ticker.len() < 60 {
                    ticker.push(name.clone());
                }
                if recent_tools.len() < 8 {
                    recent_tools.push(RecentToolCall { name, timestamp: ts.clone(), detail });
                }
            }
            if ticker.len() >= 60 {
                break;
            }
        }
    }
    Some(FocusTelemetry { model, input, output, cost, used_percentage, recent_tools, ticker, files, tool_times })
}

// "2026-11-22T19:14:51.893Z" -> unix epoch saniyesi (chrono bağımlılığı olmadan).
fn parse_iso_epoch(ts: &str) -> Option<i64> {
    let b = ts.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || (b[10] != b'T' && b[10] != b' ') {
        return None;
    }
    let num = |r: std::ops::Range<usize>| ts.get(r)?.parse::<i64>().ok();
    let (y, m, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (hh, mm, ss) = (num(11..13)?, num(14..16)?, num(17..19)?);
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    // Howard Hinnant days_from_civil
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some(days * 86400 + hh * 3600 + mm * 60 + ss)
}

fn json_command_string(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Array(a) => {
            let parts: Vec<&str> = a.iter().filter_map(|x| x.as_str()).collect();
            if parts.len() >= 3 && (parts[1] == "-lc" || parts[1] == "-c") {
                Some(parts[2..].join(" "))
            } else if parts.is_empty() {
                None
            } else {
                Some(parts.join(" "))
            }
        }
        _ => None,
    }
}

fn clip_one_line(t: &str, max: usize) -> String {
    let one: String = t.split_whitespace().collect::<Vec<_>>().join(" ");
    if one.chars().count() > max {
        format!("{}…", one.chars().take(max.saturating_sub(1)).collect::<String>())
    } else {
        one
    }
}

// apply_patch gövdesinden dokunulan dosya adları ("*** Update File: path" vb.)
fn patch_files(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|l| {
            ["*** Update File: ", "*** Add File: ", "*** Delete File: "]
                .iter()
                .find_map(|p| l.strip_prefix(p))
        })
        .map(|p| p.trim().rsplit('/').next().unwrap_or(p).to_string())
        .collect()
}

// Codex: oturum jsonl dosyasının sonundan token_count + araç çağrıları.
// token_count.total_token_usage kümülatif olduğundan son kayıt yeterli (artımlı okuma gerekmez).
fn codex_focus_telemetry(path: &std::path::Path) -> Option<FocusTelemetry> {
    let tail = read_tail(path, 1024 * 1024)?;
    let mut model = String::new();
    let mut usage: Option<(u64, u64, u64)> = None; // (input, cached, output)
    let mut used_percentage = 0.0;
    let mut recent_tools = Vec::new();
    let mut ticker = Vec::new();
    let mut files: HashMap<String, u32> = HashMap::new();
    let mut tool_times: Vec<i64> = Vec::new();

    for line in tail.lines().rev() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        let top = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let Some(p) = v.get("payload") else { continue };
        let ptype = p.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let ts = v.get("timestamp").and_then(|t| t.as_str()).unwrap_or("").to_string();

        if model.is_empty() {
            if top == "turn_context" {
                if let Some(m) = p.get("model").and_then(|m| m.as_str()) {
                    model = m.to_string();
                }
            } else if ptype == "thread_settings_applied" {
                if let Some(m) = p.get("thread_settings").and_then(|t| t.get("model")).and_then(|m| m.as_str()) {
                    model = m.to_string();
                }
            }
        }

        if usage.is_none() && top == "event_msg" && ptype == "token_count" {
            if let Some(info) = p.get("info") {
                if let Some(u) = info.get("total_token_usage") {
                    let n = |k: &str| u.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
                    usage = Some((n("input_tokens"), n("cached_input_tokens"), n("output_tokens")));
                }
                let window = info.get("model_context_window").and_then(|w| w.as_u64()).unwrap_or(0);
                let last_in = info
                    .get("last_token_usage")
                    .and_then(|u| u.get("input_tokens"))
                    .and_then(|x| x.as_u64())
                    .unwrap_or(0);
                if window > 0 {
                    used_percentage = ((last_in as f64 / window as f64) * 100.0).min(100.0);
                }
            }
        }

        if top == "response_item"
            && matches!(ptype, "function_call" | "custom_tool_call" | "local_shell_call")
            && recent_tools.len() < 8
        {
            let name = match ptype {
                "local_shell_call" => "shell".to_string(),
                _ => p.get("name").and_then(|n| n.as_str()).unwrap_or("tool").to_string(),
            };
            let args: Option<serde_json::Value> = p
                .get("arguments")
                .and_then(|a| a.as_str())
                .and_then(|s| serde_json::from_str(s).ok());
            let raw_input = p.get("input").and_then(|i| i.as_str()).map(|s| s.to_string())
                .or_else(|| args.as_ref().and_then(|a| a.get("input")).and_then(|i| i.as_str()).map(|s| s.to_string()));
            let mut detail = "İşlem yapıldı".to_string();
            if let Some(text) = raw_input.as_deref().filter(|t| t.contains("*** ")) {
                let names = patch_files(text);
                if let Some(first) = names.first() {
                    detail = first.clone();
                }
                for n in names {
                    *files.entry(n).or_insert(0) += 1;
                }
            } else if let Some(cmd) = p
                .get("action")
                .and_then(|a| a.get("command"))
                .or_else(|| args.as_ref().and_then(|a| a.get("command").or_else(|| a.get("cmd"))))
                .and_then(json_command_string)
            {
                detail = clip_one_line(&cmd, 80);
            }
            if let Some(t) = parse_iso_epoch(&ts) {
                tool_times.push(t);
            }
            if ticker.len() < 60 {
                ticker.push(name.clone());
            }
            recent_tools.push(RecentToolCall { name, timestamp: ts, detail });
        }
    }

    let (inp, cached, out) = usage.unwrap_or((0, 0, 0));
    let uncached = inp.saturating_sub(cached);
    Some(FocusTelemetry {
        model,
        input: uncached,
        output: out,
        cost: crate::agents_usage::codex_cost_usd(uncached, cached, out),
        used_percentage,
        recent_tools,
        ticker,
        files,
        tool_times,
    })
}

fn find_codex_session_file(home: &std::path::Path, session_id: &str) -> Option<std::path::PathBuf> {
    let mut files = Vec::new();
    walk_jsonl_depth(&home.join(".codex").join("sessions"), 4, std::time::SystemTime::now(), &mut files);
    files
        .into_iter()
        .find(|(_, p)| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.contains(session_id)))
        .map(|(_, p)| p)
}

fn read_caveman_mode(home: &std::path::Path) -> String {
    std::fs::read_to_string(home.join(".claude").join(".caveman-active"))
        .ok()
        .map(|s| s.trim().to_uppercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "NORMAL".to_string())
}

#[tauri::command]
pub fn get_agent_status() -> AgentStatus {
    let home = dirs::home_dir().unwrap_or_default();
    let agy_dir = home.join(".gemini").join("antigravity-cli");
    let status_path = agy_dir.join("status.json");
    let cache_path = agy_dir.join("cache").join("last_statusline.json");

    let mut model = "AGY".to_string();
    let mut used_percentage = 0.0;
    let mut inp: u64 = 0;
    let mut out: u64 = 0;
    let mut agent_state = "idle".to_string();
    let mut subagents_list = Vec::new();
    let mut quota_5h = 100.0;
    let mut quota_weekly = 100.0;
    let mut has_live_status = false;
    let mut status_conv_id: Option<String> = None;

    let status_mtime = std::fs::metadata(&status_path).and_then(|m| m.modified()).ok();
    let cache_mtime = std::fs::metadata(&cache_path).and_then(|m| m.modified()).ok();
    let chosen_status_path = match (status_mtime, cache_mtime) {
        (Some(sm), Some(cm)) => {
            if sm >= cm { Some(&status_path) } else { Some(&cache_path) }
        }
        (Some(_), None) => Some(&status_path),
        (None, Some(_)) => Some(&cache_path),
        (None, None) => None,
    };

    if let Some(p) = chosen_status_path {
        if let Ok(content) = std::fs::read_to_string(p) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                has_live_status = true;
                status_conv_id = v
                    .get("conversation_id")
                    .or_else(|| v.get("session_id"))
                    .and_then(|s| s.as_str())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());
                model = v.get("model")
                    .and_then(|m| m.get("display_name").or_else(|| m.get("id")))
                    .and_then(|s| s.as_str())
                    .unwrap_or("AGY")
                    .to_string();

                used_percentage = v.get("context_window")
                    .and_then(|cw| cw.get("used_percentage"))
                    .and_then(|p| p.as_f64())
                    .unwrap_or(0.0);

                inp = v.get("context_window")
                    .and_then(|cw| cw.get("total_input_tokens"))
                    .and_then(|t| t.as_u64())
                    .unwrap_or(0);

                out = v.get("context_window")
                    .and_then(|cw| cw.get("total_output_tokens"))
                    .and_then(|t| t.as_u64())
                    .unwrap_or(0);

                agent_state = v.get("agent_state")
                    .and_then(|s| s.as_str())
                    .unwrap_or("idle")
                    .to_string();

                if let Some(quota) = v.get("quota") {
                    if let Some(g5h) = quota.get("gemini-5h").and_then(|q| q.get("remaining_fraction")).and_then(|f| f.as_f64()) {
                        quota_5h = (g5h * 100.0).round();
                    }
                    if let Some(gwk) = quota.get("gemini-weekly").and_then(|q| q.get("remaining_fraction")).and_then(|f| f.as_f64()) {
                        quota_weekly = (gwk * 100.0).round();
                    }
                }

                if let Some(subs) = v.get("subagents").and_then(|arr| arr.as_array()) {
                    for s in subs {
                        let name = s.get("name").and_then(|n| n.as_str()).unwrap_or("agent").to_string();
                        let role = s.get("role").and_then(|r| r.as_str()).unwrap_or("").to_string();
                        let status = s.get("status").and_then(|st| st.as_str()).unwrap_or("idle").to_string();
                        subagents_list.push(SubagentInfo { name, role, status });
                    }
                }
            }
        }
    }

    // Disk üzerindeki AGY, Claude Code ve Codex oturumlarını tara (en güncel 50 oturum)
    let now = std::time::SystemTime::now();
    let (mut session_list, mut primary_transcript_path) = collect_agy_sessions(&agy_dir, now);
    session_list.extend(collect_claude_sessions(&home, now));
    session_list.extend(collect_codex_sessions(&home, now));
    session_list.sort_by_key(|s| s.updated_ago_secs);
    session_list.truncate(50);

    let mut recent_tools = Vec::new();
    let mut ticker_squares = Vec::new();
    let mut file_map: HashMap<String, u32> = HashMap::new();
    let mut marquee_text = "YDevDesk hazır.".to_string();
    let mut focus_cost: Option<f64> = None;

    let now_epoch = now
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let mut tool_times: Vec<i64> = Vec::new();
    let agy_status_age_secs = [status_mtime, cache_mtime]
        .into_iter()
        .flatten()
        .max()
        .and_then(|t| now.duration_since(t).ok())
        .map(|d| d.as_secs())
        .unwrap_or(u64::MAX);

    if let Some(focus) = session_list.first().cloned() {
        if focus.agent == "agy" {
            // Status/cache dosyası başka bir konuşmaya ait olabilir: karıştırma, transcript'ten tahmin et.
            if has_live_status && status_conv_id.as_deref().is_some_and(|id| id != focus.full_session_id) {
                has_live_status = false;
                used_percentage = 0.0;
                subagents_list.clear();
                agent_state = "idle".to_string();
            } else if agent_state == "working" && agy_status_age_secs > 120 {
                // Hook güncellemeyi bıraktıysa "working" sonsuza kadar takılı kalmasın.
                agent_state = "idle".to_string();
            }
            // Eşleşen AGY oturumunun modelini listede de göster ("AGY" sabiti yerine).
            if has_live_status && model != "AGY" {
                for s in session_list.iter_mut().filter(|s| s.agent == "agy") {
                    if status_conv_id.as_deref().is_none_or(|id| id == s.full_session_id) {
                        s.model = model.clone();
                    }
                }
            }
        } else {
            model = focus.model.clone();
            used_percentage = 0.0;
            inp = 0;
            out = 0;
            agent_state = "idle".to_string();
            subagents_list.clear();
            primary_transcript_path = None;
            has_live_status = true; // AGY transcript tahmini devre dışı
            let telemetry = match focus.agent.as_str() {
                "claude" => find_claude_session_file(&home, &focus.full_session_id)
                    .and_then(|p| claude_focus_telemetry(&p)),
                "codex" => find_codex_session_file(&home, &focus.full_session_id)
                    .and_then(|p| codex_focus_telemetry(&p)),
                _ => None,
            };
            if let Some(cf) = telemetry {
                if !cf.model.is_empty() {
                    model = cf.model;
                }
                used_percentage = cf.used_percentage;
                inp = cf.input;
                out = cf.output;
                focus_cost = Some(cf.cost);
                recent_tools = cf.recent_tools;
                ticker_squares = cf.ticker;
                file_map = cf.files;
                tool_times = cf.tool_times;
            }
        }
    }

    if !has_live_status {
        if let Some(ref t_path) = primary_transcript_path {
            let (est_inp, est_out) = estimate_agy_transcript_tokens(t_path);
            inp = est_inp;
            out = est_out;
        }
    }

    if let Some(t_path) = primary_transcript_path {
        if let Some(t_content) = read_tail(&t_path, 512 * 1024) {
            let lines: Vec<&str> = t_content.lines().rev().take(100).collect();
            for line in lines {
                if let Ok(entry) = serde_json::from_str::<serde_json::Value>(line) {
                    if let Some(calls) = entry.get("tool_calls").and_then(|c| c.as_array()) {
                        let created_at = entry.get("created_at").and_then(|t| t.as_str()).unwrap_or("").to_string();
                        for call in calls {
                            let name = call.get("name").and_then(|n| n.as_str()).unwrap_or("tool").to_string();
                            if let Some(t) = parse_iso_epoch(&created_at) {
                                tool_times.push(t);
                            }
                            ticker_squares.push(name.clone());

                            let args_obj = call.get("args");
                            let parsed_args = call.get("argumentsJson")
                                .and_then(|a| a.as_str())
                                .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok());

                            let get_field = |k: &str| -> Option<String> {
                                if let Some(v) = args_obj.and_then(|o| o.get(k)).and_then(|val| val.as_str()) {
                                    return Some(v.trim_matches('"').to_string());
                                }
                                if let Some(v) = parsed_args.as_ref().and_then(|o| o.get(k)).and_then(|val| val.as_str()) {
                                    return Some(v.trim_matches('"').to_string());
                                }
                                None
                            };

                            let detail = match name.as_str() {
                                "run_command" => {
                                    get_field("toolSummary")
                                        .or_else(|| get_field("CommandLine"))
                                        .unwrap_or_else(|| "Komut yürütüldü".to_string())
                                }
                                "read_file" | "edit_file" | "write_file" => {
                                    let raw_path = get_field("Path").unwrap_or_else(|| "dosya".to_string());
                                    let filename = raw_path.split('/').last().unwrap_or(&raw_path).to_string();
                                    *file_map.entry(filename.clone()).or_insert(0) += 1;
                                    filename
                                }
                                "search_web" => get_field("query").unwrap_or_else(|| "Web araması".to_string()),
                                _ => "İşlem yapıldı".to_string(),
                            };

                            if recent_tools.len() < 8 {
                                recent_tools.push(RecentToolCall {
                                    name: name.clone(),
                                    timestamp: created_at.clone(),
                                    detail: detail.clone(),
                                });
                            }
                        }
                    }
                }
                if ticker_squares.len() >= 60 {
                    break;
                }
            }
        }
    }

    if let Some(first_tool) = recent_tools.first() {
        marquee_text = format!("Ajan Aktif: {} → {}", first_tool.name, first_tool.detail);
    }

    let mut file_heat: Vec<FileHeatItem> = file_map
        .into_iter()
        .map(|(name, count)| FileHeatItem { name, count })
        .collect();
    file_heat.sort_by(|a, b| b.count.cmp(&a.count));
    file_heat.truncate(5);

    let cost = focus_cost.unwrap_or((inp as f64 / 1_000_000.0) * 0.15 + (out as f64 / 1_000_000.0) * 0.60);
    let active_count = session_list.iter().filter(|s| s.is_active).count();
    let other_agent_working = session_list
        .iter()
        .any(|s| s.agent != "agy" && s.updated_ago_secs < 6);
    let agy_fallback_working = !has_live_status
        && session_list
            .iter()
            .any(|s| s.agent == "agy" && s.updated_ago_secs < 6);
    let final_agent_state = if agent_state == "working" || other_agent_working || agy_fallback_working {
        "working".to_string()
    } else {
        agent_state
    };

    AgentStatus {
        model,
        used_percentage,
        session_cost: (cost * 1000.0).round() / 1000.0,
        total_input_tokens: inp,
        total_output_tokens: out,
        mode: read_caveman_mode(&home),
        agent_state: final_agent_state,
        active_sessions_count: active_count,
        quota_5h_percent: quota_5h,
        quota_weekly_percent: quota_weekly,
        tools_per_minute: tool_times
            .iter()
            .filter(|t| (-5..=60).contains(&(now_epoch - **t)))
            .count() as u32,
        marquee_text,
        ticker_squares,
        file_heat,
        sessions: session_list,
        subagents: subagents_list,
        recent_tools,
    }
}


#[cfg(test)]
mod focus_tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn claude_aggregate_dedupes_by_message_id_and_reads_incrementally() {
        let dir = std::env::temp_dir().join(format!("ydevdesk-focus-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.jsonl");
        let rec = |id: &str, out: u64| {
            format!(
                r#"{{"type":"assistant","message":{{"id":"{id}","model":"claude-sonnet-5-5","usage":{{"input_tokens":2,"cache_creation_input_tokens":8,"cache_read_input_tokens":100,"output_tokens":{out}}},"content":[]}}}}"#
            )
        };
        let mut f = std::fs::File::create(&path).unwrap();
        // Aynı id iki kez: son usage geçerli olmalı.
        writeln!(f, "{}", rec("m1", 5)).unwrap();
        writeln!(f, "{}", rec("m1", 50)).unwrap();
        f.flush().unwrap();
        let (model, inp, out, cost, ctx) = claude_aggregate(&path).unwrap();
        assert_eq!(model, "claude-sonnet-5-5");
        assert_eq!((inp, out, ctx), (10, 50, 110));
        assert!(cost > 0.0);

        // Yarım satır eklenirse işlenmemeli; tamamlanınca sayılmalı.
        write!(f, "{}", rec("m2", 7).trim_end_matches('}')).unwrap();
        f.flush().unwrap();
        assert_eq!(claude_aggregate(&path).unwrap().2, 50);
        writeln!(f, "}}}}").unwrap();
        f.flush().unwrap();
        assert_eq!(claude_aggregate(&path).unwrap().2, 57);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn claude_tool_detail_maps_known_tools() {
        let v: serde_json::Value = serde_json::json!({"file_path": "/a/b/c.rs"});
        let (d, f) = claude_tool_detail("Edit", Some(&v));
        assert_eq!((d.as_str(), f.as_deref()), ("c.rs", Some("c.rs")));
    }
}

#[cfg(test)]
mod codex_agy_tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn parse_iso_epoch_known_values() {
        assert_eq!(parse_iso_epoch("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_iso_epoch("2026-11-22T19:14:51.893Z"), Some(1_795_374_891));
        assert_eq!(parse_iso_epoch("2024-02-29T12:00:00Z"), Some(1_709_208_000));
        assert_eq!(parse_iso_epoch("bozuk"), None);
    }

    #[test]
    fn patch_files_extracts_names() {
        let p = "*** Begin Patch\n*** Update File: src/a/main.rs\n@@\n*** Add File: b.txt\n*** End Patch";
        assert_eq!(patch_files(p), vec!["main.rs".to_string(), "b.txt".to_string()]);
    }

    #[test]
    fn json_command_string_strips_shell_wrapper() {
        let v = serde_json::json!(["bash", "-lc", "ls -la"]);
        assert_eq!(json_command_string(&v).as_deref(), Some("ls -la"));
    }

    #[test]
    fn codex_telemetry_reads_tokens_model_and_tools() {
        let dir = std::env::temp_dir().join(format!("ydevdesk-codex-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("rollout-x.jsonl");
        let mut f = std::fs::File::create(&path).unwrap();
        let lines = [
            r#"{"timestamp":"2026-11-22T19:00:00Z","type":"turn_context","payload":{"model":"gpt-5.4"}}"#,
            r#"{"timestamp":"2026-11-22T19:00:01Z","type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"{\"command\":[\"bash\",\"-lc\",\"cargo test\"]}"}}"#,
            r#"{"timestamp":"2026-11-22T19:00:02Z","type":"response_item","payload":{"type":"custom_tool_call","name":"apply_patch","input":"*** Begin Patch\n*** Update File: src/lib.rs\n*** End Patch"}}"#,
            r#"{"timestamp":"2026-11-22T19:00:03Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":400,"output_tokens":50},"last_token_usage":{"input_tokens":50000},"model_context_window":200000}}}"#,
        ];
        for l in lines {
            writeln!(f, "{l}").unwrap();
        }
        f.flush().unwrap();
        let t = codex_focus_telemetry(&path).unwrap();
        assert_eq!(t.model, "gpt-5.4");
        assert_eq!((t.input, t.output), (600, 50));
        assert!((t.used_percentage - 25.0).abs() < 1e-9);
        assert_eq!(t.recent_tools.len(), 2);
        assert_eq!(t.recent_tools[0].detail, "lib.rs"); // en yeni önce
        assert_eq!(t.recent_tools[1].detail, "cargo test");
        assert_eq!(t.files.get("lib.rs"), Some(&1));
        assert_eq!(t.tool_times.len(), 2);
        assert!(t.cost > 0.0);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod window_tests {
    use super::claude_context_window as w;

    #[test]
    fn context_window_by_model() {
        assert_eq!(w("claude-sonnet-5-5"), 1_000_000);
        assert_eq!(w("claude-opus-5-5"), 1_000_000);
        assert_eq!(w("claude-haiku-5-5"), 1_000_000);
        assert_eq!(w("claude-fable-5-2"), 1_000_000);
        assert_eq!(w("claude-opus-4-8"), 1_000_000);
        assert_eq!(w("claude-haiku-4-5"), 200_000);
        assert_eq!(w("claude-sonnet-4-5"), 200_000);
        assert_eq!(w("claude-sonnet-4-5[1m]"), 1_000_000);
    }
}
