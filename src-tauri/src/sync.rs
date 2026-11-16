use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::{write_private_file, ydevdesk_config_dir};

const DEFAULT_GITHUB_CLIENT_ID: &str = "Ov23liX9aCQjPxg4A6j3";
const SYNC_GIST_DESCRIPTION: &str = "YDevDesk Sync Profile (v1)";
const SYNC_GIST_FILENAME: &str = "ydevdesk-sync.json";
const USER_AGENT: &str = concat!("YDevDesk/", env!("CARGO_PKG_VERSION"));

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct SyncAuthState {
    access_token: String,
    github_login: String,
    gist_id: Option<String>,
    etag: Option<String>,
    device_id: String,
    device_name: String,
    #[serde(default)]
    sync_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceFlowStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceFlowPollResult {
    pub status: String, // "pending" | "slow_down" | "authorized"
    pub interval: Option<u64>,
    pub login: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncStatusInfo {
    pub connected: bool,
    pub login: String,
    pub gist_id: Option<String>,
    pub device_id: String,
    pub device_name: String,
    pub has_sync_key: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncPullResult {
    pub changed: bool,
    pub payload_json: Option<String>,
    pub gist_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncPushResult {
    pub gist_id: String,
}

fn github_client_id() -> String {
    std::env::var("YDEVDESK_GITHUB_CLIENT_ID")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_GITHUB_CLIENT_ID.to_string())
}

fn sync_auth_path() -> PathBuf {
    ydevdesk_config_dir().join("sync_auth.json")
}

fn resolve_device_name() -> String {
    for key in ["HOSTNAME", "COMPUTERNAME"] {
        if let Ok(val) = std::env::var(key) {
            let trimmed = val.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    if let Ok(out) = std::process::Command::new("hostname").output() {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() {
                return s;
            }
        }
    }
    std::env::consts::OS.to_string()
}

fn generate_device_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("dev-{:x}-{:x}", std::process::id(), nanos & 0xffff_ffff)
}

fn load_auth_state() -> Option<SyncAuthState> {
    let raw = std::fs::read_to_string(sync_auth_path()).ok()?;
    let mut state: SyncAuthState = serde_json::from_str(&raw).ok()?;
    if state.access_token.trim().is_empty() {
        return None;
    }
    if state.device_id.trim().is_empty() {
        state.device_id = generate_device_id();
    }
    if state.device_name.trim().is_empty() {
        state.device_name = resolve_device_name();
    }
    Some(state)
}

fn save_auth_state(state: &SyncAuthState) -> Result<(), String> {
    let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    write_private_file(&sync_auth_path(), &json)
}

fn build_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())
}

fn find_matching_gist_id(gists: &[serde_json::Value]) -> Option<String> {
    gists.iter().find_map(|g| {
        let desc = g.get("description").and_then(|v| v.as_str()).unwrap_or("");
        let has_file = g
            .get("files")
            .and_then(|f| f.get(SYNC_GIST_FILENAME))
            .is_some();
        if desc == SYNC_GIST_DESCRIPTION || has_file {
            g.get("id").and_then(|v| v.as_str()).map(|s| s.to_string())
        } else {
            None
        }
    })
}

async fn find_sync_gist(client: &reqwest::Client, token: &str) -> Result<Option<String>, String> {
    let res = client
        .get("https://api.github.com/gists?per_page=100")
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("GitHub API HTTP {}", res.status()));
    }

    let gists = res
        .json::<Vec<serde_json::Value>>()
        .await
        .map_err(|e| e.to_string())?;
    Ok(find_matching_gist_id(&gists))
}

#[tauri::command]
pub async fn github_device_flow_start() -> Result<DeviceFlowStart, String> {
    let client = build_http_client()?;
    let res = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "client_id": github_client_id(),
            "scope": "gist"
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("GitHub OAuth HTTP {}", res.status()));
    }

    let v = res
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;

    if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
        let desc = v
            .get("error_description")
            .and_then(|d| d.as_str())
            .unwrap_or(err);
        return Err(desc.to_string());
    }

    Ok(DeviceFlowStart {
        device_code: v
            .get("device_code")
            .and_then(|s| s.as_str())
            .ok_or("device_code eksik")?
            .to_string(),
        user_code: v
            .get("user_code")
            .and_then(|s| s.as_str())
            .ok_or("user_code eksik")?
            .to_string(),
        verification_uri: v
            .get("verification_uri")
            .and_then(|s| s.as_str())
            .unwrap_or("https://github.com/login/device")
            .to_string(),
        expires_in: v.get("expires_in").and_then(|n| n.as_u64()).unwrap_or(900),
        interval: v.get("interval").and_then(|n| n.as_u64()).unwrap_or(5),
    })
}

