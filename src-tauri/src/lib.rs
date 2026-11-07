use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

pub struct TerminalState {
    writers: Arc<Mutex<HashMap<String, Box<dyn Write + Send>>>>,
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

// 1. Çoklu PTY Başlatma (macOS ve Linux uyumlu terminal oturumu)
#[tauri::command]
fn start_pty(app: AppHandle, state: State<'_, TerminalState>, session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(10),
            cols: cols.max(20),
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

    let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    {
        let mut writers = state.writers.lock().map_err(|e| e.to_string())?;
        writers.insert(session_id.clone(), writer);
    }

    let event_name = format!("pty-data-{}", session_id);
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            let data = String::from_utf8_lossy(&buf[..n]).to_string();
            let _ = app.emit(&event_name, data);
        }
    });

    Ok(())
}

// 2. Belirli PTY Oturumuna Veri Yazma
#[tauri::command]
fn write_pty(state: State<'_, TerminalState>, session_id: String, data: String) -> Result<(), String> {
    let mut writers = state.writers.lock().map_err(|e| e.to_string())?;
    if let Some(writer) = writers.get_mut(&session_id) {
        writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// 3. PTY Oturumunu Kapatma
#[tauri::command]
fn close_pty(state: State<'_, TerminalState>, session_id: String) -> Result<(), String> {
    let mut writers = state.writers.lock().map_err(|e| e.to_string())?;
    writers.remove(&session_id);
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
        if let Ok(t_content) = std::fs::read_to_string(t_path) {
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

    let json = res.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
    Ok(json)
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

    let json = res.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
    Ok(json)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(TerminalState {
            writers: Arc::new(Mutex::new(HashMap::new())),
        })
        .invoke_handler(tauri::generate_handler![
            start_pty,
            write_pty,
            close_pty,
            load_homelab_config,
            get_agent_status,
            fetch_homelab_notes,
            fetch_homelab_knowledge,
            fetch_ynetmon_summary,
            create_homelab_note,
            create_homelab_knowledge
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
