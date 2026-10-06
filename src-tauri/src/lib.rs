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

/// Whether the main webview may load `url`: the app's own assets, the dev
/// server in dev builds, and same-origin blob/about:blank documents. Anything
/// else is refused — a navigation is not governed by the CSP, and the
/// initialization script would hand `__OH_TOKEN__` to whatever page loads.
fn is_app_navigation(url: &tauri::Url, dev_url: Option<&tauri::Url>) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "about" => url.as_str() == "about:blank",
        // blob:http://tauri.localhost/<uuid> — judge the origin it was minted in.
        "blob" => url
            .path()
            .parse::<tauri::Url>()
            .is_ok_and(|inner| inner.scheme() != "blob" && is_app_navigation(&inner, dev_url)),
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
                || dev_url.is_some_and(|dev| dev.origin() == url.origin())
        }
        _ => false,
    }
}

/// External web pages (docs links) open in the system browser instead of the
/// webview. Loopback hosts are excluded so a crafted link can't point the
/// browser at the sidecar or other local services.
fn opens_in_browser(url: &tauri::Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && !matches!(
            url.host_str(),
            None | Some("tauri.localhost" | "localhost" | "127.0.0.1" | "[::1]")
        )
}

fn open_in_browser(app: &AppHandle, url: &tauri::Url) {
    if opens_in_browser(url) {
        // tauri-plugin-shell's open is deprecated in favour of tauri-plugin-opener;
        // kept to avoid a new dependency for one call (backlog: migrate).
        #[allow(deprecated)]
        let _ = app.shell().open(url.as_str(), None);
    }
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
            let dev_url = if cfg!(dev) {
                app.config().build.dev_url.clone()
            } else {
                None
            };
            let nav_app = app.handle().clone();
            let popup_app = app.handle().clone();
            WebviewWindowBuilder::from_config(app.handle(), &config)?
                .initialization_script(initialization_script(&api, &token))
                .on_navigation(move |url| {
                    let allowed = is_app_navigation(url, dev_url.as_ref());
                    if !allowed {
                        open_in_browser(&nav_app, url);
                    }
                    allowed
                })
                .on_new_window(move |url, _features| {
                    open_in_browser(&popup_app, &url);
                    tauri::webview::NewWindowResponse::Deny
                })
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
    fn main_window_is_not_auto_created_because_setup_builds_it_with_the_token_script() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let main = config["app"]["windows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|w| w["label"] == "main")
            .expect("main window config");
        assert_eq!(main["create"], serde_json::Value::Bool(false));
    }

    fn csp_directive<'a>(csp: &'a str, name: &str) -> Option<&'a str> {
        csp.split(';')
            .map(str::trim)
            .find(|d| d.split_whitespace().next() == Some(name))
    }

    #[test]
    fn production_csp_is_strict() {
        // The webview holds the sidecar token (__OH_TOKEN__) and Tauri IPC, so
        // an XSS must not be able to run injected script or reach other hosts.
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let security = &config["app"]["security"];
        let csp = security["csp"]
            .as_str()
            .expect("app.security.csp must be set");

        let script = csp_directive(csp, "script-src").expect("script-src");
        assert_eq!(script, "script-src 'self'", "Tauri appends its own hashes");
        assert!(!csp.contains("unsafe-eval"));

        let connect = csp_directive(csp, "connect-src").expect("connect-src");
        for src in connect.split_whitespace().skip(1) {
            assert!(
                [
                    "'self'",
                    "ipc:",
                    "http://ipc.localhost",
                    "http://127.0.0.1:*"
                ]
                .contains(&src),
                "connect-src may only reach IPC and the loopback sidecar, got {src}"
            );
        }
        for locked in [
            "default-src 'self'",
            "object-src 'none'",
            "frame-src 'none'",
            "frame-ancestors 'none'",
            "base-uri 'self'",
        ] {
            assert!(csp.contains(locked), "missing {locked}");
        }
        // No other directive may reach beyond the app itself.
        for directive in csp.split(';').map(str::trim).filter(|d| !d.is_empty()) {
            let mut parts = directive.split_whitespace();
            let name = parts.next().unwrap();
            assert!(
                !matches!(name, "script-src-elem" | "script-src-attr"),
                "{name} would override script-src"
            );
            if name == "connect-src" {
                continue;
            }
            for src in parts {
                assert!(
                    ["'self'", "'none'", "'unsafe-inline'", "data:", "blob:"].contains(&src),
                    "{name} allows {src}"
                );
            }
        }
        // Only style-src may opt out of Tauri's nonce injection (React style attributes).
        assert_eq!(
            security["dangerousDisableAssetCspModification"],
            serde_json::json!(["style-src"])
        );
    }

    fn url(s: &str) -> tauri::Url {
        s.parse().unwrap()
    }

    #[test]
    fn the_webview_may_only_navigate_within_the_app() {
        let dev: tauri::Url = url("http://127.0.0.1:3000");
        for ok in [
            "http://tauri.localhost/",
            "http://tauri.localhost/studio?x=1",
            "tauri://localhost/index.html",
            "about:blank",
            "blob:http://tauri.localhost/5b1d4c0e-0000-4000-8000-000000000000",
        ] {
            assert!(
                is_app_navigation(&url(ok), None),
                "{ok} should stay in the app"
            );
        }
        for bad in [
            "https://evil.example/?t=secret",
            "http://127.0.0.1:8000/providers",
            "http://127.0.0.1:3000/",
            "file:///C:/Windows/win.ini",
            "blob:https://evil.example/x",
            "about:srcdoc",
            "javascript:alert(1)",
        ] {
            assert!(!is_app_navigation(&url(bad), None), "{bad} must be refused");
        }
        // The dev server is the app only in dev builds, where it is passed in.
        assert!(is_app_navigation(
            &url("http://127.0.0.1:3000/"),
            Some(&dev)
        ));
        assert!(!is_app_navigation(
            &url("http://127.0.0.1:3001/"),
            Some(&dev)
        ));
    }

    #[test]
    fn only_external_web_links_are_handed_to_the_system_browser() {
        assert!(opens_in_browser(&url("https://openrouter.ai/docs")));
        assert!(opens_in_browser(&url("http://example.com/")));
        for not_web in [
            "http://tauri.localhost/x",
            "file:///C:/x",
            "javascript:alert(1)",
            "ms-settings:privacy",
            "http://127.0.0.1:8000/",
            "http://localhost:9000/",
        ] {
            assert!(!opens_in_browser(&url(not_web)), "{not_web}");
        }
    }

    #[test]
    fn reserve_port_returns_a_loopback_port_that_can_be_rebound() {
        let port = reserve_port().unwrap();
        TcpListener::bind(("127.0.0.1", port)).unwrap();
    }
}
