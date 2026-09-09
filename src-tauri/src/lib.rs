//! OpenHarness Tauri shell — window chrome + FastAPI sidecar lifecycle.
//!
//! ADR 0001: decorations off; TitleBar is the real chrome. Sidecar is the
//! FastAPI binary registered as `binaries/openharness-sidecar`.

use std::sync::Mutex;
use tauri::{AppHandle, Manager, RunEvent, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// Default loopback URL injected as `window.__OH_API__` for the static UI.
const DEFAULT_API: &str = "http://127.0.0.1:8000";

struct SidecarState(Mutex<Option<CommandChild>>);

fn inject_api_script(api: &str) -> String {
    format!(
        r#"Object.defineProperty(window, "__OH_API__", {{ value: "{}", writable: false }});"#,
        api.replace('\\', "\\\\").replace('"', "\\\"")
    )
}

fn spawn_sidecar(app: &AppHandle) -> Result<(), String> {
    let shell = app.shell();
    let sidecar = shell
        .sidecar("binaries/openharness-sidecar")
        .map_err(|e| format!("sidecar lookup failed: {e}"))?;

    let (mut _rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("sidecar spawn failed: {e}"))?;

    let state = app.state::<SidecarState>();
    *state.0.lock().map_err(|e| e.to_string())? = Some(child);
    Ok(())
}

fn kill_sidecar(app: &AppHandle) {
    if let Ok(mut guard) = app.state::<SidecarState>().0.lock() {
        if let Some(child) = guard.take() {
            let _ = child.kill();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
            // Inject API base before any page script runs (static export → sidecar).
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval(&inject_api_script(DEFAULT_API));
            }

            // Sidecar may be missing in scaffold/dev without a built binary —
            // log and continue so `tauri build` still packages the UI.
            if let Err(err) = spawn_sidecar(app.handle()) {
                eprintln!("[openharness] sidecar not started: {err}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building OpenHarness")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                kill_sidecar(app_handle);
            }
        });
}
