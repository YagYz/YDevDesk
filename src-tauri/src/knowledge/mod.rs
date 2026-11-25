//! Bilgi Ağı: yerel SQLite deposu, isteğe bağlı YDevHub eşlemesi ve servis katmanı.
//! Hem Tauri uygulaması hem `--mcp` süreci aynı `service` katmanını çağırır.

use serde::Serialize;

pub mod store;
pub mod settings;
pub mod heartbeat;
pub mod hub;
pub mod service;
pub mod mcp;
pub mod commands;
pub mod agent_setup;

/// Yeni kayıt girdisi (henüz id/zaman yok).
#[derive(Clone, Debug)]
pub struct NewEntry {
    pub service: String,
    pub title: String,
    pub summary: String,
    pub tags: Vec<String>,
    pub device: String,
    pub agent: String,
}

/// Depodaki bir bilgi ağı kaydı.
#[derive(Serialize, Clone, Debug)]
pub struct Entry {
    pub id: i64,
    pub service: String,
    pub title: String,
    pub summary: String,
    pub tags: Vec<String>,
    pub device: String,
    pub agent: String,
    /// Unix saniye
    pub created_at: i64,
}
