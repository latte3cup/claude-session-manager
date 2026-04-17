use std::env;

/// Detect the shell to use, in order of precedence:
/// 1. CLI --shell flag
/// 2. WMUX_SHELL env var
/// 3. COMSPEC env var
/// 4. Fallback: powershell.exe
pub fn detect_shell(cli_shell: Option<String>) -> String {
    if let Some(shell) = cli_shell {
        return shell;
    }
    if let Ok(shell) = env::var("WMUX_SHELL") {
        if !shell.is_empty() {
            return shell;
        }
    }
    if let Ok(shell) = env::var("COMSPEC") {
        if !shell.is_empty() {
            return shell;
        }
    }
    "powershell.exe".to_string()
}

/// Detect available CLI tools in PATH
pub fn detect_available_clis() -> Vec<String> {
    let candidates = ["claude", "opencode", "kilo"];
    let mut available = Vec::new();

    for cmd in &candidates {
        let check = if cfg!(windows) {
            std::process::Command::new("where").arg(cmd).output()
        } else {
            std::process::Command::new("which").arg(cmd).output()
        };

        if let Ok(output) = check {
            if output.status.success() {
                available.push(cmd.to_string());
            }
        }
    }

    available
}
