use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Serialize, Deserialize, Clone)]
pub struct AgentMarkdownFile {
    pub path: String,
    pub name: String,
    pub agent: String,
    pub session_id: String,
    pub full_session_id: String,
    pub modified_ago_secs: u64,
    pub size_bytes: u64,
}

fn short_id(id: &str) -> String {
    id.chars().take(8).collect()
}

fn expand_home_path(raw: &str, home: &Path) -> PathBuf {
    if let Some(rest) = raw.strip_prefix("~/") {
        home.join(rest)
    } else if raw == "~" {
        home.to_path_buf()
    } else {
        PathBuf::from(raw)
    }
}

fn collect_md_in_dir(
    dir: &Path,
    agent: &str,
    depth: u8,
    session_hint: Option<&str>,
    now: SystemTime,
    seen: &mut HashSet<PathBuf>,
    out: &mut Vec<AgentMarkdownFile>,
) {
    if depth == 0 || !dir.is_dir() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        let fname = entry.file_name().to_string_lossy().to_string();
        if fname.starts_with('.')
            || matches!(
                fname.as_str(),
                "node_modules" | "target" | "dist" | "build" | ".venv" | "venv" | "__pycache__"
            )
        {
            continue;
        }
        if p.is_dir() {
            let next_hint = session_hint.or(Some(fname.as_str()));
            collect_md_in_dir(&p, agent, depth - 1, next_hint, now, seen, out);
        } else if p.is_file() {
            let is_md = p
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"))
                .unwrap_or(false);
            if !is_md {
                continue;
            }
            let canon = std::fs::canonicalize(&p).unwrap_or_else(|_| p.clone());
            if !seen.insert(canon.clone()) {
                continue;
            }
            let Ok(meta) = std::fs::metadata(&p) else {
                continue;
            };
            let modified_ago_secs = meta
                .modified()
                .ok()
                .and_then(|m| now.duration_since(m).ok())
                .map(|d| d.as_secs())
                .unwrap_or(u64::MAX);
            let full_sid = session_hint.unwrap_or("").to_string();
            out.push(AgentMarkdownFile {
                path: canon.to_string_lossy().to_string(),
                name: fname,
                agent: agent.to_string(),
                session_id: if full_sid.is_empty() {
                    String::new()
                } else {
                    short_id(&full_sid)
                },
                full_session_id: full_sid,
                modified_ago_secs,
                size_bytes: meta.len(),
            });
        }
    }
}

#[tauri::command]
pub fn list_agent_markdowns(project_roots: Option<Vec<String>>) -> Vec<AgentMarkdownFile> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let now = SystemTime::now();
    let mut seen = HashSet::new();
    let mut out = Vec::new();

    collect_md_in_dir(
        &home.join(".gemini").join("antigravity-cli").join("brain"),
        "agy",
        8,
        None,
        now,
        &mut seen,
        &mut out,
    );
    collect_md_in_dir(
        &home.join(".gemini").join("antigravity").join("brain"),
        "agy",
        8,
        None,
        now,
        &mut seen,
        &mut out,
    );
    collect_md_in_dir(
        &home.join(".claude").join("plans"),
        "claude",
        8,
        Some("plans"),
        now,
        &mut seen,
        &mut out,
    );
    collect_md_in_dir(
        &home.join(".claude").join("projects"),
        "claude",
        8,
        None,
        now,
        &mut seen,
        &mut out,
    );
    collect_md_in_dir(
        &home.join(".codex"),
        "codex",
        8,
        None,
        now,
        &mut seen,
        &mut out,
    );

    if let Some(roots) = project_roots {
        for raw_root in roots {
            let trimmed = raw_root.trim();
            if trimmed.is_empty() {
                continue;
            }
            let root_path = expand_home_path(trimmed, &home);
            collect_md_in_dir(&root_path, "project", 5, None, now, &mut seen, &mut out);
        }
    }

    out.sort_by_key(|f| f.modified_ago_secs);
    out.truncate(100);
    out
}

#[tauri::command]
pub fn read_markdown_file(path: String, project_roots: Option<Vec<String>>) -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "Ev dizini bulunamadı".to_string())?;
    let canon_home = std::fs::canonicalize(&home).map_err(|e| e.to_string())?;
    let canon_path = std::fs::canonicalize(&path).map_err(|e| format!("Dosya okunamadı: {}", e))?;

    let mut allowed = canon_path.starts_with(&canon_home);
    if !allowed {
        if let Some(roots) = project_roots {
            for raw_root in roots {
                let root_path = expand_home_path(raw_root.trim(), &home);
                if let Ok(canon_root) = std::fs::canonicalize(&root_path) {
                    if canon_path.starts_with(&canon_root) {
                        allowed = true;
                        break;
                    }
                }
            }
        }
    }
    if !allowed {
        return Err("Yalnızca ev dizini veya tanımlı proje dizinleri altındaki dosyalar açılabilir".to_string());
    }
    let is_md = canon_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"))
        .unwrap_or(false);
    if !is_md {
        return Err("Yalnızca .md / .markdown dosyaları açılabilir".to_string());
    }
    let meta = std::fs::metadata(&canon_path).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("Geçerli bir dosya değil".to_string());
    }
    if meta.len() > 5 * 1024 * 1024 {
        return Err("Dosya 5 MB sınırını aşıyor".to_string());
    }
    std::fs::read_to_string(&canon_path).map_err(|e| format!("Dosya okunamadı: {}", e))
}
