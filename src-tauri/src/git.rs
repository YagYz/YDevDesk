use crate::config::expand_home;

fn run_cmd(dir: &std::path::Path, prog: &str, args: &[&str]) -> Option<String> {
    let out = std::process::Command::new(prog).args(args).current_dir(dir).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

#[tauri::command]
pub fn list_git_projects(root: String) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(expand_home(&root))
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().join(".git").exists())
                .filter_map(|e| e.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default();
    v.sort_by_key(|s| s.to_lowercase());
    v
}

#[tauri::command]
pub async fn get_git_status(root: String, project: String) -> Result<serde_json::Value, String> {
    if project.is_empty() || project.contains('/') || project.contains('\\') || project.contains("..") {
        return Err("Geçersiz proje adı".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let root_dir = expand_home(&root);
        let dir = root_dir.join(&project);
        let canon_root = root_dir.canonicalize().map_err(|_| "Kök dizin bulunamadı".to_string())?;
        let canon_dir = dir.canonicalize().map_err(|_| "Proje dizini bulunamadı".to_string())?;
        if !canon_dir.starts_with(&canon_root) || !canon_dir.join(".git").exists() {
            return Err("Git deposu bulunamadı".to_string());
        }
        let branch = run_cmd(&dir, "git", &["rev-parse", "--abbrev-ref", "HEAD"])
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let (mut ahead, mut behind) = (0i64, 0i64);
        if let Some(s) = run_cmd(&dir, "git", &["rev-list", "--left-right", "--count", "@{u}...HEAD"]) {
            let mut it = s.split_whitespace();
            behind = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
            ahead = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
        }
        let changes: Vec<serde_json::Value> = run_cmd(&dir, "git", &["status", "--porcelain"])
            .unwrap_or_default()
            .lines()
            .filter_map(|l| {
                let st = l.get(..2)?;
                let p = l.get(3..)?;
                Some(serde_json::json!({ "status": st.trim(), "path": p }))
            })
            .collect();
        let last_commit = run_cmd(&dir, "git", &["log", "-1", "--pretty=%h %s"])
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        // PR durumu (gh yoksa veya oturum yoksa null)
        let pr = run_cmd(
            &dir,
            "gh",
            &["pr", "list", "--head", &branch, "--state", "all", "--limit", "1", "--json", "number,title,state,url,isDraft"],
        )
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get(0).cloned());
        Ok(serde_json::json!({
            "branch": branch,
            "ahead": ahead,
            "behind": behind,
            "changes": changes,
            "last_commit": last_commit,
            "pr": pr
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

