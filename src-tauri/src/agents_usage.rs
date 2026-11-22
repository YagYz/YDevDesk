use std::collections::HashMap;
use std::io::BufRead;
use std::sync::{Mutex, OnceLock};
use serde::{Deserialize, Serialize};
use crate::agents_sessions::{mtime_ago_secs, walk_jsonl_depth};
use crate::platform;

#[derive(Serialize, Deserialize, Clone)]
pub struct AgentUsageTotals {
    pub agent: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_tokens: u64,
    pub cost_usd: f64,
    pub estimated: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DailyUsagePoint {
    pub date: String,
    pub agy_tokens: u64,
    pub claude_tokens: u64,
    pub codex_tokens: u64,
    pub agy_cost: f64,
    pub claude_cost: f64,
    pub codex_cost: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct UsageWindowSummary {
    pub days: u32,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cache_tokens: u64,
    pub total_cost_usd: f64,
    pub by_agent: Vec<AgentUsageTotals>,
    pub daily: Vec<DailyUsagePoint>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct UsageWindows {
    pub d1: UsageWindowSummary,
    pub d7: UsageWindowSummary,
    pub d30: UsageWindowSummary,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct UsageAnalytics {
    pub windows: UsageWindows,
    pub agy_quota_configured: bool,
    pub codex_quota_5h_remaining: Option<f64>,
    pub codex_quota_weekly_remaining: Option<f64>,
}

static USAGE_ANALYTICS_CACHE: OnceLock<Mutex<Option<(std::time::Instant, UsageAnalytics)>>> =
    OnceLock::new();



fn days_to_ymd(days_since_epoch: i64) -> (i32, u32, u32) {
    let z = days_since_epoch + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = (y + if m <= 2 { 1 } else { 0 }) as i32;
    (year, m as u32, d as u32)
}

fn system_time_to_ymd(t: std::time::SystemTime) -> String {
    let secs = t
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (y, m, d) = days_to_ymd(secs.div_euclid(86400));
    format!("{:04}-{:02}-{:02}", y, m, d)
}

fn extract_ymd_prefix(s: &str) -> Option<&str> {
    let b = s.as_bytes();
    if b.len() >= 10
        && s.is_char_boundary(10)
        && b[4] == b'-'
        && b[7] == b'-'
        && b[0..4].iter().all(|c| c.is_ascii_digit())
    {
        return s.get(..10);
    }
    None
}

fn agy_step_token_counts(v: &serde_json::Value) -> (u64, u64) {
    let kind = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
    match kind {
        "USER_INPUT" | "SYSTEM_MESSAGE" | "GENERIC" => {
            let content_chars = v
                .get("content")
                .and_then(|c| c.as_str())
                .map(|s| s.chars().count())
                .unwrap_or(0);
            let tool_chars = match v.get("tool_calls") {
                Some(serde_json::Value::String(s)) => s.chars().count(),
                Some(other) if !other.is_null() => other.to_string().chars().count(),
                _ => 0,
            };
            (((content_chars + tool_chars) as u64) / 4, 0)
        }
        "PLANNER_RESPONSE" => {
            let content_chars = v
                .get("content")
                .and_then(|c| c.as_str())
                .map(|s| s.chars().count())
                .unwrap_or(0);
            let thinking_chars = v
                .get("thinking")
                .and_then(|c| c.as_str())
                .map(|s| s.chars().count())
                .unwrap_or(0);
            let tool_chars = match v.get("tool_calls") {
                Some(serde_json::Value::String(s)) => s.chars().count(),
                Some(other) if !other.is_null() => other.to_string().chars().count(),
                _ => 0,
            };
            let total = content_chars + thinking_chars + tool_chars;
            (0, (total as u64) / 4)
        }
        _ => (0, 0),
    }
}

pub(crate) fn estimate_agy_transcript_tokens(path: &std::path::Path) -> (u64, u64) {
    // Sistem promptu ve araç şemaları oturum başına ~8k token başlangıç girdisi
    let mut total_inp = 8_000u64;
    let mut total_out = 0u64;
    if let Ok(file) = std::fs::File::open(path) {
        let reader = std::io::BufReader::new(file);
        for line in reader.lines().map_while(Result::ok) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                let (i, o) = agy_step_token_counts(&v);
                total_inp += i;
                total_out += o;
            }
        }
    }
    (total_inp, total_out)
}

#[derive(Default, Clone)]
struct ProviderDayStats {
    input_tokens: u64,
    output_tokens: u64,
    cache_tokens: u64,
    cost_usd: f64,
}

// Codex tahmini fiyat ($/1M): işlenmemiş girdi 1.50, önbellekli girdi 0.375, çıktı 6.00
pub(crate) fn codex_cost_usd(uncached_input: u64, cached_input: u64, output: u64) -> f64 {
    (uncached_input as f64 / 1_000_000.0) * 1.50
        + (cached_input as f64 / 1_000_000.0) * 0.375
        + (output as f64 / 1_000_000.0) * 6.00
}

pub(crate) fn claude_pricing_per_1m(model: &str) -> (f64, f64, f64, f64) {
    let lower = model.to_lowercase();
    if lower.contains("opus") {
        (15.0, 75.0, 15.0 * 1.25, 15.0 * 0.1)
    } else if lower.contains("haiku") {
        (0.8, 4.0, 0.8 * 1.25, 0.8 * 0.1)
    } else {
        (3.0, 15.0, 3.0 * 1.25, 3.0 * 0.1)
    }
}

fn collect_claude_jsonl_files(projects_dir: &std::path::Path, now: std::time::SystemTime) -> Vec<std::path::PathBuf> {
    let max_age = 31 * 86400;
    let mut out = Vec::new();
    let Ok(proj_entries) = std::fs::read_dir(projects_dir) else {
        return out;
    };
    for proj in proj_entries.flatten() {
        let p_path = proj.path();
        if !p_path.is_dir() {
            continue;
        }
        let Ok(sess_entries) = std::fs::read_dir(&p_path) else {
            continue;
        };
        for s_entry in sess_entries.flatten() {
            let f_path = s_entry.path();
            if f_path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                if mtime_ago_secs(&f_path, now).is_some_and(|d| d <= max_age) {
                    out.push(f_path);
                }
            } else if f_path.is_dir() {
                let sub_dir = f_path.join("subagents");
                if let Ok(sub_entries) = std::fs::read_dir(&sub_dir) {
                    for sub_entry in sub_entries.flatten() {
                        let sub_path = sub_entry.path();
                        if sub_path.extension().and_then(|e| e.to_str()) == Some("jsonl")
                            && mtime_ago_secs(&sub_path, now).is_some_and(|d| d <= max_age)
                        {
                            out.push(sub_path);
                        }
                    }
                }
            }
        }
    }
    out
}

fn build_usage_window(
    days: u32,
    date_keys: &[String],
    agy_by_day: &HashMap<String, ProviderDayStats>,
    claude_by_day: &HashMap<String, ProviderDayStats>,
    codex_by_day: &HashMap<String, ProviderDayStats>,
) -> UsageWindowSummary {
    let start_idx = date_keys.len().saturating_sub(days as usize);
    let window_dates = &date_keys[start_idx..];

    let mut agy_tot = ProviderDayStats::default();
    let mut claude_tot = ProviderDayStats::default();
    let mut codex_tot = ProviderDayStats::default();
    let mut daily = Vec::with_capacity(window_dates.len());

    let add_stats = |acc: &mut ProviderDayStats, s: &ProviderDayStats| {
        acc.input_tokens += s.input_tokens;
        acc.output_tokens += s.output_tokens;
        acc.cache_tokens += s.cache_tokens;
        acc.cost_usd += s.cost_usd;
    };

    for date in window_dates {
        let a = agy_by_day.get(date).cloned().unwrap_or_default();
        let cl = claude_by_day.get(date).cloned().unwrap_or_default();
        let cx = codex_by_day.get(date).cloned().unwrap_or_default();

        add_stats(&mut agy_tot, &a);
        add_stats(&mut claude_tot, &cl);
        add_stats(&mut codex_tot, &cx);

        daily.push(DailyUsagePoint {
            date: date.clone(),
            agy_tokens: a.input_tokens + a.output_tokens,
            claude_tokens: cl.input_tokens + cl.output_tokens + cl.cache_tokens,
            codex_tokens: cx.input_tokens + cx.output_tokens + cx.cache_tokens,
            agy_cost: (a.cost_usd * 10000.0).round() / 10000.0,
            claude_cost: (cl.cost_usd * 10000.0).round() / 10000.0,
            codex_cost: (cx.cost_usd * 10000.0).round() / 10000.0,
        });
    }

    let round_cost = |c: f64| (c * 10000.0).round() / 10000.0;
    let total_input_tokens = agy_tot.input_tokens + claude_tot.input_tokens + codex_tot.input_tokens;
    let total_output_tokens = agy_tot.output_tokens + claude_tot.output_tokens + codex_tot.output_tokens;
    let total_cache_tokens = agy_tot.cache_tokens + claude_tot.cache_tokens + codex_tot.cache_tokens;
    let total_cost_usd = round_cost(agy_tot.cost_usd + claude_tot.cost_usd + codex_tot.cost_usd);

    let by_agent = vec![
        AgentUsageTotals {
            agent: "agy".to_string(),
            input_tokens: agy_tot.input_tokens,
            output_tokens: agy_tot.output_tokens,
            cache_tokens: agy_tot.cache_tokens,
            cost_usd: round_cost(agy_tot.cost_usd),
            estimated: true,
        },
        AgentUsageTotals {
            agent: "claude".to_string(),
            input_tokens: claude_tot.input_tokens,
            output_tokens: claude_tot.output_tokens,
            cache_tokens: claude_tot.cache_tokens,
            cost_usd: round_cost(claude_tot.cost_usd),
            estimated: false,
        },
        AgentUsageTotals {
            agent: "codex".to_string(),
            input_tokens: codex_tot.input_tokens,
            output_tokens: codex_tot.output_tokens,
            cache_tokens: codex_tot.cache_tokens,
            cost_usd: round_cost(codex_tot.cost_usd),
            estimated: false,
        },
    ];

    UsageWindowSummary {
        days,
        total_input_tokens,
        total_output_tokens,
        total_cache_tokens,
        total_cost_usd,
        by_agent,
        daily,
    }
}

fn compute_usage_analytics() -> UsageAnalytics {
    let home = dirs::home_dir().unwrap_or_default();
    let now = std::time::SystemTime::now();
    let now_days = now
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| (d.as_secs() as i64).div_euclid(86400))
        .unwrap_or(0);

