use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri_plugin_autostart::ManagerExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPreferences {
    pub notifications_enabled: bool,
    pub launch_at_login: bool,
    pub log_limit: usize,
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            notifications_enabled: true,
            launch_at_login: false,
            log_limit: 100,
        }
    }
}

pub fn load_preferences(app_data_dir: &Path) -> Result<UserPreferences, Box<dyn std::error::Error>> {
    let path = app_data_dir.join("preferences.json");
    if !path.exists() {
        return Ok(UserPreferences::default());
    }

    let content = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&content)?)
}

pub fn save_preferences(
    app_data_dir: &Path,
    preferences: &UserPreferences,
) -> Result<(), Box<dyn std::error::Error>> {
    fs::create_dir_all(app_data_dir)?;
    fs::write(
        app_data_dir.join("preferences.json"),
        serde_json::to_vec_pretty(preferences)?,
    )?;
    Ok(())
}

pub fn apply_launch_at_login(
    app: &tauri::AppHandle,
    enabled: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable()?;
    } else {
        manager.disable()?;
    }
    Ok(())
}
