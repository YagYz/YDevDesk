//! Ajan kurulumu: Bilgi Ağı kural bloğunu ve MCP kaydını Claude Code, Codex ve AGY'ye ekler/kaldırır.
//! Tüm işlevler `home` parametresi alır (testler geçici dizin kullanır, gerçek home'a dokunmaz).
//! Yalnızca işaretçili bloklar yazılır; kullanıcı içeriği bayt bayt korunur.
//!
//! Hedefler:
//! - Claude: kural `~/.claude/CLAUDE.md`; MCP `claude mcp add --scope user` (durum `~/.claude.json` okunarak).
//! - Codex: kural `~/.codex/AGENTS.md`; MCP `~/.codex/config.toml` içinde işaretçili TOML bloğu.
//! - AGY: kural `~/.gemini/config/GEMINI.md` (gerçek AGY ile doğrulandı); MCP `~/.gemini/config/mcp_config.json`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

const MCP_NAME: &str = "ydevdesk-knowledge";
const MD_START: &str = "<!-- ydevdesk:knowledge:start -->";
const MD_END: &str = "<!-- ydevdesk:knowledge:end -->";
const TOML_START: &str = "# >>> ydevdesk-knowledge (managed)";
const TOML_END: &str = "# <<< ydevdesk-knowledge";

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentId {
    Claude,
    Codex,
    Agy,
}

impl AgentId {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentId::Claude => "claude",
            AgentId::Codex => "codex",
            AgentId::Agy => "agy",
        }
    }
    pub fn parse(s: &str) -> Option<AgentId> {
        match s {
            "claude" => Some(AgentId::Claude),
            "codex" => Some(AgentId::Codex),
            "agy" => Some(AgentId::Agy),
            _ => None,
        }
    }
}

/// Kimlik dizilerini ayrıştırır: (geçerli ajanlar, tanınmayan kimlikler).
pub fn parse_ids(ids: &[String]) -> (Vec<AgentId>, Vec<String>) {
    let mut ok = Vec::new();
    let mut bad = Vec::new();
    for i in ids {
        match AgentId::parse(i) {
            Some(a) if !ok.contains(&a) => ok.push(a),
            Some(_) => {}
            None => bad.push(i.clone()),
        }
    }
    (ok, bad)
}

#[derive(Serialize, Clone, Debug)]
pub struct AgentSetupStatus {
    pub id: String,
    pub cli_found: bool,
    pub rules_path: String,
    pub rules_installed: bool,
    pub mcp_installed: bool,
    pub note: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct AgentPreview {
    pub id: String,
    pub rules_path: String,
    /// "add" | "update" | "none"
    pub rules_action: String,
    pub mcp_target: String,
    /// "add" | "update" | "none" | "error"
    pub mcp_action: String,
    pub mcp_snippet: String,
    pub error: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct AgentApplyResult {
    pub id: String,
    pub ok: bool,
    pub message: String,
}

// ---------------------------------------------------------------------------
// CLI soyutlaması (testte sahtesi kullanılır; gerçek `claude` çağrısı yapılmaz)
// ---------------------------------------------------------------------------

/// Ajan CLI'lerini bulan ve `claude mcp` çağıran katman.
pub trait Cli {
    fn found(&self, agent: AgentId) -> bool;
    fn claude_mcp_add(&self, bin: &str) -> Result<(), String>;
    fn claude_mcp_remove(&self) -> Result<(), String>;
}

struct RealCli;

impl RealCli {
    fn run_claude(&self, args: &[&str]) -> Result<(), String> {
        let path = crate::env_helpers::find_binary("claude").ok_or_else(|| "Claude CLI bulunamadı".to_string())?;
        let mut cmd = crate::platform::hidden_command(&path.to_string_lossy());
        cmd.args(args).env("PATH", crate::env_helpers::get_enhanced_path());
        crate::env_helpers::sanitize_std_cmd(&mut cmd);
        let out = cmd.output().map_err(|e| format!("claude çalıştırılamadı: {e}"))?;
        if out.status.success() {
            Ok(())
        } else {
            let mut msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
            if msg.is_empty() {
                msg = String::from_utf8_lossy(&out.stdout).trim().to_string();
            }
            Err(format!("claude {} başarısız: {}", args.join(" "), msg))
        }
    }
}

impl Cli for RealCli {
    fn found(&self, agent: AgentId) -> bool {
        use crate::env_helpers::find_binary;
        match agent {
            AgentId::Claude => find_binary("claude").is_some(),
            AgentId::Codex => find_binary("codex").is_some(),
            AgentId::Agy => find_binary("agy").is_some() || find_binary("antigravity").is_some(),
        }
    }
    fn claude_mcp_add(&self, bin: &str) -> Result<(), String> {
        self.run_claude(&["mcp", "add", "--scope", "user", MCP_NAME, "--", bin, "--mcp"])
    }
    fn claude_mcp_remove(&self) -> Result<(), String> {
        self.run_claude(&["mcp", "remove", "--scope", "user", MCP_NAME])
    }
}

// ---------------------------------------------------------------------------
// İşaretçili blok işlemleri (saf)
// ---------------------------------------------------------------------------

pub fn rules_block() -> &'static str {
    include_str!("agent_rules.md")
}

enum Marked {
    Absent,
    /// (başlangıç, bitiş-hariç) — bitiş işaretçisinin sonu dahil
    Present(usize, usize),
    Broken,
}

fn marked_state(text: &str, start: &str, end: &str) -> Marked {
    match (text.find(start), text.find(end)) {
        (None, None) => Marked::Absent,
        (Some(s), Some(_)) => match text[s..].find(end) {
            Some(e) => Marked::Present(s, s + e + end.len()),
            None => Marked::Broken,
        },
        _ => Marked::Broken,
    }
}

fn eol_of(text: &str) -> &'static str {
    if text.contains("\r\n") { "\r\n" } else { "\n" }
}

