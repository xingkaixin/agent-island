use tauri_plugin_notification::NotificationExt;

use crate::{AppServices, session::AgentEvent};

pub fn maybe_notify(app: &tauri::AppHandle, services: &AppServices, event: &AgentEvent) {
    let preferences = services.preferences.lock().unwrap().clone();
    if !preferences.notifications_enabled {
        return;
    }

    let Some(body) = notification_body(event) else {
        return;
    };

    let _ = app
        .notification()
        .builder()
        .title("AgentIsland")
        .body(body)
        .show();
}

fn notification_body(event: &AgentEvent) -> Option<&'static str> {
    match event.kind.as_str() {
        "PermissionRequest" | "permission_request" => Some("有新的权限审批请求"),
        "Notification" | "notification" if is_idle_prompt(event) => None,
        "Notification" | "notification" => Some("Agent 需要你回到终端处理"),
        _ => None,
    }
}

fn is_idle_prompt(event: &AgentEvent) -> bool {
    event
        .payload
        .get("notification_type")
        .and_then(serde_json::Value::as_str)
        == Some("idle_prompt")
}

#[cfg(test)]
mod tests {
    use super::notification_body;
    use crate::session::AgentEvent;
    use chrono::Utc;
    use serde_json::json;

    fn event(kind: &str, payload: serde_json::Value) -> AgentEvent {
        AgentEvent {
            source: "claude".into(),
            session_id: "session-1".into(),
            timestamp: Some(Utc::now()),
            kind: kind.into(),
            launcher: None,
            payload,
        }
    }

    #[test]
    fn idle_prompt_does_not_trigger_notification() {
        assert_eq!(
            notification_body(&event(
                "Notification",
                json!({ "notification_type": "idle_prompt" }),
            )),
            None
        );
    }

    #[test]
    fn permission_request_still_triggers_notification() {
        assert_eq!(
            notification_body(&event("PermissionRequest", json!({}))),
            Some("有新的权限审批请求")
        );
    }

    #[test]
    fn generic_attention_notification_still_triggers_notification() {
        assert_eq!(
            notification_body(&event(
                "Notification",
                json!({ "notification_type": "task_attention" }),
            )),
            Some("Agent 需要你回到终端处理")
        );
    }
}