#[tauri::command]
pub async fn github_device_flow_poll(device_code: String) -> Result<DeviceFlowPollResult, String> {
    let client = build_http_client()?;
    let cid = github_client_id();
    let res = client
        .post("https://github.com/login/device/oauth/access_token")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "client_id": cid,
            "device_code": device_code,
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("GitHub OAuth HTTP {}", res.status()));
    }

    let v = res
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;

    if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
        return match err {
            "authorization_pending" => Ok(DeviceFlowPollResult {
                status: "pending".into(),
                interval: None,
                login: None,
            }),
            "slow_down" => Ok(DeviceFlowPollResult {
                status: "slow_down".into(),
                interval: v.get("interval").and_then(|n| n.as_u64()),
                login: None,
            }),
            "expired_token" => Err("Doğrulama kodunun süresi doldu. Tekrar dene.".into()),
            "access_denied" => Err("GitHub yetkilendirmesi iptal edildi.".into()),
            other => Err(v
                .get("error_description")
                .and_then(|d| d.as_str())
                .unwrap_or(other)
                .to_string()),
        };
    }

    let access_token = v
        .get("access_token")
        .and_then(|s| s.as_str())
        .ok_or("access_token alınamadı")?
        .to_string();

    let user_res = client
        .get("https://api.github.com/user")
        .bearer_auth(&access_token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let login = if user_res.status().is_success() {
        user_res
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|u| u.get("login").and_then(|l| l.as_str()).map(|s| s.to_string()))
            .unwrap_or_else(|| "github-user".into())
    } else {
        "github-user".into()
    };

    let existing = load_auth_state();
    let state = SyncAuthState {
        access_token,
        github_login: login.clone(),
        gist_id: None,
        etag: None,
        device_id: existing
            .as_ref()
            .map(|e| e.device_id.clone())
            .unwrap_or_else(generate_device_id),
        device_name: resolve_device_name(),
        sync_key: existing.and_then(|e| e.sync_key),
    };
    save_auth_state(&state)?;

    Ok(DeviceFlowPollResult {
        status: "authorized".into(),
        interval: None,
        login: Some(login),
    })
}

#[tauri::command]
pub fn github_sync_status() -> SyncStatusInfo {
    match load_auth_state() {
        Some(s) => SyncStatusInfo {
            connected: true,
            login: s.github_login,
            gist_id: s.gist_id,
            device_id: s.device_id,
            device_name: s.device_name,
            has_sync_key: s.sync_key.as_ref().is_some_and(|k| !k.trim().is_empty()),
        },
        None => SyncStatusInfo {
            connected: false,
            login: String::new(),
            gist_id: None,
            device_id: generate_device_id(),
            device_name: resolve_device_name(),
            has_sync_key: false,
        },
    }
}

#[tauri::command]
pub fn github_get_sync_key() -> Result<Option<String>, String> {
    Ok(load_auth_state().and_then(|s| s.sync_key).filter(|k| !k.trim().is_empty()))
}

#[tauri::command]
pub fn github_set_sync_key(key: String) -> Result<(), String> {
    let trimmed = key.trim().to_string();
    if trimmed.len() < 8 {
        return Err("Sync anahtarı en az 8 karakter olmalıdır.".into());
    }
    let mut state = load_auth_state().ok_or("GitHub hesabı bağlı değil.")?;
    state.sync_key = Some(trimmed);
    save_auth_state(&state)
}

