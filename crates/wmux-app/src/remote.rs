use crate::AppState;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Router,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;
use tower_http::services::ServeDir;
use wmux_core::socket::commands::dispatch;
use wmux_core::socket::protocol::{Request, Response};

#[derive(Deserialize)]
struct WsParams {
    token: Option<String>,
}

pub async fn start_remote_server(
    state: Arc<AppState>,
    port: u16,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_default();

    // Unified frontend: serve frontend/ for both Tauri and web
    let frontend_dir = if std::path::Path::new("frontend").exists() {
        std::path::PathBuf::from("frontend")
    } else {
        exe_dir.join("frontend")
    };

    let vendor_dir = if std::path::Path::new("frontend/vendor").exists() {
        std::path::PathBuf::from("frontend/vendor")
    } else {
        exe_dir.join("frontend/vendor")
    };

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .nest_service("/vendor", ServeDir::new(vendor_dir))
        .fallback_service(ServeDir::new(frontend_dir))
        .with_state(state);

    let addr = format!("0.0.0.0:{}", port);

    // mTLS mode if certs/ exists, otherwise plain HTTP + PIN
    if crate::tls::is_mtls_configured() {
        let tls_config = crate::tls::build_tls_config()?;
        let rustls_config =
            axum_server::tls_rustls::RustlsConfig::from_config(std::sync::Arc::new(tls_config));
        eprintln!("[remote] listening on {} (HTTPS + mTLS)", addr);
        axum_server::bind_rustls(addr.parse()?, rustls_config)
            .serve(app.into_make_service())
            .await?;
    } else {
        eprintln!("[remote] listening on {} (HTTP + PIN)", addr);
        let listener = tokio::net::TcpListener::bind(&addr).await?;
        axum::serve(listener, app).await?;
    }

    Ok(())
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<WsParams>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    // mTLS mode: client cert already verified at TLS layer, skip PIN check
    // PIN mode: require token parameter
    if !crate::tls::is_mtls_configured() {
        let token = params.token.unwrap_or_default();
        if token != state.auth_token {
            return StatusCode::UNAUTHORIZED.into_response();
        }
    }
    ws.on_upgrade(move |socket| handle_ws(socket, state))
        .into_response()
}

async fn handle_ws(socket: WebSocket, state: Arc<AppState>) {
    let (ws_tx, mut ws_rx) = socket.split();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();

    let active = Arc::new(AtomicBool::new(false));
    let active_w = active.clone();

    let mut pty_rx = state.pty_broadcast.subscribe();
    let mut exit_rx = state.exit_broadcast.subscribe();

    // Writer task: forwards PTY output directly
    let mut ws_tx = ws_tx;
    let write_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                Some(msg) = out_rx.recv() => {
                    if ws_tx.send(Message::Text(msg)).await.is_err() {
                        break;
                    }
                }
                result = pty_rx.recv() => {
                    match result {
                        Ok((id, data)) => {
                            if active_w.load(Ordering::Relaxed) {
                                let event = json!({
                                    "event": "pty-output",
                                    "surface_id": id.to_string(),
                                    "data": BASE64.encode(&data),
                                });
                                if ws_tx.send(Message::Text(event.to_string())).await.is_err() {
                                    break;
                                }
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
                result = exit_rx.recv() => {
                    match result {
                        Ok(id) => {
                            let event = json!({
                                "event": "pty-exit",
                                "surface_id": id.to_string(),
                            });
                            if ws_tx.send(Message::Text(event.to_string())).await.is_err() {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
            }
        }
    });

    // Reader loop
    while let Some(Ok(msg)) = ws_rx.next().await {
        let text = match msg {
            Message::Text(t) => t.to_string(),
            Message::Close(_) => break,
            _ => continue,
        };

        let req: Request = match serde_json::from_str(&text) {
            Ok(r) => r,
            Err(_) => continue,
        };

        // client.init: resize all surface PTYs to client size + activate streaming
        if req.method == "client.init" {
            let params_val = req.params.as_ref().unwrap_or(&serde_json::Value::Null);
            let cols = params_val
                .get("cols")
                .and_then(|v| v.as_u64())
                .unwrap_or(80) as u16;
            let rows = params_val
                .get("rows")
                .and_then(|v| v.as_u64())
                .unwrap_or(24) as u16;

            {
                let mut core = state.core.lock().await;
                for surface in core.surfaces.values_mut() {
                    surface.resize(cols, rows);
                }
            }

            active.store(true, Ordering::Relaxed);

            let resp = json!({"id": req.id, "ok": true, "result": {}});
            let _ = out_tx.send(resp.to_string());
            continue;
        }

        // Web-only RPC: filesystem access
        if req.method == "fs.read" {
            let resp = handle_fs_read(&req);
            let _ = out_tx.send(serde_json::to_string(&resp).unwrap_or_default());
            continue;
        }
        if req.method == "fs.write" {
            let resp = handle_fs_write(&req);
            let _ = out_tx.send(serde_json::to_string(&resp).unwrap_or_default());
            continue;
        }

        // Web-only RPC: config
        if req.method == "config.workspace_root" {
            let root = crate::get_workspace_root_path();
            let resp = Response::success(req.id.clone(), json!(root));
            let _ = out_tx.send(serde_json::to_string(&resp).unwrap_or_default());
            continue;
        }

        // All other commands → wmux-core dispatch
        let mut core = state.core.lock().await;
        let resp = dispatch(&mut core, &req, &state.pty_tx, &state.exit_tx);
        drop(core);

        if let Ok(json_str) = serde_json::to_string(&resp) {
            let _ = out_tx.send(json_str);
        }
    }

    write_task.abort();

    // Restore desktop sizes from split layout
    {
        let mut core = state.core.lock().await;
        let (w, h) = core.terminal_size;
        let all_layouts: Vec<_> = core
            .workspaces
            .iter()
            .flat_map(|ws| ws.split_tree.layout(0, 0, w, h))
            .collect();
        for layout in &all_layouts {
            if let Some(surface) = core.surfaces.get_mut(&layout.surface_id) {
                surface.resize(
                    layout.width.saturating_sub(2),
                    layout.height.saturating_sub(2),
                );
            }
        }
    }

    eprintln!("[remote] client disconnected, desktop size restored");
}

fn handle_fs_read(req: &Request) -> Response {
    let params = req.params.as_ref().unwrap_or(&serde_json::Value::Null);
    let path = params.get("path").and_then(|v| v.as_str()).unwrap_or("");
    match std::fs::read_to_string(path) {
        Ok(content) => Response::success(req.id.clone(), json!(content)),
        Err(e) => Response::error(req.id.clone(), "read_failed", &e.to_string()),
    }
}

fn handle_fs_write(req: &Request) -> Response {
    let params = req.params.as_ref().unwrap_or(&serde_json::Value::Null);
    let path = params.get("path").and_then(|v| v.as_str()).unwrap_or("");
    let content = params.get("content").and_then(|v| v.as_str()).unwrap_or("");
    match std::fs::write(path, content) {
        Ok(()) => Response::success(req.id.clone(), json!({})),
        Err(e) => Response::error(req.id.clone(), "write_failed", &e.to_string()),
    }
}
