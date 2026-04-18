use log::{error, info, warn};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Notify;

const DEFAULT_PORT: u16 = 8080;
const HEALTH_TIMEOUT: Duration = Duration::from_secs(30);
const HEALTH_RETRY_INTERVAL: Duration = Duration::from_millis(400);
const PING_INTERVAL: Duration = Duration::from_secs(5);

pub struct BackendManager {
    process: Option<Child>,
    port: u16,
    project_root: PathBuf,
    is_packaged: bool,
    resource_dir: Option<PathBuf>,
    shutdown_notify: Arc<Notify>,
}

pub type BackendManagerHandle = Arc<Mutex<BackendManager>>;

impl BackendManager {
    pub fn new(project_root: PathBuf, is_packaged: bool, resource_dir: Option<PathBuf>) -> Self {
        let port = std::env::var("CCR_PORT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(DEFAULT_PORT);

        Self {
            process: None,
            port,
            project_root,
            is_packaged,
            resource_dir,
            shutdown_notify: Arc::new(Notify::new()),
        }
    }

    pub fn get_app_url(&self) -> String {
        if let Ok(dev_url) = std::env::var("REMOTE_CODE_DEV_SERVER_URL") {
            if !dev_url.is_empty() {
                return dev_url;
            }
        }
        format!("http://127.0.0.1:{}", self.port)
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    fn find_python_executable(&self) -> PathBuf {
        #[cfg(windows)]
        let candidates = vec![
            self.project_root
                .join(".venv")
                .join("Scripts")
                .join("python.exe"),
            PathBuf::from("python"),
        ];
        #[cfg(not(windows))]
        let candidates = vec![
            self.project_root
                .join(".venv")
                .join("bin")
                .join("python"),
            PathBuf::from("python3"),
            PathBuf::from("python"),
        ];

        for candidate in &candidates {
            if candidate.exists() {
                info!("Found Python at: {:?}", candidate);
                return candidate.clone();
            }
        }

        // Fallback
        let fallback = if cfg!(windows) {
            PathBuf::from("python")
        } else {
            PathBuf::from("python3")
        };
        info!("Using fallback Python: {:?}", fallback);
        fallback
    }

    fn get_backend_executable(&self) -> Option<PathBuf> {
        let resource_dir = self.resource_dir.as_ref()?;
        let ext = if cfg!(windows) { ".exe" } else { "" };
        let exe = resource_dir
            .join("backend")
            .join(format!("remote-code-server{}", ext));
        if exe.exists() {
            Some(exe)
        } else {
            None
        }
    }

    pub fn start(&mut self) -> Result<(), String> {
        if self
            .process
            .as_mut()
            .is_some_and(|p| p.try_wait().ok().flatten().is_none())
        {
            return Ok(());
        }

        let port_str = self.port.to_string();

        let mut cmd = if self.is_packaged {
            // Packaged mode: try PyInstaller binary first, fall back to Python + bundled source
            if let Some(exe) = self.get_backend_executable() {
                info!("Starting packaged backend (binary): {:?}", exe);
                let mut c = Command::new(&exe);
                c.args(["--host", "127.0.0.1", "--port", &port_str]);
                c
            } else {
                // Fall back to system Python + bundled source files
                let python = self.find_python_executable();
                let resource_dir = self.resource_dir.as_ref()
                    .ok_or("Resource directory not found")?;
                let script = resource_dir.join("remote_code_server.py");
                if !script.exists() {
                    return Err(format!("Backend script not found: {:?}", script));
                }
                info!("Starting packaged backend (python): {:?} {:?}", python, script);
                let mut c = Command::new(python);
                c.arg(&script)
                    .args(["--host", "127.0.0.1", "--port", &port_str])
                    .current_dir(resource_dir);
                c
            }
        } else {
            let python = self.find_python_executable();
            let script = self.project_root.join("remote_code_server.py");
            info!("Starting dev backend: {:?} {:?}", python, script);
            let mut c = Command::new(python);
            c.arg(&script)
                .args(["--host", "127.0.0.1", "--port", &port_str])
                .current_dir(&self.project_root);
            c
        };

        // Generate a random JWT secret if not already set
        let jwt_secret = std::env::var("CCR_JWT_SECRET").unwrap_or_else(|_| {
            use std::collections::hash_map::DefaultHasher;
            use std::hash::{Hash, Hasher};
            let mut hasher = DefaultHasher::new();
            std::time::SystemTime::now().hash(&mut hasher);
            std::process::id().hash(&mut hasher);
            format!("tauri-auto-{:x}", hasher.finish())
        });

        cmd.env("CCR_HOST", "127.0.0.1")
            .env("CCR_PORT", &port_str)
            .env("CCR_JWT_SECRET", &jwt_secret)
            .env("PYTHONPATH", &self.project_root)
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());

        // Hide console window in packaged mode only
        #[cfg(windows)]
        if self.is_packaged {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let child = cmd.spawn().map_err(|e| format!("Failed to spawn backend: {}", e))?;
        info!("Backend process started with PID: {:?}", child.id());
        self.process = Some(child);
        Ok(())
    }

    pub fn stop(&mut self) {
        // Notify ping loop to stop
        self.shutdown_notify.notify_waiters();

        // Send shutdown notification
        let port = self.port;
        let _ = std::thread::spawn(move || {
            let url = format!("http://127.0.0.1:{}/api/desktop/session", port);
            let client = reqwest::blocking::Client::new();
            let _ = client
                .delete(&url)
                .timeout(Duration::from_secs(3))
                .send();
        })
        .join();

        if let Some(mut child) = self.process.take() {
            #[cfg(windows)]
            {
                let pid = child.id().to_string();
                let _ = Command::new("taskkill")
                    .args(["/pid", &pid, "/t", "/f"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
                std::thread::sleep(Duration::from_secs(1));
            }

            #[cfg(not(windows))]
            {
                unsafe {
                    libc::kill(child.id() as i32, libc::SIGTERM);
                }
                // Wait up to 5s for graceful exit
                for _ in 0..50 {
                    if child.try_wait().ok().flatten().is_some() {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                let _ = child.kill();
            }

            let _ = child.wait();
        }
    }

    pub fn shutdown_notify(&self) -> Arc<Notify> {
        self.shutdown_notify.clone()
    }
}

pub async fn wait_for_health(port: u16) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{}/api/health", port);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;

    let start = std::time::Instant::now();
    loop {
        if start.elapsed() > HEALTH_TIMEOUT {
            return Err("Backend health check timed out".to_string());
        }

        match client.get(&url).send().await {
            Ok(resp) if resp.status().as_u16() < 500 => {
                info!("Backend is healthy");
                return Ok(());
            }
            _ => {}
        }

        tokio::time::sleep(HEALTH_RETRY_INTERVAL).await;
    }
}

pub fn start_ping_loop(port: u16, shutdown: Arc<Notify>) {
    tokio::spawn(async move {
        let url = format!("http://127.0.0.1:{}/api/desktop/ping", port);
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap();

        loop {
            tokio::select! {
                _ = shutdown.notified() => {
                    info!("Ping loop stopped");
                    break;
                }
                _ = tokio::time::sleep(PING_INTERVAL) => {
                    if let Err(e) = client.post(&url).send().await {
                        warn!("Ping failed: {}", e);
                    }
                }
            }
        }
    });
}
