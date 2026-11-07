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
            load_homelab_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
