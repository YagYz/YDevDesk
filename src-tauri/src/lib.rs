use std::collections::HashMap;
use std::io::{BufRead, Read, Write};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

pub struct TerminalState {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

#[derive(Serialize, Deserialize)]
pub struct HomelabConfig {
    pub ydevhub_url: String,
    pub ydevhub_key: String,
    pub ynetmon_url: String,
    pub ynetmon_key: String,
}

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

#[derive(Serialize, Deserialize, Default)]
pub struct SessionPrefs {
    #[serde(default)]
    pub pinned: HashMap<String, bool>,
    #[serde(default)]
    pub aliases: HashMap<String, String>,
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

#[derive(Serialize, Deserialize, Clone)]
pub struct AgentUsageTotals {
    pub agent: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_tokens: u64,
    pub cost_usd: f64,
    pub estimated: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DailyUsagePoint {
    pub date: String,
    pub agy_tokens: u64,
    pub claude_tokens: u64,
    pub codex_tokens: u64,
    pub agy_cost: f64,
    pub claude_cost: f64,
    pub codex_cost: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct UsageWindowSummary {
    pub days: u32,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cache_tokens: u64,
    pub total_cost_usd: f64,
    pub by_agent: Vec<AgentUsageTotals>,
    pub daily: Vec<DailyUsagePoint>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct UsageWindows {
    pub d1: UsageWindowSummary,
    pub d7: UsageWindowSummary,
    pub d30: UsageWindowSummary,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct UsageAnalytics {
    pub windows: UsageWindows,
    pub agy_quota_configured: bool,
    pub codex_quota_5h_remaining: Option<f64>,
    pub codex_quota_weekly_remaining: Option<f64>,
}

static USAGE_ANALYTICS_CACHE: OnceLock<Mutex<Option<(std::time::Instant, UsageAnalytics)>>> =
    OnceLock::new();

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AgentCliInfo {
    pub id: String,
    pub name: String,
    pub binary: String,
    pub npm_package: Option<String>,
    pub is_installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub description: String,
    pub install_cmd: String,
    pub bypass_cmd: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AgentEnvironmentStatus {
    pub node_installed: bool,
    pub node_version: Option<String>,
    pub npm_installed: bool,
    pub npm_version: Option<String>,
    pub agents: Vec<AgentCliInfo>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AgentInstallResult {
    pub success: bool,
    pub agent_id: String,
    pub message: String,
    pub output: String,
}

pub fn get_enhanced_path() -> String {
    let current_path = std::env::var("PATH").unwrap_or_default();
    let home = dirs::home_dir().unwrap_or_default();
    let mut candidates = vec![
        std::path::PathBuf::from("/usr/local/bin"),
        std::path::PathBuf::from("/usr/bin"),
        std::path::PathBuf::from("/bin"),
        std::path::PathBuf::from("/opt/claude-code/bin"),
        std::path::PathBuf::from("/opt/Antigravity"),
        std::path::PathBuf::from("/opt/homebrew/bin"),
        home.join(".local").join("bin"),
        home.join(".npm-global").join("bin"),
        home.join(".cargo").join("bin"),
        home.join(".volta").join("bin"),
        home.join(".nvm").join("current").join("bin"),
        home.join(".fnm").join("aliases").join("default").join("bin"),
        home.join(".local").join("share").join("fnm").join("aliases").join("default").join("bin"),
        std::path::PathBuf::from("/usr/local/sbin"),
        std::path::PathBuf::from("/usr/sbin"),
        std::path::PathBuf::from("/sbin"),
    ];

    // nvm 'current' sembolik bağı yoksa kurulu en güncel Node sürümünü ekle
    let nvm_versions = home.join(".nvm").join("versions").join("node");
    if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
        let mut bins: Vec<std::path::PathBuf> = entries
            .flatten()
            .map(|e| e.path().join("bin"))
            .filter(|p| p.is_dir())
            .collect();
        bins.sort();
        if let Some(latest) = bins.pop() {
            candidates.push(latest);
        }
    }

    let mut parts: Vec<String> = Vec::new();
    for c in &candidates {
        if c.exists() {
            let s = c.to_string_lossy().to_string();
            if !parts.contains(&s) {
                parts.push(s);
            }
        }
    }
    for p in current_path.split(':') {
        if !p.is_empty() && !parts.contains(&p.to_string()) {
            parts.push(p.to_string());
        }
    }
    parts.join(":")
}

/// AppImage çalışma zamanının enjekte ettiği (PYTHONHOME, PYTHONPATH, LD_LIBRARY_PATH vb.)
/// mount içi ortam değişkenlerini temizleyerek sistem ikili dosyalarının bozulmasını önler.
fn appimage_env_actions() -> Vec<(&'static str, Option<String>)> {
    let appdir = std::env::var("APPDIR").unwrap_or_default();
    let is_mount_path = |val: &str| -> bool {
        (!appdir.is_empty() && val.starts_with(&appdir)) || val.starts_with("/tmp/.mount_")
    };

    const SINGLE_VARS: &[&str] = &[
        "PYTHONHOME",
        "GSETTINGS_SCHEMA_DIR",
        "GIO_MODULE_DIR",
        "GTK_PATH",
        "GDK_PIXBUF_MODULE_FILE",
        "GDK_PIXBUF_MODULEDIR",
        "QT_PLUGIN_PATH",
        "GST_PLUGIN_SYSTEM_PATH",
        "GST_PLUGIN_SCANNER",
        "LD_PRELOAD",
    ];
    const LIST_VARS: &[&str] = &[
        "PYTHONPATH",
        "LD_LIBRARY_PATH",
        "PERLLIB",
        "PERL5LIB",
        "XDG_DATA_DIRS",
    ];

    let mut actions = Vec::new();
    for &key in SINGLE_VARS {
        if let Ok(val) = std::env::var(key) {
            if is_mount_path(&val) {
                actions.push((key, None));
            }
        }
    }
    for &key in LIST_VARS {
        if let Ok(val) = std::env::var(key) {
            let parts: Vec<&str> = val.split(':').collect();
            if parts.iter().any(|p| is_mount_path(p)) {
                let kept: Vec<&str> = parts
                    .into_iter()
                    .filter(|p| !p.is_empty() && !is_mount_path(p))
                    .collect();
                if kept.is_empty() {
                    actions.push((key, None));
                } else {
                    actions.push((key, Some(kept.join(":"))));
                }
            }
        }
    }
    actions
}

fn sanitize_std_cmd(cmd: &mut std::process::Command) {
    for (key, val) in appimage_env_actions() {
        match val {
            Some(v) => {
                cmd.env(key, v);
            }
            None => {
                cmd.env_remove(key);
            }
        }
    }
}

fn sanitize_pty_cmd(cmd: &mut CommandBuilder) {
    for (key, val) in appimage_env_actions() {
        match val {
            Some(v) => cmd.env(key, v),
            None => cmd.env_remove(key),
        }
    }
    for key in ["APPIMAGE", "APPDIR", "ARGV0", "OWD"] {
        cmd.env_remove(key);
    }
}

fn find_binary(name: &str) -> Option<std::path::PathBuf> {
    let full_path = get_enhanced_path();
    for dir in full_path.split(':') {
        let p = std::path::Path::new(dir).join(name);
        if p.is_file() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(meta) = p.metadata() {
                    if meta.permissions().mode() & 0o111 != 0 {
                        return Some(p);
                    }
                }
            }
            #[cfg(not(unix))]
            return Some(p);
        }
    }
    None
}

fn get_binary_version(bin: &std::path::Path, args: &[&str]) -> Option<String> {
    let mut cmd = std::process::Command::new(bin);
    cmd.args(args).env("PATH", get_enhanced_path());
    sanitize_std_cmd(&mut cmd);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if !err.is_empty() {
            return Some(err.lines().next().unwrap_or(&err).trim().to_string());
        }
        return None;
    }
    let first_line = s.lines().next().unwrap_or(&s).trim().to_string();
    Some(first_line)
}

// 1. Çoklu PTY Başlatma (macOS ve Linux uyumlu terminal oturumu). Aynı oturum için tekrar çağrı güvenlidir.
#[tauri::command]
fn start_pty(app: AppHandle, state: State<'_, TerminalState>, session_id: String, cols: u16, rows: u16, init_cmd: Option<String>) -> Result<(), String> {
    {
        let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        if sessions.contains_key(&session_id) {
            return Ok(());
        }
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(2),
            cols: cols.max(10),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(target_os = "macos") {
            "/bin/zsh".to_string()
        } else {
            "/bin/bash".to_string()
        }
    });

    let mut cmd = CommandBuilder::new(&shell);
    sanitize_pty_cmd(&mut cmd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("PATH", get_enhanced_path());

    if let Some(home) = dirs::home_dir() {
        cmd.cwd(home);
    }

    if let Some(initial_command) = &init_cmd {
        cmd.arg("-c");
        cmd.arg(format!("{}; exec {}", initial_command, shell));
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;


    {
        let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        sessions.insert(
            session_id.clone(),
            PtySession {
                writer,
                master: pair.master,
                child,
            },
        );
    }

    let event_name = format!("pty-data-{}", session_id);
    let exit_event = format!("pty-exit-{}", session_id);
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        // Çok baytlı UTF-8 karakterlerin okuma sınırında bozulmaması için artık baytlar saklanır.
        let mut pending: Vec<u8> = Vec::new();
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            pending.extend_from_slice(&buf[..n]);
            let valid_up_to = match std::str::from_utf8(&pending) {
                Ok(_) => pending.len(),
                Err(e) => {
                    if e.error_len().is_none() {
                        e.valid_up_to()
                    } else {
                        pending.len()
                    }
                }
            };
            let chunk: Vec<u8> = pending.drain(..valid_up_to).collect();
            if !chunk.is_empty() {
                let _ = app.emit(&event_name, String::from_utf8_lossy(&chunk).to_string());
            }
        }
        let _ = app.emit(&exit_event, ());
    });

