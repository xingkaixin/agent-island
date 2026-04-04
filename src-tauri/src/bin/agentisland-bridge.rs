use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;

use serde_json::{json, Value};

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args = std::env::args().collect::<Vec<_>>();
    let source = args
        .windows(2)
        .find(|window| window[0] == "--source")
        .map(|window| window[1].clone())
        .unwrap_or_else(|| "unknown".into());

    let mut stdin = String::new();
    std::io::stdin().read_to_string(&mut stdin)?;
    let raw: Value = if stdin.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(&stdin)?
    };

    let session_id = extract_session_id(&raw);
    let kind = extract_kind(&raw);

    let payload = json!({
        "event": {
            "source": source,
            "sessionId": session_id,
            "timestamp": chrono::Utc::now(),
            "kind": kind,
            "payload": raw
        }
    });

    let socket_path = socket_path();
    let mut socket = UnixStream::connect(socket_path)?;
    socket.write_all(serde_json::to_string(&payload)?.as_bytes())?;
    socket.shutdown(std::net::Shutdown::Write)?;

    let mut response = String::new();
    socket.read_to_string(&mut response)?;
    if response.trim().is_empty() {
        return Ok(());
    }

    let response: Value = serde_json::from_str(&response)?;
    if !response.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        return Err(response
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("ipc request failed")
            .into());
    }

    if let Some(decision) = response.get("decision") {
        print!("{}", serde_json::to_string(decision)?);
    }

    Ok(())
}

fn extract_session_id(raw: &Value) -> String {
    first_str(raw, &[
        &["sessionId"],
        &["session_id"],
        &["conversationId"],
        &["conversation_id"],
        &["chatId"],
        &["chat_id"],
        &["payload", "sessionId"],
        &["payload", "session_id"],
    ])
    .unwrap_or("unknown-session")
    .to_string()
}

fn extract_kind(raw: &Value) -> String {
    first_str(raw, &[
        &["hookEventName"],
        &["eventName"],
        &["event_name"],
        &["event"],
        &["kind"],
        &["type"],
        &["payload", "hookEventName"],
        &["payload", "eventName"],
        &["payload", "event"],
        &["payload", "kind"],
        &["payload", "type"],
    ])
    .unwrap_or("unknown")
    .to_string()
}

fn first_str<'a>(value: &'a Value, paths: &[&[&str]]) -> Option<&'a str> {
    paths
        .iter()
        .find_map(|path| value_at_path(value, path).and_then(Value::as_str))
}

fn value_at_path<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for segment in path {
        current = current.get(*segment)?;
    }
    Some(current)
}

fn socket_path() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
        .join(".agentisland")
        .join("run")
        .join("agentisland.sock")
}
