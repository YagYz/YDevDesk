use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

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
    pub is_active: bool,
    pub model: String,
    pub last_tool: String,
    pub updated_ago_secs: u64,
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
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    if let Some(home) = dirs::home_dir() {
        cmd.cwd(home);
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    if let Some(initial_command) = init_cmd {
        let _ = writer.write_all(format!("{}\r", initial_command).as_bytes());
        let _ = writer.flush();
    }

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
                ydevhub_url: v.get("api_url").and_then(|s| s.as_str()).unwrap_or("http://10.10.50.1:3080").to_string(),
                ydevhub_key: v.get("api_key").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                ynetmon_url: v.get("ynetmon_url").and_then(|s| s.as_str()).unwrap_or("http://10.10.50.1:8765").to_string(),
                ynetmon_key: v.get("ynetmon_key").and_then(|s| s.as_str()).unwrap_or("").to_string(),
            };
        }
    }

    HomelabConfig {
        ydevhub_url: "http://10.10.50.1:3080".to_string(),
        ydevhub_key: "".to_string(),
        ynetmon_url: "http://10.10.50.1:8765".to_string(),
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

// 5. Antigravity Agent Durumu, Telemetri ve File Heat Verisini Okuma
#[tauri::command]
fn get_agent_status() -> AgentStatus {
    let home = dirs::home_dir().unwrap_or_default();
    let agy_dir = home.join(".gemini").join("antigravity-cli");
    let cache_path = agy_dir.join("cache").join("last_statusline.json");
    let brain_dir = agy_dir.join("brain");

    let mut model = "AGY".to_string();
    let mut used_percentage = 0.0;
    let mut inp: u64 = 0;
    let mut out: u64 = 0;
    let mut agent_state = "idle".to_string();
    let mut subagents_list = Vec::new();
    let mut quota_5h = 100.0;
    let mut quota_weekly = 100.0;

    if let Ok(content) = std::fs::read_to_string(&cache_path) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
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

    // Disk üzerindeki tüm beyin (brain) oturumlarını tara
    let mut session_list: Vec<ActiveAgentSession> = Vec::new();
    let mut primary_transcript_path: Option<std::path::PathBuf> = None;
    let now = std::time::SystemTime::now();

    if let Ok(entries) = std::fs::read_dir(&brain_dir) {
        let mut found_sessions = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let t_path = path.join(".system_generated").join("logs").join("transcript.jsonl");
                if t_path.exists() {
                    if let Ok(metadata) = std::fs::metadata(&t_path) {
                        if let Ok(mtime) = metadata.modified() {
                            if let Ok(diff) = now.duration_since(mtime) {
                                found_sessions.push((diff.as_secs(), entry.file_name().to_string_lossy().to_string(), t_path));
                            }
                        }
                    }
                }
            }
        }

        found_sessions.sort_by_key(|s| s.0);

        for (diff_secs, session_id, t_path) in found_sessions {
            if primary_transcript_path.is_none() {
                primary_transcript_path = Some(t_path.clone());
            }

            let is_active = diff_secs < 300;
            session_list.push(ActiveAgentSession {
                session_id: if session_id.len() > 8 { session_id[..8].to_string() } else { session_id },
                is_active,
                model: "Gemini Pro/Flash".to_string(),
                last_tool: "working".to_string(),
                updated_ago_secs: diff_secs,
            });
            if session_list.len() >= 6 {
                break;
            }
        }
    }

    let mut recent_tools = Vec::new();
    let mut ticker_squares = Vec::new();
    let mut file_map: HashMap<String, u32> = HashMap::new();
    let mut marquee_text = "AGY hazır. Canlı telemetri akışı aktif.".to_string();

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

const PROJECTS_ROOT: &str = "/mnt/Depo/Projeler";

fn run_cmd(dir: &std::path::Path, prog: &str, args: &[&str]) -> Option<String> {
    let out = std::process::Command::new(prog).args(args).current_dir(dir).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

#[tauri::command]
fn list_git_projects() -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(PROJECTS_ROOT)
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
async fn get_git_status(project: String) -> Result<serde_json::Value, String> {
    if project.is_empty() || project.contains('/') || project.contains("..") {
        return Err("Geçersiz proje adı".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let dir = std::path::Path::new(PROJECTS_ROOT).join(&project);
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
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
            fetch_homelab_notes,
            fetch_homelab_knowledge,
            fetch_ynetmon_summary,
            create_homelab_note,
            create_homelab_knowledge,
            fetch_homelab_tasks,
            create_homelab_task,
            complete_homelab_task,
            list_git_projects,
            get_git_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
