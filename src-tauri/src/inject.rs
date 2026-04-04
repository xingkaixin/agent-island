use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde_json::{json, Value};

use crate::session::InstallStatusItem;

const CLAUDE_EVENTS: &[(&str, bool, bool)] = &[
    ("Notification", true, false),
    ("PermissionRequest", true, true),
    ("PostToolUse", true, false),
    ("PreCompact", false, false),
    ("PreToolUse", true, false),
    ("SessionEnd", false, false),
    ("SessionStart", false, false),
    ("Stop", false, false),
    ("SubagentStart", false, false),
    ("SubagentStop", false, false),
    ("UserPromptSubmit", false, false),
];

const CODEX_EVENTS: &[&str] = &["SessionStart", "Stop", "UserPromptSubmit"];
const CURSOR_EVENTS: &[&str] = &[
    "afterAgentResponse",
    "afterAgentThought",
    "afterFileEdit",
    "afterMCPExecution",
    "afterShellExecution",
    "beforeMCPExecution",
    "beforeReadFile",
    "beforeShellExecution",
    "beforeSubmitPrompt",
    "stop",
];

pub fn ensure_bridge_installed() -> Result<(), Box<dyn std::error::Error>> {
    let home = std::env::var("HOME")?;
    let bridge_dir = Path::new(&home).join(".agentisland/bin");
    fs::create_dir_all(&bridge_dir)?;
    let bridge_path = bridge_dir.join("agentisland-bridge");
    fs::write(
        &bridge_path,
        include_str!("../../scripts/agentisland-bridge"),
    )?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&bridge_path)?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&bridge_path, permissions)?;
    }

    Ok(())
}

pub fn agent_config_path(agent: &str) -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    match agent {
        "claude" => Path::new(&home).join(".claude/settings.json"),
        "codex" => Path::new(&home).join(".codex/hooks.json"),
        "cursor" => Path::new(&home).join(".cursor/hooks.json"),
        _ => PathBuf::from(""),
    }
}

pub fn install_status() -> Vec<InstallStatusItem> {
    let bridge_activity = latest_bridge_activity();
    ["claude", "codex", "cursor"]
        .into_iter()
        .map(|agent| {
            let path = agent_config_path(agent);
            let exists = path.exists();
            let injected = if exists {
                fs::read_to_string(&path)
                    .map(|content| content.contains(".agentisland/bin/agentisland-bridge"))
                    .unwrap_or(false)
            } else {
                false
            };
            let backup_path = latest_backup_path(&path).map(|path| path.display().to_string());
            let activity = bridge_activity.get(agent);

            InstallStatusItem {
                agent: agent.into(),
                path: path.display().to_string(),
                exists,
                injected,
                backup_path,
                last_seen_at: activity.map(|item| item.timestamp.to_rfc3339()),
                last_seen_kind: activity.map(|item| item.kind.clone()),
                last_seen_workspace: activity.and_then(|item| item.workspace.clone()),
            }
        })
        .collect()
}

pub fn inject_agent_hooks_impl(agent: &str) -> Result<(), Box<dyn std::error::Error>> {
    let path = agent_config_path(agent);
    ensure_parent(&path)?;
    backup_file(&path)?;

    match agent {
        "claude" => write_json(&path, build_claude_hooks(read_json_or_default(&path)?))?,
        "codex" => write_json(&path, build_codex_hooks(read_json_or_default(&path)?))?,
        "cursor" => write_json(&path, build_cursor_hooks(read_json_or_default(&path)?))?,
        _ => {}
    }

    Ok(())
}

pub fn remove_agent_hooks_impl(agent: &str) -> Result<(), Box<dyn std::error::Error>> {
    let path = agent_config_path(agent);
    if !path.exists() {
        return Ok(());
    }

    let mut value = read_json_or_default(&path)?;
    match agent {
        "claude" | "codex" | "cursor" => remove_agentisland_entries(&mut value),
        _ => {}
    }
    write_json(&path, value)?;
    Ok(())
}

pub fn restore_agent_backup_impl(agent: &str) -> Result<(), Box<dyn std::error::Error>> {
    let path = agent_config_path(agent);
    let Some(backup) = latest_backup_path(&path) else {
        return Ok(());
    };
    fs::copy(backup, path)?;
    Ok(())
}

fn remove_agentisland_entries(value: &mut Value) {
    let Some(hooks) = value.get_mut("hooks").and_then(Value::as_object_mut) else {
        return;
    };

    let keys = hooks.keys().cloned().collect::<Vec<_>>();
    for key in keys {
        if let Some(entries) = hooks.get_mut(&key).and_then(Value::as_array_mut) {
            entries.retain(|entry| {
                !entry
                    .to_string()
                    .contains(".agentisland/bin/agentisland-bridge")
            });
            if entries.is_empty() {
                hooks.remove(&key);
            }
        }
    }
}

