use crate::platform;

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
pub(crate) fn appimage_env_actions() -> Vec<(&'static str, Option<String>)> {
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

pub(crate) fn sanitize_std_cmd(cmd: &mut std::process::Command) {
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


pub(crate) fn find_binary(name: &str) -> Option<std::path::PathBuf> {
    platform::find_binary(name)
}

pub(crate) fn get_binary_version(bin: &std::path::Path, args: &[&str]) -> Option<String> {
    let mut cmd = platform::hidden_command(&bin.to_string_lossy());
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