fn with_eol(block: &str, eol: &str) -> String {
    let b = block.trim_end_matches(['\r', '\n']).replace("\r\n", "\n");
    if eol == "\n" { b } else { b.replace('\n', eol) }
}

/// Bloğu işaretçiler arasında değiştirir ya da sona ekler (işaretçi çifti tamsa).
/// Ekleme düzeni: mevcut + boş satır + blok. Sonda yeni satır yoksa blok da yeni satırsız biter;
/// böylece `remove_marked` bunu tam geri alabilir.
fn apply_marked(existing: &str, start: &str, end: &str, block: &str) -> String {
    let eol = eol_of(existing);
    let blk = with_eol(block, eol);
    if let Marked::Present(s, e) = marked_state(existing, start, end) {
        return format!("{}{}{}", &existing[..s], blk, &existing[e..]);
    }
    if existing.is_empty() {
        return format!("{blk}{eol}");
    }
    if existing.ends_with('\n') {
        format!("{existing}{eol}{blk}{eol}")
    } else {
        format!("{existing}{eol}{eol}{blk}")
    }
}

/// `apply_marked`in eklediğini geri alır: blok, sonundaki satır sonu ve önündeki boş satır gider.
fn remove_marked(existing: &str, start: &str, end: &str) -> String {
    let (s, e) = match marked_state(existing, start, end) {
        Marked::Present(s, e) => (s, e),
        _ => return existing.to_string(),
    };
    let eol = eol_of(existing);
    let before = &existing[..s];
    let after = &existing[e..];
    if let Some(rest) = after.strip_prefix(eol) {
        // blok sonrası satır sonu da bizim eklediğimiz; önündeki bir boş satırı da al
        let b = before.strip_suffix(eol).filter(|_| !before.is_empty()).unwrap_or(before);
        format!("{b}{rest}")
    } else if after.is_empty() {
        // sonda yeni satırsız eklenmişti: önündeki iki satır sonu bizim
        let two = format!("{eol}{eol}");
        let b = before.strip_suffix(two.as_str()).unwrap_or(before);
        b.to_string()
    } else {
        format!("{before}{after}")
    }
}

pub fn apply_block(existing: &str, block: &str) -> String {
    apply_marked(existing, MD_START, MD_END, block)
}

pub fn remove_block(existing: &str) -> String {
    remove_marked(existing, MD_START, MD_END)
}

fn norm(s: &str) -> String {
    s.replace("\r\n", "\n").trim_end_matches('\n').to_string()
}

