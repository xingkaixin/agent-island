use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::time::Instant;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::launcher::{LauncherResolver, LauncherView};

const SESSION_IDLE_TIMEOUT_MS: i64 = 30_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub source: String,
    pub session_id: String,
    pub timestamp: Option<DateTime<Utc>>,
    pub kind: String,
    #[serde(default)]
    pub launcher: Option<LauncherView>,
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
    pub launcher: Option<LauncherView>,
    pub recent_hooks: Vec<SessionHookPreview>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionHookPreview {
    pub kind: String,
    pub text: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallStatusItem {
    pub agent: String,
    pub path: String,
    pub exists: bool,
    pub injected: bool,
    pub backup_path: Option<String>,
    pub last_seen_at: Option<String>,
    pub last_seen_kind: Option<String>,
    pub last_seen_workspace: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineLogEntry {
    pub id: String,
    pub source: String,
    pub session_id: Option<String>,
    pub kind: String,
    pub created_at: DateTime<Utc>,
    pub channel: String,
    pub stage: Option<String>,
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
    last_event_at: DateTime<Utc>,
    has_pending_permission: bool,
    needs_user_attention: bool,
    subagent_count: u32,
    launcher: Option<LauncherView>,
    recent_hooks: Vec<SessionHookPreview>,
}

pub struct SessionStore {
    sessions: HashMap<String, SessionRecord>,
    logs: Vec<LogEntry>,
    log_path: PathBuf,
    launcher_resolver: LauncherResolver,
}

impl SessionStore {
    pub fn new(log_path: PathBuf, _icon_cache_dir: PathBuf) -> Self {
        Self {
            sessions: HashMap::new(),
            logs: Vec::new(),
            log_path,
            launcher_resolver: LauncherResolver::new(),
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
            let _ = writeln!(
                file,
                "{}",
                serde_json::to_string(&entry).unwrap_or_default()
            );
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

    /// Clears in-memory logs and truncates the persisted JSONL file.
    pub fn clear_logs(&mut self) -> Result<(), std::io::Error> {
        self.logs.clear();
        if let Some(parent) = self.log_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::File::create(&self.log_path)?;
        Ok(())
    }

    pub fn prune_logs_older_than(
        &mut self,
        bridge_log_path: &PathBuf,
        cutoff: DateTime<Utc>,
    ) -> Result<bool, std::io::Error> {
        let event_changed = prune_json_lines(&self.log_path, |line| {
            let entry = serde_json::from_str::<LogEntry>(line).ok()?;
            Some(entry.created_at >= cutoff)
        })?;
        let bridge_changed = prune_json_lines(bridge_log_path, |line| {
            let value = serde_json::from_str::<Value>(line).ok()?;
            let timestamp = value
                .get("timestamp")
                .and_then(Value::as_str)
                .and_then(parse_timestamp)?;
            Some(timestamp >= cutoff)
        })?;

        let original_len = self.logs.len();
        self.logs.retain(|entry| entry.created_at >= cutoff);

        Ok(event_changed || bridge_changed || self.logs.len() != original_len)
    }

    pub fn log_timeline(&self, limit: usize, bridge_log_path: &PathBuf) -> Vec<TimelineLogEntry> {
        let total_started = Instant::now();

        let event_started = Instant::now();
        let mut entries = read_event_log_entries(&self.log_path);
        let event_count = entries.len();
        let event_elapsed = event_started.elapsed();

        let bridge_started = Instant::now();
        let bridge_entries = read_bridge_log_entries(bridge_log_path);
        let bridge_count = bridge_entries.len();
        let bridge_elapsed = bridge_started.elapsed();

        entries.extend(bridge_entries);

        let sort_started = Instant::now();
        entries.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        let sort_elapsed = sort_started.elapsed();

        entries.truncate(limit);

        eprintln!(
            "agentisland:get_log_timeline total_ms={} event_count={} event_read_ms={} bridge_count={} bridge_read_ms={} sort_ms={} returned_count={} limit={}",
            total_started.elapsed().as_millis(),
            event_count,
            event_elapsed.as_millis(),
            bridge_count,
            bridge_elapsed.as_millis(),
            sort_elapsed.as_millis(),
            entries.len(),
            limit
        );

        entries
    }

    pub fn apply_event(&mut self, event: &AgentEvent) {
        let now = event.timestamp.unwrap_or_else(Utc::now);
        let session_id = self.resolve_session_id(event);
        let session = self
            .sessions
            .entry(session_id.clone())
            .or_insert_with(|| SessionRecord {
                id: session_id.clone(),
                source: event.source.clone(),
                title: format!("{} session", event.source),
                status: "running".into(),
                status_detail: "running".into(),
                cwd: session_cwd(event),
                started_at: now,
                last_event_at: now,
                has_pending_permission: false,
                needs_user_attention: false,
                subagent_count: 0,
                launcher: None,
                recent_hooks: Vec::new(),
            });
        session.id = session_id;
        session.last_event_at = now;

        if let Some(launcher) = event.launcher.clone() {
            session.launcher = Some(self.launcher_resolver.hydrate(launcher));
        }

        if let Some(cwd) = session_cwd(event) {
            session.cwd = Some(cwd);
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
                | "afterAgentResponse"
        );
        if clears_attention {
            session.needs_user_attention = false;
        }

        match event.kind.as_str() {
            "session_start" | "SessionStart" => {
                session.status = session_start_status(event.source.as_str()).into();
                session.status_detail = session_start_detail(event.source.as_str()).into();
                session.has_pending_permission = false;
            }
            "prompt_submit" | "UserPromptSubmit" | "beforeSubmitPrompt" => {
                session.status = prompt_submit_status(event.source.as_str()).into();
                session.status_detail = prompt_submit_detail(event.source.as_str()).into();
                session.has_pending_permission = false;
            }
            "tool_start" | "PreToolUse" => {
                session.status = "tool".into();
                let tool_name = event
                    .payload
                    .get("toolName")
                    .or_else(|| event.payload.get("tool_name"))
                    .and_then(Value::as_str)
                    .unwrap_or("tool");
                session.status_detail = format!("using tool: {tool_name}");
            }
            "tool_end" | "PostToolUse" => {
                session.status = "running".into();
                session.status_detail = "running".into();
                session.has_pending_permission = false;
            }
            "compact" | "PreCompact" => {
                session.status = "compact".into();
                session.status_detail = "compacting context".into();
            }
            "afterAgentThought" => {
                session.status = "thinking".into();
                session.status_detail = "thinking".into();
            }
            "afterAgentResponse" => {
                session.status = "idle".into();
                session.status_detail = "idle".into();
            }
            "notification" | "Notification" => {
                if !should_ignore_permission_prompt_notification(session, event) {
                    match classify_notification(event) {
                        NotificationDisposition::Idle => {
                            session.status = "idle".into();
                            session.status_detail = notification_idle_detail(event);
                            session.needs_user_attention = false;
                        }
                        NotificationDisposition::AskUserQuestion => {
                            session.status = "permission".into();
                            session.status_detail = ask_user_summary(event)
                                .unwrap_or_else(|| "AskUserQuestion".to_string());
                            session.has_pending_permission = false;
                            session.needs_user_attention = false;
                        }
                        NotificationDisposition::Attention => {
                            session.status = "attention".into();
                            session.status_detail = describe_attention_event(event);
                            session.needs_user_attention = true;
                        }
                    }
                }
            }
            "permission_request" | "PermissionRequest" => {
                if is_ask_user_question(event) {
                    session.status = "permission".into();
                    session.has_pending_permission = false;
                    session.needs_user_attention = false;
                    session.status_detail =
                        ask_user_summary(event).unwrap_or_else(|| "AskUserQuestion".to_string());
                } else {
                    session.status = "attention".into();
                    session.has_pending_permission = true;
                    session.needs_user_attention = true;
                    session.status_detail = describe_attention_event(event);
                }
            }
            "permission_resolved" => {
                session.has_pending_permission = false;
                session.status = "running".into();
                session.status_detail = "permission resolved".into();
                session.needs_user_attention = false;
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
            "stop" | "Stop" => {
                if session.has_pending_permission || session.needs_user_attention {
                    session.status = "attention".into();
                } else {
                    session.status = "idle".into();
                    session.status_detail = "idle".into();
                }
            }
            "session_end" | "SessionEnd" => {
                session.status = "done".into();
                session.status_detail = "done".into();
                session.has_pending_permission = false;
                session.needs_user_attention = false;
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

        if let Some(hook) = preview_hook(event) {
            session.recent_hooks.insert(0, hook);
            session.recent_hooks.truncate(3);
        }
    }

    pub fn force_remove_session(&mut self, session_id: &str) {
        self.sessions.remove(session_id);
    }

    fn resolve_session_id(&self, event: &AgentEvent) -> String {
        if !is_unknown_session_id(&event.session_id) {
            return event.session_id.clone();
        }

        let mut candidates = self
            .sessions
            .values()
            .filter(|session| {
                session.source == event.source
                    && !matches!(session.status.as_str(), "done" | "error")
            })
            .map(|session| session.id.clone())
            .collect::<Vec<_>>();

        if candidates.len() == 1 {
            return candidates.pop().unwrap();
        }

        event.session_id.clone()
    }

    pub fn snapshot(&mut self) -> Vec<SessionView> {
        let now = Utc::now();
        let mut sessions = self
            .sessions
            .values()
            .filter(|session| {
                !matches!(session.status.as_str(), "done" | "error")
                    && !is_expired_session(session, now)
            })
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
                launcher: session.launcher,
                recent_hooks: session.recent_hooks,
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
}

fn is_unknown_session_id(session_id: &str) -> bool {
    let trimmed = session_id.trim();
    trimmed.is_empty() || trimmed == "unknown-session"
}

fn describe_attention_event(event: &AgentEvent) -> String {
    if is_ask_user_question(event) {
        let summary =
            ask_user_summary(event).unwrap_or_else(|| "等待你回到终端回答问题".to_string());
        return format!("AskUserQuestion · {summary}");
    }

    if is_permission_prompt(event) {
        let summary =
            permission_summary(event).unwrap_or_else(|| "等待你回到终端处理权限请求".to_string());
        return format!("Permission Approval · {summary}");
    }

    event
        .payload
        .get("message")
        .or_else(|| event.payload.get("summary"))
        .or_else(|| event.payload.get("title"))
        .and_then(Value::as_str)
        .unwrap_or("needs user attention")
        .to_string()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum NotificationDisposition {
    Idle,
    AskUserQuestion,
    Attention,
}

fn classify_notification(event: &AgentEvent) -> NotificationDisposition {
    if is_idle_prompt(event) {
        return NotificationDisposition::Idle;
    }

    if is_ask_user_question(event) {
        return NotificationDisposition::AskUserQuestion;
    }

    NotificationDisposition::Attention
}

fn notification_idle_detail(event: &AgentEvent) -> String {
    event
        .payload
        .get("message")
        .or_else(|| event.payload.get("summary"))
        .or_else(|| event.payload.get("title"))
        .and_then(Value::as_str)
        .unwrap_or("idle")
        .to_string()
}

fn should_ignore_permission_prompt_notification(
    session: &SessionRecord,
    event: &AgentEvent,
) -> bool {
    is_permission_prompt(event)
        && !session.has_pending_permission
        && !session.needs_user_attention
        && session.status == "permission"
}

fn is_permission_prompt(event: &AgentEvent) -> bool {
    if is_ask_user_question(event) {
        return false;
    }

    if event
        .payload
        .get("notification_type")
        .and_then(Value::as_str)
        == Some("permission_prompt")
    {
        return true;
    }

    let Some(question) = first_question(event) else {
        return false;
    };

    let header = question
        .get("header")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let prompt = question
        .get("question")
        .and_then(Value::as_str)
        .unwrap_or_default();

    header.contains("权限")
        || header.contains("Permission")
        || prompt.contains("权限")
        || prompt.contains("是否批准")
        || prompt.contains("批准")
        || prompt.contains("是否允许")
        || prompt.contains("允许读取")
        || prompt.contains("允许执行")
}

fn is_ask_user_question(event: &AgentEvent) -> bool {
    tool_name(event) == Some("AskUserQuestion")
}

fn is_ask_user_question_tool_hook(event: &AgentEvent) -> bool {
    is_ask_user_question(event)
        && matches!(
            event.kind.as_str(),
            "tool_start" | "PreToolUse" | "tool_end" | "PostToolUse"
        )
}

fn is_idle_prompt(event: &AgentEvent) -> bool {
    event
        .payload
        .get("notification_type")
        .and_then(Value::as_str)
        == Some("idle_prompt")
}

fn permission_summary(event: &AgentEvent) -> Option<String> {
    if let Some(question) = first_question(event)
        .and_then(|question| question.get("question"))
        .and_then(Value::as_str)
    {
        return Some(question.replace('\n', " "));
    }

    let tool_name = tool_name(event).unwrap_or("Tool");
    let input = tool_input(event)?;

    if let Some(command) = input
        .get("command")
        .or_else(|| input.get("cmd"))
        .and_then(Value::as_str)
    {
        return Some(format!("{tool_name} · {command}"));
    }

    if let Some(path) = input
        .get("file_path")
        .or_else(|| input.get("filePath"))
        .or_else(|| input.get("path"))
        .and_then(Value::as_str)
    {
        return Some(format!("{tool_name} · {path}"));
    }

    if let Some(description) = input.get("description").and_then(Value::as_str) {
        return Some(format!("{tool_name} · {description}"));
    }

    let preview = serde_json::to_string(input).ok()?;
    Some(format!("{tool_name} · {preview}"))
}

fn ask_user_summary(event: &AgentEvent) -> Option<String> {
    let question = first_question(event)?;
    question
        .get("question")
        .and_then(Value::as_str)
        .map(|text| text.replace('\n', " "))
}

fn first_question<'a>(event: &'a AgentEvent) -> Option<&'a Value> {
    tool_input(event)
        .and_then(|input| input.get("questions"))
        .and_then(Value::as_array)
        .and_then(|questions| questions.first())
}

fn tool_input<'a>(event: &'a AgentEvent) -> Option<&'a Value> {
    event
        .payload
        .get("tool_input")
        .or_else(|| event.payload.get("toolInput"))
}

fn tool_name(event: &AgentEvent) -> Option<&str> {
    event
        .payload
        .get("toolName")
        .or_else(|| event.payload.get("tool_name"))
        .or_else(|| event.payload.get("tool"))
        .and_then(Value::as_str)
}

fn session_cwd(event: &AgentEvent) -> Option<String> {
    event
        .payload
        .get("cwd")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .or_else(|| {
            event
                .payload
                .get("workspace_roots")
                .and_then(Value::as_array)
                .and_then(|roots| roots.first())
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
}

fn preview_hook(event: &AgentEvent) -> Option<SessionHookPreview> {
    if is_permission_prompt(event) {
        return None;
    }

    let text = preview_text(event)?;
    Some(SessionHookPreview {
        kind: event.kind.clone(),
        text,
        role: preview_role(event).into(),
    })
}

fn preview_role(event: &AgentEvent) -> &'static str {
    if matches!(event.kind.as_str(), "UserPromptSubmit" | "prompt_submit" | "beforeSubmitPrompt") {
        return "user";
    }

    if event.payload.get("last_assistant_message").and_then(Value::as_str).is_some()
        || matches!(event.kind.as_str(), "afterAgentResponse")
    {
        return "assistant";
    }

    "system"
}

fn preview_text(event: &AgentEvent) -> Option<String> {
    if is_ask_user_question_tool_hook(event) {
        return tool_name(event).map(normalize_preview_text);
    }

    first_non_empty_str(
        &event.payload,
        &[
            &["prompt"],
            &["last_assistant_message"],
            &["message"],
            &["summary"],
            &["title"],
        ],
    )
    .map(normalize_preview_text)
    .or_else(|| first_question(event).and_then(value_text))
    .or_else(|| permission_summary(event))
    .or_else(|| tool_input(event).and_then(compose_tool_input_preview))
    .or_else(|| fallback_preview_text(event))
}

fn compose_tool_input_preview(input: &Value) -> Option<String> {
    if let Some(command) = input
        .get("command")
        .or_else(|| input.get("cmd"))
        .and_then(Value::as_str)
    {
        return Some(normalize_preview_text(command));
    }

    if let Some(path) = input
        .get("file_path")
        .or_else(|| input.get("filePath"))
        .or_else(|| input.get("path"))
        .and_then(Value::as_str)
    {
        return Some(normalize_preview_text(path));
    }

    input
        .get("description")
        .and_then(Value::as_str)
        .map(normalize_preview_text)
}

fn fallback_preview_text(event: &AgentEvent) -> Option<String> {
    if let Some(name) = tool_name(event) {
        return Some(normalize_preview_text(name));
    }

    match event.kind.as_str() {
        "Notification" | "notification" | "PermissionRequest" | "permission_request" => {
            Some(humanize_kind(&event.kind))
        }
        _ => None,
    }
}

fn humanize_kind(kind: &str) -> String {
    match kind {
        "UserPromptSubmit" | "prompt_submit" | "beforeSubmitPrompt" => "Prompt submitted".into(),
        "Stop" | "stop" => "Stopped".into(),
        "Notification" | "notification" => "Notification".into(),
        "PermissionRequest" | "permission_request" => "Permission request".into(),
        "afterAgentResponse" => "Assistant responded".into(),
        _ => kind.to_string(),
    }
}

fn first_non_empty_str<'a>(value: &'a Value, paths: &[&[&str]]) -> Option<&'a str> {
    paths.iter().find_map(|path| {
        value_at_path(value, path)
            .and_then(Value::as_str)
            .filter(|text| !text.trim().is_empty())
    })
}

fn value_at_path<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for segment in path {
        current = current.get(*segment)?;
    }
    Some(current)
}

fn value_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) if !text.trim().is_empty() => Some(normalize_preview_text(text)),
        Value::Object(map) => map
            .get("question")
            .and_then(Value::as_str)
            .map(normalize_preview_text),
        _ => None,
    }
}