fn build_claude_hooks(mut root: Value) -> Value {
    let command = bridge_command("claude");
    let hooks = root
        .as_object_mut()
        .unwrap()
        .entry("hooks")
        .or_insert_with(|| json!({}));

    let hooks_map = hooks.as_object_mut().unwrap();
    for (event, needs_matcher, is_permission) in CLAUDE_EVENTS {
        hooks_map.insert(
            (*event).into(),
            json!([{
                "matcher": if *needs_matcher { json!("*") } else { Value::Null },
                "hooks": [{
                    "command": command,
                    "type": "command",
                    "timeout": if *is_permission { json!(86400) } else { Value::Null }
                }]
            }]),
        );
        cleanup_nulls(hooks_map.get_mut(*event).unwrap());
    }
    root
}

fn build_codex_hooks(mut root: Value) -> Value {
    let command = bridge_command("codex");
    let hooks = root
        .as_object_mut()
        .unwrap()
        .entry("hooks")
        .or_insert_with(|| json!({}));
    let hooks_map = hooks.as_object_mut().unwrap();

    for event in CODEX_EVENTS {
        hooks_map.insert(
            (*event).into(),
            json!([{
                "hooks": [{
                    "command": command,
                    "timeout": 5,
                    "type": "command"
                }]
            }]),
        );
    }
    root
}

fn build_cursor_hooks(mut root: Value) -> Value {
    if !root.is_object() {
        root = json!({});
    }
    let command = bridge_command("cursor");
    let hooks = root
        .as_object_mut()
        .unwrap()
        .entry("hooks")
        .or_insert_with(|| json!({}));
    let hooks_map = hooks.as_object_mut().unwrap();
    for event in CURSOR_EVENTS {
        hooks_map.insert(
            (*event).into(),
            json!([{
                "command": command
            }]),
        );
    }
    root.as_object_mut()
        .unwrap()
        .insert("version".into(), json!(1));
    root
}

fn cleanup_nulls(value: &mut Value) {
    match value {
        Value::Object(map) => {
            let keys = map.keys().cloned().collect::<Vec<_>>();
            for key in keys {
                if map.get(&key) == Some(&Value::Null) {
                    map.remove(&key);
                    continue;
                }
                if let Some(child) = map.get_mut(&key) {
                    cleanup_nulls(child);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(cleanup_nulls),
        _ => {}
    }
}

fn bridge_command(source: &str) -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    format!("{home}/.agentisland/bin/agentisland-bridge --source {source}")
}

fn read_json_or_default(path: &Path) -> Result<Value, Box<dyn std::error::Error>> {
    if !path.exists() {
        return Ok(json!({}));
    }
    let content = fs::read_to_string(path)?;
    if content.trim().is_empty() {
        return Ok(json!({}));
    }
    Ok(serde_json::from_str(&content)?)
}

#[derive(Clone)]
struct BridgeActivity {
    timestamp: DateTime<Utc>,
    kind: String,
    workspace: Option<String>,
}

fn latest_bridge_activity() -> std::collections::HashMap<&'static str, BridgeActivity> {
    let path = Path::new(&std::env::var("HOME").unwrap_or_default())
        .join(".agentisland")
        .join("logs")
        .join("bridge.log");
    let Ok(content) = fs::read_to_string(path) else {
        return std::collections::HashMap::new();
    };

    let mut result = std::collections::HashMap::new();
    for line in content.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if value.get("stage").and_then(Value::as_str) != Some("incoming") {
            continue;
        }

        let payload = value.get("payload").and_then(Value::as_object);
        let event = payload.and_then(|payload| payload.get("event"));
        let Some(source) = event
            .and_then(|event| event.get("source"))
            .and_then(Value::as_str)
        else {
            continue;
        };
        if !matches!(source, "claude" | "codex" | "cursor") {
            continue;
        }

        let Some(timestamp) = value
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(|raw| DateTime::parse_from_rfc3339(raw).ok())
            .map(|value| value.with_timezone(&Utc))
        else {
            continue;
        };

        let kind = event
            .and_then(|event| event.get("kind"))
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        let workspace = payload
            .and_then(|payload| payload.get("raw"))
            .and_then(extract_workspace_hint);

        result.insert(
            match source {
                "claude" => "claude",
                "codex" => "codex",
                "cursor" => "cursor",
                _ => unreachable!(),
            },
            BridgeActivity {
                timestamp,
                kind,
                workspace,
            },
        );
    }

    result
}

fn extract_workspace_hint(raw: &Value) -> Option<String> {
    raw.get("workspace_roots")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| raw.get("cwd").and_then(Value::as_str).map(str::to_string))
}

fn write_json(path: &Path, value: Value) -> Result<(), Box<dyn std::error::Error>> {
    fs::write(path, serde_json::to_vec_pretty(&value)?)?;
    Ok(())
}

fn ensure_parent(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(())
}

fn backup_file(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    if !path.exists() {
        return Ok(());
    }
    let timestamp = Utc::now().format("%Y-%m-%dT%H-%M-%SZ");
    let backup_path = PathBuf::from(format!("{}.backup.{timestamp}", path.display()));
    fs::copy(path, backup_path)?;
    Ok(())
}

fn latest_backup_path(path: &Path) -> Option<PathBuf> {
    let file_name = path.file_name()?.to_string_lossy();
    let parent = path.parent()?;
    let mut backups = fs::read_dir(parent)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|candidate| {
            candidate
                .file_name()
                .map(|name| {
                    name.to_string_lossy()
                        .starts_with(&format!("{file_name}.backup."))
                })
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    backups.sort();
    backups.pop()
}
