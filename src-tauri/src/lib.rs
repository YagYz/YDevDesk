use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

pub struct TerminalState {
    writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
}

#[derive(Serialize, Deserialize)]
pub struct HomelabConfig {
    pub ydevhub_url: String,
    pub ydevhub_key: String,
    pub ynetmon_url: String,
    pub ynetmon_key: String,
}

// 1. PTY Başlatma (Terminal)
#[tauri::command]
fn start_pty(app: AppHandle, state: State<'_, TerminalState>, cols: u16, rows: u16) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(10),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    // Varsayılan shell'i bul (zsh veya bash)
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    // Home dizinini varsayılan çalışma dizini yap
    if let Some(home) = dirs::home_dir() {
        cmd.cwd(home);
    }

    let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    {
        let mut w = state.writer.lock().map_err(|e| e.to_string())?;
        *w = Some(writer);
    }

    // Arka planda PTY çıktısını dinleyip ön yüze 'pty-data' eventi olarak fırlat
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            let data = String::from_utf8_lossy(&buf[..n]).to_string();
            let _ = app.emit("pty-data", data);
        }
    });

    Ok(())
}

// 2. Terminale Veri Yazma
#[tauri::command]
fn write_pty(state: State<'_, TerminalState>, data: String) -> Result<(), String> {
    let mut w = state.writer.lock().map_err(|e| e.to_string())?;
    if let Some(writer) = w.as_mut() {
        writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// 3. Yerel Homelab / YDevHub Yapılandırmasını Otomatik Okuma
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

#[derive(Serialize, Deserialize, Clone)]
pub struct AgentStatus {
    pub model: String,
    pub used_percentage: f64,
    pub session_cost: f64,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub mode: String,
}

// 4. Antigravity Agent Durumunu Okuma
#[tauri::command]
fn get_agent_status() -> AgentStatus {
    let home = dirs::home_dir().unwrap_or_default();
    let cache_path = home.join(".gemini").join("antigravity-cli").join("cache").join("last_statusline.json");

    if let Ok(content) = std::fs::read_to_string(cache_path) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
            let model = v.get("model")
                .and_then(|m| m.get("display_name").or_else(|| m.get("id")))
                .and_then(|s| s.as_str())
                .unwrap_or("AGY")
                .to_string();

            let used_percentage = v.get("context_window")
                .and_then(|cw| cw.get("used_percentage"))
                .and_then(|p| p.as_f64())
                .unwrap_or(0.0);

            let inp = v.get("context_window")
                .and_then(|cw| cw.get("total_input_tokens"))
                .and_then(|t| t.as_u64())
                .unwrap_or(0);

            let out = v.get("context_window")
                .and_then(|cw| cw.get("total_output_tokens"))
                .and_then(|t| t.as_u64())
                .unwrap_or(0);

            let cost = (inp as f64 / 1_000_000.0) * 0.15 + (out as f64 / 1_000_000.0) * 0.60;

            return AgentStatus {
                model,
                used_percentage,
                session_cost: (cost * 1000.0).round() / 1000.0,
                total_input_tokens: inp,
                total_output_tokens: out,
                mode: "CAVEMAN".to_string(),
            };
        }
    }

    AgentStatus {
        model: "Hazır".to_string(),
        used_percentage: 0.0,
        session_cost: 0.0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        mode: "IDLE".to_string(),
    }
}

// 5. Homelab Proxy İstekleri (CORS kısıtlarını aşmak için Rust üzerinden doğrudan istemci)
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
            writer: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            start_pty,
            write_pty,
            load_homelab_config,
            get_agent_status,
            fetch_homelab_notes,
            fetch_homelab_knowledge,
            fetch_ynetmon_summary
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