fn normalize_preview_text(text: impl AsRef<str>) -> String {
    text.as_ref().replace('\n', " ").trim().to_string()
}

fn is_expired_session(session: &SessionRecord, now: DateTime<Utc>) -> bool {
    if session.has_pending_permission || session.needs_user_attention {
        return false;
    }

    session.source != "claude"
        && matches!(session.status.as_str(), "idle")
        && (now - session.last_event_at).num_milliseconds() > SESSION_IDLE_TIMEOUT_MS
}

fn session_start_status(source: &str) -> &'static str {
    match source {
        "codex" | "cursor" => "idle",
        _ => "running",
    }
}

fn session_start_detail(source: &str) -> &'static str {
    match source {
        "codex" | "cursor" => "idle",
        _ => "session started",
    }
}

fn prompt_submit_status(source: &str) -> &'static str {
    match source {
        "codex" | "cursor" => "running",
        _ => "thinking",
    }
}

fn prompt_submit_detail(source: &str) -> &'static str {
    match source {
        "codex" | "cursor" => "running",
        _ => "thinking",
    }
}

fn read_event_log_entries(path: &PathBuf) -> Vec<TimelineLogEntry> {
    read_json_lines(path, parse_event_log_entry)
}

fn read_bridge_log_entries(path: &PathBuf) -> Vec<TimelineLogEntry> {
    read_json_lines(path, parse_bridge_log_entry)
}