/// Metindeki işaretçili bloğun, istenen blokla aynı olup olmadığı: Some(true)=aynı, Some(false)=farklı, None=yok.
fn block_same(text: &str, start: &str, end: &str, want: &str) -> Option<bool> {
    match marked_state(text, start, end) {
        Marked::Present(s, e) => Some(norm(&text[s..e]) == norm(want)),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Dosya yardımcıları
// ---------------------------------------------------------------------------

/// Dosyayı UTF-8 metin olarak okur; yoksa Ok(None). UTF-8 değilse hata (dosyaya dokunulmaz).
fn read_text(path: &Path) -> Result<Option<String>, String> {
    match std::fs::read(path) {
        Ok(b) => String::from_utf8(b).map(Some).map_err(|_| format!("{} UTF-8 değil; dokunulmadı", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{} okunamadı: {e}", path.display())),
    }
}

/// Atomik yazma: ilk değişiklikte `<dosya>.ydevdesk.bak` yedeği, sonra tmp + rename.
fn write_safe(path: &Path, content: &str) -> Result<(), String> {
    // sembolik bağı bozmamak için gerçek hedefe yaz
    let target: PathBuf = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let fname = target.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_else(|| "dosya".into());
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{} oluşturulamadı: {e}", dir.display()))?;
    }
    let bak = target.with_file_name(format!("{fname}.ydevdesk.bak"));
    if target.exists() && !bak.exists() {
        std::fs::copy(&target, &bak).map_err(|e| format!("yedek alınamadı ({}): {e}", bak.display()))?;
    }
    let tmp = target.with_file_name(format!("{fname}.ydevdesk.tmp"));
    std::fs::write(&tmp, content).map_err(|e| format!("{} yazılamadı: {e}", tmp.display()))?;
    if let Ok(meta) = std::fs::metadata(&target) {
        let _ = std::fs::set_permissions(&tmp, meta.permissions());
    }
    std::fs::rename(&tmp, &target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("{} değiştirilemedi: {e}", target.display())
    })
}

/// Kaldırma sonrası içerik boşsa ve yedek yoksa (dosyayı biz yaratmışız) dosyayı siler; yoksa yazar.
fn write_or_delete_if_created(path: &Path, content: &str) -> Result<(), String> {
    if content.is_empty() {
        let fname = path.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
        let bak = path.with_file_name(format!("{fname}.ydevdesk.bak"));
        if !bak.exists() {
            return std::fs::remove_file(path).map_err(|e| format!("{} silinemedi: {e}", path.display()));
        }
    }
    write_safe(path, content)
}

fn p(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn rules_path(home: &Path, a: AgentId) -> PathBuf {
    match a {
        AgentId::Claude => home.join(".claude").join("CLAUDE.md"),
        AgentId::Codex => home.join(".codex").join("AGENTS.md"),
        AgentId::Agy => home.join(".gemini").join("config").join("GEMINI.md"),
    }
}

fn codex_config(home: &Path) -> PathBuf {
    home.join(".codex").join("config.toml")
}
fn agy_mcp_path(home: &Path) -> PathBuf {
    home.join(".gemini").join("config").join("mcp_config.json")
}
fn claude_json(home: &Path) -> PathBuf {
    home.join(".claude.json")
}

/// Kural dosyası durumu: (kurulu, eylem) ya da hata (işaretçi bozuk / okunamadı).
fn rules_state(path: &Path) -> Result<(bool, &'static str), String> {
    let text = read_text(path)?.unwrap_or_default();
    match marked_state(&text, MD_START, MD_END) {
        Marked::Absent => Ok((false, "add")),
        Marked::Broken => Err(format!("{}: işaretçi çifti eksik/bozuk; elle düzeltin", path.display())),
        Marked::Present(..) => {
            let same = block_same(&text, MD_START, MD_END, rules_block()).unwrap_or(false);
            Ok((true, if same { "none" } else { "update" }))
        }
    }
}

fn apply_rules(path: &Path) -> Result<String, String> {
    let existing = read_text(path)?.unwrap_or_default();
    if let Marked::Broken = marked_state(&existing, MD_START, MD_END) {
        return Err(format!("{}: işaretçi çifti eksik/bozuk; dokunulmadı", path.display()));
    }
    if block_same(&existing, MD_START, MD_END, rules_block()) == Some(true) {
        return Ok("kurallar zaten güncel".into());
    }
    write_safe(path, &apply_block(&existing, rules_block()))?;
    Ok(format!("kurallar yazıldı: {}", path.display()))
}

fn remove_rules(path: &Path) -> Result<String, String> {
    let Some(existing) = read_text(path)? else { return Ok("kural dosyası yok".into()) };
    match marked_state(&existing, MD_START, MD_END) {
        Marked::Absent => Ok("kural bloğu yok".into()),
        Marked::Broken => Err(format!("{}: işaretçi çifti eksik/bozuk; dokunulmadı", path.display())),
        Marked::Present(..) => {
            write_or_delete_if_created(path, &remove_block(&existing))?;
            Ok(format!("kural bloğu kaldırıldı: {}", path.display()))
        }
    }
}

// ---------------------------------------------------------------------------
// MCP durumları
// ---------------------------------------------------------------------------

#[derive(PartialEq, Clone, Copy, Debug)]
enum Mcp {
    Absent,
    Same,
    Different,
}

fn desired_entry(bin: &str) -> Value {
    json!({ "command": bin, "args": ["--mcp"] })
}

fn entry_matches(entry: &Value, bin: &str) -> bool {
    entry.get("command").and_then(|c| c.as_str()) == Some(bin)
        && entry.get("args") == Some(&json!(["--mcp"]))
}

/// JSON nesnesini okur: yok → None, boş → boş nesne, bozuk/nesne değil → Err.
fn read_json_obj(path: &Path) -> Result<Option<Map<String, Value>>, String> {
    let Some(text) = read_text(path)? else { return Ok(None) };
    if text.trim().is_empty() {
        return Ok(Some(Map::new()));
    }
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(m)) => Ok(Some(m)),
        Ok(_) => Err(format!("{}: kök JSON nesnesi değil", path.display())),
        Err(e) => Err(format!("{} ayrıştırılamadı: {e}", path.display())),
    }
}

fn servers_of<'a>(root: &'a Map<String, Value>, path: &Path) -> Result<Option<&'a Map<String, Value>>, String> {
    match root.get("mcpServers") {
        None => Ok(None),
        Some(Value::Object(m)) => Ok(Some(m)),
        Some(_) => Err(format!("{}: mcpServers nesne değil", path.display())),
    }
}

fn json_mcp_state(path: &Path, bin: &str) -> Result<Mcp, String> {
    let Some(root) = read_json_obj(path)? else { return Ok(Mcp::Absent) };
    Ok(match servers_of(&root, path)?.and_then(|s| s.get(MCP_NAME)) {
        None => Mcp::Absent,
        Some(e) if entry_matches(e, bin) => Mcp::Same,
        Some(_) => Mcp::Different,
    })
}

/// Codex `config.toml` durumu: (durum, elle tanımlı mı).
fn codex_state(path: &Path, bin: &str) -> Result<(Mcp, bool), String> {
    let text = read_text(path)?.unwrap_or_default();
    let parsed: toml::Table = toml::from_str(&text).map_err(|e| format!("{} ayrıştırılamadı: {e}", path.display()))?;
    match marked_state(&text, TOML_START, TOML_END) {
        Marked::Broken => Err(format!("{}: işaretçi çifti eksik/bozuk; elle düzeltin", path.display())),
        Marked::Present(..) => {
            let same = block_same(&text, TOML_START, TOML_END, &codex_block(bin)) == Some(true);
            Ok((if same { Mcp::Same } else { Mcp::Different }, false))
        }
        Marked::Absent => {
            let manual = parsed
                .get("mcp_servers")
                .and_then(|v| v.as_table())
                .map(|t| t.contains_key(MCP_NAME))
                .unwrap_or(false);
            Ok((if manual { Mcp::Same } else { Mcp::Absent }, manual))
        }
    }
}

/// TOML dizgesi: tercihen literal (tek tırnak, kaçışsız); `'` veya satır sonu varsa kaçışlı temel dizge.
fn toml_str(s: &str) -> String {
    if !s.contains('\'') && !s.contains('\n') && !s.contains('\r') {
        format!("'{s}'")
    } else {
        let esc = s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "\\r");
        format!("\"{esc}\"")
    }
}

fn codex_block(bin: &str) -> String {
    format!(
        "{TOML_START}\n[mcp_servers.{MCP_NAME}]\ncommand = {}\nargs = [\"--mcp\"]\n{TOML_END}",
        toml_str(bin)
    )
}

