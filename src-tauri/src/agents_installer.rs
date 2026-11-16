use serde::{Deserialize, Serialize};
use crate::env_helpers::{find_binary, get_binary_version, get_enhanced_path, sanitize_std_cmd};
use crate::platform;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AgentCliInfo {
    pub id: String,
    pub name: String,
    pub binary: String,
    pub npm_package: Option<String>,
    pub is_installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub description: String,
    pub install_cmd: String,
    pub bypass_cmd: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AgentEnvironmentStatus {
    pub node_installed: bool,
    pub node_version: Option<String>,
    pub npm_installed: bool,
    pub npm_version: Option<String>,
    pub agents: Vec<AgentCliInfo>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AgentInstallResult {
    pub success: bool,
    pub agent_id: String,
    pub message: String,
    pub output: String,
}


#[tauri::command]
pub fn check_agent_environment() -> Result<AgentEnvironmentStatus, String> {
    let node_bin = find_binary("node");
    let node_installed = node_bin.is_some();
    let node_version = node_bin.as_deref().and_then(|p| get_binary_version(p, &["-v"]));

    let npm_bin = find_binary("npm");
    let npm_installed = npm_bin.is_some();
    let npm_version = npm_bin.as_deref().and_then(|p| get_binary_version(p, &["-v"]));

    let mut agents = Vec::new();

    // 1. Google Antigravity (AGY)
    let agy_bin = find_binary("agy").or_else(|| find_binary("antigravity"));
    let agy_installed = agy_bin.is_some();
    let agy_version = agy_bin.as_deref().and_then(|p| get_binary_version(p, &["--version"]));
    let agy_path = agy_bin.map(|p| p.to_string_lossy().to_string());
    agents.push(AgentCliInfo {
        id: "agy".into(),
        name: "Google Antigravity (AGY)".into(),
        binary: "agy".into(),
        npm_package: None,
        is_installed: agy_installed,
        version: agy_version,
        path: agy_path,
        description: "Google'un agentic platform CLI'ı, Zettelkasten hafıza ve araç yürütme çekirdeği.".into(),
        install_cmd: "curl -fsSL https://antigravity.google/cli/install.sh | bash".into(),
        bypass_cmd: Some("agy --dangerously-skip-permissions".into()),
    });

    // 2. Anthropic Claude Code
    let claude_bin = find_binary("claude");
    let claude_installed = claude_bin.is_some();
    let claude_version = claude_bin.as_deref().and_then(|p| get_binary_version(p, &["--version"]));
    let claude_path = claude_bin.map(|p| p.to_string_lossy().to_string());
    agents.push(AgentCliInfo {
        id: "claude".into(),
        name: "Anthropic Claude Code".into(),
        binary: "claude".into(),
        npm_package: Some("@anthropic-ai/claude-code".into()),
        is_installed: claude_installed,
        version: claude_version,
        path: claude_path,
        description: "Anthropic Claude Code terminal kodlama ve proje mimarisi ajanı.".into(),
        install_cmd: "npm install -g @anthropic-ai/claude-code".into(),
        bypass_cmd: Some("claude --dangerously-skip-permissions".into()),
    });

    // 3. OpenAI Codex CLI
    let codex_bin = find_binary("codex");
    let codex_installed = codex_bin.is_some();
    let codex_version = codex_bin.as_deref().and_then(|p| get_binary_version(p, &["--version"]));
    let codex_path = codex_bin.map(|p| p.to_string_lossy().to_string());
    agents.push(AgentCliInfo {
        id: "codex".into(),
        name: "OpenAI Codex CLI".into(),
        binary: "codex".into(),
        npm_package: Some("@openai/codex".into()),
        is_installed: codex_installed,
        version: codex_version,
        path: codex_path,
        description: "OpenAI Codex CLI yerel kodlama ve komut satırı ajanı.".into(),
        install_cmd: "npm install -g @openai/codex".into(),
        bypass_cmd: Some("codex --dangerously-bypass-approvals-and-run-code".into()),
    });

    Ok(AgentEnvironmentStatus {
        node_installed,
        node_version,
        npm_installed,
        npm_version,
        agents,
    })
}

fn run_clean_shell(script: &str, enhanced_path: &str) -> Result<(bool, String), String> {
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = platform::hidden_command("powershell");
        c.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let shell_bin = if find_binary("bash").is_some() { "bash" } else { "sh" };
        let mut c = platform::hidden_command(shell_bin);
        c.args(["-c", script]);
        c
    };
    cmd.env("PATH", enhanced_path);
    sanitize_std_cmd(&mut cmd);
    let out = cmd
        .output()
        .map_err(|e| format!("Kurulum komutu çalıştırılamadı: {}", e))?;
    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    )
    .trim()
    .to_string();
    Ok((out.status.success(), combined))
}

