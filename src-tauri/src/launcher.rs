use std::collections::{HashMap, HashSet};
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
}

pub struct ClaudeSessionResolver {
    icon_cache: Mutex<HashMap<PathBuf, String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeSessionFile {
    pid: u32,
    session_id: String,
}

#[derive(Debug, Clone)]
struct ProcessInfo {
    pid: u32,
    ppid: u32,
    args: String,
}

impl ClaudeSessionResolver {
    pub fn new(_icon_cache_dir: PathBuf) -> Self {
        Self {
            icon_cache: Mutex::new(HashMap::new()),
        }
    }

    pub fn resolve(&self) -> Option<HashMap<String, LauncherView>> {
        let Ok(session_files) = read_claude_session_files() else {
            return None;
        };
        if session_files.is_empty() {
            return Some(HashMap::new());
        }

        let Ok(processes) = read_process_table() else {
            return None;
        };

        Some(
            session_files
            .into_iter()
            .filter_map(|session| {
                let root = resolve_root_process(session.pid, &processes)?;
                let bundle_path = bundle_path_from_args(root.args.as_str())?;
                let name = app_name_from_bundle_path(&bundle_path)?;
                let icon_data_url = self.export_app_icon(&bundle_path);
                Some((
                    session.session_id,
                    LauncherView {
                        name,
                        icon_data_url,
                        bundle_path: Some(bundle_path.to_string_lossy().into_owned()),
                    },
                ))
            })
            .collect(),
        )
    }

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

fn read_claude_session_files() -> Result<Vec<ClaudeSessionFile>, std::io::Error> {
    let Some(home_dir) = std::env::var_os("HOME") else {
        return Ok(Vec::new());
    };
    let sessions_dir = PathBuf::from(home_dir).join(".claude").join("sessions");
    let Ok(entries) = std::fs::read_dir(sessions_dir) else {
        return Ok(Vec::new());
    };

    let mut sessions = Vec::new();
    for entry in entries {
        let entry = entry?;
        if entry.path().extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }

        let Ok(contents) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        let Ok(session) = serde_json::from_str::<ClaudeSessionFile>(&contents) else {
            continue;
        };

        sessions.push(session);
    }

    Ok(sessions)
}

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

fn resolve_root_process(pid: u32, processes: &HashMap<u32, ProcessInfo>) -> Option<ProcessInfo> {
    let mut current = pid;
    let mut visited = HashSet::new();
    let mut last = None;

    while visited.insert(current) {
        let process = processes.get(&current)?.clone();
        last = Some(process.clone());

        if process.ppid == 1 {
            return Some(process);
        }

        current = process.ppid;
    }

    last
}

fn bundle_path_from_args(args: &str) -> Option<PathBuf> {
    if !args.starts_with('/') {
        return None;
    }

    let marker = ".app/Contents/";
    let app_end = args.find(marker)? + 4;
    Some(PathBuf::from(&args[..app_end]))
}

fn app_name_from_bundle_path(path: &Path) -> Option<String> {
    path.file_stem()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
fn export_app_icon_data_url(bundle_path: &Path) -> Option<String> {
    use objc2::{runtime::AnyObject, AnyThread};
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
        let properties = NSDictionary::<objc2_app_kit::NSBitmapImageRepPropertyKey, AnyObject>::dictionary();
        bitmap
            .representationUsingType_properties(NSBitmapImageFileType::PNG, &properties)?
            .to_vec()
    };

    let encoded = base64::engine::general_purpose::STANDARD.encode(png_bytes);
    Some(format!("data:image/png;base64,{encoded}"))
}

#[cfg(not(target_os = "macos"))]
fn export_app_icon_data_url(_bundle_path: &Path) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_process_rows_with_spaces_in_args() {
        let process = parse_process_line(" 1447     1 /Applications/Ghostty.app/Contents/MacOS/ghostty").unwrap();
        assert_eq!(process.pid, 1447);
        assert_eq!(process.ppid, 1);
        assert_eq!(process.args, "/Applications/Ghostty.app/Contents/MacOS/ghostty");
    }

    #[test]
    fn extracts_bundle_path_from_root_process_args() {
        let bundle = bundle_path_from_args("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome").unwrap();
        assert_eq!(bundle, PathBuf::from("/Applications/Google Chrome.app"));
    }

    #[test]
    fn resolves_root_process_by_following_parent_chain() {
        let processes = HashMap::from([
            (
                87884,
                ProcessInfo {
                    pid: 87884,
                    ppid: 64851,
                    args: "claude".into(),
                },
            ),
            (
                64851,
                ProcessInfo {
                    pid: 64851,
                    ppid: 64849,
                    args: "-zsh".into(),
                },
            ),
            (
                64849,
                ProcessInfo {
                    pid: 64849,
                    ppid: 64283,
                    args: "/usr/bin/login -flp Kevin /bin/zsh -fc exec -a -zsh /bin/zsh".into(),
                },
            ),
            (
                64283,
                ProcessInfo {
                    pid: 64283,
                    ppid: 1,
                    args: "/Applications/Zed.app/Contents/MacOS/zed".into(),
                },
            ),
        ]);

        let root = resolve_root_process(87884, &processes).unwrap();
        assert_eq!(root.pid, 64283);
        assert_eq!(root.ppid, 1);
    }
}