fn sh_quote(s: &str) -> String {
    let safe = !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "/._-+:@".contains(c));
    if safe {
        s.to_string()
    } else if cfg!(windows) {
        format!("\"{}\"", s.replace('"', "\\\""))
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}

fn claude_add_cmd(bin: &str) -> String {
    format!("claude mcp add --scope user {MCP_NAME} -- {} --mcp", sh_quote(bin))
}

fn claude_remove_cmd() -> String {
    format!("claude mcp remove --scope user {MCP_NAME}")
}

// ---------------------------------------------------------------------------
// Durum / önizleme / uygula / kaldır
// ---------------------------------------------------------------------------

const ALL: [AgentId; 3] = [AgentId::Claude, AgentId::Codex, AgentId::Agy];

fn mcp_installed_of(home: &Path, a: AgentId, bin: &str) -> Result<bool, String> {
    Ok(match a {
        AgentId::Claude => json_mcp_state(&claude_json(home), bin)? != Mcp::Absent,
        AgentId::Codex => codex_state(&codex_config(home), bin)?.0 != Mcp::Absent,
        AgentId::Agy => json_mcp_state(&agy_mcp_path(home), bin)? != Mcp::Absent,
    })
}

pub(crate) fn status_with(home: &Path, bin: &str, cli: &dyn Cli) -> Vec<AgentSetupStatus> {
    ALL.iter()
        .map(|&a| {
            let rp = rules_path(home, a);
            let mut notes: Vec<String> = Vec::new();
            let cli_found = cli.found(a);
            if !cli_found {
                notes.push(format!("{} CLI bulunamadı", a.as_str()));
            }
            let rules_installed = match rules_state(&rp) {
                Ok((i, _)) => i,
                Err(e) => {
                    notes.push(e);
                    false
                }
            };
            let mcp_installed = match mcp_installed_of(home, a, bin) {
                Ok(v) => v,
                Err(e) => {
                    notes.push(format!("MCP durumu bilinmiyor: {e}"));
                    false
                }
            };
            AgentSetupStatus {
                id: a.as_str().into(),
                cli_found,
                rules_path: p(&rp),
                rules_installed,
                mcp_installed,
                note: if notes.is_empty() { None } else { Some(notes.join("; ")) },
            }
        })
        .collect()
}

fn act(m: Mcp) -> &'static str {
    match m {
        Mcp::Absent => "add",
        Mcp::Same => "none",
        Mcp::Different => "update",
    }
}

pub(crate) fn preview_with(home: &Path, bin: &str, agents: &[AgentId], cli: &dyn Cli) -> Vec<AgentPreview> {
    agents
        .iter()
        .map(|&a| {
            let rp = rules_path(home, a);
            let mut errors: Vec<String> = Vec::new();
            let rules_action = match rules_state(&rp) {
                Ok((_, act)) => act.to_string(),
                Err(e) => {
                    errors.push(e);
                    "none".into()
                }
            };
            let (mcp_target, mcp_action, mcp_snippet) = match a {
                AgentId::Claude => {
                    let t = format!("{} (claude mcp add --scope user)", p(&claude_json(home)));
                    match json_mcp_state(&claude_json(home), bin) {
                        Ok(m) => {
                            let mut action = act(m).to_string();
                            if m != Mcp::Same && !cli.found(a) {
                                errors.push("Claude CLI bulunamadı; MCP kaydı elle yapılmalı".into());
                                action = "error".into();
                            }
                            (t, action, claude_add_cmd(bin))
                        }
                        Err(e) => {
                            errors.push(e);
                            (t, "error".into(), claude_add_cmd(bin))
                        }
                    }
                }
                AgentId::Codex => {
                    let t = p(&codex_config(home));
                    match codex_state(&codex_config(home), bin) {
                        Ok((_, true)) => (t, "none".into(), "zaten yapılandırılmış (elle)".to_string()),
                        Ok((m, false)) => (t, act(m).into(), codex_block(bin)),
                        Err(e) => {
                            errors.push(e);
                            (t, "error".into(), codex_block(bin))
                        }
                    }
                }
                AgentId::Agy => {
                    let path = agy_mcp_path(home);
                    let snippet = serde_json::to_string_pretty(&json!({ "mcpServers": { MCP_NAME: desired_entry(bin) } }))
                        .unwrap_or_default();
                    match json_mcp_state(&path, bin) {
                        Ok(m) => (p(&path), act(m).into(), snippet),
                        Err(e) => {
                            errors.push(e);
                            (p(&path), "error".into(), snippet)
                        }
                    }
                }
            };
            AgentPreview {
                id: a.as_str().into(),
                rules_path: p(&rp),
                rules_action,
                mcp_target,
                mcp_action,
                mcp_snippet,
                error: if errors.is_empty() { None } else { Some(errors.join("; ")) },
            }
        })
        .collect()
}

fn apply_claude_mcp(home: &Path, bin: &str, cli: &dyn Cli) -> Result<String, String> {
    let state = json_mcp_state(&claude_json(home), bin)?;
    if state == Mcp::Same {
        return Ok("MCP zaten kayıtlı".into());
    }
    if !cli.found(AgentId::Claude) {
        return Err(format!("Claude CLI bulunamadı; elle komut: {}", claude_add_cmd(bin)));
    }
    if state == Mcp::Different {
        cli.claude_mcp_remove()?;
    }
    cli.claude_mcp_add(bin)?;
    Ok("MCP kaydedildi (claude mcp add)".into())
}

