use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

pub struct TerminalState {
    // Map of session_id -> writer
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
pub struct AgentStatus {
    pub model: String,
    pub used_percentage: f64,
    pub session_cost: f64,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub mode: String,
    pub agent_state: String,
    pub subagents: Vec<SubagentInfo>,
    pub recent_tools: Vec<RecentToolCall>,
}

// 1. Çoklu PTY Başlatma (Her oturum için benzersiz id)
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

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
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

// 5. Antigravity Agent Durumu ve Canlı Tool Akışını Okuma
#[tauri::command]
fn get_agent_status() -> AgentStatus {
    let home = dirs::home_dir().unwrap_or_default();
    let cache_path = home.join(".gemini").join("antigravity-cli").join("cache").join("last_statusline.json");

    let mut model = "AGY".to_string();
    let mut used_percentage = 0.0;
    let mut inp: u64 = 0;
    let mut out: u64 = 0;
    let mut agent_state = "idle".to_string();
    let mut subagents_list = Vec::new();
    let mut transcript_path_opt: Option<String> = None;

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

            transcript_path_opt = v.get("transcript_path").and_then(|s| s.as_str()).map(|s| s.to_string());

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

    // Son 10 Tool çağrısını transkript dosyasından ayrıştır
    let mut recent_tools = Vec::new();
    if let Some(t_path) = transcript_path_opt {
        if let Ok(t_content) = std::fs::read_to_string(t_path) {
            let lines: Vec<&str> = t_content.lines().rev().take(30).collect();
            for line in lines {
                if let Ok(entry) = serde_json::from_str::<serde_json::Value>(line) {
                    if let Some(calls) = entry.get("tool_calls").and_then(|c| c.as_array()) {
                        let created_at = entry.get("created_at").and_then(|t| t.as_str()).unwrap_or("").to_string();
                        for call in calls {
                            let name = call.get("name").and_then(|n| n.as_str()).unwrap_or("tool").to_string();
                            let detail = match name.as_str() {
                                "run_command" => {
                                    if let Some(a_str) = call.get("argumentsJson").and_then(|a| a.as_str()) {
                                        if let Ok(j) = serde_json::from_str::<serde_json::Value>(a_str) {
                                            j.get("toolSummary")
                                                .or_else(|| j.get("CommandLine"))
                                                .and_then(|s| s.as_str())
                                                .unwrap_or("exec")
                                                .to_string()
                                        } else {
                                            "exec".to_string()
                                        }
                                    } else {
                                        "exec".to_string()
                                    }
                                }
                                "read_file" | "edit_file" | "write_file" => {
                                    if let Some(a_str) = call.get("argumentsJson").and_then(|a| a.as_str()) {
                                        if let Ok(j) = serde_json::from_str::<serde_json::Value>(a_str) {
                                            j.get("Path")
                                                .and_then(|s| s.as_str())
                                                .map(|p| p.split('/').last().unwrap_or(p))
                                                .unwrap_or("file")
                                                .to_string()
                                        } else {
                                            "file".to_string()
                                        }
                                    } else {
                                        "file".to_string()
                                    }
                                }
                                "search_web" => "web query".to_string(),
                                _ => "call".to_string(),
                            };
                            recent_tools.push(RecentToolCall {
                                name,
                                timestamp: created_at.clone(),
                                detail,
                            });
                            if recent_tools.len() >= 6 {
                                break;
                            }
                        }
                    }
                }
                if recent_tools.len() >= 6 {
                    break;
                }
            }
        }
    }

    let cost = (inp as f64 / 1_000_000.0) * 0.15 + (out as f64 / 1_000_000.0) * 0.60;

    AgentStatus {
        model,
        used_percentage,
        session_cost: (cost * 1000.0).round() / 1000.0,
        total_input_tokens: inp,
        total_output_tokens: out,
        mode: "CAVEMAN".to_string(),
        agent_state,
        subagents: subagents_list,
        recent_tools,
    }
}

// 6. Homelab Proxy İstekleri
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
            fetch_ynetmon_summary
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