fn read_json_lines<T>(path: &PathBuf, parser: impl Fn(usize, &str) -> Option<T>) -> Vec<T> {
    let Ok(file) = File::open(path) else {
        return Vec::new();
    };
    BufReader::new(file)
        .lines()
        .enumerate()
        .filter_map(|(index, line)| line.ok().and_then(|value| parser(index, &value)))
        .collect()
}

fn prune_json_lines(
    path: &PathBuf,
    should_keep: impl Fn(&str) -> Option<bool>,
) -> Result<bool, std::io::Error> {
    let Ok(file) = File::open(path) else {
        return Ok(false);
    };

    let mut retained = Vec::new();
    let mut changed = false;

    for line in BufReader::new(file).lines() {
        let line = line?;
        match should_keep(&line) {
            Some(true) => retained.push(line),
            Some(false) | None => changed = true,
        }
    }

    if !changed {
        return Ok(false);
    }

    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let mut file = File::create(path)?;
    for line in retained {
        writeln!(file, "{line}")?;
    }

    Ok(true)
}

fn parse_event_log_entry(_index: usize, line: &str) -> Option<TimelineLogEntry> {
    let entry = serde_json::from_str::<LogEntry>(line).ok()?;
    Some(TimelineLogEntry {
        id: entry.id,
        source: entry.source,
        session_id: entry.session_id,
        kind: entry.kind,
        created_at: entry.created_at,
        channel: "event".into(),
        stage: None,
        raw: entry.raw,
    })
}