fn apply_codex_mcp(home: &Path, bin: &str) -> Result<String, String> {
    let path = codex_config(home);
    let (state, manual) = codex_state(&path, bin)?;
    if manual {
        return Ok("MCP zaten yapılandırılmış (elle)".into());
    }
    if state == Mcp::Same {
        return Ok("MCP zaten kayıtlı".into());
    }
    let existing = read_text(&path)?.unwrap_or_default();
    let new = apply_marked(&existing, TOML_START, TOML_END, &codex_block(bin));
    // sonuç geçerli TOML olmalı; değilse hiçbir şey yazma
    toml::from_str::<toml::Table>(&new).map_err(|e| format!("{}: üretilen yapılandırma geçersiz: {e}", path.display()))?;
    write_safe(&path, &new)?;
    Ok(format!("MCP yazıldı: {}", path.display()))
}

fn apply_agy_mcp(home: &Path, bin: &str) -> Result<String, String> {
    let path = agy_mcp_path(home);
    let mut root = read_json_obj(&path)?.unwrap_or_default();
    servers_of(&root, &path)?; // mcpServers türünü doğrula
    if json_mcp_state(&path, bin)? == Mcp::Same {
        return Ok("MCP zaten kayıtlı".into());
    }
    let servers = root.entry("mcpServers").or_insert_with(|| Value::Object(Map::new()));
    if let Value::Object(m) = servers {
        m.insert(MCP_NAME.into(), desired_entry(bin));
    }
    let text = serde_json::to_string_pretty(&Value::Object(root)).map_err(|e| e.to_string())? + "\n";
    write_safe(&path, &text)?;
    Ok(format!("MCP yazıldı: {}", path.display()))
}

pub(crate) fn apply_with(home: &Path, bin: &str, agents: &[AgentId], cli: &dyn Cli) -> Vec<AgentApplyResult> {
    agents
        .iter()
        .map(|&a| {
            let rules = apply_rules(&rules_path(home, a));
            let mcp = match a {
                AgentId::Claude => apply_claude_mcp(home, bin, cli),
                AgentId::Codex => apply_codex_mcp(home, bin),
                AgentId::Agy => apply_agy_mcp(home, bin),
            };
            combine(a, rules, mcp)
        })
        .collect()
}

fn combine(a: AgentId, rules: Result<String, String>, mcp: Result<String, String>) -> AgentApplyResult {
    let ok = rules.is_ok() && mcp.is_ok();
    let msg = |r: Result<String, String>| r.unwrap_or_else(|e| format!("HATA: {e}"));
    AgentApplyResult { id: a.as_str().into(), ok, message: format!("{}; {}", msg(rules), msg(mcp)) }
}

fn remove_claude_mcp(home: &Path, bin: &str, cli: &dyn Cli) -> Result<String, String> {
    if json_mcp_state(&claude_json(home), bin)? == Mcp::Absent {
        return Ok("MCP kaydı yok".into());
    }
    if !cli.found(AgentId::Claude) {
        return Err(format!("Claude CLI bulunamadı; elle komut: {}", claude_remove_cmd()));
    }
    cli.claude_mcp_remove()?;
    Ok("MCP kaydı kaldırıldı (claude mcp remove)".into())
}

fn remove_codex_mcp(home: &Path, bin: &str) -> Result<String, String> {
    let path = codex_config(home);
    let (state, manual) = codex_state(&path, bin)?;
    if manual {
        return Ok("MCP elle tanımlı; dokunulmadı".into());
    }
    if state == Mcp::Absent {
        return Ok("MCP bloğu yok".into());
    }
    let existing = read_text(&path)?.unwrap_or_default();
    write_or_delete_if_created(&path, &remove_marked(&existing, TOML_START, TOML_END))?;
    Ok(format!("MCP bloğu kaldırıldı: {}", path.display()))
}

fn remove_agy_mcp(home: &Path, bin: &str) -> Result<String, String> {
    let path = agy_mcp_path(home);
    if json_mcp_state(&path, bin)? == Mcp::Absent {
        return Ok("MCP kaydı yok".into());
    }
    let mut root = read_json_obj(&path)?.unwrap_or_default();
    let mut emptied = false;
    if let Some(Value::Object(m)) = root.get_mut("mcpServers") {
        m.shift_remove(MCP_NAME);
        emptied = m.is_empty();
    }
    if emptied {
        root.shift_remove("mcpServers");
    }
    if root.is_empty() {
        // dosyayı biz yarattıysak (yedek yok) sil; özgün dosya vardıysa boş nesne bırak
        let fname = path.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
        if path.with_file_name(format!("{fname}.ydevdesk.bak")).exists() {
            write_safe(&path, "{}\n")?;
        } else {
            std::fs::remove_file(&path).map_err(|e| format!("{} silinemedi: {e}", path.display()))?;
        }
    } else {
        let text = serde_json::to_string_pretty(&Value::Object(root)).map_err(|e| e.to_string())? + "\n";
        write_safe(&path, &text)?;
    }
    Ok(format!("MCP kaydı kaldırıldı: {}", path.display()))
}

pub(crate) fn remove_with(home: &Path, bin: &str, agents: &[AgentId], cli: &dyn Cli) -> Vec<AgentApplyResult> {
    agents
        .iter()
        .map(|&a| {
            let rules = remove_rules(&rules_path(home, a));
            let mcp = match a {
                AgentId::Claude => remove_claude_mcp(home, bin, cli),
                AgentId::Codex => remove_codex_mcp(home, bin),
                AgentId::Agy => remove_agy_mcp(home, bin),
            };
            combine(a, rules, mcp)
        })
        .collect()
}

