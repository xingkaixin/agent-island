use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use base64::Engine;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LauncherView {
    pub name: String,
    pub icon_data_url: Option<String>,
    pub bundle_path: Option<String>,
    #[serde(default)]
    pub pid: Option<u32>,
    #[serde(default)]
    pub detected_from: Option<String>,
}

#[allow(dead_code)]
pub struct LauncherResolver {
    icon_cache: Mutex<HashMap<PathBuf, String>>,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
struct ProcessInfo {
    pid: u32,
    ppid: u32,
    args: String,
}

impl LauncherResolver {
    #[allow(dead_code)]
    pub fn new() -> Self {
        Self {
            icon_cache: Mutex::new(HashMap::new()),
        }
    }

    #[allow(dead_code)]
    pub fn detect_for_current_process() -> Option<LauncherView> {
        let processes = read_process_table().ok()?;
        resolve_launcher(std::process::id(), &processes)
    }

    #[allow(dead_code)]
    pub fn hydrate(&self, launcher: LauncherView) -> LauncherView {
        let Some(bundle_path) = launcher.bundle_path.as_deref() else {
            return launcher;
        };
        if launcher.icon_data_url.is_some() {
            return launcher;
        }

        let bundle_path = PathBuf::from(bundle_path);
        let Some(icon_data_url) = self.export_app_icon(&bundle_path) else {
            return launcher;
        };

        LauncherView {
            icon_data_url: Some(icon_data_url),
            ..launcher
        }
    }

    #[allow(dead_code)]
    fn export_app_icon(&self, bundle_path: &Path) -> Option<String> {
        if let Some(cached) = self.icon_cache.lock().unwrap().get(bundle_path).cloned() {
            return Some(cached);
        }

        let data_url = export_app_icon_data_url(bundle_path)?;
        self.icon_cache
            .lock()
            .unwrap()
            .insert(bundle_path.to_path_buf(), data_url.clone());
        Some(data_url)
    }
}

#[allow(dead_code)]
fn read_process_table() -> Result<HashMap<u32, ProcessInfo>, std::io::Error> {
    let output = Command::new("ps")
        .args(["-axo", "pid=,ppid=,args="])
        .output()?;

    if !output.status.success() {
        return Ok(HashMap::new());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout
        .lines()
        .filter_map(parse_process_line)
        .map(|process| (process.pid, process))
        .collect())
}

#[allow(dead_code)]
fn parse_process_line(line: &str) -> Option<ProcessInfo> {
    let trimmed = line.trim_start();
    if trimmed.is_empty() {
        return None;
    }

    let pid_end = trimmed.find(char::is_whitespace)?;
    let pid = trimmed[..pid_end].parse().ok()?;
    let rest = trimmed[pid_end..].trim_start();
    let ppid_end = rest.find(char::is_whitespace)?;
    let ppid = rest[..ppid_end].parse().ok()?;
    let args = rest[ppid_end..].trim_start();

    Some(ProcessInfo {
        pid,
        ppid,
        args: args.to_string(),
    })
}

#[allow(dead_code)]
fn resolve_launcher(pid: u32, processes: &HashMap<u32, ProcessInfo>) -> Option<LauncherView> {
    let mut current = processes.get(&pid)?.ppid;

    while current != 0 {
        let process = processes.get(&current)?;
        if let Some(bundle_path) = bundle_path_from_args(&process.args) {
            let name = app_name_from_bundle_path(&bundle_path)?;
            return Some(LauncherView {
                name,
                icon_data_url: None,
                bundle_path: Some(bundle_path.to_string_lossy().into_owned()),
                pid: Some(process.pid),
                detected_from: Some("processTree".into()),
            });
        }
        current = process.ppid;
    }

    None
}

#[allow(dead_code)]
fn bundle_path_from_args(args: &str) -> Option<PathBuf> {
    let marker = ".app/Contents/";
    let app_end = args.find(marker)? + 4;
    let bundle = &args[..app_end];
    bundle.starts_with('/').then(|| PathBuf::from(bundle))
}

#[allow(dead_code)]
fn app_name_from_bundle_path(path: &Path) -> Option<String> {
    path.file_stem()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
#[allow(dead_code)]
fn export_app_icon_data_url(bundle_path: &Path) -> Option<String> {
    use objc2::{AnyThread, runtime::AnyObject};
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage, NSWorkspace};
    use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize, NSString};

    let bundle_path = bundle_path.to_string_lossy();
    let bundle_path = NSString::from_str(&bundle_path);

