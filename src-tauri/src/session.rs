use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub source: String,
    pub session_id: String,
    pub timestamp: Option<DateTime<Utc>>,
    pub kind: String,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequestView {
    pub request_id: String,
    pub session_id: String,
    pub source: String,
    pub tool_name: String,
    pub summary: String,
    pub raw_args_preview: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub id: String,
    pub source: String,
    pub title: String,
    pub status: String,
    pub status_detail: String,
    pub cwd: Option<String>,
    pub started_at: DateTime<Utc>,
    pub duration_ms: i64,
    pub has_pending_permission: bool,
    pub needs_user_attention: bool,
    pub subagent_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallStatusItem {
    pub agent: String,
    pub path: String,
    pub exists: bool,
    pub injected: bool,
    pub backup_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: String,
    pub source: String,
    pub session_id: Option<String>,
    pub kind: String,
    pub created_at: DateTime<Utc>,
    pub raw: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStateSnapshot {
    pub sessions: Vec<SessionView>,
    pub permission_request: Option<PermissionRequestView>,
    pub install_status: Vec<InstallStatusItem>,
    pub preferences: crate::settings::UserPreferences,
    pub logs: Vec<LogEntry>,
}

#[derive(Debug, Clone)]
struct SessionRecord {
    id: String,
    source: String,
    title: String,
    status: String,
    status_detail: String,
    cwd: Option<String>,
    started_at: DateTime<Utc>,
    has_pending_permission: bool,
    needs_user_attention: bool,
    subagent_count: u32,
}

pub struct SessionStore {
    sessions: HashMap<String, SessionRecord>,
    logs: Vec<LogEntry>,
    log_path: PathBuf,
}

impl SessionStore {
    pub fn new(log_path: PathBuf) -> Self {
        Self {
            sessions: HashMap::new(),
            logs: Vec::new(),
            log_path,
        }
    }

    pub fn push_log(&mut self, entry: LogEntry) {
        if let Some(parent) = self.log_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_path)
        {
            let _ = writeln!(file, "{}", serde_json::to_string(&entry).unwrap_or_default());
        }

        self.logs.push(entry);
        if self.logs.len() > 500 {
            let drop_count = self.logs.len() - 500;
            self.logs.drain(0..drop_count);
        }
    }

    pub fn recent_logs(&self, limit: usize) -> Vec<LogEntry> {
        self.logs
            .iter()
            .rev()
            .take(limit)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    }

    pub fn apply_event(&mut self, event: &AgentEvent) -> Option<PermissionRequestView> {
        let now = event.timestamp.unwrap_or_else(Utc::now);
        let session = self.sessions.entry(event.session_id.clone()).or_insert_with(|| SessionRecord {
            id: event.session_id.clone(),
            source: event.source.clone(),
            title: format!("{} session", event.source),
            status: "running".into(),
            status_detail: "running".into(),
            cwd: event
                .payload
                .get("cwd")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            started_at: now,
            has_pending_permission: false,
            needs_user_attention: false,
            subagent_count: 0,
        });

        if let Some(cwd) = event.payload.get("cwd").and_then(Value::as_str) {
            session.cwd = Some(cwd.to_string());
        }

        let clears_attention = matches!(
            event.kind.as_str(),
            "session_start"
                | "SessionStart"
                | "prompt_submit"
                | "UserPromptSubmit"
                | "beforeSubmitPrompt"
                | "tool_start"
                | "PreToolUse"
                | "tool_end"
                | "PostToolUse"
                | "beforeShellExecution"
                | "shell_start"
                | "afterShellExecution"
                | "shell_end"
                | "beforeMCPExecution"
                | "mcp_start"
                | "afterMCPExecution"
                | "mcp_end"
                | "beforeReadFile"
                | "file_read"
                | "afterFileEdit"
                | "file_edit"
        );
        if clears_attention {
            session.needs_user_attention = false;
        }

        match event.kind.as_str() {
            "session_start" | "SessionStart" => {
                session.status = "running".into();
                session.status_detail = "session started".into();
            }
            "prompt_submit" | "UserPromptSubmit" | "beforeSubmitPrompt" => {
                session.status = "thinking".into();
                session.status_detail = "thinking".into();
            }
            "tool_start" | "PreToolUse" => {
                session.status = "tool".into();
                let tool_name = event.payload.get("toolName").and_then(Value::as_str).unwrap_or("tool");
                session.status_detail = format!("using tool: {tool_name}");
            }
            "tool_end" | "PostToolUse" => {
                session.status = "running".into();
                session.status_detail = "running".into();
            }
            "compact" | "PreCompact" => {
                session.status = "compact".into();
                session.status_detail = "compacting context".into();
            }
            "notification" | "Notification" | "afterAgentThought" => {
                session.status = "attention".into();
                session.status_detail = event
                    .payload
                    .get("message")
                    .or_else(|| event.payload.get("summary"))
                    .or_else(|| event.payload.get("title"))
                    .and_then(Value::as_str)
                    .unwrap_or("needs user attention")
                    .to_string();
                session.needs_user_attention = true;
            }
            "permission_request" | "PermissionRequest" => {
                session.status = "permission".into();
                session.has_pending_permission = true;
                session.status_detail = "permission requested".into();
                let tool_name = event
                    .payload
                    .get("toolName")
                    .or_else(|| event.payload.get("tool_name"))
                    .or_else(|| event.payload.get("tool"))
                    .and_then(Value::as_str)
                    .unwrap_or("Unknown Tool")
                    .to_string();
                let summary = event
                    .payload
                    .get("summary")
                    .and_then(Value::as_str)
                    .or_else(|| event.payload.get("message").and_then(Value::as_str))
                    .or_else(|| event.payload.get("toolInputSummary").and_then(Value::as_str))
                    .unwrap_or("等待审批")
                    .to_string();
                let request_id = event
                    .payload
                    .get("requestId")
                    .or_else(|| event.payload.get("request_id"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| Uuid::new_v4().to_string());
                let raw_args_preview = event
                    .payload
                    .get("toolArgs")
                    .or_else(|| event.payload.get("tool_args"))
                    .or_else(|| event.payload.get("toolInput"))
                    .or_else(|| event.payload.get("tool_input"))
                    .map(|value| serde_json::to_string_pretty(value).unwrap_or_default());

                return Some(PermissionRequestView {
                    request_id,
                    session_id: session.id.clone(),
                    source: session.source.clone(),
                    tool_name,
                    summary,
                    raw_args_preview,
                    created_at: now,
                });
            }
            "permission_resolved" => {
                session.has_pending_permission = false;
                session.status = "running".into();
                session.status_detail = "permission resolved".into();
            }
            "subagent_start" | "SubagentStart" => {
                session.subagent_count += 1;
                session.status_detail = format!("{} subagent running", session.subagent_count);
            }
            "subagent_stop" | "SubagentStop" => {
                session.subagent_count = session.subagent_count.saturating_sub(1);
                session.status_detail = "running".into();
            }
            "beforeShellExecution" | "shell_start" => {
                session.status = "shell".into();
                session.status_detail = "running shell command".into();
            }
            "afterShellExecution" | "shell_end" => {
                session.status = "running".into();
                session.status_detail = "shell finished".into();
            }
            "beforeMCPExecution" | "mcp_start" => {
                session.status = "mcp".into();
                session.status_detail = "calling MCP".into();
            }
            "afterMCPExecution" | "mcp_end" => {
                session.status = "running".into();
                session.status_detail = "MCP finished".into();
            }
            "beforeReadFile" | "file_read" => {
                session.status = "file".into();
                session.status_detail = "reading file".into();
            }
            "afterFileEdit" | "file_edit" => {
                session.status = "file".into();
                session.status_detail = "editing file".into();
            }
            "stop" | "Stop" | "session_end" | "SessionEnd" => {
                session.status = "done".into();
                session.status_detail = "done".into();
                session.has_pending_permission = false;
            }
            "error" => {
                session.status = "error".into();
                session.status_detail = event
                    .payload
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("error")
                    .to_string();
            }
            _ => {}
        }

        None
    }

    pub fn snapshot(&self) -> Vec<SessionView> {
        let now = Utc::now();
        let mut sessions = self
            .sessions
            .values()
            .filter(|session| !matches!(session.status.as_str(), "done" | "error"))
            .cloned()
            .map(|session| SessionView {
                id: session.id,
                source: session.source,
                title: session.title,
                status: session.status,
                status_detail: session.status_detail,
                cwd: session.cwd,
                started_at: session.started_at,
                duration_ms: (now - session.started_at).num_milliseconds(),
                has_pending_permission: session.has_pending_permission,
                needs_user_attention: session.needs_user_attention,
                subagent_count: session.subagent_count,
            })
            .collect::<Vec<_>>();

        sessions.sort_by_key(|session| {
            (
                !session.has_pending_permission,
                !session.needs_user_attention,
                session.started_at,
            )
        });
        sessions
    }

    pub fn mark_permission_resolved(&mut self, session_id: &str, decision: &str) {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.has_pending_permission = false;
            session.status = "running".into();
            session.status_detail = format!("permission {decision}");
        }
    }
}
