use std::path::{Path, PathBuf};

use crate::config::SessionPrefs;

fn is_safe_session_id(session_id: &str) -> bool {
    !session_id.is_empty()
        && session_id != "."
        && !session_id.contains('/')
        && !session_id.contains('\\')
        && !session_id.contains("..")
        && !session_id.contains('\0')
}

fn collect_matching_jsonl(dir: &Path, session_id: &str, out: &mut Vec<PathBuf>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_matching_jsonl(&path, session_id, out);
        } else if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.ends_with(".jsonl") && name.contains(session_id) {
                    out.push(path);
                }
            }
        }
    }
}

fn remove_session_pref(agent: &str, session_id: &str) {
    let prefs_path = crate::ydevdesk_config_dir().join("session_prefs.json");
    let content = match std::fs::read_to_string(&prefs_path) {
        Ok(c) => c,
        Err(_) => return,
    };
    let mut prefs: SessionPrefs = match serde_json::from_str(&content) {
        Ok(p) => p,
        Err(_) => return,
    };
    let key = format!("{}:{}", agent, session_id);
    let removed_pin = prefs.pinned.remove(&key).is_some();
    let removed_alias = prefs.aliases.remove(&key).is_some();
    if removed_pin || removed_alias {
        if let Ok(json) = serde_json::to_string_pretty(&prefs) {
            let _ = std::fs::write(&prefs_path, json);
        }
    }
}

fn delete_in_base(home: &Path, agent: &str, session_id: &str) -> Result<String, String> {
    if !is_safe_session_id(session_id) {
        return Err("Geçersiz oturum kimliği.".to_string());
    }

    let mut deleted = false;

    match agent {
        "agy" => {
            let brain_dirs = [
                home.join(".gemini").join("antigravity-cli").join("brain"),
                home.join(".gemini").join("antigravity").join("brain"),
            ];
            for brain_dir in brain_dirs {
                let canon_brain = match std::fs::canonicalize(&brain_dir) {
                    Ok(p) => p,
                    Err(_) => continue,
                };
                let target = brain_dir.join(session_id);
                if !target.exists() {
                    continue;
                }
                let canon_target =
                    std::fs::canonicalize(&target).map_err(|e| format!("Yol doğrulanamadı: {}", e))?;
                if !canon_target.starts_with(&canon_brain) || canon_target == canon_brain {
                    return Err("İzin verilmeyen oturum yolu.".to_string());
                }
                if canon_target.is_dir() {
                    std::fs::remove_dir_all(&canon_target)
                        .map_err(|e| format!("Oturum klasörü silinemedi: {}", e))?;
                } else {
                    std::fs::remove_file(&canon_target)
                        .map_err(|e| format!("Oturum dosyası silinemedi: {}", e))?;
                }
                deleted = true;
            }
        }
        "claude" => {
            let projects_dir = home.join(".claude").join("projects");
            if let Ok(canon_projects) = std::fs::canonicalize(&projects_dir) {
                if let Ok(entries) = std::fs::read_dir(&projects_dir) {
                    for entry in entries.flatten() {
                        let proj_path = entry.path();
                        if !proj_path.is_dir() {
                            continue;
                        }
                        let file_candidate = proj_path.join(format!("{}.jsonl", session_id));
                        if file_candidate.exists() {
                            let canon = std::fs::canonicalize(&file_candidate)
                                .map_err(|e| format!("Yol doğrulanamadı: {}", e))?;
                            if !canon.starts_with(&canon_projects) || canon == canon_projects {
                                return Err("İzin verilmeyen oturum yolu.".to_string());
                            }
                            std::fs::remove_file(&canon)
                                .map_err(|e| format!("Oturum dosyası silinemedi: {}", e))?;
                            deleted = true;
                        }
                        let dir_candidate = proj_path.join(session_id);
                        if dir_candidate.is_dir() {
                            let canon = std::fs::canonicalize(&dir_candidate)
                                .map_err(|e| format!("Yol doğrulanamadı: {}", e))?;
                            if !canon.starts_with(&canon_projects) || canon == canon_projects {
                                return Err("İzin verilmeyen oturum yolu.".to_string());
                            }
                            std::fs::remove_dir_all(&canon)
                                .map_err(|e| format!("Oturum klasörü silinemedi: {}", e))?;
                            deleted = true;
                        }
                    }
                }
            }
        }
        "codex" => {
            let sessions_dir = home.join(".codex").join("sessions");
            if let Ok(canon_sessions) = std::fs::canonicalize(&sessions_dir) {
                let mut matches = Vec::new();
                collect_matching_jsonl(&sessions_dir, session_id, &mut matches);
                for path in matches {
                    let canon = std::fs::canonicalize(&path)
                        .map_err(|e| format!("Yol doğrulanamadı: {}", e))?;
                    if !canon.starts_with(&canon_sessions) || canon == canon_sessions {
                        return Err("İzin verilmeyen oturum yolu.".to_string());
                    }
                    std::fs::remove_file(&canon)
                        .map_err(|e| format!("Oturum dosyası silinemedi: {}", e))?;
                    deleted = true;
                }
            }
        }
        _ => return Err(format!("Desteklenmeyen ajan: {}", agent)),
    }

    if !deleted {
        return Err(format!("Oturum bulunamadı: {}", session_id));
    }

    remove_session_pref(agent, session_id);
    Ok(format!("Oturum silindi: {}", session_id))
}

#[tauri::command]
pub fn delete_agent_session(agent: String, session_id: String) -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "Kullanıcı dizini bulunamadı.".to_string())?;
    delete_in_base(&home, &agent, &session_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rejects_path_traversal_session_ids() {
        let tmp = std::env::temp_dir().join(format!("ydevdesk_del_test_{}", std::process::id()));
        for bad in ["../foo", "..", "", "a/b", "a\\b", "foo\0bar", "."] {
            let res = delete_in_base(&tmp, "agy", bad);
            assert!(res.is_err(), "expected error for {:?}", bad);
            assert!(
                res.unwrap_err().contains("Geçersiz"),
                "expected invalid session id error for {:?}",
                bad
            );
        }
    }
}
