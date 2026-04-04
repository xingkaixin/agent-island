use tauri_plugin_notification::NotificationExt;

use crate::{session::AgentEvent, AppServices};

pub fn maybe_notify(app: &tauri::AppHandle, services: &AppServices, event: &AgentEvent) {
    let preferences = services.preferences.lock().unwrap().clone();
    if !preferences.notifications_enabled {
        return;
    }

    match event.kind.as_str() {
        "PermissionRequest" | "permission_request" => {
            let _ = app
                .notification()
                .builder()
                .title("AgentIsland")
                .body("有新的权限审批请求")
                .show();
        }
        "Notification" | "notification" => {
            let _ = app
                .notification()
                .builder()
                .title("AgentIsland")
                .body("Agent 需要你回到终端处理")
                .show();
        }
        _ => {}
    }
}
