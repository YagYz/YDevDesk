use std::collections::HashMap;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};

use crate::plugins::{is_safe_id, open_dir_in_file_manager};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ThemeManifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub builtin: bool,
    pub vars: HashMap<String, String>,
    #[serde(default)]
    pub terminal: Option<HashMap<String, String>>,
}

fn themes_root_dir() -> PathBuf {
    crate::ydevdesk_config_dir().join("themes")
}

fn make_map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
        .collect()
}

pub(crate) fn builtin_themes() -> Vec<ThemeManifest> {
    vec![
        ThemeManifest {
            id: "deep-navy".to_string(),
            name: "Deep Navy & Petrol".to_string(),
            description: "YDevDesk varsayılan koyu lacivert ve petrol teması.".to_string(),
            author: "YDevDesk".to_string(),
            builtin: true,
            vars: make_map(&[
                ("--bg", "#06090e"),
                ("--surface", "#0a111a"),
                ("--surface-raised", "#0f1926"),
                ("--border", "#162638"),
                ("--border-glow", "#1f3a56"),
                ("--accent", "#00d2ff"),
                ("--petrol", "#00838f"),
                ("--txt-main", "#f0f6fc"),
                ("--txt-muted", "#7d8b99"),
                ("--txt-dim", "#475569"),
                ("--ok", "#2ed573"),
                ("--warn", "#ffa502"),
                ("--err", "#ff6b81"),
            ]),
            terminal: Some(make_map(&[
                ("background", "#06090e"),
                ("foreground", "#f0f6fc"),
                ("cursor", "#00d2ff"),
                ("selectionBackground", "#1f3a56"),
            ])),
        },
        ThemeManifest {
            id: "midnight-violet".to_string(),
            name: "Midnight Violet".to_string(),
            description: "Derin gece moru ve neon lila vurgular.".to_string(),
            author: "YDevDesk".to_string(),
            builtin: true,
            vars: make_map(&[
                ("--bg", "#09070f"),
                ("--surface", "#120e1d"),
                ("--surface-raised", "#1a142a"),
                ("--border", "#2a1f42"),
                ("--border-glow", "#3e2d63"),
                ("--accent", "#a78bfa"),
                ("--petrol", "#7c3aed"),
                ("--txt-main", "#f5f3ff"),
                ("--txt-muted", "#9c8fb8"),
                ("--txt-dim", "#5b4f78"),
                ("--ok", "#34d399"),
                ("--warn", "#fbbf24"),
                ("--err", "#fb7185"),
            ]),
            terminal: Some(make_map(&[
                ("background", "#09070f"),
                ("foreground", "#f5f3ff"),
                ("cursor", "#a78bfa"),
                ("selectionBackground", "#3e2d63"),
            ])),
        },
        ThemeManifest {
            id: "emerald-matrix".to_string(),
            name: "Emerald Terminal".to_string(),
            description: "Klasik zümrüt yeşili terminal estetiği.".to_string(),
            author: "YDevDesk".to_string(),
            builtin: true,
            vars: make_map(&[
                ("--bg", "#050b08"),
                ("--surface", "#09140f"),
                ("--surface-raised", "#0f2018"),
                ("--border", "#173326"),
                ("--border-glow", "#214d38"),
                ("--accent", "#10b981"),
                ("--petrol", "#047857"),
                ("--txt-main", "#ecfdf5"),
                ("--txt-muted", "#7ca392"),
                ("--txt-dim", "#426656"),
                ("--ok", "#4ade80"),
                ("--warn", "#facc15"),
                ("--err", "#f87171"),
            ]),
            terminal: Some(make_map(&[
                ("background", "#050b08"),
                ("foreground", "#ecfdf5"),
                ("cursor", "#10b981"),
                ("selectionBackground", "#214d38"),
            ])),
        },
        ThemeManifest {
            id: "amber-forge".to_string(),
            name: "Amber Forge".to_string(),
            description: "Sıcak kehribar ve koyu karbon tonları.".to_string(),
            author: "YDevDesk".to_string(),
            builtin: true,
            vars: make_map(&[
                ("--bg", "#0c0906"),
                ("--surface", "#16110c"),
                ("--surface-raised", "#211911"),
                ("--border", "#36281a"),
                ("--border-glow", "#523b24"),
                ("--accent", "#f59e0b"),
                ("--petrol", "#b45309"),
                ("--txt-main", "#fffbeb"),
                ("--txt-muted", "#a8957e"),
                ("--txt-dim", "#6b5a47"),
                ("--ok", "#4ade80"),
                ("--warn", "#fbbf24"),
                ("--err", "#f87171"),
            ]),
            terminal: Some(make_map(&[
                ("background", "#0c0906"),
                ("foreground", "#fffbeb"),
                ("cursor", "#f59e0b"),
                ("selectionBackground", "#523b24"),
            ])),
        },
        ThemeManifest {
            id: "slate-light".to_string(),
            name: "Slate Light".to_string(),
            description: "Aydınlık çalışma ortamları için yüksek kontrastlı açık tema.".to_string(),
            author: "YDevDesk".to_string(),
            builtin: true,
            vars: make_map(&[
                ("--bg", "#f1f5f9"),
                ("--surface", "#ffffff"),
                ("--surface-raised", "#e2e8f0"),
                ("--border", "#cbd5e1"),
                ("--border-glow", "#94a3b8"),
                ("--accent", "#0284c7"),
                ("--petrol", "#0369a1"),
                ("--txt-main", "#0f172a"),
                ("--txt-muted", "#475569"),
                ("--txt-dim", "#64748b"),
                ("--ok", "#16a34a"),
                ("--warn", "#d97706"),
                ("--err", "#dc2626"),
            ]),
            terminal: Some(make_map(&[
                ("background", "#ffffff"),
                ("foreground", "#0f172a"),
                ("cursor", "#0284c7"),
                ("selectionBackground", "#bae6fd"),
            ])),
        },
    ]
}

