mod inject;
mod ipc;
mod launcher;
mod notify;
mod session;
mod settings;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use inject::{
    ensure_bridge_installed, inject_agent_hooks_impl, install_status, remove_agent_hooks_impl,
    restore_agent_backup_impl,
};
use ipc::start_ipc_server;
use notify::maybe_notify;
use session::{AppStateSnapshot, InstallStatusItem, LogEntry, SessionStore, TimelineLogEntry};
use settings::{apply_launch_at_login, load_preferences, save_preferences, UserPreferences};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::{
    include_image, ActivationPolicy, Emitter, Manager, PhysicalPosition, Rect, Runtime, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_autostart::MacosLauncher;
use uuid::Uuid;

const TRAY_ID: &str = "agent-island-tray";
const POPOVER_WIDTH: f64 = 420.0;
const POPOVER_HEIGHT_TWO_SESSIONS: f64 = 420.0;
const POPOVER_HEIGHT_THREE_SESSIONS: f64 = 580.0;
const POPUP_TOP_MARGIN: f64 = 6.0;
const LOG_RETENTION_DAYS: i64 = 3;
const LOG_PRUNE_INTERVAL_SECS: u64 = 60 * 60;
const SESSION_REFRESH_INTERVAL_MS: u64 = 2_000;
const TRAY_TICK_MS: u64 = 125;

#[derive(Clone, Copy)]
struct TrayAnchor {
    rect: Rect,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MenuBarState {
    Idle,
    Working,
    Ask,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct MenuBarSummary {
    ask_count: usize,
    working_count: usize,
    idle_count: usize,
}

#[derive(Clone, Copy)]
struct TrayAnimation {
    frame_count: usize,
    frame_duration_ms: u64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct TrayIconKey {
    state: MenuBarState,
    frame: u8,
}

fn tray_animation(state: MenuBarState) -> TrayAnimation {
    match state {
        MenuBarState::Ask => TrayAnimation {
            frame_count: 6,
            frame_duration_ms: 200,
        },
        MenuBarState::Working => TrayAnimation {
            frame_count: 4,
            frame_duration_ms: 125,
        },
        MenuBarState::Idle => TrayAnimation {
            frame_count: 1,
            frame_duration_ms: 1_000,
        },
    }
}

fn tray_frame(state: MenuBarState, tick: usize) -> usize {
    let animation = tray_animation(state);
    if animation.frame_count <= 1 {
        return 0;
    }

    let elapsed_ms = tick as u64 * TRAY_TICK_MS;
    ((elapsed_ms / animation.frame_duration_ms) % animation.frame_count as u64) as usize
}

fn tray_icon_key(state: MenuBarState, tick: usize) -> TrayIconKey {
    TrayIconKey {
        state,
        frame: tray_frame(state, tick) as u8,
    }
}

pub struct AppServices {
    sessions: Mutex<SessionStore>,
    preferences: Mutex<UserPreferences>,
    app_data_dir: PathBuf,
    bridge_log_path: PathBuf,
    tray_anchor: Mutex<Option<TrayAnchor>>,
    /// Last tray icon + summary applied; avoids redundant `set_icon` / template / title (Idle flicker).
    tray_last_applied: Mutex<Option<(TrayIconKey, MenuBarSummary)>>,
}

impl AppServices {
    fn snapshot(&self) -> AppStateSnapshot {
        let preferences = self.preferences.lock().unwrap().clone();
        let mut session_store = self.sessions.lock().unwrap();
        let sessions = session_store.snapshot();
        let logs = session_store.recent_logs(preferences.log_limit);
        let install_status = install_status();

        AppStateSnapshot {
            sessions,
            permission_request: None,
            install_status,
            preferences,
            logs,
        }
    }
}

fn derive_menu_bar_state(snapshot: &AppStateSnapshot) -> MenuBarState {
    if snapshot.permission_request.is_some()
        || snapshot
            .sessions
            .iter()
            .any(|session| session.has_pending_permission || session.needs_user_attention)
    {
        return MenuBarState::Ask;
    }
    if snapshot
        .sessions
        .iter()
        .any(|session| session.status != "idle")
    {
        return MenuBarState::Working;
    }

    MenuBarState::Idle
}

fn derive_menu_bar_summary(snapshot: &AppStateSnapshot) -> MenuBarSummary {
    snapshot.sessions.iter().fold(
        MenuBarSummary::default(),
        |mut summary, session| {
            if session.has_pending_permission || session.needs_user_attention {
                summary.ask_count += 1;
            } else if session.status == "idle" {
                summary.idle_count += 1;
            } else {
                summary.working_count += 1;
            }
            summary
        },
    )
}

fn tray_title_for(summary: MenuBarSummary) -> Option<String> {
    if summary == MenuBarSummary::default() {
        return Some(String::new());
    }

    let ask = if summary.ask_count > 0 {
        format!("{}!", summary.ask_count)
    } else {
        summary.ask_count.to_string()
    };

    Some(format!("{ask}·{}·{}", summary.working_count, summary.idle_count))
}

fn tray_icon_for(state: MenuBarState, tick: usize) -> tauri::image::Image<'static> {
    match (state, tray_frame(state, tick)) {
        (MenuBarState::Ask, 0) => include_image!("../public/bot/ask-5fps/agentisland_perm_00.png"),
        (MenuBarState::Ask, 1) => include_image!("../public/bot/ask-5fps/agentisland_perm_01.png"),
        (MenuBarState::Ask, 2) => include_image!("../public/bot/ask-5fps/agentisland_perm_02.png"),
        (MenuBarState::Ask, 3) => include_image!("../public/bot/ask-5fps/agentisland_perm_03.png"),
        (MenuBarState::Ask, 4) => include_image!("../public/bot/ask-5fps/agentisland_perm_04.png"),
        (MenuBarState::Ask, _) => include_image!("../public/bot/ask-5fps/agentisland_perm_05.png"),
        (MenuBarState::Working, 0) => {
            include_image!("../public/bot/work-8fps/agentisland_work_00.png")
        }
        (MenuBarState::Working, 1) => {
            include_image!("../public/bot/work-8fps/agentisland_work_01.png")
        }
        (MenuBarState::Working, 2) => {
            include_image!("../public/bot/work-8fps/agentisland_work_02.png")
        }
        (MenuBarState::Working, _) => {
            include_image!("../public/bot/work-8fps/agentisland_work_03.png")
        }
        (MenuBarState::Idle, _) => include_image!("../public/bot/idle-6fps/agentisland_idle_00.png"),
    }
}

fn tray_tooltip_for(summary: MenuBarSummary) -> String {
    if summary == MenuBarSummary::default() {
        return "AgentIsland".into();
    }

    let mut parts = Vec::new();
    if summary.ask_count > 0 {
        parts.push(format!("Ask {}", summary.ask_count));
    }
    if summary.working_count > 0 {
        parts.push(format!("Working {}", summary.working_count));
    }
    if summary.idle_count > 0 {
        parts.push(format!("Idle {}", summary.idle_count));
    }

    format!(
        "AgentIsland — {}（标题数字顺序：Ask·Working·Idle）",
        parts.join("，")
    )
}

fn sync_tray_state(
    app: &tauri::AppHandle,
    services: &AppServices,
    tick: usize,
) -> tauri::Result<()> {
    let snapshot = services.snapshot();
    let state = derive_menu_bar_state(&snapshot);
    let summary = derive_menu_bar_summary(&snapshot);
    let icon_key = tray_icon_key(state, tick);

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let mut last = services.tray_last_applied.lock().unwrap();
        let icon_changed = last.map(|(k, _)| k != icon_key).unwrap_or(true);
        let summary_changed = last.map(|(_, s)| s != summary).unwrap_or(true);

        if icon_changed {
            tray.set_icon(Some(tray_icon_for(state, tick)))?;
            #[cfg(target_os = "macos")]
            tray.set_icon_as_template(true)?;
        }
        if summary_changed {
            tray.set_tooltip(Some(tray_tooltip_for(summary)))?;
            tray.set_title(tray_title_for(summary))?;
        }
        if icon_changed || summary_changed {
            *last = Some((icon_key, summary));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::{
        derive_menu_bar_state, derive_menu_bar_summary, popover_height_for, tray_frame,
        tray_title_for, AppStateSnapshot, MenuBarState, MenuBarSummary,
        POPOVER_HEIGHT_THREE_SESSIONS, POPOVER_HEIGHT_TWO_SESSIONS,
    };
    use crate::session::SessionView;
    use crate::settings::UserPreferences;

    fn session(status: &str, needs_user_attention: bool, has_pending_permission: bool) -> SessionView {
        SessionView {
            id: format!("session-{status}"),
            source: "codex".into(),
            title: "test".into(),
            status: status.into(),
            status_detail: status.into(),
            cwd: None,
            started_at: Utc::now(),
            duration_ms: 0,
            has_pending_permission,
            needs_user_attention,
            subagent_count: 0,
            launcher: None,
            recent_hooks: Vec::new(),
        }
    }

    fn snapshot(sessions: Vec<SessionView>) -> AppStateSnapshot {
        AppStateSnapshot {
            sessions,
            permission_request: None,
            install_status: Vec::new(),
            preferences: UserPreferences::default(),
            logs: Vec::new(),
        }
    }

    #[test]
    fn menu_bar_summary_counts_ask_before_idle_or_working() {
        let summary = derive_menu_bar_summary(&snapshot(vec![
            session("running", false, false),
            session("idle", false, false),
            session("running", true, false),
            session("idle", false, true),
        ]));

        assert_eq!(
            summary,
            MenuBarSummary {
                ask_count: 2,
                working_count: 1,
                idle_count: 1,
            }
        );
    }

    #[test]
    fn tray_title_uses_ask_working_idle_order() {
        let title = tray_title_for(MenuBarSummary {
            ask_count: 0,
            working_count: 2,
            idle_count: 1,
        });

        assert_eq!(title.as_deref(), Some("0·2·1"));
    }

    #[test]
    fn tray_title_marks_ask_count_when_non_zero() {
        let title = tray_title_for(MenuBarSummary {
            ask_count: 1,
            working_count: 2,
            idle_count: 0,
        });

        assert_eq!(title.as_deref(), Some("1!·2·0"));
    }

    #[test]
    fn menu_bar_state_prioritizes_ask_over_working() {
        let state = derive_menu_bar_state(&snapshot(vec![
            session("running", false, false),
            session("idle", true, false),
        ]));

        assert_eq!(state, MenuBarState::Ask);
    }

    #[test]
    fn menu_bar_state_falls_back_to_working_before_idle() {
        let state = derive_menu_bar_state(&snapshot(vec![
            session("running", false, false),
            session("idle", false, false),
        ]));

        assert_eq!(state, MenuBarState::Working);
    }

    #[test]
    fn idle_animation_is_static() {
        assert_eq!(tray_frame(MenuBarState::Idle, 0), 0);
        assert_eq!(tray_frame(MenuBarState::Idle, 99), 0);
    }

    #[test]
    fn popover_height_uses_two_session_height_until_third_session() {
        assert_eq!(popover_height_for(0), POPOVER_HEIGHT_TWO_SESSIONS);
        assert_eq!(popover_height_for(2), POPOVER_HEIGHT_TWO_SESSIONS);
        assert_eq!(popover_height_for(3), POPOVER_HEIGHT_THREE_SESSIONS);
    }
}

fn emit_state(app: &tauri::AppHandle, services: &AppServices) -> tauri::Result<()> {
    let snapshot = services.snapshot();
    let _ = sync_popover_height(app, services, snapshot.sessions.len());
    app.emit("app-state-updated", snapshot.clone())?;
    sync_tray_state(app, services, 0)?;
    Ok(())
}

fn prune_old_logs(app: &tauri::AppHandle, services: &Arc<AppServices>) -> Result<bool, String> {
    let cutoff = chrono::Utc::now() - chrono::Duration::days(LOG_RETENTION_DAYS);
    let changed = {
        let mut sessions = services.sessions.lock().unwrap();
        sessions
            .prune_logs_older_than(&services.bridge_log_path, cutoff)
            .map_err(|error| error.to_string())?
    };

    if changed {
        emit_state(app, services).map_err(|error| error.to_string())?;
    }

    Ok(changed)
}

#[tauri::command]
fn get_app_state(state: tauri::State<'_, Arc<AppServices>>) -> AppStateSnapshot {
    state.snapshot()
}

#[tauri::command]
fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(
        &app,
        "settings",
        WebviewUrl::App("index.html?view=settings".into()),
    )
    .title("AgentIsland Settings")
    .inner_size(1200.0, 760.0)
    .resizable(true)
    .decorations(true)
    .build()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_install_status() -> Vec<InstallStatusItem> {
    install_status()
}

#[tauri::command]
fn inject_agent_hooks(agent: String) -> Result<(), String> {
    ensure_bridge_installed().map_err(|error| error.to_string())?;
    inject_agent_hooks_impl(&agent).map_err(|error| error.to_string())
}

#[tauri::command]
fn remove_agent_hooks(agent: String) -> Result<(), String> {
    remove_agent_hooks_impl(&agent).map_err(|error| error.to_string())
}

#[tauri::command]
fn restore_agent_backup(agent: String) -> Result<(), String> {
    restore_agent_backup_impl(&agent).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_user_preferences(
    preferences: UserPreferences,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppServices>>,
) -> Result<(), String> {
    save_preferences(&state.app_data_dir, &preferences).map_err(|error| error.to_string())?;
    apply_launch_at_login(&app, preferences.launch_at_login).map_err(|error| error.to_string())?;
    {
        *state.preferences.lock().unwrap() = preferences;
    }
    emit_state(&app, &state).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_recent_logs(limit: usize, state: tauri::State<'_, Arc<AppServices>>) -> Vec<LogEntry> {
    state.sessions.lock().unwrap().recent_logs(limit)
}

#[tauri::command]
fn get_log_timeline(
    limit: Option<usize>,
    state: tauri::State<'_, Arc<AppServices>>,
) -> Vec<TimelineLogEntry> {
    state
        .sessions
        .lock()
        .unwrap()
        .log_timeline(limit.unwrap_or(1000), &state.bridge_log_path)
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn clear_logs(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppServices>>,
) -> Result<(), String> {
    let bridge = state.bridge_log_path.clone();
    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.clear_logs().map_err(|error| error.to_string())?;
    }
    if let Some(parent) = bridge.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::File::create(&bridge).map_err(|error| error.to_string())?;
    emit_state(&app, &state).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn force_remove_session(
    session_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppServices>>,
) -> Result<(), String> {
    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.force_remove_session(&session_id);
    }
    emit_state(&app, &state).map_err(|error| error.to_string())
}

fn ensure_popover_window<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.set_always_on_top(true);
    let _ = window.set_skip_taskbar(true);
    let _ = window.set_decorations(false);
    let _ = window.set_shadow(true);
    let _ = window.set_resizable(false);
    let _ = window.set_title("AgentIsland");
}

fn fallback_position<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<PhysicalPosition<f64>, String> {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let size = monitor.size();
        let x = ((size.width as f64 - POPOVER_WIDTH) / 2.0).max(0.0);
        return Ok(PhysicalPosition::new(x, 28.0));
    }
    Ok(PhysicalPosition::new(0.0, 28.0))
}

fn popover_height_for(session_count: usize) -> f64 {
    if session_count > 2 {
        POPOVER_HEIGHT_THREE_SESSIONS
    } else {
        POPOVER_HEIGHT_TWO_SESSIONS
    }
}

fn position_popover_window<R: Runtime>(
    window: &WebviewWindow<R>,
    anchor: Option<TrayAnchor>,
    height: f64,
) -> Result<(), String> {
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
        POPOVER_WIDTH,
        height,
    )));

    let target = if let Some(anchor) = anchor {
        let position = anchor.rect.position.to_physical::<f64>(1.0);
        let size = anchor.rect.size.to_physical::<f64>(1.0);
        let x = (position.x + (size.width / 2.0) - (POPOVER_WIDTH / 2.0)).max(0.0);
        let y = position.y + size.height + POPUP_TOP_MARGIN;
        PhysicalPosition::new(x, y)
    } else {
        fallback_position(window)?
    };

    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
            target.x.round() as i32,
            target.y.round() as i32,
        )))
        .map_err(|error| error.to_string())
}

