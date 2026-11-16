use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, State};
use crate::env_helpers::{appimage_env_actions, get_enhanced_path};
use crate::platform;


pub struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

pub struct TerminalState {
    pub(crate) sessions: Arc<Mutex<HashMap<String, PtySession>>>,
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


// 1. Çoklu PTY Başlatma (macOS ve Linux uyumlu terminal oturumu). Aynı oturum için tekrar çağrı güvenlidir.
#[tauri::command]
pub fn start_pty(app: AppHandle, state: State<'_, TerminalState>, session_id: String, cols: u16, rows: u16, init_cmd: Option<String>) -> Result<(), String> {
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

    let shell = platform::default_shell();

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
        cmd.arg(format!("{}; exec \"$0\"", initial_command));
        cmd.arg(&shell);
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
pub fn write_pty(state: State<'_, TerminalState>, session_id: String, data: String) -> Result<(), String> {
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
pub fn resize_pty(state: State<'_, TerminalState>, session_id: String, cols: u16, rows: u16) -> Result<(), String> {
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
pub fn close_pty(state: State<'_, TerminalState>, session_id: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = sessions.remove(&session_id) {
        let _ = session.child.kill();
    }
    Ok(())
}

// 4. Yerel Homelab / YDevHub Yapılandırmasını Otomatik Okuma
