//! OpenHarness Tauri shell — window chrome + FastAPI sidecar lifecycle.
//!
//! ADR 0001: decorations off; TitleBar is the real chrome. Sidecar is the
//! FastAPI binary bundled from `binaries/openharness-sidecar` and installed
//! beside the desktop executable as `openharness-sidecar`.

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::sync::Mutex;
use std::{
    net::{SocketAddr, TcpListener, TcpStream},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, RunEvent, WebviewWindowBuilder};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

struct SidecarProcess {
    child: CommandChild,
    pid: u32,
}

struct SidecarState(Mutex<Option<SidecarProcess>>);

const SIDECAR_NAME: &str = "openharness-sidecar";

#[cfg(windows)]
fn terminate_process_tree(pid: u32) {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

#[cfg(not(windows))]
fn terminate_process_tree(_pid: u32) {}

fn stop_sidecar(process: SidecarProcess) {
    // PyInstaller one-file executables launch a worker process. Kill the tree
    // first on Windows so closing OpenHarness cannot leave the API running.
    terminate_process_tree(process.pid);
    let _ = process.child.kill();
}

fn initialization_script(api: &str, token: &str) -> String {
    format!(
        "Object.defineProperties(window, {{ __OH_API__: {{ value: {}, writable: false }}, __OH_TOKEN__: {{ value: {}, writable: false }} }});",
        serde_json::to_string(api).expect("API URL serializes"),
        serde_json::to_string(token).expect("token serializes"),
    )
}

fn generate_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("token generation failed: {e}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn reserve_port() -> Result<u16, String> {
    let listener =
        TcpListener::bind(("127.0.0.1", 0)).map_err(|e| format!("port allocation failed: {e}"))?;
    listener
        .local_addr()
        .map(|addr| addr.port())
        .map_err(|e| e.to_string())
}

fn wait_until_ready(port: u16, timeout: Duration) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&address, Duration::from_millis(150)).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(75));
    }
    false
}

fn spawn_sidecar(app: &AppHandle, port: u16, token: &str) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("app data directory lookup failed: {e}"))?;
    let shell = app.shell();
    let sidecar = shell
        .sidecar(SIDECAR_NAME)
        .map_err(|e| format!("sidecar lookup failed: {e}"))?
        .env("OH_PORT", port.to_string())
        .env("OH_SIDECAR_TOKEN", token)
        .env("OH_DATA_DIR", data_dir);

    let (mut _rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("sidecar spawn failed: {e}"))?;
    let pid = child.pid();

    if !wait_until_ready(port, Duration::from_secs(15)) {
        stop_sidecar(SidecarProcess { child, pid });
        return Err(format!("sidecar did not become ready on port {port}"));
    }

    let state = app.state::<SidecarState>();
    *state.0.lock().map_err(|e| e.to_string())? = Some(SidecarProcess { child, pid });
    Ok(())
}

fn kill_sidecar(app: &AppHandle) {
    if let Ok(mut guard) = app.state::<SidecarState>().0.lock() {
        if let Some(process) = guard.take() {
            stop_sidecar(process);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
            let token = generate_token().map_err(std::io::Error::other)?;
            let port = reserve_port().map_err(std::io::Error::other)?;
            spawn_sidecar(app.handle(), port, &token).map_err(std::io::Error::other)?;

            // The config keeps `create: false` so this initialization script
            // runs before any frontend module can issue an authenticated fetch.
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .cloned()
                .ok_or_else(|| std::io::Error::other("main window config missing"))?;
            let api = format!("http://127.0.0.1:{port}");
            WebviewWindowBuilder::from_config(app.handle(), &config)?
                .initialization_script(initialization_script(&api, &token))
                .build()?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialization_script_serializes_values_without_executable_injection() {
        let script = initialization_script("http://127.0.0.1:8123", "tok\"en");
        assert!(script.contains("http://127.0.0.1:8123"));
        assert!(script.contains("tok\\\"en"));
        assert!(script.contains("__OH_API__"));
        assert!(script.contains("__OH_TOKEN__"));
    }

    #[test]
    fn generated_tokens_are_random_hex_secrets() {
        let first = generate_token().unwrap();
        let second = generate_token().unwrap();
        assert_eq!(first.len(), 64);
        assert!(first.chars().all(|character| character.is_ascii_hexdigit()));
        assert_ne!(first, second);
    }

    #[test]
    fn reserve_port_returns_a_loopback_port_that_can_be_rebound() {
        let port = reserve_port().unwrap();
        TcpListener::bind(("127.0.0.1", port)).unwrap();
    }
}