    Ok(())
}

// 2. Belirli PTY Oturumuna Veri Yazma
#[tauri::command]
fn write_pty(state: State<'_, TerminalState>, session_id: String, data: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.get_mut(&session_id) {
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// 2b. PTY Boyutlandırma (terminal paneli yeniden boyutlandığında kabuğa bildirilir)
#[tauri::command]
fn resize_pty(state: State<'_, TerminalState>, session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.get(&session_id) {
        session
            .master
            .resize(PtySize {
                rows: rows.max(2),
                cols: cols.max(10),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// 3. PTY Oturumunu Kapatma (kabuk süreci de sonlandırılır, sızıntı olmaz)
#[tauri::command]
fn close_pty(state: State<'_, TerminalState>, session_id: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = sessions.remove(&session_id) {
        let _ = session.child.kill();
    }
    Ok(())
}

// 4. Yerel Homelab / YDevHub Yapılandırmasını Otomatik Okuma
#[tauri::command]
fn load_homelab_config() -> HomelabConfig {
    let home = dirs::home_dir().unwrap_or_default();
    let config_path = home.join(".config").join("ydevhub").join("config.json");

    if let Ok(content) = std::fs::read_to_string(config_path) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
            return HomelabConfig {
                ydevhub_url: v.get("api_url").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                ydevhub_key: v.get("api_key").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                ynetmon_url: v.get("ynetmon_url").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                ynetmon_key: v.get("ynetmon_key").and_then(|s| s.as_str()).unwrap_or("").to_string(),
            };
        }
    }

    HomelabConfig {
        ydevhub_url: "".to_string(),
        ydevhub_key: "".to_string(),
        ynetmon_url: "".to_string(),
        ynetmon_key: "".to_string(),
    }
}

#[tauri::command]
fn save_homelab_config(cfg: HomelabConfig) -> Result<(), String> {
    let home = dirs::home_dir().unwrap_or_default();
    let dir = home.join(".config").join("ydevhub");
    let _ = std::fs::create_dir_all(&dir);
    let config_path = dir.join("config.json");

    let val = serde_json::json!({
        "api_url": cfg.ydevhub_url,
        "api_key": cfg.ydevhub_key,
        "ynetmon_url": cfg.ynetmon_url,
        "ynetmon_key": cfg.ynetmon_key
    });

    std::fs::write(config_path, serde_json::to_string_pretty(&val).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

// Büyük transcript dosyalarının tamamını okumamak için yalnızca sondaki baytları okur.
fn read_tail(path: &std::path::Path, max_bytes: u64) -> Option<String> {
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
fn read_head(path: &std::path::Path, max_bytes: usize) -> Option<String> {
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

fn mtime_ago_secs(path: &std::path::Path, now: std::time::SystemTime) -> Option<u64> {
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
                if rest.len() >= 36 {
                    let candidate = &rest[..36];
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

fn walk_jsonl_depth(
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
                if stem.len() >= 36 {
                    full_id = stem[stem.len() - 36..].to_string();
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
fn get_agent_status() -> AgentStatus {
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

    AgentStatus {
        model,
        used_percentage,
        session_cost: (cost * 1000.0).round() / 1000.0,
        total_input_tokens: inp,
        total_output_tokens: out,
        mode: "CAVEMAN".to_string(),
        agent_state: if active_count > 0 { "working".to_string() } else { agent_state },
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

fn days_to_ymd(days_since_epoch: i64) -> (i32, u32, u32) {
    let z = days_since_epoch + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = (y + if m <= 2 { 1 } else { 0 }) as i32;
    (year, m as u32, d as u32)
}

fn system_time_to_ymd(t: std::time::SystemTime) -> String {
    let secs = t
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (y, m, d) = days_to_ymd(secs.div_euclid(86400));
    format!("{:04}-{:02}-{:02}", y, m, d)
}

fn extract_ymd_prefix(s: &str) -> Option<&str> {
    if s.len() >= 10 {
        let b = s.as_bytes();
        if b[4] == b'-' && b[7] == b'-' && b[0..4].iter().all(|c| c.is_ascii_digit()) {
            return Some(&s[..10]);
        }
    }
    None
}

fn agy_step_token_counts(v: &serde_json::Value) -> (u64, u64) {
    let kind = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
    match kind {
        "USER_INPUT" | "SYSTEM_MESSAGE" | "GENERIC" => {
            let content_chars = v
                .get("content")
                .and_then(|c| c.as_str())
                .map(|s| s.chars().count())
                .unwrap_or(0);
            let tool_chars = match v.get("tool_calls") {
                Some(serde_json::Value::String(s)) => s.chars().count(),
                Some(other) if !other.is_null() => other.to_string().chars().count(),
                _ => 0,
            };
            (((content_chars + tool_chars) as u64) / 4, 0)
        }
        "PLANNER_RESPONSE" => {
            let content_chars = v
                .get("content")
                .and_then(|c| c.as_str())
                .map(|s| s.chars().count())
                .unwrap_or(0);
            let thinking_chars = v
                .get("thinking")
                .and_then(|c| c.as_str())
                .map(|s| s.chars().count())
                .unwrap_or(0);
            let tool_chars = match v.get("tool_calls") {
                Some(serde_json::Value::String(s)) => s.chars().count(),
                Some(other) if !other.is_null() => other.to_string().chars().count(),
                _ => 0,
            };
            let total = content_chars + thinking_chars + tool_chars;
            (0, (total as u64) / 4)
        }
        _ => (0, 0),
    }
}

fn estimate_agy_transcript_tokens(path: &std::path::Path) -> (u64, u64) {
    // Sistem promptu ve araç şemaları oturum başına ~8k token başlangıç girdisi
    let mut total_inp = 8_000u64;
    let mut total_out = 0u64;
    if let Ok(file) = std::fs::File::open(path) {
        let reader = std::io::BufReader::new(file);
        for line in reader.lines().map_while(Result::ok) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                let (i, o) = agy_step_token_counts(&v);
                total_inp += i;
                total_out += o;
            }
        }
    }
    (total_inp, total_out)
}

#[derive(Default, Clone)]
struct ProviderDayStats {
    input_tokens: u64,
    output_tokens: u64,
    cache_tokens: u64,
    cost_usd: f64,
}

fn claude_pricing_per_1m(model: &str) -> (f64, f64, f64, f64) {
    let lower = model.to_lowercase();
    if lower.contains("opus") {
        (15.0, 75.0, 15.0 * 1.25, 15.0 * 0.1)
    } else if lower.contains("haiku") {
        (0.8, 4.0, 0.8 * 1.25, 0.8 * 0.1)
    } else {
        (3.0, 15.0, 3.0 * 1.25, 3.0 * 0.1)
    }
}

fn collect_claude_jsonl_files(projects_dir: &std::path::Path, now: std::time::SystemTime) -> Vec<std::path::PathBuf> {
    let max_age = 31 * 86400;
    let mut out = Vec::new();
    let Ok(proj_entries) = std::fs::read_dir(projects_dir) else {
        return out;
    };
    for proj in proj_entries.flatten() {
        let p_path = proj.path();
        if !p_path.is_dir() {
            continue;
        }
        let Ok(sess_entries) = std::fs::read_dir(&p_path) else {
            continue;
        };
        for s_entry in sess_entries.flatten() {
            let f_path = s_entry.path();
            if f_path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                if mtime_ago_secs(&f_path, now).is_some_and(|d| d <= max_age) {
                    out.push(f_path);
                }
            } else if f_path.is_dir() {
                let sub_dir = f_path.join("subagents");
                if let Ok(sub_entries) = std::fs::read_dir(&sub_dir) {
                    for sub_entry in sub_entries.flatten() {
                        let sub_path = sub_entry.path();
                        if sub_path.extension().and_then(|e| e.to_str()) == Some("jsonl")
                            && mtime_ago_secs(&sub_path, now).is_some_and(|d| d <= max_age)
                        {
                            out.push(sub_path);
                        }
                    }
                }
            }
        }
    }
    out
}

fn build_usage_window(
    days: u32,
    date_keys: &[String],
    agy_by_day: &HashMap<String, ProviderDayStats>,
    claude_by_day: &HashMap<String, ProviderDayStats>,
    codex_by_day: &HashMap<String, ProviderDayStats>,
) -> UsageWindowSummary {
    let start_idx = date_keys.len().saturating_sub(days as usize);
    let window_dates = &date_keys[start_idx..];

    let mut agy_tot = ProviderDayStats::default();
    let mut claude_tot = ProviderDayStats::default();
    let mut codex_tot = ProviderDayStats::default();
    let mut daily = Vec::with_capacity(window_dates.len());

    let add_stats = |acc: &mut ProviderDayStats, s: &ProviderDayStats| {
        acc.input_tokens += s.input_tokens;
        acc.output_tokens += s.output_tokens;
        acc.cache_tokens += s.cache_tokens;
        acc.cost_usd += s.cost_usd;
    };

    for date in window_dates {
        let a = agy_by_day.get(date).cloned().unwrap_or_default();
        let cl = claude_by_day.get(date).cloned().unwrap_or_default();
        let cx = codex_by_day.get(date).cloned().unwrap_or_default();

        add_stats(&mut agy_tot, &a);
        add_stats(&mut claude_tot, &cl);
        add_stats(&mut codex_tot, &cx);

        daily.push(DailyUsagePoint {
            date: date.clone(),
            agy_tokens: a.input_tokens + a.output_tokens,
            claude_tokens: cl.input_tokens + cl.output_tokens + cl.cache_tokens,
            codex_tokens: cx.input_tokens + cx.output_tokens + cx.cache_tokens,
            agy_cost: (a.cost_usd * 10000.0).round() / 10000.0,
            claude_cost: (cl.cost_usd * 10000.0).round() / 10000.0,
            codex_cost: (cx.cost_usd * 10000.0).round() / 10000.0,
        });
    }

    let round_cost = |c: f64| (c * 10000.0).round() / 10000.0;
    let total_input_tokens = agy_tot.input_tokens + claude_tot.input_tokens + codex_tot.input_tokens;
    let total_output_tokens = agy_tot.output_tokens + claude_tot.output_tokens + codex_tot.output_tokens;
    let total_cache_tokens = agy_tot.cache_tokens + claude_tot.cache_tokens + codex_tot.cache_tokens;
    let total_cost_usd = round_cost(agy_tot.cost_usd + claude_tot.cost_usd + codex_tot.cost_usd);

    let by_agent = vec![
        AgentUsageTotals {
            agent: "agy".to_string(),
            input_tokens: agy_tot.input_tokens,
            output_tokens: agy_tot.output_tokens,
            cache_tokens: agy_tot.cache_tokens,
            cost_usd: round_cost(agy_tot.cost_usd),
            estimated: true,
        },
        AgentUsageTotals {
            agent: "claude".to_string(),
            input_tokens: claude_tot.input_tokens,
            output_tokens: claude_tot.output_tokens,
            cache_tokens: claude_tot.cache_tokens,
            cost_usd: round_cost(claude_tot.cost_usd),
            estimated: false,
        },
        AgentUsageTotals {
            agent: "codex".to_string(),
            input_tokens: codex_tot.input_tokens,
            output_tokens: codex_tot.output_tokens,
            cache_tokens: codex_tot.cache_tokens,
            cost_usd: round_cost(codex_tot.cost_usd),
            estimated: false,
        },
    ];

    UsageWindowSummary {
        days,
        total_input_tokens,
        total_output_tokens,
        total_cache_tokens,
        total_cost_usd,
        by_agent,
        daily,
    }
}

fn compute_usage_analytics() -> UsageAnalytics {
    let home = dirs::home_dir().unwrap_or_default();
    let now = std::time::SystemTime::now();
    let now_days = now
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| (d.as_secs() as i64).div_euclid(86400))
        .unwrap_or(0);

    let mut date_keys = Vec::with_capacity(30);
    for offset in (0..30).rev() {
        let (y, m, d) = days_to_ymd(now_days - offset as i64);
        date_keys.push(format!("{:04}-{:02}-{:02}", y, m, d));
    }
    let min_date = date_keys.first().cloned().unwrap_or_default();

    let mut claude_by_day: HashMap<String, ProviderDayStats> = HashMap::new();
    let mut codex_by_day: HashMap<String, ProviderDayStats> = HashMap::new();
    let mut agy_by_day: HashMap<String, ProviderDayStats> = HashMap::new();

    // 1. Claude Code
    for f_path in collect_claude_jsonl_files(&home.join(".claude").join("projects"), now) {
        let fallback_date = std::fs::metadata(&f_path)
            .and_then(|m| m.modified())
            .map(system_time_to_ymd)
            .unwrap_or_default();
        if let Ok(file) = std::fs::File::open(&f_path) {
            let reader = std::io::BufReader::new(file);
            for line in reader.lines().map_while(Result::ok) {
                let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                    continue;
                };
                let Some(msg) = v.get("message") else {
                    continue;
                };
                let Some(usage) = msg.get("usage") else {
                    continue;
                };
                let date = v
                    .get("timestamp")
                    .and_then(|t| t.as_str())
                    .and_then(extract_ymd_prefix)
                    .unwrap_or(&fallback_date);
                if date < min_date.as_str() {
                    continue;
                }
                let inp = usage.get("input_tokens").and_then(|n| n.as_u64()).unwrap_or(0);
                let cache_create = usage
                    .get("cache_creation_input_tokens")
                    .and_then(|n| n.as_u64())
                    .unwrap_or(0);
                let cache_read = usage
                    .get("cache_read_input_tokens")
                    .and_then(|n| n.as_u64())
                    .unwrap_or(0);
                let out = usage.get("output_tokens").and_then(|n| n.as_u64()).unwrap_or(0);
                if inp == 0 && cache_create == 0 && cache_read == 0 && out == 0 {
                    continue;
                }
                let model = msg.get("model").and_then(|m| m.as_str()).unwrap_or("sonnet");
                let (in_p, out_p, cc_p, cr_p) = claude_pricing_per_1m(model);
                let cost = (inp as f64 / 1_000_000.0) * in_p
                    + (out as f64 / 1_000_000.0) * out_p
                    + (cache_create as f64 / 1_000_000.0) * cc_p
                    + (cache_read as f64 / 1_000_000.0) * cr_p;

                let entry = claude_by_day.entry(date.to_string()).or_default();
                entry.input_tokens += inp + cache_create + cache_read;
                entry.output_tokens += out;
                entry.cache_tokens += cache_create + cache_read;
                entry.cost_usd += cost;
            }
        }
    }

    // 2. OpenAI Codex
    let mut codex_files = Vec::new();
    walk_jsonl_depth(&home.join(".codex").join("sessions"), 4, now, &mut codex_files);
    codex_files.retain(|(diff, _)| *diff <= 31 * 86400);
    codex_files.sort_by_key(|(diff, _)| *diff);

    let mut codex_quota_5h_remaining: Option<f64> = None;
    let mut codex_quota_weekly_remaining: Option<f64> = None;

    for (_, f_path) in codex_files {
        let fallback_date = std::fs::metadata(&f_path)
            .and_then(|m| m.modified())
            .map(system_time_to_ymd)
            .unwrap_or_default();
        let mut session_date = fallback_date.clone();
        let mut max_inp = 0u64;
        let mut max_cached = 0u64;
        let mut max_out = 0u64;
        let mut file_q5h: Option<f64> = None;
        let mut file_qwk: Option<f64> = None;

        if let Ok(file) = std::fs::File::open(&f_path) {
            let reader = std::io::BufReader::new(file);
            for line in reader.lines().map_while(Result::ok) {
                let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                    continue;
                };
                if let Some(d) = v
                    .get("timestamp")
                    .and_then(|t| t.as_str())
                    .and_then(extract_ymd_prefix)
                {
                    session_date = d.to_string();
                }

                let top_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
                let payload = if top_type == "event_msg" {
                    v.get("payload")
                } else {
                    Some(&v)
                };
                let Some(p) = payload else {
                    continue;
                };
                if p.get("type").and_then(|t| t.as_str()) != Some("token_count") {
                    continue;
                }

                let usage = p
                    .get("info")
                    .and_then(|i| i.get("total_token_usage"))
                    .or_else(|| p.get("total_token_usage"));
                if let Some(u) = usage {
                    let inp = u.get("input_tokens").and_then(|n| n.as_u64()).unwrap_or(0);
                    let cached = u
                        .get("cached_input_tokens")
                        .and_then(|n| n.as_u64())
                        .unwrap_or(0);
                    let out = u.get("output_tokens").and_then(|n| n.as_u64()).unwrap_or(0);
                    max_inp = max_inp.max(inp);
                    max_cached = max_cached.max(cached);
                    max_out = max_out.max(out);
                }

                if let Some(rl) = p.get("rate_limits") {
                    if let Some(used) = rl
                        .get("primary")
                        .and_then(|x| x.get("used_percent"))
                        .and_then(|n| n.as_f64())
                    {
                        file_q5h = Some((100.0 - used).clamp(0.0, 100.0));
                    }
                    if let Some(used) = rl
                        .get("secondary")
                        .and_then(|x| x.get("used_percent"))
                        .and_then(|n| n.as_f64())
                    {
                        file_qwk = Some((100.0 - used).clamp(0.0, 100.0));
                    }
                }
            }
        }

        if codex_quota_5h_remaining.is_none() {
            codex_quota_5h_remaining = file_q5h;
        }
        if codex_quota_weekly_remaining.is_none() {
            codex_quota_weekly_remaining = file_qwk;
        }

        if session_date >= min_date && (max_inp > 0 || max_out > 0 || max_cached > 0) {
            let uncached_inp = max_inp.saturating_sub(max_cached);
            let cost = (uncached_inp as f64 / 1_000_000.0) * 1.50
                + (max_cached as f64 / 1_000_000.0) * 0.375
                + (max_out as f64 / 1_000_000.0) * 6.00;
            let entry = codex_by_day.entry(session_date).or_default();
            entry.input_tokens += uncached_inp;
            entry.output_tokens += max_out;
            entry.cache_tokens += max_cached;
            entry.cost_usd += cost;
        }
    }

    // 3. AGY
    let agy_dir = home.join(".gemini").join("antigravity-cli");
    if let Ok(brain_entries) = std::fs::read_dir(agy_dir.join("brain")) {
        for entry in brain_entries.flatten() {
            let t_path = entry
                .path()
                .join(".system_generated")
                .join("logs")
                .join("transcript.jsonl");
            if !t_path.is_file() {
                continue;
            }
            if !mtime_ago_secs(&t_path, now).is_some_and(|d| d <= 31 * 86400) {
                continue;
            }
            let fallback_date = std::fs::metadata(&t_path)
                .and_then(|m| m.modified())
                .map(system_time_to_ymd)
                .unwrap_or_default();
            if let Ok(file) = std::fs::File::open(&t_path) {
                let reader = std::io::BufReader::new(file);
                let mut added_sys_prompt = false;
                for line in reader.lines().map_while(Result::ok) {
                    let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                        continue;
                    };
                    let (mut inp, out) = agy_step_token_counts(&v);
                    if inp == 0 && out == 0 {
                        continue;
                    }
                    let date = v
                        .get("created_at")
                        .and_then(|t| t.as_str())
                        .and_then(extract_ymd_prefix)
                        .unwrap_or(&fallback_date);
                    if date < min_date.as_str() {
                        continue;
                    }
                    if !added_sys_prompt {
                        inp += 8_000;
                        added_sys_prompt = true;
                    }
                    // Blended Gemini Flash/Pro estimated rate ($0.50 / 1M input, $2.00 / 1M output)
                    let cost = (inp as f64 / 1_000_000.0) * 0.50
                        + (out as f64 / 1_000_000.0) * 2.00;
                    let day_entry = agy_by_day.entry(date.to_string()).or_default();
                    day_entry.input_tokens += inp;
                    day_entry.output_tokens += out;
                    day_entry.cost_usd += cost;
                }
            }
        }
    }

    // Bugünkü canlı AGY statusline verisi (sistem promptu + bağlam tekrarları dahil)
    // ham transcript tahmininden büyükse bugünün toplamını en az canlı oturum kadar tut.
    if let Some(today) = date_keys.last() {
        let status_candidates = [
            agy_dir.join("status.json"),
            agy_dir.join("cache").join("last_statusline.json"),
        ];
        let newest_status = status_candidates
            .iter()
            .filter_map(|p| {
                let mtime = std::fs::metadata(p).ok()?.modified().ok()?;
                Some((mtime, p))
            })
            .max_by_key(|(m, _)| *m);

        if let Some((mtime, spath)) = newest_status {
            if system_time_to_ymd(mtime) == *today {
                if let Ok(raw) = std::fs::read_to_string(spath) {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                        let cw = v.get("context_window");
                        let live_in = cw.and_then(|c| c.get("total_input_tokens")).and_then(|t| t.as_u64()).unwrap_or(0);
                        let live_out = cw.and_then(|c| c.get("total_output_tokens")).and_then(|t| t.as_u64()).unwrap_or(0);
                        if live_in > 0 || live_out > 0 {
                            let day_entry = agy_by_day.entry(today.clone()).or_default();
                            if live_in > day_entry.input_tokens {
                                day_entry.input_tokens = live_in;
                            }
                            if live_out > day_entry.output_tokens {
                                day_entry.output_tokens = live_out;
                            }
                            day_entry.cost_usd = (day_entry.input_tokens as f64 / 1_000_000.0) * 0.50
                                + (day_entry.output_tokens as f64 / 1_000_000.0) * 2.00;
                        }
                    }
                }
            }
        }
    }

    let settings_has_statusline = std::fs::read_to_string(agy_dir.join("settings.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .is_some_and(|v| v.get("statusLine").is_some_and(|sl| !sl.is_null()));

    let agy_quota_configured = settings_has_statusline
        || agy_dir.join("cache").join("last_statusline.json").exists()
        || agy_dir.join("status.json").exists();

    UsageAnalytics {
        windows: UsageWindows {
            d1: build_usage_window(1, &date_keys, &agy_by_day, &claude_by_day, &codex_by_day),
            d7: build_usage_window(7, &date_keys, &agy_by_day, &claude_by_day, &codex_by_day),
            d30: build_usage_window(30, &date_keys, &agy_by_day, &claude_by_day, &codex_by_day),
        },
        agy_quota_configured,
        codex_quota_5h_remaining,
        codex_quota_weekly_remaining,
    }
}

#[tauri::command]
fn get_usage_analytics() -> UsageAnalytics {
    let cache = USAGE_ANALYTICS_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = cache.lock() {
        if let Some((ts, ref data)) = *guard {
            if ts.elapsed().as_secs() < 45 {
                return data.clone();
            }
        }
    }

    let analytics = compute_usage_analytics();
    if let Ok(mut guard) = cache.lock() {
        *guard = Some((std::time::Instant::now(), analytics.clone()));
    }
    analytics
}

#[tauri::command]
fn enable_agy_quota_hook() -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "Home dizini bulunamadı".to_string())?;
    let agy_dir = home.join(".gemini").join("antigravity-cli");
    let settings_path = agy_dir.join("settings.json");

    let mut settings: serde_json::Value = if settings_path.exists() {
        let raw = std::fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        if raw.trim().is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_str(&raw).map_err(|e| e.to_string())?
        }
    } else {
        serde_json::json!({})
    };

    if settings.get("statusLine").is_some_and(|v| !v.is_null()) {
        return Ok("AGY statusLine zaten yapılandırılmış.".to_string());
    }

    let hook_dir = home.join(".config").join("ydevdesk");
    std::fs::create_dir_all(&hook_dir).map_err(|e| e.to_string())?;
    let hook_path = hook_dir.join("agy-quota-hook.sh");
    let hook_script = "#!/bin/sh\nmkdir -p \"$HOME/.gemini/antigravity-cli/cache\"\ncat > \"$HOME/.gemini/antigravity-cli/cache/last_statusline.json\"\n";
    std::fs::write(&hook_path, hook_script).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o755);
        std::fs::set_permissions(&hook_path, perms).map_err(|e| e.to_string())?;
    }

    let obj = settings
        .as_object_mut()
        .ok_or_else(|| "settings.json geçerli bir JSON nesnesi değil".to_string())?;
    obj.insert(
        "statusLine".to_string(),
        serde_json::json!({
            "type": "command",
            "command": hook_path.to_string_lossy().to_string()
        }),
    );

    if let Some(parent) = settings_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let serialized = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&settings_path, serialized).map_err(|e| e.to_string())?;

