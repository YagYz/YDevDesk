use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::Manager;

mod agents;
mod agents_installer;
mod agents_sessions;
mod agents_usage;
mod config;
mod env_helpers;
mod git;
mod homelab;
mod platform;
mod plugins;
mod pty;
mod sync;
mod themes;
mod updater;
mod window_notify;

pub(crate) use config::{write_private_file, ydevdesk_config_dir};
pub(crate) use env_helpers::get_enhanced_path;
use pty::TerminalState;

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
            pty::start_pty,
            pty::write_pty,
            pty::resize_pty,
            pty::close_pty,
            window_notify::app_window_close,
            window_notify::app_window_minimize,
            window_notify::app_window_toggle_maximize,
            config::load_homelab_config,
            config::save_homelab_config,
            agents_sessions::get_agent_status,
            agents::markdown::list_agent_markdowns,
            agents::markdown::read_markdown_file,
            agents_usage::get_usage_analytics,
            agents_usage::enable_agy_quota_hook,
            agents_usage::enable_claude_quota_hook,
            homelab::fetch_homelab_notes,
            homelab::fetch_homelab_knowledge,
            homelab::fetch_ynetmon_summary,
            homelab::create_homelab_note,
            homelab::create_homelab_knowledge,
            homelab::fetch_homelab_tasks,
            homelab::create_homelab_task,
            homelab::complete_homelab_task,
            git::list_git_projects,
            git::get_git_status,
            config::load_app_settings,
            config::save_app_settings,
            config::load_session_prefs,
            config::save_session_prefs,
            config::default_projects_root,
            updater::get_app_version,
            updater::check_app_update,
            updater::install_app_update,
            agents_installer::check_agent_environment,
            agents_installer::install_agent_cli,
            window_notify::play_notification_sound,
            window_notify::send_desktop_notification,
            sync::github_device_flow_start,
            sync::github_device_flow_poll,
            sync::github_sync_status,
            sync::github_get_sync_key,
            sync::github_set_sync_key,
            sync::github_sync_disconnect,
            sync::github_sync_pull,
            sync::github_sync_push,
            agents::sessions_delete::delete_agent_session,
            plugins::list_installed_plugins,
            plugins::read_plugin_entry,
            plugins::remove_plugin,
            plugins::create_sample_plugin,
            plugins::open_plugins_dir,
            themes::list_themes,
            themes::remove_theme,
            themes::create_sample_theme,
            themes::open_themes_dir
        ])
        .run(context)
        .expect("error while running tauri application");
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_target_asset_suffix_matches_os() {
        let suffix = updater::target_asset_suffix();
        #[cfg(target_os = "windows")]
        assert_eq!(suffix, "x64-setup.exe");
        #[cfg(target_os = "macos")]
        assert!(suffix == "aarch64.app.tar.gz" || suffix == "x64.app.tar.gz");
        #[cfg(target_os = "linux")]
        assert_eq!(suffix, "amd64.AppImage");
    }

    #[test]
    fn test_parse_semver_and_compare() {
        assert_eq!(updater::parse_semver("v1.0.0"), (1, 0, 0));
        assert_eq!(updater::parse_semver("1.2.3-beta"), (1, 2, 3));
        assert!(updater::parse_semver("v1.10.0") > updater::parse_semver("v1.2.9"));
        assert!(updater::parse_semver("2.0.0") > updater::parse_semver("1.99.99"));
    }

    #[test]
    fn test_write_agy_statusline_hook_cross_platform() {
        let tmp = std::env::temp_dir().join(format!("ydevdesk_hook_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).expect("create temp home");

        let cmd = platform::write_agy_statusline_hook(&tmp).expect("write hook");
        #[cfg(target_os = "windows")]
        {
            assert!(cmd.contains("powershell"));
            assert!(tmp.join(".gemini/antigravity-cli/hooks/ydevdesk-statusline.ps1").is_file());
        }
        #[cfg(not(target_os = "windows"))]
        {
            let hook_file = tmp.join(".config/ydevdesk/agy-quota-hook.sh");
            assert!(hook_file.is_file());
            assert_eq!(cmd, hook_file.to_string_lossy());
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mode = std::fs::metadata(&hook_file).unwrap().permissions().mode();
                assert_ne!(mode & 0o111, 0);
            }
        }

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_build_chime_wav_header_and_payload() {
        for kind in ["done", "notify", "notify2", "warn"] {
            let wav = window_notify::build_chime_wav(kind);
            assert!(wav.len() > 44, "wav too short for {}", kind);
            assert_eq!(&wav[0..4], b"RIFF");
            assert_eq!(&wav[8..12], b"WAVE");
            assert_eq!(&wav[12..16], b"fmt ");
            assert_eq!(&wav[36..40], b"data");
        }
    }
}