pub fn status(home: &Path, bin: &str) -> Vec<AgentSetupStatus> {
    status_with(home, bin, &RealCli)
}
pub fn preview(home: &Path, bin: &str, agents: &[AgentId]) -> Vec<AgentPreview> {
    preview_with(home, bin, agents, &RealCli)
}
pub fn apply(home: &Path, bin: &str, agents: &[AgentId]) -> Vec<AgentApplyResult> {
    apply_with(home, bin, agents, &RealCli)
}
pub fn remove(home: &Path, bin: &str, agents: &[AgentId]) -> Vec<AgentApplyResult> {
    remove_with(home, bin, agents, &RealCli)
}

/// Uygulama ikilisi: `$APPIMAGE` doluysa o, yoksa `current_exe()`.
pub fn exe_path() -> String {
    if let Ok(a) = std::env::var("APPIMAGE") {
        if !a.is_empty() {
            return a;
        }
    }
    std::env::current_exe().map(|e| e.to_string_lossy().to_string()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// Gerçek CLI çağırmayan sahte: çağrıları kaydeder.
    struct FakeCli {
        found: bool,
        calls: RefCell<Vec<String>>,
    }
    impl FakeCli {
        fn new(found: bool) -> Self {
            FakeCli { found, calls: RefCell::new(vec![]) }
        }
    }
    impl Cli for FakeCli {
        fn found(&self, _: AgentId) -> bool {
            self.found
        }
        fn claude_mcp_add(&self, bin: &str) -> Result<(), String> {
            self.calls.borrow_mut().push(format!("add {bin}"));
            Ok(())
        }
        fn claude_mcp_remove(&self) -> Result<(), String> {
            self.calls.borrow_mut().push("remove".into());
            Ok(())
        }
    }

    fn tmp_home(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ydesk_agent_{}_{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn apply_block_appends_when_missing_and_is_idempotent() {
        let b = rules_block();
        for base in ["", "abc\n", "abc", "# T\n\nbody\n"] {
            let once = apply_block(base, b);
            assert!(once.starts_with(base), "kullanıcı içeriği başta aynen kalmalı");
            assert_eq!(apply_block(&once, b), once, "ikinci uygulama değişiklik yapmamalı");
            assert_eq!(once.matches(MD_START).count(), 1);
            assert_eq!(once.matches(MD_END).count(), 1);
        }
    }

    #[test]
    fn apply_block_replaces_existing_block_only() {
        let old = "head\n\n<!-- ydevdesk:knowledge:start -->\neski\n<!-- ydevdesk:knowledge:end -->\n\ntail\n";
        let out = apply_block(old, rules_block());
        assert!(out.starts_with("head\n\n<!-- ydevdesk:knowledge:start -->"));
        assert!(out.ends_with("<!-- ydevdesk:knowledge:end -->\n\ntail\n"));
        assert!(!out.contains("eski"));
        assert_eq!(out.matches(MD_START).count(), 1);
    }

    #[test]
    fn remove_block_restores_original_byte_for_byte() {
        let b = rules_block();
        let cases = [
            "",
            "\n",
            "abc",
            "abc\n",
            "abc\n\n",
            "satır1\r\nsatır2\r\n",
            "satır1\r\nsatır2",
            "# Başlık\n\nİçerik ğüşiöç 🚀\n",
            "tek satır işaretçisiz",
        ];
        for c in cases {
            let applied = apply_block(c, b);
            assert_eq!(remove_block(&applied), c, "geri alma başarısız: {c:?}");
        }
        // blok yoksa aynen
        assert_eq!(remove_block("merhaba\n"), "merhaba\n");
        // ekledikten sonra kullanıcı sona satır eklerse yine kullanıcı içeriği kalır
        let applied = apply_block("abc\n", b);
        let edited = format!("{applied}\nsonradan\n");
        assert_eq!(remove_block(&edited), "abc\n\nsonradan\n");
    }

    #[test]
    fn block_matches_site_templates() {
        // Windows checkout satır sonlarını CRLF yapmış olabilir: iki tarafı da LF'ye indirip karşılaştır.
        let normalized = rules_block().replace("\r\n", "\n");
        let b = normalized.trim_end();
        for t in [
            include_str!("../../../docs/site/agents/CLAUDE.md"),
            include_str!("../../../docs/site/agents/AGENTS.md"),
            include_str!("../../../docs/site/agents/GEMINI.md"),
        ] {
            assert!(t.replace("\r\n", "\n").contains(b), "şablon kural bloğunu birebir içermeli");
        }
    }

    #[test]
    fn codex_toml_block_added_removed_and_quotes_path() {
        let home = tmp_home("codex_toml");
        let cfg = codex_config(&home);
        std::fs::create_dir_all(cfg.parent().unwrap()).unwrap();
        let original = "model = \"o3\"\r\n\r\n[profiles.x]\r\nfoo = 1";
        std::fs::write(&cfg, original).unwrap();
        let bin = r"C:\Program Files\Çalış App\ydevdesk.exe";
        let cli = FakeCli::new(true);
        let r = apply_with(&home, bin, &[AgentId::Codex], &cli);
        assert!(r[0].ok, "{}", r[0].message);
        let written = std::fs::read_to_string(&cfg).unwrap();
        assert!(written.contains(&format!("command = '{bin}'")));
        assert!(written.contains("args = [\"--mcp\"]"));
        assert!(written.starts_with(original));
        let parsed: toml::Table = toml::from_str(&written).unwrap();
        assert_eq!(parsed["mcp_servers"][MCP_NAME]["command"].as_str(), Some(bin));
        // ikinci uygulama çoğaltmaz
        apply_with(&home, bin, &[AgentId::Codex], &cli);
        assert_eq!(std::fs::read_to_string(&cfg).unwrap().matches(TOML_START).count(), 1);
        // kaldır → birebir eski
        let r = remove_with(&home, bin, &[AgentId::Codex], &cli);
        assert!(r[0].ok, "{}", r[0].message);
        assert_eq!(std::fs::read_to_string(&cfg).unwrap(), original);
        // tek tırnaklı yol: kaçışlı temel dizge, yine geçerli TOML
        assert_eq!(toml_str("a'b\\c"), "\"a'b\\\\c\"");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn codex_existing_unmanaged_table_not_duplicated() {
        let home = tmp_home("codex_unmanaged");
        let cfg = codex_config(&home);
        std::fs::create_dir_all(cfg.parent().unwrap()).unwrap();
        let original = "[mcp_servers.ydevdesk-knowledge]\ncommand = \"/x/y\"\nargs = [\"--mcp\"]\n";
        std::fs::write(&cfg, original).unwrap();
        let cli = FakeCli::new(true);
        let pv = preview_with(&home, "/x/y", &[AgentId::Codex], &cli);
        assert_eq!(pv[0].mcp_action, "none");
        assert!(pv[0].mcp_snippet.contains("elle"));
        let r = apply_with(&home, "/x/y", &[AgentId::Codex], &cli);
        assert!(r[0].message.contains("zaten yapılandırılmış (elle)"), "{}", r[0].message);
        assert_eq!(std::fs::read_to_string(&cfg).unwrap(), original);
        // kaldırma da elle tanımlıya dokunmaz
        remove_with(&home, "/x/y", &[AgentId::Codex], &cli);
        assert_eq!(std::fs::read_to_string(&cfg).unwrap(), original);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn codex_corrupt_toml_errors_and_file_unchanged() {
        let home = tmp_home("codex_corrupt");
        let cfg = codex_config(&home);
        std::fs::create_dir_all(cfg.parent().unwrap()).unwrap();
        std::fs::write(&cfg, "bozuk = = [").unwrap();
        let cli = FakeCli::new(true);
        let r = apply_with(&home, "/x", &[AgentId::Codex], &cli);
        assert!(!r[0].ok);
        assert_eq!(std::fs::read_to_string(&cfg).unwrap(), "bozuk = = [");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn agy_mcp_json_merge_keeps_other_servers() {
        let home = tmp_home("agy_merge");
        let path = agy_mcp_path(&home);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, r#"{"mcpServers":{"diger":{"command":"x","args":["a"]}},"baska":{"k":1}}"#).unwrap();
        let cli = FakeCli::new(true);
        let r = apply_with(&home, "/bin/yd esk", &[AgentId::Agy], &cli);
        assert!(r[0].ok, "{}", r[0].message);
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(v["mcpServers"]["diger"]["command"], "x");
        assert_eq!(v["baska"]["k"], 1);
        assert_eq!(v["mcpServers"][MCP_NAME], json!({"command":"/bin/yd esk","args":["--mcp"]}));
        // kaldır → diğerleri kalır
        remove_with(&home, "/bin/yd esk", &[AgentId::Agy], &cli);
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert!(v["mcpServers"].get(MCP_NAME).is_none());
        assert_eq!(v["mcpServers"]["diger"]["command"], "x");
        // dosya yokken oluşturulur, kaldırınca silinir
        let home2 = tmp_home("agy_new");
        apply_with(&home2, "/b", &[AgentId::Agy], &cli);
        assert!(agy_mcp_path(&home2).exists());
        remove_with(&home2, "/b", &[AgentId::Agy], &cli);
        assert!(!agy_mcp_path(&home2).exists());
        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::remove_dir_all(&home2);
    }

    #[test]
    fn agy_corrupt_json_errors_and_file_unchanged() {
        let home = tmp_home("agy_corrupt");
        let path = agy_mcp_path(&home);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{ bozuk json,").unwrap();
        let cli = FakeCli::new(true);
        let r = apply_with(&home, "/b", &[AgentId::Agy], &cli);
        assert!(!r[0].ok);
        assert!(r[0].message.contains("HATA"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{ bozuk json,");
        assert!(!path.with_file_name("mcp_config.json.ydevdesk.bak").exists());
        let pv = preview_with(&home, "/b", &[AgentId::Agy], &cli);
        assert_eq!(pv[0].mcp_action, "error");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn backup_created_before_first_write() {
        let home = tmp_home("backup");
        let rp = rules_path(&home, AgentId::Claude);
        std::fs::create_dir_all(rp.parent().unwrap()).unwrap();
        std::fs::write(&rp, "ilk içerik\n").unwrap();
        let cli = FakeCli::new(false);
        apply_with(&home, "/b", &[AgentId::Claude], &cli);
        let bak = rp.with_file_name("CLAUDE.md.ydevdesk.bak");
        assert_eq!(std::fs::read_to_string(&bak).unwrap(), "ilk içerik\n");
        assert!(std::fs::read_to_string(&rp).unwrap().contains(MD_START));
        // ikinci değişiklik yedeği ezmez
        std::fs::write(&rp, "ikinci\n").unwrap();
        apply_with(&home, "/b", &[AgentId::Claude], &cli);
        assert_eq!(std::fs::read_to_string(&bak).unwrap(), "ilk içerik\n");
        // dosya yokken yedek de yok
        let home2 = tmp_home("backup2");
        apply_with(&home2, "/b", &[AgentId::Claude], &cli);
        assert!(!rules_path(&home2, AgentId::Claude).with_file_name("CLAUDE.md.ydevdesk.bak").exists());
        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::remove_dir_all(&home2);
    }

    #[test]
    fn preview_reports_none_when_already_installed() {
        let home = tmp_home("preview_none");
        let bin = "/opt/yd/ydevdesk";
        // Claude: ~/.claude.json içinde kayıt var
        std::fs::write(
            claude_json(&home),
            json!({"mcpServers": {MCP_NAME: {"type":"stdio","command":bin,"args":["--mcp"],"env":{}}}}).to_string(),
        )
        .unwrap();
        let cli = FakeCli::new(true);
        let all = [AgentId::Claude, AgentId::Codex, AgentId::Agy];
        let before = preview_with(&home, bin, &all, &cli);
        assert_eq!(before[0].mcp_action, "none");
        assert_eq!(before[0].rules_action, "add");
        assert_eq!(before[1].mcp_action, "add");
        assert_eq!(before[2].mcp_action, "add");
        apply_with(&home, bin, &all, &cli);
        assert!(cli.calls.borrow().is_empty(), "Claude kaydı zaten vardı; CLI çağrılmamalı");
        let after = preview_with(&home, bin, &all, &cli);
        for pv in &after {
            assert_eq!(pv.rules_action, "none", "{}", pv.id);
            assert_eq!(pv.mcp_action, "none", "{}", pv.id);
            assert!(pv.error.is_none());
        }
        let st = status_with(&home, bin, &cli);
        assert!(st.iter().all(|s| s.rules_installed && s.mcp_installed));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn claude_cli_missing_and_corrupt_claude_json() {
        let home = tmp_home("claude_cli");
        let cli = FakeCli::new(false);
        let r = apply_with(&home, "/b/yd", &[AgentId::Claude], &cli);
        assert!(!r[0].ok);
        assert!(r[0].message.contains("Claude CLI bulunamadı; elle komut: claude mcp add --scope user ydevdesk-knowledge -- /b/yd --mcp"));
        assert!(rules_path(&home, AgentId::Claude).exists(), "kural bloğu CLI olmadan da yazılır");
        // CLI var: ekleme çağrılır; farklı kayıt varsa önce kaldırılır
        let cli = FakeCli::new(true);
        let r = apply_with(&home, "/b/yd", &[AgentId::Claude], &cli);
        assert!(r[0].ok);
        assert_eq!(*cli.calls.borrow(), vec!["add /b/yd".to_string()]);
        std::fs::write(claude_json(&home), json!({"mcpServers": {MCP_NAME: {"command":"/eski","args":["--mcp"]}}}).to_string()).unwrap();
        let cli = FakeCli::new(true);
        apply_with(&home, "/b/yd", &[AgentId::Claude], &cli);
        assert_eq!(*cli.calls.borrow(), vec!["remove".to_string(), "add /b/yd".to_string()]);
        // bozuk ~/.claude.json: bilinmiyor + note, dosya değişmez, CLI çağrılmaz
        std::fs::write(claude_json(&home), "{bozuk").unwrap();
        let cli = FakeCli::new(true);
        let st = status_with(&home, "/b/yd", &cli);
        assert!(st[0].note.as_ref().unwrap().contains("bilinmiyor"));
        let r = apply_with(&home, "/b/yd", &[AgentId::Claude], &cli);
        assert!(!r[0].ok);
        assert!(cli.calls.borrow().is_empty());
        assert_eq!(std::fs::read_to_string(claude_json(&home)).unwrap(), "{bozuk");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn apply_then_remove_restores_all_files() {
        let home = tmp_home("roundtrip");
        let rp = rules_path(&home, AgentId::Codex);
        std::fs::create_dir_all(rp.parent().unwrap()).unwrap();
        std::fs::write(&rp, "kendi kurallarım\r\n").unwrap();
        let cli = FakeCli::new(true);
        let all = [AgentId::Codex, AgentId::Agy];
        apply_with(&home, "/b", &all, &cli);
        remove_with(&home, "/b", &all, &cli);
        assert_eq!(std::fs::read_to_string(&rp).unwrap(), "kendi kurallarım\r\n");
        assert!(!rules_path(&home, AgentId::Agy).exists());
        let _ = std::fs::remove_dir_all(&home);
    }

    /// Elle çalıştırılır: `cargo test real_user_files -- --ignored`. Gerçek ~/.claude/CLAUDE.md ve ~/.codex/AGENTS.md
    /// içeriğini yalnızca OKUR, geçici bir home'a kopyalar; ekleme + kaldırmadan sonra bayt eşitliğini doğrular.
    #[test]
    #[ignore]
    fn real_user_files_roundtrip_on_copy() {
        let real = dirs::home_dir().unwrap();
        let home = tmp_home("real_copy");
        let mut checked = 0;
        for (agent, rel) in [(AgentId::Claude, ".claude/CLAUDE.md"), (AgentId::Codex, ".codex/AGENTS.md")] {
            let Ok(orig) = std::fs::read(real.join(rel)) else { continue };
            let dest = rules_path(&home, agent);
            std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
            std::fs::write(&dest, &orig).unwrap();
            let cli = FakeCli::new(true);
            apply_with(&home, "/b", &[agent], &cli);
            let after = std::fs::read_to_string(&dest).unwrap();
            assert!(after.contains("ydevdesk:knowledge:start"), "blok eklenmeli");
            assert!(after.as_bytes().starts_with(&orig), "mevcut içerik başta aynen kalmalı");
            apply_with(&home, "/b", &[agent], &cli); // ikinci tıklama
            assert_eq!(after.matches("ydevdesk:knowledge:start").count(), 1);
            assert_eq!(std::fs::read_to_string(&dest).unwrap(), after, "idempotent");
            remove_with(&home, "/b", &[agent], &cli);
            assert_eq!(std::fs::read(&dest).unwrap(), orig, "{rel}: kaldırınca bayt bayt eski hâl");
            checked += 1;
            eprintln!("{rel}: {} bayt, gidiş-dönüş tamam", orig.len());
        }
        let _ = std::fs::remove_dir_all(&home);
        eprintln!("kontrol edilen gerçek dosya sayısı: {checked}");
    }
}
