use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::session::AgentEvent;
use crate::{on_event_received, AppServices};

#[derive(Debug, Deserialize)]
struct IpcRequest {
    event: AgentEvent,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IpcResponse {
    ok: bool,
    decision: Option<Value>,
    error: Option<String>,
}

pub fn socket_path() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
        .join(".agentisland")
        .join("run")
        .join("agentisland.sock")
}

pub fn start_ipc_server(
    app: tauri::AppHandle,
    services: Arc<AppServices>,
) -> tauri::Result<()> {
    let socket_path = socket_path();
    if let Some(parent) = socket_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if socket_path.exists() {
        let _ = std::fs::remove_file(&socket_path);
    }

    let std_listener = std::os::unix::net::UnixListener::bind(&socket_path)?;
    let app_handle = app.clone();
    let services_handle = services.clone();

    std::thread::spawn(move || {
        loop {
            let Ok((mut stream, _)) = std_listener.accept() else {
                continue;
            };

            let app = app_handle.clone();
            let services = services_handle.clone();

            std::thread::spawn(move || {
                let mut buffer = Vec::new();
                if std::io::Read::read_to_end(&mut stream, &mut buffer).is_err() {
                    return;
                }

                let request = serde_json::from_slice::<IpcRequest>(&buffer);
                let response = match request {
                    Ok(payload) => match on_event_received(&app, &services, payload.event) {
                        Ok(()) => IpcResponse {
                            ok: true,
                            decision: None,
                            error: None,
                        },
                        Err(error) => IpcResponse {
                            ok: false,
                            decision: None,
                            error: Some(error),
                        },
                    },
                    Err(error) => IpcResponse {
                        ok: false,
                        decision: None,
                        error: Some(error.to_string()),
                    },
                };

                let _ = std::io::Write::write_all(
                    &mut stream,
                    &serde_json::to_vec(&response).unwrap_or_default(),
                );
                let _ = stream.shutdown(std::net::Shutdown::Write);
            });
        }
    });

    Ok(())
}
