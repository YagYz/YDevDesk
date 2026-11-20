use std::collections::HashMap;
use std::io::Read;
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
pub struct AgentMarkdownFile {
    pub path: String,
    pub name: String,
    pub agent: String,
    pub session_id: String,
    pub full_session_id: String,
    pub modified_ago_secs: u64,
    pub size_bytes: u64,
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


// Büyük transcript dosyalarının tamamını okumamak için yalnızca sondaki baytları okur.
pub(crate) fn read_tail(path: &std::path::Path, max_bytes: u64) -> Option<String> {
    use std::io::{Seek, SeekFrom};
    let mut f = std::fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let start = len.saturating_sub(max_bytes);
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    f.read_to_end(&mut bytes).ok()?;
    let mut text = String::from_utf8_lossy(&bytes).to_string();
    if start > 0 {
        // İlk satır kesilmiş olabilir, at.
        if let Some(idx) = text.find('\n') {
            text = text[idx + 1..].to_string();
        }
    }
    Some(text)
}

// Büyük transcript dosyalarının yalnızca başındaki baytları okur.
pub(crate) fn read_head(path: &std::path::Path, max_bytes: usize) -> Option<String> {
    let mut f = std::fs::File::open(path).ok()?;
    let mut buf = vec![0u8; max_bytes];
    let n = f.read(&mut buf).ok()?;
    buf.truncate(n);
    Some(String::from_utf8_lossy(&buf).to_string())
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

fn extract_agy_subagent_ids(t_path: &std::path::Path) -> std::collections::HashSet<String> {
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
    let (mut session_list, primary_transcript_path) = collect_agy_sessions(&agy_dir, now);
    session_list.extend(collect_claude_sessions(&home, now));
    session_list.extend(collect_codex_sessions(&home, now));
    session_list.sort_by_key(|s| s.updated_ago_secs);
    session_list.truncate(50);

    let mut recent_tools = Vec::new();
    let mut ticker_squares = Vec::new();
    let mut file_map: HashMap<String, u32> = HashMap::new();
    let mut marquee_text = "AGY hazır. Canlı telemetri akışı aktif.".to_string();

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

    let cost = (inp as f64 / 1_000_000.0) * 0.15 + (out as f64 / 1_000_000.0) * 0.60;
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
        mode: "CAVEMAN".to_string(),
        agent_state: final_agent_state,
        active_sessions_count: active_count.max(1),
        quota_5h_percent: quota_5h,
        quota_weekly_percent: quota_weekly,
        tools_per_minute: (recent_tools.len() as u32) * 2,
        marquee_text,
        ticker_squares,
        file_heat,
        sessions: session_list,
        subagents: subagents_list,
        recent_tools,
    }
}

fn collect_md_in_dir(
    dir: &std::path::Path,
    agent: &str,
    depth: usize,
    session_hint: Option<&str>,
    now: std::time::SystemTime,
    seen: &mut std::collections::HashSet<std::path::PathBuf>,
    out: &mut Vec<AgentMarkdownFile>,
) {
    if depth == 0 || !dir.is_dir() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        let fname = entry.file_name().to_string_lossy().to_string();
        if fname.starts_with('.')
            || matches!(
                fname.as_str(),
                "node_modules" | "target" | "dist" | "build" | ".venv" | "venv" | "__pycache__"
            )
        {
            continue;
        }
        if p.is_dir() {
            let next_hint = session_hint.or(Some(fname.as_str()));
            collect_md_in_dir(&p, agent, depth - 1, next_hint, now, seen, out);
        } else if p.is_file() {
            let is_md = p
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"))
                .unwrap_or(false);
            if !is_md {
                continue;
            }
            let canon = std::fs::canonicalize(&p).unwrap_or_else(|_| p.clone());
            if !seen.insert(canon.clone()) {
                continue;
            }
            let Ok(meta) = std::fs::metadata(&p) else {
                continue;
            };
            let modified_ago_secs = meta
                .modified()
                .ok()
                .and_then(|m| now.duration_since(m).ok())
                .map(|d| d.as_secs())
                .unwrap_or(u64::MAX);
            let full_sid = session_hint.unwrap_or("").to_string();
            out.push(AgentMarkdownFile {
                path: canon.to_string_lossy().to_string(),
                name: fname,
                agent: agent.to_string(),
                session_id: if full_sid.is_empty() {
                    String::new()
                } else {
                    short_id(&full_sid)
                },
                full_session_id: full_sid,
                modified_ago_secs,
                size_bytes: meta.len(),
            });
        }
    }
}

