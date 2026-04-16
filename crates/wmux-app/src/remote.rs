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
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::mpsc;
use tower_http::services::ServeDir;
use uuid::Uuid;
use wmux_core::socket::commands::dispatch;
use wmux_core::socket::protocol::Request;

// vt100::Parser doesn't implement Send but is only used within a single task
struct SendParser(vt100::Parser);
unsafe impl Send for SendParser {}
impl SendParser {
    fn new(rows: u16, cols: u16) -> Self {
        Self(vt100::Parser::new(rows, cols, 0))
    }
    fn process(&mut self, data: &[u8]) {
        self.0.process(data);
    }
    fn screen(&self) -> &vt100::Screen {
        self.0.screen()
    }
}

#[derive(Deserialize)]
struct WsParams {
    token: Option<String>,
}

pub async fn start_remote_server(
    state: Arc<AppState>,
    port: u16,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Resolve frontend paths
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_default();

    // Try dev path first, then relative to exe
    let mobile_dir = if std::path::Path::new("frontend-mobile").exists() {
        std::path::PathBuf::from("frontend-mobile")
    } else {
        exe_dir.join("frontend-mobile")
    };

    let vendor_dir = if std::path::Path::new("frontend/vendor").exists() {
        std::path::PathBuf::from("frontend/vendor")
    } else {
        exe_dir.join("frontend/vendor")
    };

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .nest_service("/vendor", ServeDir::new(vendor_dir))
        .fallback_service(ServeDir::new(mobile_dir))
        .with_state(state);

    let addr = format!("0.0.0.0:{}", port);
    eprintln!("[remote] listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<WsParams>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let token = params.token.unwrap_or_default();
    if token != state.auth_token {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    ws.on_upgrade(move |socket| handle_ws(socket, state))
        .into_response()
}

async fn handle_ws(socket: WebSocket, state: Arc<AppState>) {
    let (ws_tx, mut ws_rx) = socket.split();

    // Channel for sending responses/events to the WebSocket writer
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();

    // Channel for reader→writer: client terminal size
    let (size_tx, mut size_rx) = mpsc::unbounded_channel::<(u16, u16)>();

    // Subscribe to broadcast channels
    let mut pty_rx = state.pty_broadcast.subscribe();
    let mut exit_rx = state.exit_broadcast.subscribe();

    // Writer task: sends all outgoing messages (responses + events)
    // Maintains per-surface vt100 parser pairs for client-sized re-rendering
    let mut ws_tx = ws_tx;
    let write_state = state.clone();
    let write_task = tokio::spawn(async move {
        // Per-surface parser pairs: (prev_parser, current_parser)
        let mut parsers: HashMap<Uuid, (SendParser, SendParser)> = HashMap::new();
        let mut proxy_active = false;

        loop {
            tokio::select! {
                Some(msg) = out_rx.recv() => {
                    if ws_tx.send(Message::Text(msg)).await.is_err() {
                        break;
                    }
                }
                // Receive client terminal size → initialize parsers
                Some((cols, rows)) = size_rx.recv() => {
                    parsers.clear();
                    // Collect surface data while holding lock, then release
                    let surface_data: Vec<(Uuid, Vec<u8>)> = {
                        let core = write_state.core.lock().await;
                        core.surfaces.iter()
                            .map(|(id, s)| (*id, s.output_history.clone()))
                            .collect()
                    };
                    for (id, history) in &surface_data {
                        let mut prev = SendParser::new(rows, cols);
                        let mut curr = SendParser::new(rows, cols);
                        prev.process(history);
                        curr.process(history);
                        let formatted = curr.screen().contents_formatted();
                        if !formatted.is_empty() {
                            let event = json!({
                                "event": "pty-output",
                                "surface_id": id.to_string(),
                                "data": BASE64.encode(&formatted),
                            });
                            let _ = ws_tx.send(Message::Text(event.to_string())).await;
                        }
                        parsers.insert(*id, (prev, curr));
                    }
                    proxy_active = true;
                }
                result = pty_rx.recv() => {
                    match result {
                        Ok((id, data)) => {
                            if proxy_active {
                                // Proxy mode: re-render through client-sized parsers
                                if let Some((prev, curr)) = parsers.get_mut(&id) {
                                    curr.process(&data);
                                    let diff = curr.screen().contents_diff(prev.screen());
                                    prev.process(&data);
                                    if !diff.is_empty() {
                                        let event = json!({
                                            "event": "pty-output",
                                            "surface_id": id.to_string(),
                                            "data": BASE64.encode(&diff),
                                        });
                                        if ws_tx.send(Message::Text(event.to_string())).await.is_err() {
                                            break;
                                        }
                                    }
                                } else {
                                    // New surface (created after client.init) → create parsers
                                    let history = {
                                        let core = write_state.core.lock().await;
                                        core.surfaces.get(&id).map(|s| s.output_history.clone())
                                    };
                                    if let Some(history) = history {
                                        let (rows, cols): (u16, u16) = parsers.values().next()
                                            .map(|(p, _): &(SendParser, SendParser)| p.screen().size())
                                            .unwrap_or((24, 80));
                                        let mut prev = SendParser::new(rows, cols);
                                        let mut curr = SendParser::new(rows, cols);
                                        prev.process(&history);
                                        curr.process(&history);
                                        let formatted = curr.screen().contents_formatted();
                                        if !formatted.is_empty() {
                                            let event = json!({
                                                "event": "pty-output",
                                                "surface_id": id.to_string(),
                                                "data": BASE64.encode(&formatted),
                                            });
                                            let _ = ws_tx.send(Message::Text(event.to_string())).await;
                                        }
                                        parsers.insert(id, (prev, curr));
                                    }
                                }
                            } else {
                                // Raw mode (before client.init)
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
                            parsers.remove(&id);
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

    // Reader loop: receives commands from WebSocket client
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

        // Handle client.init: send terminal size to write_task
        if req.method == "client.init" {
            let params = req.params.as_ref().unwrap_or(&serde_json::Value::Null);
            let cols = params.get("cols").and_then(|v| v.as_u64()).unwrap_or(80) as u16;
            let rows = params.get("rows").and_then(|v| v.as_u64()).unwrap_or(24) as u16;
            let _ = size_tx.send((cols, rows));
            let resp = serde_json::json!({"id": req.id, "ok": true, "result": {}});
            let _ = out_tx.send(resp.to_string());
            continue;
        }

        let mut core = state.core.lock().await;
        let resp = dispatch(&mut core, &req, &state.pty_tx, &state.exit_tx);
        drop(core);

        if let Ok(json) = serde_json::to_string(&resp) {
            let _ = out_tx.send(json);
        }
    }

    write_task.abort();
    eprintln!("[remote] client disconnected");
}