fn parse_bridge_log_entry(index: usize, line: &str) -> Option<TimelineLogEntry> {
    let value = serde_json::from_str::<Value>(line).ok()?;
    let created_at = value
        .get("timestamp")
        .and_then(Value::as_str)
        .and_then(parse_timestamp)?;
    let stage = value.get("stage").and_then(Value::as_str)?.to_string();
    let payload = value.get("payload")?;
    let source = payload
        .get("event")
        .and_then(|event| event.get("source"))
        .and_then(Value::as_str)
        .or_else(|| {
            payload
                .get("argv")
                .and_then(Value::as_array)
                .and_then(|argv| {
                    argv.windows(2).find_map(|window| {
                        let flag = window.first()?.as_str()?;
                        let next = window.get(1)?.as_str()?;
                        (flag == "--source").then_some(next)
                    })
                })
        })
        .unwrap_or("unknown")
        .to_string();
    let session_id = payload
        .get("event")
        .and_then(|event| event.get("sessionId"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let kind = payload
        .get("event")
        .and_then(|event| event.get("kind"))
        .and_then(Value::as_str)
        .unwrap_or(stage.as_str())
        .to_string();

    Some(TimelineLogEntry {
        id: format!("bridge-{index}-{stage}"),
        source,
        session_id,
        kind,
        created_at,
        channel: "bridge".into(),
        stage: Some(stage),
        raw: serde_json::to_string_pretty(payload).unwrap_or_default(),
    })
}

fn parse_timestamp(value: &str) -> Option<DateTime<Utc>> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| timestamp.with_timezone(&Utc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;
    use serde_json::json;
    use uuid::Uuid;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("agent-island-{name}-{}.jsonl", Uuid::new_v4()))
    }

    fn event(source: &str, kind: &str, timestamp: DateTime<Utc>) -> AgentEvent {
        AgentEvent {
            source: source.into(),
            session_id: format!("{source}-session"),
            timestamp: Some(timestamp),
            kind: kind.into(),
            launcher: None,
            payload: json!({ "cwd": "/tmp/project" }),
        }
    }

    fn event_with_payload(
        source: &str,
        kind: &str,
        timestamp: DateTime<Utc>,
        payload: Value,
    ) -> AgentEvent {
        AgentEvent {
            source: source.into(),
            session_id: format!("{source}-session"),
            timestamp: Some(timestamp),
            kind: kind.into(),
            launcher: None,
            payload,
        }
    }

    fn event_with_launcher(
        source: &str,
        kind: &str,
        timestamp: DateTime<Utc>,
        launcher: LauncherView,
    ) -> AgentEvent {
        AgentEvent {
            source: source.into(),
            session_id: format!("{source}-session"),
            timestamp: Some(timestamp),
            kind: kind.into(),
            launcher: Some(launcher),
            payload: json!({ "cwd": "/tmp/project" }),
        }
    }

    #[test]
    fn codex_prompt_submit_stays_running_until_stop() {
        let log_path = temp_path("events");
        let mut store = SessionStore::new(log_path, std::env::temp_dir());
        let now = Utc::now();

        store.apply_event(&event("codex", "SessionStart", now));
        store.apply_event(&event(
            "codex",
            "UserPromptSubmit",
            now + Duration::seconds(2),
        ));

        let sessions = store.snapshot();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].status, "running");
        assert_eq!(sessions[0].status_detail, "running");
    }

    #[test]
    fn only_idle_sessions_expire() {
        let log_path = temp_path("events");
        let mut store = SessionStore::new(log_path, std::env::temp_dir());
        let now = Utc::now() - Duration::milliseconds(SESSION_IDLE_TIMEOUT_MS + 1_000);

        store.apply_event(&event("codex", "SessionStart", now));
        assert!(store.snapshot().is_empty());

        store.apply_event(&event("cursor", "beforeSubmitPrompt", Utc::now()));
        let sessions = store.snapshot();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].status, "running");
    }

    #[test]
    fn force_remove_session_hides_existing_session() {
        let log_path = temp_path("events-force-remove");
        let mut store = SessionStore::new(log_path, std::env::temp_dir());
        let now = Utc::now();

        store.apply_event(&event("codex", "SessionStart", now));
        assert_eq!(store.snapshot().len(), 1);

        store.force_remove_session("codex-session");
        assert!(store.snapshot().is_empty());
    }

    #[test]
    fn force_remove_session_is_idempotent() {
        let log_path = temp_path("events-force-remove-idempotent");
        let mut store = SessionStore::new(log_path, std::env::temp_dir());
        let now = Utc::now();

        store.apply_event(&event("codex", "SessionStart", now));
        store.apply_event(&event("cursor", "SessionStart", now));

        store.force_remove_session("missing-session");

        let sessions = store.snapshot();
        assert_eq!(sessions.len(), 2);
    }

    #[test]
    fn force_removed_session_reappears_on_new_event() {
        let log_path = temp_path("events-force-remove-recreate");
        let mut store = SessionStore::new(log_path, std::env::temp_dir());
        let now = Utc::now();

        store.apply_event(&event("codex", "SessionStart", now));
        store.force_remove_session("codex-session");
        store.apply_event(&event(
            "codex",
            "UserPromptSubmit",
            now + Duration::seconds(1),
        ));

        let sessions = store.snapshot();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "codex-session");
    }

    #[test]
    fn launcher_from_event_is_attached_to_session() {
        let log_path = temp_path("events-launcher");
        let mut store = SessionStore::new(log_path, std::env::temp_dir());
        let now = Utc::now();

        store.apply_event(&event_with_launcher(
            "codex",
            "SessionStart",
            now,
            LauncherView {
                name: "Ghostty".into(),
                icon_data_url: None,
                bundle_path: Some("/Applications/Ghostty.app".into()),
                pid: Some(123),
                detected_from: Some("processTree".into()),
            },
        ));

        let sessions = store.snapshot();
        assert_eq!(sessions.len(), 1);
        assert_eq!(
            sessions[0].launcher.as_ref().map(|item| item.name.as_str()),
            Some("Ghostty")
        );
        assert_eq!(
            sessions[0]
                .launcher
                .as_ref()
                .and_then(|item| item.bundle_path.as_deref()),
            Some("/Applications/Ghostty.app")
        );
    }

    #[test]
    fn empty_launcher_update_does_not_clear_existing_launcher() {
        let log_path = temp_path("events-launcher-keep");
        let mut store = SessionStore::new(log_path, std::env::temp_dir());
        let now = Utc::now();

        store.apply_event(&event_with_launcher(
            "cursor",
            "SessionStart",
            now,
            LauncherView {
                name: "Cursor".into(),
                icon_data_url: None,
                bundle_path: Some("/Applications/Cursor.app".into()),
                pid: Some(456),
                detected_from: Some("processTree".into()),
            },
        ));
        store.apply_event(&event(
            "cursor",
            "beforeSubmitPrompt",
            now + Duration::seconds(1),
        ));

        let sessions = store.snapshot();
        assert_eq!(sessions.len(), 1);
        assert_eq!(
            sessions[0].launcher.as_ref().map(|item| item.name.as_str()),
            Some("Cursor")
        );
    }

    #[test]
    fn log_timeline_merges_event_and_bridge_logs() {
        let event_log_path = temp_path("events");
        let bridge_log_path = temp_path("bridge");
        let mut store = SessionStore::new(event_log_path.clone(), std::env::temp_dir());
        store.push_log(LogEntry {
            id: "event-1".into(),
            source: "codex".into(),
            session_id: Some("session-1".into()),
            kind: "UserPromptSubmit".into(),
            created_at: parse_timestamp("2026-04-04T08:34:09.274657+00:00").unwrap(),
            raw: "{\"hook_event_name\":\"UserPromptSubmit\"}".into(),
        });

        std::fs::write(
            &bridge_log_path,
            concat!(
                "{\"timestamp\":\"2026-04-04T08:34:09.276887+00:00\",\"stage\":\"response\",\"payload\":{\"ok\":true}}\n",
                "{\"timestamp\":\"2026-04-04T08:34:09.241648+00:00\",\"stage\":\"incoming\",\"payload\":{\"argv\":[\"--source\",\"codex\"],\"event\":{\"source\":\"codex\",\"sessionId\":\"session-1\",\"kind\":\"SessionStart\"}}}\n"
            ),
        )
        .unwrap();

        let timeline = store.log_timeline(10, &bridge_log_path);

        assert_eq!(timeline.len(), 3);
        assert_eq!(timeline[0].channel, "bridge");
        assert_eq!(timeline[0].stage.as_deref(), Some("response"));
        assert_eq!(timeline[1].channel, "event");
        assert_eq!(timeline[2].kind, "SessionStart");
    }

    #[test]
    fn prune_logs_older_than_keeps_only_recent_entries() {
        let event_log_path = temp_path("events-prune");
        let bridge_log_path = temp_path("bridge-prune");
        let cutoff = parse_timestamp("2026-04-05T00:00:00+00:00").unwrap();
        let mut store = SessionStore::new(event_log_path.clone(), std::env::temp_dir());

        store.push_log(LogEntry {
            id: "old-event".into(),
            source: "codex".into(),
            session_id: Some("session-1".into()),
            kind: "old".into(),
            created_at: parse_timestamp("2026-04-04T23:59:59+00:00").unwrap(),
            raw: "{\"kind\":\"old\"}".into(),
        });
        store.push_log(LogEntry {
            id: "new-event".into(),
            source: "codex".into(),
            session_id: Some("session-2".into()),
            kind: "new".into(),
            created_at: parse_timestamp("2026-04-05T00:00:00+00:00").unwrap(),
            raw: "{\"kind\":\"new\"}".into(),
        });

        std::fs::write(
            &bridge_log_path,
            concat!(
                "{\"timestamp\":\"2026-04-04T10:00:00+00:00\",\"stage\":\"old\",\"payload\":{\"ok\":true}}\n",
                "{\"timestamp\":\"2026-04-05T10:00:00+00:00\",\"stage\":\"new\",\"payload\":{\"ok\":true}}\n",
                "broken-line\n"
            ),
        )
        .unwrap();

        let changed = store
            .prune_logs_older_than(&bridge_log_path, cutoff)
            .unwrap();

        assert!(changed);
        assert_eq!(store.logs.len(), 1);
        assert_eq!(store.logs[0].id, "new-event");

        let timeline = store.log_timeline(10, &bridge_log_path);
        assert_eq!(timeline.len(), 2);
        assert!(timeline.iter().all(|entry| entry.created_at >= cutoff));
    }

    #[test]
    fn idle_prompt_notification_does_not_require_attention() {
        let log_path = temp_path("events-idle-prompt");
        let mut store = SessionStore::new(log_path, std::env::temp_dir());
        let now = Utc::now();

        store.apply_event(&event("codex", "SessionStart", now));
        store.apply_event(&event_with_payload(
            "codex",
            "Notification",
            now + Duration::seconds(1),
            json!({
                "cwd": "/tmp/project",
                "notification_type": "idle_prompt",
                "message": "Claude is waiting for your input"
            }),
        ));

        let sessions = store.snapshot();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].status, "idle");
        assert_eq!(
            sessions[0].status_detail,
            "Claude is waiting for your input"
        );
        assert!(!sessions[0].needs_user_attention);
    }

    #[test]
    fn permission_prompt_notification_still_requires_attention() {
        let log_path = temp_path("events-permission-prompt");
        let mut store = SessionStore::new(log_path, std::env::temp_dir());
        let now = Utc::now();

        store.apply_event(&event("codex", "SessionStart", now));
        store.apply_event(&event_with_payload(
            "codex",
            "Notification",
            now + Duration::seconds(1),
            json!({
                "cwd": "/tmp/project",
                "notification_type": "permission_prompt",
                "message": "Permission needed"
            }),
        ));

        let sessions = store.snapshot();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].status, "attention");
        assert!(sessions[0].needs_user_attention);
    }

    #[test]
    fn ask_user_question_permission_request_updates_preview_without_attention() {
        let log_path = temp_path("events-ask-user");
        let mut store = SessionStore::new(log_path, std::env::temp_dir());
        let now = Utc::now();

        store.apply_event(&event("codex", "SessionStart", now));
        store.apply_event(&event_with_payload(
            "codex",
            "PermissionRequest",
            now + Duration::seconds(1),
            json!({
                "cwd": "/tmp/project",
                "tool_name": "AskUserQuestion",
                "tool_input": {
                    "questions": [
                        { "question": "Which option should I choose?" }
                    ]
                }
            }),
        ));

        let sessions = store.snapshot();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].status, "permission");
        assert_eq!(sessions[0].status_detail, "Which option should I choose?");
        assert!(!sessions[0].needs_user_attention);
        assert!(!sessions[0].has_pending_permission);
        assert_eq!(sessions[0].recent_hooks.len(), 1);
        assert_eq!(sessions[0].recent_hooks[0].text, "Which option should I choose?");
    }

    #[test]
    fn ask_user_question_hook_chain_hides_prompt_notification_and_deduplicates_preview() {
        let log_path = temp_path("events-ask-user-chain");
        let mut store = SessionStore::new(log_path, std::env::temp_dir());
        let now = Utc::now();

        store.apply_event(&event("claude", "SessionStart", now));
        store.apply_event(&event_with_payload(
            "claude",
            "PreToolUse",
            now + Duration::seconds(1),
            json!({
                "cwd": "/tmp/project",
                "tool_name": "AskUserQuestion",
                "tool_input": {
                    "questions": [
                        { "question": "今晚想吃什么？" }
                    ]
                }
            }),
        ));
        store.apply_event(&event_with_payload(
            "claude",
            "PermissionRequest",
            now + Duration::seconds(2),
            json!({
                "cwd": "/tmp/project",
                "tool_name": "AskUserQuestion",
                "tool_input": {
                    "questions": [
                        { "question": "今晚想吃什么？" }
                    ]
                }
            }),
        ));
        store.apply_event(&event_with_payload(
            "claude",
            "Notification",
            now + Duration::seconds(3),
            json!({
                "cwd": "/tmp/project",
                "message": "Claude Code needs your attention",
                "notification_type": "permission_prompt"
            }),
        ));

        let sessions = store.snapshot();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].status, "permission");
        assert!(!sessions[0].needs_user_attention);
        assert!(!sessions[0].has_pending_permission);
        assert_eq!(sessions[0].recent_hooks.len(), 2);
        assert_eq!(sessions[0].recent_hooks[0].text, "今晚想吃什么？");
        assert_eq!(sessions[0].recent_hooks[1].text, "AskUserQuestion");
    }

    #[test]
    fn prompt_and_stop_events_populate_recent_hooks() {
        let log_path = temp_path("events-recent-hooks");
        let mut store = SessionStore::new(log_path, std::env::temp_dir());
        let now = Utc::now();

        store.apply_event(&event("claude", "SessionStart", now));
        store.apply_event(&event_with_payload(
            "claude",
            "UserPromptSubmit",
            now + Duration::seconds(1),
            json!({
                "cwd": "/tmp/project",
                "prompt": "@wiki/log.md 是否要更新下"
            }),
        ));
        store.apply_event(&event_with_payload(
            "claude",
            "Stop",
            now + Duration::seconds(2),
            json!({
                "cwd": "/tmp/project",
                "last_assistant_message": "内容看起来已经是更新过的了"
            }),
        ));

        let sessions = store.snapshot();
        assert_eq!(sessions[0].recent_hooks.len(), 2);
        assert_eq!(sessions[0].recent_hooks[0].role, "assistant");
        assert_eq!(sessions[0].recent_hooks[0].text, "内容看起来已经是更新过的了");
        assert_eq!(sessions[0].recent_hooks[1].role, "user");
        assert_eq!(sessions[0].recent_hooks[1].text, "@wiki/log.md 是否要更新下");
    }

    #[test]
    fn recent_hooks_keep_only_latest_three_entries() {
        let log_path = temp_path("events-recent-hooks-truncate");
        let mut store = SessionStore::new(log_path, std::env::temp_dir());
        let now = Utc::now();

        store.apply_event(&event("codex", "SessionStart", now));
        for index in 0..4 {
            store.apply_event(&event_with_payload(
                "codex",
                "UserPromptSubmit",
                now + Duration::seconds(index + 1),
                json!({
                    "cwd": "/tmp/project",
                    "prompt": format!("prompt-{index}")
                }),
            ));
        }

        let sessions = store.snapshot();
        assert_eq!(sessions[0].recent_hooks.len(), 3);
        assert_eq!(sessions[0].recent_hooks[0].text, "prompt-3");
        assert_eq!(sessions[0].recent_hooks[1].text, "prompt-2");
        assert_eq!(sessions[0].recent_hooks[2].text, "prompt-1");
    }

    #[test]
    fn unknown_notification_remains_attention() {
        let log_path = temp_path("events-unknown-notification");
        let mut store = SessionStore::new(log_path, std::env::temp_dir());
        let now = Utc::now();

        store.apply_event(&event("codex", "SessionStart", now));
        store.apply_event(&event_with_payload(
            "codex",
            "Notification",
            now + Duration::seconds(1),
            json!({
                "cwd": "/tmp/project",
                "message": "Something needs attention"
            }),
        ));

        let sessions = store.snapshot();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].status, "attention");
        assert!(sessions[0].needs_user_attention);
    }
}