fn expand_home_path(raw: &str, home: &std::path::Path) -> std::path::PathBuf {
    if let Some(rest) = raw.strip_prefix("~/") {
        home.join(rest)
    } else if raw == "~" {
        home.to_path_buf()
    } else {
        std::path::PathBuf::from(raw)
    }
}

#[tauri::command]
pub fn list_agent_markdowns(project_roots: Option<Vec<String>>) -> Vec<AgentMarkdownFile> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let now = std::time::SystemTime::now();
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();

    collect_md_in_dir(
        &home.join(".gemini").join("antigravity-cli").join("brain"),
        "agy",
        8,
        None,
        now,
        &mut seen,
        &mut out,
    );
    collect_md_in_dir(
        &home.join(".gemini").join("antigravity").join("brain"),
        "agy",
        8,
        None,
        now,
        &mut seen,
        &mut out,
    );
    collect_md_in_dir(
        &home.join(".claude").join("plans"),
        "claude",
        8,
        Some("plans"),
        now,
        &mut seen,
        &mut out,
    );
    collect_md_in_dir(
        &home.join(".claude").join("projects"),
        "claude",
        8,
        None,
        now,
        &mut seen,
        &mut out,
    );
    collect_md_in_dir(
        &home.join(".codex"),
        "codex",
        8,
        None,
        now,
        &mut seen,
        &mut out,
    );

    if let Some(roots) = project_roots {
        for raw_root in roots {
            let trimmed = raw_root.trim();
            if trimmed.is_empty() {
                continue;
            }
            let root_path = expand_home_path(trimmed, &home);
            collect_md_in_dir(&root_path, "project", 5, None, now, &mut seen, &mut out);
        }
    }

    out.sort_by_key(|f| f.modified_ago_secs);
    out.truncate(100);
    out
}

#[tauri::command]
pub fn read_markdown_file(path: String, project_roots: Option<Vec<String>>) -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "Ev dizini bulunamadı".to_string())?;
    let canon_home = std::fs::canonicalize(&home).map_err(|e| e.to_string())?;
    let canon_path = std::fs::canonicalize(&path).map_err(|e| format!("Dosya okunamadı: {}", e))?;

    let mut allowed = canon_path.starts_with(&canon_home);
    if !allowed {
        if let Some(roots) = project_roots {
            for raw_root in roots {
                let root_path = expand_home_path(raw_root.trim(), &home);
                if let Ok(canon_root) = std::fs::canonicalize(&root_path) {
                    if canon_path.starts_with(&canon_root) {
                        allowed = true;
                        break;
                    }
                }
            }
        }
    }
    if !allowed {
        return Err("Yalnızca ev dizini veya tanımlı proje dizinleri altındaki dosyalar açılabilir".to_string());
    }
    let is_md = canon_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"))
        .unwrap_or(false);
    if !is_md {
        return Err("Yalnızca .md / .markdown dosyaları açılabilir".to_string());
    }
    let meta = std::fs::metadata(&canon_path).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("Geçerli bir dosya değil".to_string());
    }
    if meta.len() > 2 * 1024 * 1024 {
        return Err("Dosya 2 MB sınırını aşıyor".to_string());
    }
    std::fs::read_to_string(&canon_path).map_err(|e| format!("Okuma hatası: {}", e))
}