#[tauri::command]
pub fn github_sync_disconnect() -> Result<(), String> {
    let path = sync_auth_path();
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn github_sync_pull() -> Result<SyncPullResult, String> {
    let mut state = load_auth_state().ok_or("GitHub hesabı bağlı değil.")?;
    let client = build_http_client()?;

    if state.gist_id.is_none() {
        state.gist_id = find_sync_gist(&client, &state.access_token).await?;
        if state.gist_id.is_none() {
            return Ok(SyncPullResult {
                changed: false,
                payload_json: None,
                gist_id: None,
            });
        }
        save_auth_state(&state)?;
    }

    let gist_id = state.gist_id.clone().unwrap_or_default();
    let mut req = client
        .get(format!("https://api.github.com/gists/{}", gist_id))
        .bearer_auth(&state.access_token)
        .header("Accept", "application/vnd.github+json");

    if let Some(ref etag) = state.etag {
        req = req.header("If-None-Match", etag);
    }

    let res = req.send().await.map_err(|e| e.to_string())?;

    if res.status() == reqwest::StatusCode::NOT_MODIFIED {
        return Ok(SyncPullResult {
            changed: false,
            payload_json: None,
            gist_id: Some(gist_id),
        });
    }

    if res.status() == reqwest::StatusCode::NOT_FOUND {
        state.gist_id = None;
        state.etag = None;
        save_auth_state(&state)?;
        return Ok(SyncPullResult {
            changed: false,
            payload_json: None,
            gist_id: None,
        });
    }

    if !res.status().is_success() {
        return Err(format!("GitHub API HTTP {}", res.status()));
    }

    let new_etag = res
        .headers()
        .get("etag")
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string());

    let gist = res
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;

    let file_obj = gist.get("files").and_then(|f| f.get(SYNC_GIST_FILENAME));
    let content = match file_obj {
        Some(f) => {
            let truncated = f.get("truncated").and_then(|b| b.as_bool()).unwrap_or(false);
            if truncated {
                if let Some(raw_url) = f.get("raw_url").and_then(|u| u.as_str()) {
                    let raw_res = client
                        .get(raw_url)
                        .bearer_auth(&state.access_token)
                        .send()
                        .await
                        .map_err(|e| e.to_string())?;
                    if !raw_res.status().is_success() {
                        return Err(format!("GitHub API HTTP {}", raw_res.status()));
                    }
                    Some(raw_res.text().await.map_err(|e| e.to_string())?)
                } else {
                    f.get("content").and_then(|c| c.as_str()).map(|s| s.to_string())
                }
            } else {
                f.get("content").and_then(|c| c.as_str()).map(|s| s.to_string())
            }
        }
        None => None,
    };

    state.etag = new_etag;
    save_auth_state(&state)?;

    Ok(SyncPullResult {
        changed: content.is_some(),
        payload_json: content,
        gist_id: Some(gist_id),
    })
}

#[tauri::command]
pub async fn github_sync_push(payload_json: String) -> Result<SyncPushResult, String> {
    let mut state = load_auth_state().ok_or("GitHub hesabı bağlı değil.")?;
    let client = build_http_client()?;

    if state.gist_id.is_none() {
        state.gist_id = find_sync_gist(&client, &state.access_token).await?;
    }

    let body = serde_json::json!({
        "description": SYNC_GIST_DESCRIPTION,
        "public": false,
        "files": {
            SYNC_GIST_FILENAME: {
                "content": payload_json
            }
        }
    });

    let res = match state.gist_id {
        Some(ref id) => {
            client
                .patch(format!("https://api.github.com/gists/{}", id))
                .bearer_auth(&state.access_token)
                .header("Accept", "application/vnd.github+json")
                .json(&body)
                .send()
                .await
                .map_err(|e| e.to_string())?
        }
        None => {
            client
                .post("https://api.github.com/gists")
                .bearer_auth(&state.access_token)
                .header("Accept", "application/vnd.github+json")
                .json(&body)
                .send()
                .await
                .map_err(|e| e.to_string())?
        }
    };

    if !res.status().is_success() {
        return Err(format!("GitHub API HTTP {}", res.status()));
    }

    let new_etag = res
        .headers()
        .get("etag")
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string());

    let gist = res
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;

    let gist_id = gist
        .get("id")
        .and_then(|i| i.as_str())
        .ok_or("Gist ID alınamadı")?
        .to_string();

    state.gist_id = Some(gist_id.clone());
    if new_etag.is_some() {
        state.etag = new_etag;
    }
    save_auth_state(&state)?;

    Ok(SyncPushResult { gist_id })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_gist_by_description_or_filename() {
        let gists = vec![
            serde_json::json!({
                "id": "other",
                "description": "random",
                "files": { "notes.txt": {} }
            }),
            serde_json::json!({
                "id": "target-1",
                "description": SYNC_GIST_DESCRIPTION,
                "files": {}
            }),
        ];
        assert_eq!(find_matching_gist_id(&gists).as_deref(), Some("target-1"));

        let by_file = vec![serde_json::json!({
            "id": "target-2",
            "description": "renamed",
            "files": { "ydevdesk-sync.json": {} }
        })];
        assert_eq!(find_matching_gist_id(&by_file).as_deref(), Some("target-2"));
    }

    #[test]
    fn device_name_is_non_empty() {
        assert!(!resolve_device_name().trim().is_empty());
    }
}