    let png_bytes = unsafe {
        let workspace = NSWorkspace::sharedWorkspace();
        let image = workspace.iconForFile(&bundle_path);
        let target_size = NSSize {
            width: 40.0,
            height: 40.0,
        };
        let canvas = NSImage::initWithSize(NSImage::alloc(), target_size);
        canvas.lockFocus();
        image.drawInRect(NSRect {
            origin: NSPoint { x: 0.0, y: 0.0 },
            size: target_size,
        });
        canvas.unlockFocus();
        let tiff_data = canvas.TIFFRepresentation()?;
        let bitmap = NSBitmapImageRep::imageRepWithData(&tiff_data)?;
        let properties =
            NSDictionary::<objc2_app_kit::NSBitmapImageRepPropertyKey, AnyObject>::dictionary();
        bitmap
            .representationUsingType_properties(NSBitmapImageFileType::PNG, &properties)?
            .to_vec()
    };

    let encoded = base64::engine::general_purpose::STANDARD.encode(png_bytes);
    Some(format!("data:image/png;base64,{encoded}"))
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
fn export_app_icon_data_url(_bundle_path: &Path) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_process_rows_with_spaces_in_args() {
        let process =
            parse_process_line(" 1447     1 /Applications/Ghostty.app/Contents/MacOS/ghostty")
                .unwrap();
        assert_eq!(process.pid, 1447);
        assert_eq!(process.ppid, 1);
        assert_eq!(
            process.args,
            "/Applications/Ghostty.app/Contents/MacOS/ghostty"
        );
    }

    #[test]
    fn extracts_bundle_path_from_process_args() {
        let bundle =
            bundle_path_from_args("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
                .unwrap();
        assert_eq!(bundle, PathBuf::from("/Applications/Google Chrome.app"));
    }

    #[test]
    fn resolves_nearest_launcher_in_process_tree() {
        let processes = HashMap::from([
            (
                90001,
                ProcessInfo {
                    pid: 90001,
                    ppid: 90000,
                    args: "python3 /Users/Kevin/.agentisland/bin/agentisland-bridge".into(),
                },
            ),
            (
                90000,
                ProcessInfo {
                    pid: 90000,
                    ppid: 89999,
                    args: "/bin/zsh -lc /Users/Kevin/.agentisland/bin/agentisland-bridge".into(),
                },
            ),
            (
                89999,
                ProcessInfo {
                    pid: 89999,
                    ppid: 89998,
                    args: "codex".into(),
                },
            ),
            (
                89998,
                ProcessInfo {
                    pid: 89998,
                    ppid: 1,
                    args: "/Applications/Ghostty.app/Contents/MacOS/ghostty".into(),
                },
            ),
        ]);

        let launcher = resolve_launcher(90001, &processes).unwrap();
        assert_eq!(launcher.name, "Ghostty");
        assert_eq!(
            launcher.bundle_path.as_deref(),
            Some("/Applications/Ghostty.app")
        );
        assert_eq!(launcher.pid, Some(89998));
        assert_eq!(launcher.detected_from.as_deref(), Some("processTree"));
    }

    #[test]
    fn prefers_closest_app_ancestor() {
        let processes = HashMap::from([
            (
                90001,
                ProcessInfo {
                    pid: 90001,
                    ppid: 90000,
                    args: "python3 bridge".into(),
                },
            ),
            (
                90000,
                ProcessInfo {
                    pid: 90000,
                    ppid: 89999,
                    args: "/Applications/Cursor.app/Contents/MacOS/Cursor".into(),
                },
            ),
            (
                89999,
                ProcessInfo {
                    pid: 89999,
                    ppid: 89998,
                    args: "/Applications/Ghostty.app/Contents/MacOS/ghostty".into(),
                },
            ),
        ]);

        let launcher = resolve_launcher(90001, &processes).unwrap();
        assert_eq!(launcher.name, "Cursor");
    }

    #[test]
    fn returns_none_when_process_tree_has_no_app() {
        let processes = HashMap::from([
            (
                90001,
                ProcessInfo {
                    pid: 90001,
                    ppid: 90000,
                    args: "python3 bridge".into(),
                },
            ),
            (
                90000,
                ProcessInfo {
                    pid: 90000,
                    ppid: 1,
                    args: "/bin/zsh -lc codex".into(),
                },
            ),
        ]);

        assert!(resolve_launcher(90001, &processes).is_none());
    }
}