fn sync_popover_height<R: Runtime>(
    app: &tauri::AppHandle<R>,
    services: &AppServices,
    session_count: usize,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    if !window.is_visible().map_err(|error| error.to_string())? {
        return Ok(());
    }

    let anchor = *services.tray_anchor.lock().unwrap();
    position_popover_window(&window, anchor, popover_height_for(session_count))
}

fn show_popover_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
    services: &AppServices,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    ensure_popover_window(&window);
    let anchor = *services.tray_anchor.lock().unwrap();
    let session_count = services.snapshot().sessions.len();
    position_popover_window(&window, anchor, popover_height_for(session_count))?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

fn hide_popover_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn toggle_popover_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
    services: &AppServices,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    if window.is_visible().map_err(|error| error.to_string())? {
        window.hide().map_err(|error| error.to_string())
    } else {
        show_popover_window(app, services)
    }
}

fn handle_tray_click<R: Runtime>(
    app: &tauri::AppHandle<R>,
    services: &Arc<AppServices>,
    event: TrayIconEvent,
) {
    if let TrayIconEvent::Click {
        button,
        button_state,
        rect,
        ..
    } = event
    {
        *services.tray_anchor.lock().unwrap() = Some(TrayAnchor { rect });
        if button == MouseButton::Left && button_state == MouseButtonState::Up {
            let _ = toggle_popover_window(app, services);
        }
    }
}