    let mut date_keys = Vec::with_capacity(30);
    for offset in (0..30).rev() {
        let (y, m, d) = days_to_ymd(now_days - offset as i64);
        date_keys.push(format!("{:04}-{:02}-{:02}", y, m, d));
    }
    let min_date = date_keys.first().cloned().unwrap_or_default();

    let mut claude_by_day: HashMap<String, ProviderDayStats> = HashMap::new();
    let mut codex_by_day: HashMap<String, ProviderDayStats> = HashMap::new();
    let mut agy_by_day: HashMap<String, ProviderDayStats> = HashMap::new();

    // 1. Claude Code
    for f_path in collect_claude_jsonl_files(&home.join(".claude").join("projects"), now) {
        let fallback_date = std::fs::metadata(&f_path)
            .and_then(|m| m.modified())
            .map(system_time_to_ymd)
            .unwrap_or_default();
        if let Ok(file) = std::fs::File::open(&f_path) {
            let reader = std::io::BufReader::new(file);
            for line in reader.lines().map_while(Result::ok) {
                let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                    continue;
                };
                let Some(msg) = v.get("message") else {
                    continue;
                };
                let Some(usage) = msg.get("usage") else {
                    continue;
                };
                let date = v
                    .get("timestamp")
                    .and_then(|t| t.as_str())
                    .and_then(extract_ymd_prefix)
                    .unwrap_or(&fallback_date);
                if date < min_date.as_str() {
                    continue;
                }
                let inp = usage.get("input_tokens").and_then(|n| n.as_u64()).unwrap_or(0);
                let cache_create = usage
                    .get("cache_creation_input_tokens")
                    .and_then(|n| n.as_u64())
                    .unwrap_or(0);
                let cache_read = usage
                    .get("cache_read_input_tokens")
                    .and_then(|n| n.as_u64())
                    .unwrap_or(0);
                let out = usage.get("output_tokens").and_then(|n| n.as_u64()).unwrap_or(0);
                if inp == 0 && cache_create == 0 && cache_read == 0 && out == 0 {
                    continue;
                }
                let model = msg.get("model").and_then(|m| m.as_str()).unwrap_or("sonnet");
                let (in_p, out_p, cc_p, cr_p) = claude_pricing_per_1m(model);
                let cost = (inp as f64 / 1_000_000.0) * in_p
                    + (out as f64 / 1_000_000.0) * out_p
                    + (cache_create as f64 / 1_000_000.0) * cc_p
                    + (cache_read as f64 / 1_000_000.0) * cr_p;

                let entry = claude_by_day.entry(date.to_string()).or_default();
                entry.input_tokens += inp + cache_create + cache_read;
                entry.output_tokens += out;
                entry.cache_tokens += cache_create + cache_read;
                entry.cost_usd += cost;
            }
        }
    }

    // 2. OpenAI Codex
    let mut codex_files = Vec::new();
    walk_jsonl_depth(&home.join(".codex").join("sessions"), 4, now, &mut codex_files);
    codex_files.retain(|(diff, _)| *diff <= 31 * 86400);
    codex_files.sort_by_key(|(diff, _)| *diff);

    let mut codex_quota_5h_remaining: Option<f64> = None;
    let mut codex_quota_weekly_remaining: Option<f64> = None;

    for (_, f_path) in codex_files {
        let fallback_date = std::fs::metadata(&f_path)
            .and_then(|m| m.modified())
            .map(system_time_to_ymd)
            .unwrap_or_default();
        let mut session_date = fallback_date.clone();
        let mut max_inp = 0u64;
        let mut max_cached = 0u64;
        let mut max_out = 0u64;
        let mut file_q5h: Option<f64> = None;
        let mut file_qwk: Option<f64> = None;

        if let Ok(file) = std::fs::File::open(&f_path) {
            let reader = std::io::BufReader::new(file);
            for line in reader.lines().map_while(Result::ok) {
                let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                    continue;
                };
                if let Some(d) = v
                    .get("timestamp")
                    .and_then(|t| t.as_str())
                    .and_then(extract_ymd_prefix)
                {
                    session_date = d.to_string();
                }

                let top_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
                let payload = if top_type == "event_msg" {
                    v.get("payload")
                } else {
                    Some(&v)
                };
                let Some(p) = payload else {
                    continue;
                };
                if p.get("type").and_then(|t| t.as_str()) != Some("token_count") {
                    continue;
                }

                let usage = p
                    .get("info")
                    .and_then(|i| i.get("total_token_usage"))
                    .or_else(|| p.get("total_token_usage"));
                if let Some(u) = usage {
                    let inp = u.get("input_tokens").and_then(|n| n.as_u64()).unwrap_or(0);
                    let cached = u
                        .get("cached_input_tokens")
                        .and_then(|n| n.as_u64())
                        .unwrap_or(0);
                    let out = u.get("output_tokens").and_then(|n| n.as_u64()).unwrap_or(0);
                    max_inp = max_inp.max(inp);
                    max_cached = max_cached.max(cached);
                    max_out = max_out.max(out);
                }

                if let Some(rl) = p.get("rate_limits") {
                    if let Some(used) = rl
                        .get("primary")
                        .and_then(|x| x.get("used_percent"))
                        .and_then(|n| n.as_f64())
                    {
                        file_q5h = Some((100.0 - used).clamp(0.0, 100.0));
                    }
                    if let Some(used) = rl
                        .get("secondary")
                        .and_then(|x| x.get("used_percent"))
                        .and_then(|n| n.as_f64())
                    {
                        file_qwk = Some((100.0 - used).clamp(0.0, 100.0));
                    }
                }
            }
        }

        if codex_quota_5h_remaining.is_none() {
            codex_quota_5h_remaining = file_q5h;
        }
        if codex_quota_weekly_remaining.is_none() {
            codex_quota_weekly_remaining = file_qwk;
        }

        if session_date >= min_date && (max_inp > 0 || max_out > 0 || max_cached > 0) {
            let uncached_inp = max_inp.saturating_sub(max_cached);
            let cost = codex_cost_usd(uncached_inp, max_cached, max_out);
            let entry = codex_by_day.entry(session_date).or_default();
            entry.input_tokens += uncached_inp;
            entry.output_tokens += max_out;
            entry.cache_tokens += max_cached;
            entry.cost_usd += cost;
        }
    }

    // 3. AGY
    let agy_dir = home.join(".gemini").join("antigravity-cli");
    if let Ok(brain_entries) = std::fs::read_dir(agy_dir.join("brain")) {
        for entry in brain_entries.flatten() {
            let t_path = entry
                .path()
                .join(".system_generated")
                .join("logs")
                .join("transcript.jsonl");
            if !t_path.is_file() {
                continue;
            }
            if !mtime_ago_secs(&t_path, now).is_some_and(|d| d <= 31 * 86400) {
                continue;
            }
            let fallback_date = std::fs::metadata(&t_path)
                .and_then(|m| m.modified())
                .map(system_time_to_ymd)
                .unwrap_or_default();
            if let Ok(file) = std::fs::File::open(&t_path) {
                let reader = std::io::BufReader::new(file);
                let mut added_sys_prompt = false;
                for line in reader.lines().map_while(Result::ok) {
                    let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                        continue;
                    };
                    let (mut inp, out) = agy_step_token_counts(&v);
                    if inp == 0 && out == 0 {
                        continue;
                    }
                    let date = v
                        .get("created_at")
                        .and_then(|t| t.as_str())
                        .and_then(extract_ymd_prefix)
                        .unwrap_or(&fallback_date);
                    if date < min_date.as_str() {
                        continue;
                    }
                    if !added_sys_prompt {
                        inp += 8_000;
                        added_sys_prompt = true;
                    }
                    // Blended Gemini Flash/Pro estimated rate ($0.50 / 1M input, $2.00 / 1M output)
                    let cost = (inp as f64 / 1_000_000.0) * 0.50
                        + (out as f64 / 1_000_000.0) * 2.00;
                    let day_entry = agy_by_day.entry(date.to_string()).or_default();
                    day_entry.input_tokens += inp;
                    day_entry.output_tokens += out;
                    day_entry.cost_usd += cost;
                }
            }
        }
    }

    // Bugünkü canlı AGY statusline verisi (sistem promptu + bağlam tekrarları dahil)
    // ham transcript tahmininden büyükse bugünün toplamını en az canlı oturum kadar tut.
    if let Some(today) = date_keys.last() {
        let status_candidates = [
            agy_dir.join("status.json"),
            agy_dir.join("cache").join("last_statusline.json"),
        ];
        let newest_status = status_candidates
            .iter()
            .filter_map(|p| {
                let mtime = std::fs::metadata(p).ok()?.modified().ok()?;
                Some((mtime, p))
            })
            .max_by_key(|(m, _)| *m);

        if let Some((mtime, spath)) = newest_status {
            if system_time_to_ymd(mtime) == *today {
                if let Ok(raw) = std::fs::read_to_string(spath) {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                        let cw = v.get("context_window");
                        let live_in = cw.and_then(|c| c.get("total_input_tokens")).and_then(|t| t.as_u64()).unwrap_or(0);
                        let live_out = cw.and_then(|c| c.get("total_output_tokens")).and_then(|t| t.as_u64()).unwrap_or(0);
                        if live_in > 0 || live_out > 0 {
                            let day_entry = agy_by_day.entry(today.clone()).or_default();
                            if live_in > day_entry.input_tokens {
                                day_entry.input_tokens = live_in;
                            }
                            if live_out > day_entry.output_tokens {
                                day_entry.output_tokens = live_out;
                            }
                            day_entry.cost_usd = (day_entry.input_tokens as f64 / 1_000_000.0) * 0.50
                                + (day_entry.output_tokens as f64 / 1_000_000.0) * 2.00;
                        }
                    }
                }
            }
        }
    }

    let settings_has_statusline = std::fs::read_to_string(agy_dir.join("settings.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .is_some_and(|v| v.get("statusLine").is_some_and(|sl| !sl.is_null()));

    let agy_quota_configured = settings_has_statusline
        || agy_dir.join("cache").join("last_statusline.json").exists()
        || agy_dir.join("status.json").exists();

    UsageAnalytics {
        windows: UsageWindows {
            d1: build_usage_window(1, &date_keys, &agy_by_day, &claude_by_day, &codex_by_day),
            d7: build_usage_window(7, &date_keys, &agy_by_day, &claude_by_day, &codex_by_day),
            d30: build_usage_window(30, &date_keys, &agy_by_day, &claude_by_day, &codex_by_day),
        },
        agy_quota_configured,
        codex_quota_5h_remaining,
        codex_quota_weekly_remaining,
    }
}

#[tauri::command]
pub fn get_usage_analytics() -> UsageAnalytics {
    let cache = USAGE_ANALYTICS_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = cache.lock() {
        if let Some((ts, ref data)) = *guard {
            if ts.elapsed().as_secs() < 45 {
                return data.clone();
            }
        }
    }

    let analytics = compute_usage_analytics();
    if let Ok(mut guard) = cache.lock() {
        *guard = Some((std::time::Instant::now(), analytics.clone()));
    }
    analytics
}

#[tauri::command]
pub fn enable_agy_quota_hook() -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "Home dizini bulunamadı".to_string())?;
    let agy_dir = home.join(".gemini").join("antigravity-cli");
    let settings_path = agy_dir.join("settings.json");

    let mut settings: serde_json::Value = if settings_path.exists() {
        let raw = std::fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        if raw.trim().is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_str(&raw).map_err(|e| e.to_string())?
        }
    } else {
        serde_json::json!({})
    };

    if settings.get("statusLine").is_some_and(|v| !v.is_null()) {
        return Ok("AGY statusLine zaten yapılandırılmış.".to_string());
    }

    let hook_cmd = platform::write_agy_statusline_hook(&home)?;

    let obj = settings
        .as_object_mut()
        .ok_or_else(|| "settings.json geçerli bir JSON nesnesi değil".to_string())?;
    obj.insert(
        "statusLine".to_string(),
        serde_json::json!({
            "type": "command",
            "command": hook_cmd
        }),
    );

    if let Some(parent) = settings_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let serialized = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&settings_path, serialized).map_err(|e| e.to_string())?;

    if let Some(cache) = USAGE_ANALYTICS_CACHE.get() {
        if let Ok(mut guard) = cache.lock() {
            *guard = None;
        }
    }

    Ok("AGY statusLine hook yapılandırıldı.".to_string())
}