#[tauri::command]
pub fn list_themes() -> Vec<ThemeManifest> {
    let mut themes = builtin_themes();

    let root = themes_root_dir();
    if let Ok(entries) = std::fs::read_dir(&root) {
        let mut custom = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let content = match std::fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            if let Ok(mut theme) = serde_json::from_str::<ThemeManifest>(&content) {
                if !is_safe_id(&theme.id) {
                    continue;
                }
                theme.builtin = false;
                custom.push(theme);
            }
        }
        custom.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        themes.extend(custom);
    }

    themes
}

#[tauri::command]
pub fn remove_theme(theme_id: String) -> Result<(), String> {
    if !is_safe_id(&theme_id) {
        return Err("Geçersiz tema kimliği.".to_string());
    }
    let root = themes_root_dir();
    let target = root.join(format!("{}.json", theme_id));
    if !target.exists() {
        return Ok(());
    }
    let canon_root =
        std::fs::canonicalize(&root).map_err(|e| format!("Tema dizini bulunamadı: {}", e))?;
    let canon_target =
        std::fs::canonicalize(&target).map_err(|e| format!("Tema dosyası doğrulanamadı: {}", e))?;
    if !canon_target.starts_with(&canon_root) || !canon_target.is_file() {
        return Err("İzin verilmeyen tema yolu.".to_string());
    }
    std::fs::remove_file(&canon_target).map_err(|e| format!("Tema silinemedi: {}", e))
}

#[tauri::command]
pub fn create_sample_theme() -> Result<ThemeManifest, String> {
    let root = themes_root_dir();
    std::fs::create_dir_all(&root).map_err(|e| format!("Tema klasörü oluşturulamadı: {}", e))?;

    let theme = ThemeManifest {
        id: "cyber-rose".to_string(),
        name: "Cyber Rose".to_string(),
        description: "Neon pembe ve koyu obsidyen özel örnek tema.".to_string(),
        author: "YDevDesk".to_string(),
        builtin: false,
        vars: make_map(&[
            ("--bg", "#0b060a"),
            ("--surface", "#160c14"),
            ("--surface-raised", "#22121f"),
            ("--border", "#3b1c33"),
            ("--border-glow", "#5c274e"),
            ("--accent", "#f43f5e"),
            ("--petrol", "#be123c"),
            ("--txt-main", "#fff1f2"),
            ("--txt-muted", "#b88c9c"),
            ("--txt-dim", "#734d5b"),
            ("--ok", "#34d399"),
            ("--warn", "#fbbf24"),
            ("--err", "#fb7185"),
        ]),
        terminal: Some(make_map(&[
            ("background", "#0b060a"),
            ("foreground", "#fff1f2"),
            ("cursor", "#f43f5e"),
            ("selectionBackground", "#5c274e"),
        ])),
    };

    let json = serde_json::to_string_pretty(&theme).map_err(|e| format!("JSON hatası: {}", e))?;
    std::fs::write(root.join("cyber-rose.json"), json)
        .map_err(|e| format!("Tema dosyası yazılamadı: {}", e))?;

    Ok(theme)
}

#[tauri::command]
pub fn open_themes_dir() -> Result<String, String> {
    open_dir_in_file_manager(&themes_root_dir())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_builtins_include_deep_navy() {
        let builtins = builtin_themes();
        assert_eq!(builtins.len(), 5);
        let deep = builtins
            .iter()
            .find(|t| t.id == "deep-navy")
            .expect("deep-navy builtin theme must exist");
        assert!(deep.builtin);
        assert_eq!(deep.name, "Deep Navy & Petrol");
        assert_eq!(deep.vars.get("--bg").map(String::as_str), Some("#06090e"));
        assert_eq!(deep.vars.get("--accent").map(String::as_str), Some("#00d2ff"));
        assert!(deep.terminal.is_some());
    }
}
