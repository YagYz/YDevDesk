#[cfg(target_os = "linux")]
use crate::env_helpers::{find_binary, sanitize_std_cmd};
#[cfg(target_os = "windows")]
use crate::platform;

#[tauri::command]
pub fn app_window_close(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn app_window_minimize(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn app_window_toggle_maximize(window: tauri::Window) -> Result<(), String> {
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

#[allow(dead_code)]
pub(crate) fn build_chime_wav(kind: &str) -> Vec<u8> {
    let sample_rate = 44_100u32;
    // (freq_hz, start_s, dur_s, gain, decay_rate)
    let notes: &[(f32, f32, f32, f32, f32)] = match kind {
        // Bildirim Sesi 1: yumuşak marimba/cam ikilisi (G4 -> D5)
        "notify" => &[
            (392.00, 0.0, 0.55, 0.24, 5.2),
            (587.33, 0.11, 0.70, 0.22, 4.4),
        ],
        // Bildirim Sesi 2: sıcak üçlü zil (F4 -> A4 -> C5)
        "notify2" => &[
            (349.23, 0.0, 0.50, 0.20, 5.5),
            (440.00, 0.10, 0.55, 0.20, 5.0),
            (523.25, 0.20, 0.75, 0.22, 4.0),
        ],
        // Uyarı: alçak yumuşak ikili (D4 -> A3)
        "warn" => &[
            (293.66, 0.0, 0.45, 0.22, 6.0),
            (220.00, 0.14, 0.60, 0.20, 4.8),
        ],
        // Ajan görevi tamamladı: sıcak Fender Rhodes / Celesta akoru (C4 temel + C5 -> E5 -> G5)
        _ => &[
            (261.63, 0.0, 0.95, 0.14, 3.2),
            (523.25, 0.0, 0.65, 0.18, 4.5),
            (659.25, 0.105, 0.70, 0.18, 4.2),
            (783.99, 0.21, 0.85, 0.20, 3.6),
        ],
    };

    let tail_s = 0.25f32;
    let total_dur = notes
        .iter()
        .map(|(_, start, dur, _, _)| start + dur)
        .fold(0.0f32, f32::max)
        + tail_s;
    let total_samples = (sample_rate as f32 * total_dur) as usize;
    let mut dry = vec![0.0f32; total_samples];

    for &(freq, start_s, dur_s, gain, decay_rate) in notes {
        let start_idx = (sample_rate as f32 * start_s) as usize;
        let len = (sample_rate as f32 * dur_s) as usize;
        for i in 0..len {
            let idx = start_idx + i;
            if idx >= total_samples {
                break;
            }
            let t = i as f32 / sample_rate as f32;
            // Yumuşak kosinüs atak (6ms) -> tıkırtısız başlangıç
            let attack = if t < 0.006 {
                0.5 * (1.0 - (std::f32::consts::PI * t / 0.006).cos())
            } else {
                1.0
            };
            let env = attack * (-t * decay_rate).exp();
            // Sıcak gövde + çok kısa tokmak tınısı (25ms içinde sönen 2. harmonik)
            let fundamental = (2.0 * std::f32::consts::PI * freq * t).sin();
            let mallet = (2.0 * std::f32::consts::PI * (freq * 2.0) * t).sin() * 0.18 * (-t * 36.0).exp();
            let warmth = (2.0 * std::f32::consts::PI * (freq * 0.5) * t).sin() * 0.08;
            dry[idx] += (fundamental + mallet + warmth) * env * gain;
        }
    }

    // Hafif oda yankısı (105ms + 210ms) -> kuru dijital tınıyı yumuşatır
    let mut wet = dry.clone();
    let d1 = (sample_rate as f32 * 0.105) as usize;
    let d2 = (sample_rate as f32 * 0.210) as usize;
    for i in 0..total_samples {
        if i >= d1 {
            wet[i] += dry[i - d1] * 0.16;
        }
        if i >= d2 {
            wet[i] += dry[i - d2] * 0.07;
        }
    }

    let samples: Vec<i16> = wet
        .into_iter()
        .map(|s| ((s * 0.85).tanh() * i16::MAX as f32) as i16)
        .collect();

    let data_len = (samples.len() * 2) as u32;
    let mut wav = Vec::with_capacity(44 + data_len as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        wav.extend_from_slice(&s.to_le_bytes());
    }
    wav
}

#[tauri::command]
pub fn play_notification_sound(kind: Option<String>) -> Result<(), String> {
    let k = match kind.as_deref() {
        Some("notify") => "notify",
        Some("notify2") => "notify2",
        Some("warn") => "warn",
        _ => "done",
    };

    #[cfg(target_os = "macos")]
    {
        let sound = match k {
            "warn" => "/System/Library/Sounds/Basso.aiff",
            "notify" => "/System/Library/Sounds/Ping.aiff",
            "notify2" => "/System/Library/Sounds/Pop.aiff",
            _ => "/System/Library/Sounds/Glass.aiff",
        };
        let _ = std::process::Command::new("afplay").arg(sound).spawn();
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        let cache_dir = dirs::config_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("ydevdesk")
            .join("cache");
        let _ = std::fs::create_dir_all(&cache_dir);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&cache_dir, std::fs::Permissions::from_mode(0o700));
        }
        let wav_path = cache_dir.join(format!("ydevdesk_chime_v4_{}.wav", k));
        if !wav_path.exists() {
            let _ = std::fs::write(&wav_path, build_chime_wav(k));
        }
        for player in ["pw-play", "paplay", "aplay"] {
            if let Some(bin) = find_binary(player) {
                let mut cmd = std::process::Command::new(bin);
                cmd.arg(&wav_path);
                sanitize_std_cmd(&mut cmd);
                if cmd.spawn().is_ok() {
                    return Ok(());
                }
            }
        }
        return Err("Ses oynatıcı bulunamadı (pw-play / paplay / aplay)".into());
    }

    #[cfg(target_os = "windows")]
    {
        let wav = build_chime_wav(k);
        return platform::play_wav_windows(&wav);
    }
}

#[tauri::command]
pub fn send_desktop_notification(title: String, body: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        if let Some(bin) = find_binary("notify-send") {
            let mut cmd = std::process::Command::new(bin);
            cmd.args(["-a", "YDevDesk", "-i", "ydevdesk", &title, &body]);
            sanitize_std_cmd(&mut cmd);
            if cmd.spawn().is_ok() {
                return Ok(());
            }
        }
    }
    #[cfg(not(target_os = "linux"))]
    let _ = (&title, &body);
    Err("Native notify-send kullanılamadı".into())
}


