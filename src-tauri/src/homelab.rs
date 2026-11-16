// 6. Homelab İstekleri
#[tauri::command]
pub async fn fetch_homelab_notes(url: String, key: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("{}/api/v1/notes?limit=15", url.trim_end_matches('/')))
        .header("X-API-Key", key)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    let json = res.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
    Ok(json)
}

#[tauri::command]
pub async fn fetch_homelab_knowledge(url: String, key: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("{}/api/v1/knowledge?limit=15", url.trim_end_matches('/')))
        .header("X-API-Key", key)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    let json = res.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
    Ok(json)
}

#[tauri::command]
pub async fn fetch_homelab_tasks(url: String, key: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("{}/api/v1/tasks?limit=50", url.trim_end_matches('/')))
        .header("X-API-Key", key)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    res.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_homelab_task(url: String, key: String, title: String, priority: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "title": title,
        "description": "",
        "priority": priority,
        "due_date": serde_json::Value::Null
    });
    let res = client
        .post(format!("{}/api/v1/tasks", url.trim_end_matches('/')))
        .header("X-API-Key", key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    res.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn complete_homelab_task(url: String, key: String, id: i64) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({ "id": id, "status": "done" });
    let res = client
        .patch(format!("{}/api/v1/tasks", url.trim_end_matches('/')))
        .header("X-API-Key", key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    res.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_ynetmon_summary(url: String, key: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("{}/api/v1/integration/summary", url.trim_end_matches('/')))
        .header("X-API-Key", key)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    let json = res.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
    Ok(json)
}

// 7. Hızlı Görev ve Bilgi Ağı Kaydetme
#[tauri::command]
pub async fn create_homelab_note(url: String, key: String, content: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "content": content,
        "priority": "medium",
        "source": "ydevdesk"
    });

    let res = client
        .post(format!("{}/api/v1/notes", url.trim_end_matches('/')))
        .header("X-API-Key", key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    let json = res.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
    Ok(json)
}

#[tauri::command]
pub async fn create_homelab_knowledge(url: String, key: String, service_tag: String, title: String, summary: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "service_tag": service_tag,
        "title": title,
        "summary": summary
    });

    let res = client
        .post(format!("{}/api/v1/knowledge", url.trim_end_matches('/')))
        .header("X-API-Key", key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    let json = res.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
    Ok(json)
}