#[tauri::command]
pub async fn install_agent_cli(agent_id: String, force_update: Option<bool>) -> Result<AgentInstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || install_agent_cli_sync(agent_id, force_update.unwrap_or(false)))
        .await
        .map_err(|e| format!("Kurulum görevi hatası: {}", e))?
}

fn install_agent_cli_sync(agent_id: String, force_update: bool) -> Result<AgentInstallResult, String> {
    let enhanced_path = get_enhanced_path();
    let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("/tmp"));

    match agent_id.as_str() {
        "claude" => {
            if !force_update {
                if let Some(bin) = find_binary("claude") {
                    if let Some(ver) = get_binary_version(&bin, &["--version"]) {
                        return Ok(AgentInstallResult {
                            success: true,
                            agent_id: "claude".into(),
                            message: format!("Claude Code zaten kurulu ve aktif ({})", ver),
                            output: format!("Konum: {}", bin.display()),
                        });
                    }
                }
            }

            if force_update && find_binary("claude").is_some() {
                if let Ok((true, out)) = run_clean_shell("claude update", &enhanced_path) {
                    let ver = find_binary("claude")
                        .and_then(|b| get_binary_version(&b, &["--version"]))
                        .unwrap_or_else(|| "güncellendi".into());
                    return Ok(AgentInstallResult {
                        success: true,
                        agent_id: "claude".into(),
                        message: format!("Claude Code güncellendi ({})", ver),
                        output: out,
                    });
                }
            }

            let claude_script = if cfg!(target_os = "windows") {
                "irm https://claude.ai/install.ps1 | iex"
            } else {
                "curl -fsSL https://claude.ai/install.sh | bash"
            };
            let (ok, mut output_str) = run_clean_shell(claude_script, &enhanced_path)?;

            // Native betik başarısız olursa ve npm varsa ~/.local altına kurmayı dene
            if !ok {
                if let Some(npm_bin) = find_binary("npm") {
                    let local_prefix = home.join(".local");
                    let _ = std::fs::create_dir_all(local_prefix.join("bin"));
                    let mut npm_cmd = std::process::Command::new(&npm_bin);
                    npm_cmd
                        .args(["install", "-g", "--prefix", &local_prefix.to_string_lossy(), "@anthropic-ai/claude-code@latest"])
                        .env("PATH", &enhanced_path);
                    sanitize_std_cmd(&mut npm_cmd);
                    if let Ok(nout) = npm_cmd.output() {
                        let nstr = format!(
                            "{}\n{}",
                            String::from_utf8_lossy(&nout.stdout),
                            String::from_utf8_lossy(&nout.stderr)
                        );
                        output_str = format!("{}\n--- npm fallback ---\n{}", output_str, nstr.trim());
                    }
                }
            }

            if let Some(bin) = find_binary("claude") {
                let ver = get_binary_version(&bin, &["--version"]).unwrap_or_else(|| "kuruldu".into());
                Ok(AgentInstallResult {
                    success: true,
                    agent_id: "claude".into(),
                    message: format!("Claude Code {} ({})", if force_update { "güncellendi" } else { "kuruldu" }, ver),
                    output: output_str,
                })
            } else {
                Err(format!("Claude Code kurulumu başarısız:\n{}", output_str))
            }
        }
        "codex" => {
            if !force_update {
                if let Some(bin) = find_binary("codex") {
                    if let Some(ver) = get_binary_version(&bin, &["--version"]) {
                        return Ok(AgentInstallResult {
                            success: true,
                            agent_id: "codex".into(),
                            message: format!("OpenAI Codex CLI zaten kurulu ve aktif ({})", ver),
                            output: format!("Konum: {}", bin.display()),
                        });
                    }
                }
            }

            let npm_bin = find_binary("npm").ok_or_else(|| "Sistemde npm bulunamadı. Lütfen önce Node.js ve npm kurun.".to_string())?;
            let local_prefix = home.join(".local");
            let _ = std::fs::create_dir_all(local_prefix.join("bin"));

            let mut cmd = std::process::Command::new(&npm_bin);
            cmd.args(["install", "-g", "--prefix", &local_prefix.to_string_lossy(), "@openai/codex@latest"])
                .env("PATH", &enhanced_path);
            sanitize_std_cmd(&mut cmd);
            let out = cmd
                .output()
                .map_err(|e| format!("npm çalıştırılamadı: {}", e))?;

            let combined = format!(
                "{}\n{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            )
            .trim()
            .to_string();

            if !out.status.success() {
                return Err(format!("Codex kurulumu başarısız:\n{}", combined));
            }

            if let Some(bin) = find_binary("codex") {
                let ver = get_binary_version(&bin, &["--version"]).unwrap_or_else(|| "kuruldu".into());
                Ok(AgentInstallResult {
                    success: true,
                    agent_id: "codex".into(),
                    message: format!("OpenAI Codex CLI {} ({})", if force_update { "güncellendi" } else { "kuruldu" }, ver),
                    output: combined,
                })
            } else {
                Ok(AgentInstallResult {
                    success: true,
                    agent_id: "codex".into(),
                    message: "Codex kuruldu. Terminal yeniden başlatıldığında kullanılabilir.".into(),
                    output: combined,
                })
            }
        }
        "agy" => {
            if !force_update {
                if let Some(bin) = find_binary("agy").or_else(|| find_binary("antigravity")) {
                    let ver = get_binary_version(&bin, &["--version"]).unwrap_or_else(|| "bilinmiyor".into());
                    return Ok(AgentInstallResult {
                        success: true,
                        agent_id: "agy".into(),
                        message: format!("Google Antigravity zaten kurulu ({})", ver),
                        output: format!("Konum: {}", bin.display()),
                    });
                }
            }

            let agy_script = if cfg!(target_os = "windows") {
                "irm https://antigravity.google/cli/install.ps1 | iex"
            } else {
                "curl -fsSL https://antigravity.google/cli/install.sh | bash"
            };
            let (mut ok, mut output_str) = run_clean_shell(agy_script, &enhanced_path)?;

            // macOS üzerinde Homebrew fallback
            if !ok && cfg!(target_os = "macos") && find_binary("brew").is_some() {
                if let Ok((bok, bout)) = run_clean_shell("brew install --cask antigravity-cli", &enhanced_path) {
                    ok = bok;
                    output_str = format!("{}\n--- brew fallback ---\n{}", output_str, bout);
                }
            }

            let verified = find_binary("agy").or_else(|| find_binary("antigravity"));
            if ok && verified.is_some() {
                let ver = verified
                    .as_deref()
                    .and_then(|b| get_binary_version(b, &["--version"]))
                    .unwrap_or_else(|| "kuruldu".into());
                Ok(AgentInstallResult {
                    success: true,
                    agent_id: "agy".into(),
                    message: format!(
                        "Google Antigravity (AGY) {} ({})",
                        if force_update { "güncellendi" } else { "kuruldu" },
                        ver
                    ),
                    output: output_str,
                })
            } else {
                let aur_hint = if find_binary("yay").is_some() {
                    "\nİpucu (Arch Linux): Terminalde `yay -S antigravity-cli` ile kurabilirsiniz."
                } else if find_binary("paru").is_some() {
                    "\nİpucu (Arch Linux): Terminalde `paru -S antigravity-cli` ile kurabilirsiniz."
                } else {
                    ""
                };
                Err(format!(
                    "AGY kurulumu başarısız veya ikili dosya doğrulanamadı.{}\n{}",
                    aur_hint, output_str
                ))
            }
        }
        _ => Err(format!("Bilinmeyen ajan: {}", agent_id)),
    }
}

