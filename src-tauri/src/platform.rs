use std::path::{Path, PathBuf};
use std::process::Command;

/// Creates a `Command` that suppresses console window creation on Windows.
pub fn hidden_command(program: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut cmd = Command::new(program);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new(program)
    }
}

/// Returns the user's home directory, checking `HOME`, then `USERPROFILE` on Windows, falling back to `.`.
#[allow(dead_code)]
pub fn home_dir() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            return PathBuf::from(home);
        }
    }
    #[cfg(target_os = "windows")]
    if let Ok(profile) = std::env::var("USERPROFILE") {
        if !profile.is_empty() {
            return PathBuf::from(profile);
        }
    }
    PathBuf::from(".")
}

/// Locates an executable binary by name across platform-specific search paths.
pub fn find_binary(name: &str) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let mut dirs: Vec<PathBuf> = Vec::new();
        if let Ok(path_var) = std::env::var("PATH") {
            for entry in path_var.split(';') {
                if !entry.is_empty() {
                    dirs.push(PathBuf::from(entry));
                }
            }
        }
        if let Ok(appdata) = std::env::var("APPDATA") {
            if !appdata.is_empty() {
                dirs.push(PathBuf::from(&appdata).join("npm"));
            }
        }
        if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
            if !local_appdata.is_empty() {
                dirs.push(PathBuf::from(&local_appdata).join("Programs"));
            }
        }
        if let Ok(profile) = std::env::var("USERPROFILE") {
            if !profile.is_empty() {
                let profile_path = PathBuf::from(&profile);
                dirs.push(profile_path.join(".cargo").join("bin"));
                dirs.push(profile_path.join(".local").join("bin"));
            }
        }

        const EXTS: [&str; 3] = [".exe", ".cmd", ".bat"];
        for dir in dirs {
            let direct = dir.join(name);
            if direct.is_file() {
                return Some(direct);
            }
            for ext in EXTS {
                let with_ext = dir.join(format!("{name}{ext}"));
                if with_ext.is_file() {
                    return Some(with_ext);
                }
            }
        }
        None
    }
    #[cfg(not(target_os = "windows"))]
    {
        let full_path = crate::get_enhanced_path();
        for dir in full_path.split(':') {
            let p = Path::new(dir).join(name);
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
}

/// Returns the default interactive shell for the current OS.
pub fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        for candidate in ["pwsh.exe", "powershell.exe", "cmd.exe"] {
            if let Some(path) = find_binary(candidate) {
                return path.to_string_lossy().to_string();
            }
        }
        "cmd.exe".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                if cfg!(target_os = "macos") {
                    "/bin/zsh".to_string()
                } else {
                    "/bin/bash".to_string()
                }
            })
    }
}

/// Plays a WAV buffer on Windows via PowerShell `Media.SoundPlayer`; no-op on other platforms.
#[allow(dead_code)]
pub fn play_wav_windows(wav_bytes: &[u8]) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let tmp_path =
            std::env::temp_dir().join(format!("ydevdesk-notify-{}.wav", std::process::id()));
        std::fs::write(&tmp_path, wav_bytes).map_err(|e| e.to_string())?;
        let escaped = tmp_path.to_string_lossy().replace('\'', "''");
        let ps_script = format!("(New-Object Media.SoundPlayer '{escaped}').PlaySync()");
        let status = hidden_command("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
            .status()
            .map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&tmp_path);
        if !status.success() {
            return Err(format!("PowerShell sound playback failed: {status}"));
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = wav_bytes;
        Ok(())
    }
}

/// Writes the Antigravity statusLine hook script and returns the command string to invoke it.
pub fn write_agy_statusline_hook(home: &Path) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let hook_dir = home.join(".gemini").join("antigravity-cli").join("hooks");
        std::fs::create_dir_all(&hook_dir).map_err(|e| e.to_string())?;
        let hook_path = hook_dir.join("ydevdesk-statusline.ps1");
        let hook_script = concat!(
            "$cacheDir = Join-Path $env:USERPROFILE \".gemini\\antigravity-cli\\cache\"\n",
            "New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null\n",
            "$input | Out-File -FilePath (Join-Path $cacheDir \"last_statusline.json\") -Encoding utf8\n",
        );
        std::fs::write(&hook_path, hook_script).map_err(|e| e.to_string())?;
        Ok(format!(
            "powershell -NoProfile -ExecutionPolicy Bypass -File \"{}\"",
            hook_path.to_string_lossy()
        ))
    }
    #[cfg(not(target_os = "windows"))]
    {
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

        Ok(hook_path.to_string_lossy().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hidden_command_program() {
        let cmd = hidden_command("echo");
        assert_eq!(cmd.get_program(), "echo");
    }

    #[test]
    fn test_home_dir_non_empty() {
        let home = home_dir();
        assert!(!home.as_os_str().is_empty());
        if let Ok(env_home) = std::env::var("HOME") {
            if !env_home.is_empty() {
                assert_eq!(home, PathBuf::from(env_home));
            }
        }
    }

    #[test]
    fn test_default_shell_non_empty() {
        let shell = default_shell();
        assert!(!shell.is_empty());
        #[cfg(not(target_os = "windows"))]
        if let Ok(env_shell) = std::env::var("SHELL") {
            if !env_shell.is_empty() {
                assert_eq!(shell, env_shell);
            }
        }
    }

    #[test]
    fn test_find_binary_existing_and_missing() {
        #[cfg(not(target_os = "windows"))]
        assert!(find_binary("sh").is_some());
        #[cfg(target_os = "windows")]
        assert!(find_binary("cmd").is_some());

        assert!(find_binary("__ydevdesk_nonexistent_binary_12345__").is_none());
    }
}