    if let Some(cache) = USAGE_ANALYTICS_CACHE.get() {
        if let Ok(mut guard) = cache.lock() {
            *guard = None;
        }
    }

    Ok("AGY statusLine hook yapılandırıldı.".to_string())
}

// 6. Homelab İstekleri
#[tauri::command]
async fn fetch_homelab_notes(url: String, key: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("{}/api/v1/notes?limit=15", url.trim_end_matches('/')))
        .header("X-API-Key", key)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    let json = res.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
    Ok(json)
}

#[tauri::command]
async fn fetch_homelab_knowledge(url: String, key: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("{}/api/v1/knowledge?limit=15", url.trim_end_matches('/')))
        .header("X-API-Key", key)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    let json = res.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
    Ok(json)
}

#[tauri::command]
async fn fetch_homelab_tasks(url: String, key: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("{}/api/v1/tasks?limit=50", url.trim_end_matches('/')))
        .header("X-API-Key", key)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    res.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_homelab_task(url: String, key: String, title: String, priority: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "title": title,
        "description": "",
        "priority": priority,
        "due_date": serde_json::Value::Null
    });
    let res = client
        .post(format!("{}/api/v1/tasks", url.trim_end_matches('/')))
        .header("X-API-Key", key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    res.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn complete_homelab_task(url: String, key: String, id: i64) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({ "id": id, "status": "done" });
    let res = client
        .patch(format!("{}/api/v1/tasks", url.trim_end_matches('/')))
        .header("X-API-Key", key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    res.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

fn expand_home(p: &str) -> std::path::PathBuf {
    if let Some(rest) = p.strip_prefix("~/") {
        return dirs::home_dir().unwrap_or_default().join(rest);
    }
    std::path::PathBuf::from(p)
}

fn ydevdesk_config_dir() -> std::path::PathBuf {
    dirs::home_dir().unwrap_or_default().join(".config").join("ydevdesk")
}

fn app_settings_path() -> std::path::PathBuf {
    ydevdesk_config_dir().join("settings.json")
}

fn session_prefs_path() -> std::path::PathBuf {
    ydevdesk_config_dir().join("session_prefs.json")
}

/// Kayıtlı uygulama ayarları; dosya yoksa null döner (arayüz varsayılanları üretir).
#[tauri::command]
fn load_app_settings() -> Option<serde_json::Value> {
    let content = std::fs::read_to_string(app_settings_path()).ok()?;
    serde_json::from_str(&content).ok()
}

#[tauri::command]
fn save_app_settings(settings: serde_json::Value) -> Result<(), String> {
    let path = app_settings_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_session_prefs() -> Result<SessionPrefs, String> {
    let path = session_prefs_path();
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(SessionPrefs::default()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn save_session_prefs(prefs: SessionPrefs) -> Result<(), String> {
    let path = session_prefs_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&prefs).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

/// İlk kurulumda önerilecek proje kök dizini (yoksa boş).
#[tauri::command]
fn default_projects_root() -> String {
    for c in ["/mnt/Depo/Projeler"] {
        if std::path::Path::new(c).is_dir() {
            return c.to_string();
        }
    }
    let home = dirs::home_dir().unwrap_or_default();
    for c in ["Projects", "projects", "dev", "src", "Projeler"] {
        let p = home.join(c);
        if p.is_dir() {
            return p.to_string_lossy().to_string();
        }
    }
    String::new()
}

fn run_cmd(dir: &std::path::Path, prog: &str, args: &[&str]) -> Option<String> {
    let out = std::process::Command::new(prog).args(args).current_dir(dir).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

#[tauri::command]
fn list_git_projects(root: String) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(expand_home(&root))
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().join(".git").exists())
                .filter_map(|e| e.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default();
    v.sort_by_key(|s| s.to_lowercase());
    v
}

#[tauri::command]
async fn get_git_status(root: String, project: String) -> Result<serde_json::Value, String> {
    if project.is_empty() || project.contains('/') || project.contains("..") {
        return Err("Geçersiz proje adı".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let dir = expand_home(&root).join(&project);
        if !dir.join(".git").exists() {
            return Err("Git deposu bulunamadı".to_string());
        }
        let branch = run_cmd(&dir, "git", &["rev-parse", "--abbrev-ref", "HEAD"])
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let (mut ahead, mut behind) = (0i64, 0i64);
        if let Some(s) = run_cmd(&dir, "git", &["rev-list", "--left-right", "--count", "@{u}...HEAD"]) {
            let mut it = s.split_whitespace();
            behind = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
            ahead = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
        }
        let changes: Vec<serde_json::Value> = run_cmd(&dir, "git", &["status", "--porcelain"])
            .unwrap_or_default()
            .lines()
            .filter(|l| l.len() > 3)
            .map(|l| serde_json::json!({ "status": l[..2].trim(), "path": l[3..] }))
            .collect();
        let last_commit = run_cmd(&dir, "git", &["log", "-1", "--pretty=%h %s"])
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        // PR durumu (gh yoksa veya oturum yoksa null)
        let pr = run_cmd(
            &dir,
            "gh",
            &["pr", "list", "--head", &branch, "--state", "all", "--limit", "1", "--json", "number,title,state,url,isDraft"],
        )
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get(0).cloned());
        Ok(serde_json::json!({
            "branch": branch,
            "ahead": ahead,
            "behind": behind,
            "changes": changes,
            "last_commit": last_commit,
            "pr": pr
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn fetch_ynetmon_summary(url: String, key: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("{}/api/v1/integration/summary", url.trim_end_matches('/')))
        .header("X-API-Key", key)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    let json = res.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
    Ok(json)
}

// 7. Hızlı Görev ve Bilgi Ağı Kaydetme
#[tauri::command]
async fn create_homelab_note(url: String, key: String, content: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "content": content,
        "priority": "medium",
        "source": "ydevdesk"
    });

    let res = client
        .post(format!("{}/api/v1/notes", url.trim_end_matches('/')))
        .header("X-API-Key", key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    let json = res.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
    Ok(json)
}

#[tauri::command]
async fn create_homelab_knowledge(url: String, key: String, service_tag: String, title: String, summary: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "service_tag": service_tag,
        "title": title,
        "summary": summary
    });

    let res = client
        .post(format!("{}/api/v1/knowledge", url.trim_end_matches('/')))
        .header("X-API-Key", key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    let json = res.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
    Ok(json)
}


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

fn parse_semver(v: &str) -> (u64, u64, u64) {
    let clean = v.trim().trim_start_matches('v');
    let mut parts = clean.split(|c: char| !c.is_ascii_digit());
    let major = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    let minor = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    let patch = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    (major, minor, patch)
}

fn target_asset_suffix() -> &'static str {
    if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "aarch64.app.tar.gz"
        } else {
            "x64.app.tar.gz"
        }
    } else {
        "amd64.AppImage"
    }
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
async fn check_app_update() -> Result<UpdateCheckResult, String> {
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
async fn install_app_update(app: AppHandle, asset_url: String) -> Result<String, String> {
    if asset_url.is_empty() {
        return Err("İndirme adresi boş".into());
    }
    let client = reqwest::Client::builder()
        .user_agent("YDevDesk-Updater")
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

    #[cfg(not(target_os = "macos"))]
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

#[tauri::command]
fn check_agent_environment() -> Result<AgentEnvironmentStatus, String> {
    let node_bin = find_binary("node");
    let node_installed = node_bin.is_some();
    let node_version = node_bin.as_deref().and_then(|p| get_binary_version(p, &["-v"]));

    let npm_bin = find_binary("npm");
    let npm_installed = npm_bin.is_some();
    let npm_version = npm_bin.as_deref().and_then(|p| get_binary_version(p, &["-v"]));

    let mut agents = Vec::new();

    // 1. Google Antigravity (AGY)
    let agy_bin = find_binary("agy").or_else(|| find_binary("antigravity"));
    let agy_installed = agy_bin.is_some();
    let agy_version = agy_bin.as_deref().and_then(|p| get_binary_version(p, &["--version"]));
    let agy_path = agy_bin.map(|p| p.to_string_lossy().to_string());
    agents.push(AgentCliInfo {
        id: "agy".into(),
        name: "Google Antigravity (AGY)".into(),
        binary: "agy".into(),
        npm_package: None,
        is_installed: agy_installed,
        version: agy_version,
        path: agy_path,
        description: "Google'un agentic platform CLI'ı, Zettelkasten hafıza ve araç yürütme çekirdeği.".into(),
        install_cmd: "curl -fsSL https://antigravity.google/cli/install.sh | bash".into(),
        bypass_cmd: Some("agy --dangerously-skip-permissions".into()),
    });

    // 2. Anthropic Claude Code
    let claude_bin = find_binary("claude");
    let claude_installed = claude_bin.is_some();
    let claude_version = claude_bin.as_deref().and_then(|p| get_binary_version(p, &["--version"]));
    let claude_path = claude_bin.map(|p| p.to_string_lossy().to_string());
    agents.push(AgentCliInfo {
        id: "claude".into(),
        name: "Anthropic Claude Code".into(),
        binary: "claude".into(),
        npm_package: Some("@anthropic-ai/claude-code".into()),
        is_installed: claude_installed,
        version: claude_version,
        path: claude_path,
        description: "Anthropic Claude Code terminal kodlama ve proje mimarisi ajanı.".into(),
        install_cmd: "npm install -g @anthropic-ai/claude-code".into(),
        bypass_cmd: Some("claude --dangerously-skip-permissions".into()),
    });

    // 3. OpenAI Codex CLI
    let codex_bin = find_binary("codex");
    let codex_installed = codex_bin.is_some();
    let codex_version = codex_bin.as_deref().and_then(|p| get_binary_version(p, &["--version"]));
    let codex_path = codex_bin.map(|p| p.to_string_lossy().to_string());
    agents.push(AgentCliInfo {
        id: "codex".into(),
        name: "OpenAI Codex CLI".into(),
        binary: "codex".into(),
        npm_package: Some("@openai/codex".into()),
        is_installed: codex_installed,
        version: codex_version,
        path: codex_path,
        description: "OpenAI Codex CLI yerel kodlama ve komut satırı ajanı.".into(),
        install_cmd: "npm install -g @openai/codex".into(),
        bypass_cmd: Some("codex --dangerously-bypass-approvals-and-run-code".into()),
    });

    Ok(AgentEnvironmentStatus {
        node_installed,
        node_version,
        npm_installed,
        npm_version,
        agents,
    })
}

fn run_clean_shell(script: &str, enhanced_path: &str) -> Result<(bool, String), String> {
    let shell_bin = if find_binary("bash").is_some() { "bash" } else { "sh" };
    let mut cmd = std::process::Command::new(shell_bin);
    cmd.args(["-c", script]).env("PATH", enhanced_path);
    sanitize_std_cmd(&mut cmd);
    let out = cmd
        .output()
        .map_err(|e| format!("Kurulum komutu çalıştırılamadı: {}", e))?;
    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    )
    .trim()
    .to_string();
    Ok((out.status.success(), combined))
}

#[tauri::command]
async fn install_agent_cli(agent_id: String, force_update: Option<bool>) -> Result<AgentInstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || install_agent_cli_sync(agent_id, force_update.unwrap_or(false)))
        .await
        .map_err(|e| format!("Kurulum görevi hatası: {}", e))?
}

fn install_agent_cli_sync(agent_id: String, force_update: bool) -> Result<AgentInstallResult, String> {
    let enhanced_path = get_enhanced_path();
    let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("/tmp"));

    match agent_id.as_str() {
        "claude" => {
            if !force_update {
                if let Some(bin) = find_binary("claude") {
                    if let Some(ver) = get_binary_version(&bin, &["--version"]) {
                        return Ok(AgentInstallResult {
                            success: true,
                            agent_id: "claude".into(),
                            message: format!("Claude Code zaten kurulu ve aktif ({})", ver),
                            output: format!("Konum: {}", bin.display()),
                        });
                    }
                }
            }

            if force_update && find_binary("claude").is_some() {
                if let Ok((true, out)) = run_clean_shell("claude update", &enhanced_path) {
                    let ver = find_binary("claude")
                        .and_then(|b| get_binary_version(&b, &["--version"]))
                        .unwrap_or_else(|| "güncellendi".into());
                    return Ok(AgentInstallResult {
                        success: true,
                        agent_id: "claude".into(),
                        message: format!("Claude Code güncellendi ({})", ver),
                        output: out,
                    });
                }
            }

            let (ok, mut output_str) = run_clean_shell(
                "curl -fsSL https://claude.ai/install.sh | bash",
                &enhanced_path,
            )?;

            // Native betik başarısız olursa ve npm varsa ~/.local altına kurmayı dene
            if !ok {
                if let Some(npm_bin) = find_binary("npm") {
                    let local_prefix = home.join(".local");
                    let _ = std::fs::create_dir_all(local_prefix.join("bin"));
                    let mut npm_cmd = std::process::Command::new(&npm_bin);
                    npm_cmd
                        .args(["install", "-g", "--prefix", &local_prefix.to_string_lossy(), "@anthropic-ai/claude-code@latest"])
                        .env("PATH", &enhanced_path);
                    sanitize_std_cmd(&mut npm_cmd);
                    if let Ok(nout) = npm_cmd.output() {
                        let nstr = format!(
                            "{}\n{}",
                            String::from_utf8_lossy(&nout.stdout),
                            String::from_utf8_lossy(&nout.stderr)
                        );
                        output_str = format!("{}\n--- npm fallback ---\n{}", output_str, nstr.trim());
                    }
                }
            }

            if let Some(bin) = find_binary("claude") {
                let ver = get_binary_version(&bin, &["--version"]).unwrap_or_else(|| "kuruldu".into());
                Ok(AgentInstallResult {
                    success: true,
                    agent_id: "claude".into(),
                    message: format!("Claude Code {} ({})", if force_update { "güncellendi" } else { "kuruldu" }, ver),
                    output: output_str,
                })
            } else {
                Err(format!("Claude Code kurulumu başarısız:\n{}", output_str))
            }
        }
        "codex" => {
            if !force_update {
                if let Some(bin) = find_binary("codex") {
                    if let Some(ver) = get_binary_version(&bin, &["--version"]) {
                        return Ok(AgentInstallResult {
                            success: true,
                            agent_id: "codex".into(),
                            message: format!("OpenAI Codex CLI zaten kurulu ve aktif ({})", ver),
                            output: format!("Konum: {}", bin.display()),
                        });
                    }
                }
            }

            let npm_bin = find_binary("npm").ok_or_else(|| "Sistemde npm bulunamadı. Lütfen önce Node.js ve npm kurun.".to_string())?;
            let local_prefix = home.join(".local");
            let _ = std::fs::create_dir_all(local_prefix.join("bin"));

            let mut cmd = std::process::Command::new(&npm_bin);
            cmd.args(["install", "-g", "--prefix", &local_prefix.to_string_lossy(), "@openai/codex@latest"])
                .env("PATH", &enhanced_path);
            sanitize_std_cmd(&mut cmd);
            let out = cmd
                .output()
                .map_err(|e| format!("npm çalıştırılamadı: {}", e))?;

            let combined = format!(
                "{}\n{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            )
            .trim()
            .to_string();

            if !out.status.success() {
                return Err(format!("Codex kurulumu başarısız:\n{}", combined));
            }

            if let Some(bin) = find_binary("codex") {
                let ver = get_binary_version(&bin, &["--version"]).unwrap_or_else(|| "kuruldu".into());
                Ok(AgentInstallResult {
                    success: true,
                    agent_id: "codex".into(),
                    message: format!("OpenAI Codex CLI {} ({})", if force_update { "güncellendi" } else { "kuruldu" }, ver),
                    output: combined,
                })
            } else {
                Ok(AgentInstallResult {
                    success: true,
                    agent_id: "codex".into(),
                    message: "Codex kuruldu. Terminal yeniden başlatıldığında kullanılabilir.".into(),
                    output: combined,
                })
            }
        }
        "agy" => {
            if !force_update {
                if let Some(bin) = find_binary("agy").or_else(|| find_binary("antigravity")) {
                    let ver = get_binary_version(&bin, &["--version"]).unwrap_or_else(|| "bilinmiyor".into());
                    return Ok(AgentInstallResult {
                        success: true,
                        agent_id: "agy".into(),
                        message: format!("Google Antigravity zaten kurulu ({})", ver),
                        output: format!("Konum: {}", bin.display()),
                    });
                }
            }

            let (mut ok, mut output_str) = run_clean_shell(
                "curl -fsSL https://antigravity.google/cli/install.sh | bash",
                &enhanced_path,
            )?;

            // macOS üzerinde Homebrew fallback
            if !ok && cfg!(target_os = "macos") && find_binary("brew").is_some() {
                if let Ok((bok, bout)) = run_clean_shell("brew install --cask antigravity-cli", &enhanced_path) {
                    ok = bok;
                    output_str = format!("{}\n--- brew fallback ---\n{}", output_str, bout);
                }
            }

            let verified = find_binary("agy").or_else(|| find_binary("antigravity"));
            if ok && verified.is_some() {
                let ver = verified
                    .as_deref()
                    .and_then(|b| get_binary_version(b, &["--version"]))
                    .unwrap_or_else(|| "kuruldu".into());
                Ok(AgentInstallResult {
                    success: true,
                    agent_id: "agy".into(),
                    message: format!(
                        "Google Antigravity (AGY) {} ({})",
                        if force_update { "güncellendi" } else { "kuruldu" },
                        ver
                    ),
                    output: output_str,
                })
            } else {
                let aur_hint = if find_binary("yay").is_some() {
                    "\nİpucu (Arch Linux): Terminalde `yay -S antigravity-cli` ile kurabilirsiniz."
                } else if find_binary("paru").is_some() {
                    "\nİpucu (Arch Linux): Terminalde `paru -S antigravity-cli` ile kurabilirsiniz."
                } else {
                    ""
                };
                Err(format!(
                    "AGY kurulumu başarısız veya ikili dosya doğrulanamadı.{}\n{}",
                    aur_hint, output_str
                ))
            }
        }
        _ => Err(format!("Bilinmeyen ajan: {}", agent_id)),
    }
}

#[tauri::command]
fn app_window_close(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn app_window_minimize(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn app_window_toggle_maximize(window: tauri::Window) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let is_fs = window.is_fullscreen().unwrap_or(false);
        window.set_fullscreen(!is_fs).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        if window.is_maximized().unwrap_or(false) {
            window.unmaximize().map_err(|e| e.to_string())
        } else {
            window.maximize().map_err(|e| e.to_string())
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    let icon_bytes = include_bytes!("../icons/icon.png");
    if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
        context.set_default_window_icon(Some(icon));
    }

    tauri::Builder::default()
        .setup(|app| {
            let icon_bytes = include_bytes!("../icons/icon.png");
            if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
                for (_label, window) in app.webview_windows() {
                    let _ = window.set_icon(icon.clone());
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(TerminalState {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        })
        .invoke_handler(tauri::generate_handler![
            start_pty,
            write_pty,
            resize_pty,
            close_pty,
            app_window_close,
            app_window_minimize,
            app_window_toggle_maximize,
            load_homelab_config,
            save_homelab_config,
            get_agent_status,
            get_usage_analytics,
            enable_agy_quota_hook,
            fetch_homelab_notes,
            fetch_homelab_knowledge,
            fetch_ynetmon_summary,
            create_homelab_note,
            create_homelab_knowledge,
            fetch_homelab_tasks,
            create_homelab_task,
            complete_homelab_task,
            list_git_projects,
            get_git_status,
            load_app_settings,
            save_app_settings,
            load_session_prefs,
            save_session_prefs,
            default_projects_root,
            get_app_version,
            check_app_update,
            install_app_update,
            check_agent_environment,
            install_agent_cli
        ])
        .run(context)
        .expect("error while running tauri application");
}