fn spawn_tray_animation(app: tauri::AppHandle, services: Arc<AppServices>) {
    tauri::async_runtime::spawn(async move {
        let mut tick = 0usize;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(TRAY_TICK_MS)).await;
            let _ = sync_tray_state(&app, &services, tick);
            tick = tick.wrapping_add(1);
        }
    });
}

fn spawn_log_prune_task(app: tauri::AppHandle, services: Arc<AppServices>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(LOG_PRUNE_INTERVAL_SECS)).await;
            let _ = prune_old_logs(&app, &services);
        }
    });
}

fn spawn_session_refresh_task(app: tauri::AppHandle, services: Arc<AppServices>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(SESSION_REFRESH_INTERVAL_MS)).await;
            let _ = emit_state(&app, &services);
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let app_handle = app.handle().clone();
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("missing app data directory");
            std::fs::create_dir_all(&app_data_dir)?;

            let preferences = load_preferences(&app_data_dir).unwrap_or_default();
            let services = Arc::new(AppServices {
                sessions: Mutex::new(SessionStore::new(
                    app_data_dir.join("events.jsonl"),
                    app_data_dir.join("launcher-icons"),
                )),
                preferences: Mutex::new(preferences.clone()),
                app_data_dir: app_data_dir.clone(),
                bridge_log_path: bridge_log_path(),
                tray_anchor: Mutex::new(None),
                tray_last_applied: Mutex::new(None),
            });

            app.set_activation_policy(ActivationPolicy::Accessory);
            app.manage(services.clone());

            ensure_bridge_installed().ok();
            apply_launch_at_login(&app_handle, preferences.launch_at_login).ok();
            let _ = prune_old_logs(&app_handle, &services);

            let main_window = app_handle
                .get_webview_window("main")
                .expect("missing main window");
            ensure_popover_window(&main_window);
            let _ = main_window.hide();
            main_window.on_window_event({
                let app_handle = app_handle.clone();
                move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        hide_popover_window(&app_handle);
                    }
                }
            });

            tauri::tray::TrayIconBuilder::with_id(TRAY_ID)
                .icon(include_image!("icons/menu-bar-icon.png"))
                .icon_as_template(true)
                .show_menu_on_left_click(false)
                .tooltip("AgentIsland")
                .on_tray_icon_event({
                    let services = services.clone();
                    move |tray, event| {
                        handle_tray_click(tray.app_handle(), &services, event);
                    }
                })
                .build(app)?;

            emit_state(&app_handle, &services).ok();
            start_ipc_server(app_handle.clone(), services.clone())?;
            spawn_tray_animation(app_handle.clone(), services.clone());
            spawn_log_prune_task(app_handle.clone(), services.clone());
            spawn_session_refresh_task(app_handle, services);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_state,
            open_settings_window,
            get_install_status,
            inject_agent_hooks,
            remove_agent_hooks,
            restore_agent_backup,
            set_user_preferences,
            get_recent_logs,
            get_log_timeline,
            quit_app,
            clear_logs,
            force_remove_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub(crate) fn on_event_received(
    app: &tauri::AppHandle,
    services: &Arc<AppServices>,
    event: session::AgentEvent,
) -> Result<(), String> {
    let mut sessions = services.sessions.lock().unwrap();
    let log_entry = LogEntry {
        id: Uuid::new_v4().to_string(),
        source: event.source.clone(),
        session_id: Some(event.session_id.clone()),
        kind: event.kind.clone(),
        created_at: chrono::Utc::now(),
        raw: serde_json::to_string_pretty(&event.payload).unwrap_or_default(),
    };

    sessions.push_log(log_entry);

    sessions.apply_event(&event);

    drop(sessions);

    maybe_notify(app, services, &event);
    emit_state(app, services).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn app_data_dir_for_tests() -> PathBuf {
    std::env::temp_dir().join("agent-island-tests")
}

fn bridge_log_path() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
        .join(".agentisland")
        .join("logs")
        .join("bridge.log")
}
