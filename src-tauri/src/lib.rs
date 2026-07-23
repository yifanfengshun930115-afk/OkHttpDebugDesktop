use chrono::{Duration as ChronoDuration, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    env,
    fs::{self, OpenOptions},
    io::Write,
    net::{TcpListener, TcpStream},
    panic,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tungstenite::{accept, Message};

const PROTOCOL_VERSION: u8 = 1;
const DEFAULT_WS_PORT: u16 = 19090;
const DEFAULT_WS_PORT_RANGE_END: u16 = 19109;
const MAX_CAPTURE_RECORDS: usize = 1_000;
const AUTO_REVERSE_INTERVAL_MS: u64 = 15_000;
const LOG_RETENTION_DAYS: u64 = 7;
const STATE_CHANGED_EVENT: &str = "state_changed";
const ADB_INSTALL_HINT: &str = "未找到 ADB。请通过 Android Studio SDK Manager 或 Google Platform-Tools 安装 Android SDK Platform-Tools，并设置 ADB_PATH 或 ANDROID_HOME；也可以把内置 ADB 放到 resources/platform-tools/<platform>/adb。";

static NEXT_CONNECTION_ID: AtomicU64 = AtomicU64::new(1);
static ADB_REVERSE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone)]
struct SharedAppState(Arc<Mutex<Model>>);

struct Model {
    server: ServerState,
    captures: Vec<Value>,
    resource_dir: Option<PathBuf>,
    log_dir: PathBuf,
    shutting_down: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopState {
    server: ServerState,
    captures: Vec<Value>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerState {
    port: u16,
    preferred_port: u16,
    device_port: u16,
    usb_reverse: UsbReverseState,
    capture_log_path: Option<String>,
    port_range: PortRange,
    running: bool,
    starting: bool,
    error: Option<String>,
    connection_count: usize,
    connections: Vec<ConnectionInfo>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PortRange {
    start: u16,
    end: u16,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionInfo {
    id: String,
    connected_at_epoch_ms: u64,
    last_seen_at_epoch_ms: u64,
    remote_address: Option<String>,
    session_id: Option<String>,
    app: Option<Value>,
    device: Option<Value>,
    protocol_version: Option<u64>,
    token_present: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UsbReverseState {
    enabled: bool,
    active: bool,
    host_port: u16,
    device_port: u16,
    interval_ms: u64,
    last_attempt_epoch_ms: Option<u64>,
    last_success_epoch_ms: Option<u64>,
    adb: Option<AdbInfo>,
    devices: Vec<UsbReverseDeviceState>,
    message: Option<String>,
    error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UsbReverseDeviceState {
    serial: String,
    state: String,
    description: String,
    mapped: bool,
    last_attempt_epoch_ms: u64,
    error: Option<String>,
    stderr: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AdbInfo {
    available: bool,
    path: Option<String>,
    source: Option<String>,
    version: Option<String>,
    checked_paths: Vec<String>,
    install_hint: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AdbCommandResult {
    ok: bool,
    stdout: String,
    stderr: String,
    error: Option<String>,
    devices: Option<Vec<AdbDevice>>,
    adb: Option<AdbInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LogActionResult {
    ok: bool,
    message: String,
    log_dir: Option<String>,
    capture_log_path: Option<String>,
    deleted_count: Option<usize>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LogFileInfo {
    name: String,
    path: String,
    size_bytes: u64,
    modified_epoch_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsInfo {
    generated_at_epoch_ms: u64,
    app_version: String,
    os: String,
    arch: String,
    log_dir: String,
    capture_log_path: Option<String>,
    server: ServerState,
    adb: AdbInfo,
    log_files: Vec<LogFileInfo>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RendererErrorReport {
    message: String,
    stack: Option<String>,
    source: Option<String>,
    lineno: Option<u32>,
    colno: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AdbDevice {
    serial: String,
    state: String,
    description: String,
}

#[derive(Clone)]
struct AdbCandidate {
    path: String,
    source: String,
}

impl SharedAppState {
    fn new(resource_dir: Option<PathBuf>, log_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&log_dir);
        cleanup_old_logs(&log_dir);
        let capture_log_path = capture_log_path_for_day(&log_dir)
            .to_string_lossy()
            .to_string();

        Self(Arc::new(Mutex::new(Model {
            server: ServerState {
                port: DEFAULT_WS_PORT,
                preferred_port: DEFAULT_WS_PORT,
                device_port: DEFAULT_WS_PORT,
                usb_reverse: UsbReverseState {
                    enabled: true,
                    active: false,
                    host_port: DEFAULT_WS_PORT,
                    device_port: DEFAULT_WS_PORT,
                    interval_ms: AUTO_REVERSE_INTERVAL_MS,
                    last_attempt_epoch_ms: None,
                    last_success_epoch_ms: None,
                    adb: None,
                    devices: Vec::new(),
                    message: Some("USB 自动映射已就绪。".to_string()),
                    error: None,
                },
                capture_log_path: Some(capture_log_path),
                port_range: PortRange {
                    start: DEFAULT_WS_PORT,
                    end: DEFAULT_WS_PORT_RANGE_END,
                },
                running: false,
                starting: true,
                error: None,
                connection_count: 0,
                connections: Vec::new(),
            },
            captures: Vec::new(),
            resource_dir,
            log_dir,
            shutting_down: false,
        })))
    }

    fn snapshot(&self) -> DesktopState {
        let model = self.0.lock().expect("state lock poisoned");
        DesktopState {
            server: model.server.clone(),
            captures: model.captures.clone(),
        }
    }

    fn mutate(&self, mutate: impl FnOnce(&mut Model)) {
        let mut model = self.0.lock().expect("state lock poisoned");
        mutate(&mut model);
    }
}

#[tauri::command]
fn get_state(state: State<'_, SharedAppState>) -> DesktopState {
    state.snapshot()
}

#[tauri::command]
fn clear_captures(app: AppHandle, state: State<'_, SharedAppState>) -> DesktopState {
    state.mutate(|model| model.captures.clear());
    emit_state(&app, &state);
    state.snapshot()
}

#[tauri::command]
fn export_json(state: State<'_, SharedAppState>) -> AdbExportResult {
    let snapshot = state.snapshot();
    let file_path = export_file_path();
    let payload = json!({
      "exportedAtEpochMs": now_ms(),
      "server": snapshot.server,
      "captures": snapshot.captures,
    });

    match serde_json::to_string_pretty(&payload)
        .map_err(|error| error.to_string())
        .and_then(|text| fs::write(&file_path, text).map_err(|error| error.to_string()))
    {
        Ok(()) => {
            let open_folder_error = file_path
                .parent()
                .and_then(|parent| open_path(parent).err());
            AdbExportResult {
                ok: true,
                canceled: false,
                file_path: Some(file_path.to_string_lossy().to_string()),
                count: Some(snapshot.captures.len()),
                open_folder_error,
                error: None,
            }
        }
        Err(error) => AdbExportResult {
            ok: false,
            canceled: false,
            file_path: None,
            count: None,
            open_folder_error: None,
            error: Some(error),
        },
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdbExportResult {
    ok: bool,
    canceled: bool,
    file_path: Option<String>,
    count: Option<usize>,
    open_folder_error: Option<String>,
    error: Option<String>,
}

#[tauri::command]
fn adb_list_devices(state: State<'_, SharedAppState>) -> AdbCommandResult {
    list_adb_devices_inner(&state)
}

#[tauri::command]
fn adb_reverse(
    state: State<'_, SharedAppState>,
    serial: Option<String>,
    host_port: Option<u16>,
    device_port: Option<u16>,
) -> AdbCommandResult {
    reverse_debug_port_inner(
        &state,
        serial.as_deref(),
        host_port.unwrap_or(DEFAULT_WS_PORT),
        device_port.unwrap_or(DEFAULT_WS_PORT),
    )
}

#[tauri::command]
fn cleanup_adb_reverse(
    app: AppHandle,
    state: State<'_, SharedAppState>,
    device_port: Option<u16>,
) -> AdbCommandResult {
    cleanup_adb_reverse_inner(&app, &state, device_port.unwrap_or(DEFAULT_WS_PORT))
}

#[tauri::command]
fn close_app(app: AppHandle, state: State<'_, SharedAppState>, device_port: Option<u16>) {
    let _ = cleanup_adb_reverse_inner(&app, &state, device_port.unwrap_or(DEFAULT_WS_PORT));
    app.exit(0);
}

#[tauri::command]
fn open_log_dir(state: State<'_, SharedAppState>) -> LogActionResult {
    let log_dir = {
        let model = state.0.lock().expect("state lock poisoned");
        model.log_dir.clone()
    };
    if let Err(error) = fs::create_dir_all(&log_dir) {
        return log_action_error(&log_dir, format!("日志目录创建失败：{}", error));
    }

    match open_path(&log_dir) {
        Ok(()) => LogActionResult {
            ok: true,
            message: "已打开日志目录。".to_string(),
            log_dir: Some(log_dir.to_string_lossy().to_string()),
            capture_log_path: Some(
                capture_log_path_for_day(&log_dir)
                    .to_string_lossy()
                    .to_string(),
            ),
            deleted_count: None,
            error: None,
        },
        Err(error) => log_action_error(&log_dir, format!("日志目录打开失败：{}", error)),
    }
}

#[tauri::command]
fn clear_logs(app: AppHandle, state: State<'_, SharedAppState>) -> LogActionResult {
    let log_dir = {
        let model = state.0.lock().expect("state lock poisoned");
        model.log_dir.clone()
    };

    let mut deleted_count = 0usize;
    let mut failures = Vec::new();
    if let Err(error) = fs::create_dir_all(&log_dir) {
        return log_action_error(&log_dir, format!("日志目录创建失败：{}", error));
    }

    match fs::read_dir(&log_dir) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let path = entry.path();
                let result = if path.is_dir() {
                    fs::remove_dir_all(&path)
                } else {
                    fs::remove_file(&path)
                };
                match result {
                    Ok(()) => deleted_count += 1,
                    Err(error) => failures.push(format!("{}: {}", path.to_string_lossy(), error)),
                }
            }
        }
        Err(error) => return log_action_error(&log_dir, format!("日志读取失败：{}", error)),
    }

    let capture_log_path = capture_log_path_for_day(&log_dir);
    state.mutate(|model| {
        model.server.capture_log_path = Some(capture_log_path.to_string_lossy().to_string());
    });
    append_log(
        &state,
        json!({ "type": "logs_cleared", "deletedCount": deleted_count }),
    );
    emit_state(&app, &state);

    if failures.is_empty() {
        LogActionResult {
            ok: true,
            message: format!("已清理 {} 个日志项。", deleted_count),
            log_dir: Some(log_dir.to_string_lossy().to_string()),
            capture_log_path: Some(capture_log_path.to_string_lossy().to_string()),
            deleted_count: Some(deleted_count),
            error: None,
        }
    } else {
        LogActionResult {
            ok: false,
            message: format!(
                "已清理 {} 个日志项，{} 个失败。",
                deleted_count,
                failures.len()
            ),
            log_dir: Some(log_dir.to_string_lossy().to_string()),
            capture_log_path: Some(capture_log_path.to_string_lossy().to_string()),
            deleted_count: Some(deleted_count),
            error: Some(failures.join("\n")),
        }
    }
}

#[tauri::command]
fn get_diagnostics(state: State<'_, SharedAppState>) -> DiagnosticsInfo {
    let snapshot = state.snapshot();
    let log_dir = {
        let model = state.0.lock().expect("state lock poisoned");
        model.log_dir.clone()
    };
    DiagnosticsInfo {
        generated_at_epoch_ms: now_ms(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os: env::consts::OS.to_string(),
        arch: env::consts::ARCH.to_string(),
        log_dir: log_dir.to_string_lossy().to_string(),
        capture_log_path: snapshot.server.capture_log_path.clone(),
        server: snapshot.server,
        adb: detect_adb(&state),
        log_files: list_log_files(&log_dir),
    }
}

#[tauri::command]
fn report_renderer_error(
    state: State<'_, SharedAppState>,
    payload: RendererErrorReport,
) -> LogActionResult {
    let log_dir = {
        let model = state.0.lock().expect("state lock poisoned");
        model.log_dir.clone()
    };
    append_log(
        &state,
        json!({
          "type": "renderer_error",
          "message": payload.message,
          "stack": payload.stack,
          "source": payload.source,
          "lineno": payload.lineno,
          "colno": payload.colno,
        }),
    );
    LogActionResult {
        ok: true,
        message: "已记录前端异常。".to_string(),
        log_dir: Some(log_dir.to_string_lossy().to_string()),
        capture_log_path: Some(
            capture_log_path_for_day(&log_dir)
                .to_string_lossy()
                .to_string(),
        ),
        deleted_count: None,
        error: None,
    }
}

fn cleanup_adb_reverse_inner(
    app: &AppHandle,
    state: &SharedAppState,
    device_port: u16,
) -> AdbCommandResult {
    state.mutate(|model| {
        model.shutting_down = true;
        model.server.usb_reverse.active = false;
        model.server.usb_reverse.message = Some("正在移除 USB reverse 映射。".to_string());
    });
    emit_state(app, state);

    let result = remove_all_reverse_mappings(state, device_port);
    if result.ok {
        state.mutate(|model| {
            for device in &mut model.server.usb_reverse.devices {
                device.mapped = false;
            }
            model.server.usb_reverse.message = Some("已移除 USB reverse 映射。".to_string());
            model.server.usb_reverse.error = None;
        });
        emit_state(app, state);
    }
    result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            let resource_dir = app.path().resource_dir().ok();
            let log_dir = app.path().app_log_dir().unwrap_or_else(|_| {
                env::temp_dir()
                    .join("okhttp-debug-desktop-tauri")
                    .join("logs")
            });
            install_panic_hook(log_dir.clone());
            let shared = SharedAppState::new(resource_dir, log_dir);
            let startup_resource_dir = {
                let model = shared.0.lock().expect("state lock poisoned");
                model
                    .resource_dir
                    .as_ref()
                    .map(|path| path.to_string_lossy().to_string())
            };
            append_log(
                &shared,
                json!({
                  "type": "desktop_started",
                  "appVersion": env!("CARGO_PKG_VERSION"),
                  "os": env::consts::OS,
                  "arch": env::consts::ARCH,
                  "resourceDir": startup_resource_dir,
                }),
            );
            let handle = app.handle().clone();
            app.manage(shared.clone());
            start_capture_server(handle.clone(), shared.clone());
            start_adb_reverse_worker(handle, shared);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            clear_captures,
            export_json,
            adb_list_devices,
            adb_reverse,
            cleanup_adb_reverse,
            close_app,
            open_log_dir,
            clear_logs,
            get_diagnostics,
            report_renderer_error
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn start_capture_server(app: AppHandle, shared: SharedAppState) {
    thread::spawn(move || {
        let mut bound: Option<(u16, TcpListener)> = None;
        for port in DEFAULT_WS_PORT..=DEFAULT_WS_PORT_RANGE_END {
            match TcpListener::bind(("127.0.0.1", port)) {
                Ok(listener) => {
                    bound = Some((port, listener));
                    break;
                }
                Err(error) => {
                    if port == DEFAULT_WS_PORT_RANGE_END {
                        shared.mutate(|model| {
                            model.server.running = false;
                            model.server.starting = false;
                            model.server.error = Some(format!(
                                "本地 WebSocket 端口 {}-{} 均不可用：{}",
                                DEFAULT_WS_PORT, DEFAULT_WS_PORT_RANGE_END, error
                            ));
                        });
                        emit_state(&app, &shared);
                        return;
                    }
                }
            }
        }

        let Some((port, listener)) = bound else {
            return;
        };

        shared.mutate(|model| {
            model.server.port = port;
            model.server.usb_reverse.host_port = port;
            model.server.running = true;
            model.server.starting = false;
            model.server.error = None;
        });
        emit_state(&app, &shared);

        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    let app = app.clone();
                    let shared = shared.clone();
                    thread::spawn(move || handle_socket(stream, app, shared));
                }
                Err(error) => {
                    shared.mutate(|model| {
                        model.server.error = Some(error.to_string());
                    });
                    emit_state(&app, &shared);
                }
            }
        }
    });
}

fn handle_socket(stream: TcpStream, app: AppHandle, shared: SharedAppState) {
    let remote_address = stream.peer_addr().ok().map(|address| address.to_string());
    let connection_id = format!(
        "conn-{}-{}",
        now_ms(),
        NEXT_CONNECTION_ID.fetch_add(1, Ordering::Relaxed)
    );
    let connected_at = now_ms();

    shared.mutate(|model| {
        model.server.connections.push(ConnectionInfo {
            id: connection_id.clone(),
            connected_at_epoch_ms: connected_at,
            last_seen_at_epoch_ms: connected_at,
            remote_address,
            session_id: None,
            app: None,
            device: None,
            protocol_version: None,
            token_present: false,
        });
        model.server.connection_count = model.server.connections.len();
    });
    append_log(
        &shared,
        json!({ "type": "connection", "connectionId": connection_id }),
    );
    emit_state(&app, &shared);

    match accept(stream) {
        Ok(mut socket) => {
            while let Ok(message) = socket.read() {
                if let Message::Text(raw) = message {
                    if let Some(reply) =
                        handle_client_message(&connection_id, raw.as_str(), &app, &shared)
                    {
                        let _ = socket.send(Message::Text(reply.into()));
                    }
                }
            }
        }
        Err(error) => {
            append_log(
                &shared,
                json!({ "type": "socket_error", "connectionId": connection_id, "message": error.to_string() }),
            );
        }
    }

    shared.mutate(|model| {
        model
            .server
            .connections
            .retain(|connection| connection.id != connection_id);
        model.server.connection_count = model.server.connections.len();
    });
    append_log(
        &shared,
        json!({ "type": "close", "connectionId": connection_id }),
    );
    emit_state(&app, &shared);
}

fn handle_client_message(
    connection_id: &str,
    raw: &str,
    app: &AppHandle,
    shared: &SharedAppState,
) -> Option<String> {
    let parsed: Value = match serde_json::from_str(raw) {
        Ok(value) => value,
        Err(error) => {
            let message = format!("Message is not valid JSON: {}", error);
            append_log(
                shared,
                json!({ "type": "message_error", "connectionId": connection_id, "message": message }),
            );
            return Some(json!({ "type": "error", "message": message }).to_string());
        }
    };

    let message_type = parsed
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    shared.mutate(|model| {
        if let Some(connection) = model
            .server
            .connections
            .iter_mut()
            .find(|connection| connection.id == connection_id)
        {
            connection.last_seen_at_epoch_ms = now_ms();
        }
    });

    match message_type {
        "hello" => {
            let app_info = parsed.get("app").cloned();
            let device_info = parsed.get("device").cloned();
            let session_id = parsed
                .get("sessionId")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            let protocol_version = parsed.get("protocolVersion").and_then(Value::as_u64);
            let token_present = parsed.get("token").and_then(Value::as_str).is_some();

            shared.mutate(|model| {
                if let Some(connection) = model
                    .server
                    .connections
                    .iter_mut()
                    .find(|connection| connection.id == connection_id)
                {
                    connection.session_id = session_id;
                    connection.app = app_info;
                    connection.device = device_info;
                    connection.protocol_version = protocol_version;
                    connection.token_present = token_present;
                }
            });
            append_log(
                shared,
                json!({ "type": "hello", "connectionId": connection_id }),
            );
            emit_state(app, shared);
            Some(
                json!({
                  "type": "hello_ack",
                  "protocolVersion": PROTOCOL_VERSION,
                  "server": "OkHttp Debug Desktop",
                  "serverTimeEpochMs": now_ms(),
                })
                .to_string(),
            )
        }
        "capture" => {
            let mut capture = parsed;
            let source = shared_connection_source(shared, connection_id);
            if let Some(object) = capture.as_object_mut() {
                object.insert("connectionId".to_string(), json!(connection_id));
                object.insert("receivedAtEpochMs".to_string(), json!(now_ms()));
                object.insert("source".to_string(), source);
            }

            shared.mutate(|model| {
                model.captures.insert(0, capture.clone());
                if model.captures.len() > MAX_CAPTURE_RECORDS {
                    model.captures.truncate(MAX_CAPTURE_RECORDS);
                }
            });
            append_log(shared, json!({ "type": "capture", "capture": capture }));
            emit_state(app, shared);
            None
        }
        "ping" => Some(
            json!({
              "type": "pong",
              "protocolVersion": PROTOCOL_VERSION,
              "sentAtEpochMs": parsed.get("sentAtEpochMs").cloned().unwrap_or(Value::Null),
              "receivedAtEpochMs": now_ms(),
            })
            .to_string(),
        ),
        "pong" => None,
        _ => {
            let message = format!("Unsupported message type: {}", message_type);
            append_log(
                shared,
                json!({ "type": "message_error", "connectionId": connection_id, "message": message }),
            );
            Some(json!({ "type": "error", "message": message }).to_string())
        }
    }
}

fn shared_connection_source(shared: &SharedAppState, connection_id: &str) -> Value {
    let model = shared.0.lock().expect("state lock poisoned");
    if let Some(connection) = model
        .server
        .connections
        .iter()
        .find(|connection| connection.id == connection_id)
    {
        json!({
          "app": connection.app.clone(),
          "device": connection.device.clone(),
        })
    } else {
        json!({})
    }
}

fn emit_state(app: &AppHandle, shared: &SharedAppState) {
    let _ = app.emit(STATE_CHANGED_EVENT, shared.snapshot());
}

fn log_action_error(log_dir: &Path, message: String) -> LogActionResult {
    LogActionResult {
        ok: false,
        message: message.clone(),
        log_dir: Some(log_dir.to_string_lossy().to_string()),
        capture_log_path: Some(
            capture_log_path_for_day(log_dir)
                .to_string_lossy()
                .to_string(),
        ),
        deleted_count: None,
        error: Some(message),
    }
}

fn open_path(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(path);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg(path);
        command
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn append_log(shared: &SharedAppState, entry: Value) {
    let log_path = {
        let mut model = shared.0.lock().expect("state lock poisoned");
        let path = capture_log_path_for_day(&model.log_dir);
        model.server.capture_log_path = Some(path.to_string_lossy().to_string());
        path
    };
    let _ = append_json_line(&log_path, entry);
}

fn append_json_line(path: &Path, entry: Value) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "{}", log_entry_with_timestamp(entry))
}

fn log_entry_with_timestamp(entry: Value) -> Value {
    match entry {
        Value::Object(mut object) => {
            object.insert("tsEpochMs".to_string(), json!(now_ms()));
            object.insert("ts".to_string(), json!(Local::now().to_rfc3339()));
            Value::Object(object)
        }
        other => json!({
          "tsEpochMs": now_ms(),
          "ts": Local::now().to_rfc3339(),
          "payload": other,
        }),
    }
}

fn install_panic_hook(log_dir: PathBuf) {
    let previous_hook = panic::take_hook();
    panic::set_hook(Box::new(move |panic_info| {
        let message = panic_info
            .payload()
            .downcast_ref::<&str>()
            .map(|message| (*message).to_string())
            .or_else(|| {
                panic_info
                    .payload()
                    .downcast_ref::<String>()
                    .map(ToOwned::to_owned)
            })
            .unwrap_or_else(|| "Rust panic".to_string());
        let location = panic_info.location().map(|location| {
            format!(
                "{}:{}:{}",
                location.file(),
                location.line(),
                location.column()
            )
        });
        let _ = append_json_line(
            &crash_log_path_for_day(&log_dir),
            json!({
              "type": "rust_panic",
              "message": message,
              "location": location,
            }),
        );
        previous_hook(panic_info);
    }));
}

fn capture_log_path_for_day(log_dir: &Path) -> PathBuf {
    log_dir.join(format!(
        "captures-{}.ndjson",
        Local::now().format("%Y-%m-%d")
    ))
}

fn crash_log_path_for_day(log_dir: &Path) -> PathBuf {
    log_dir.join(format!(
        "crashes-{}.ndjson",
        Local::now().format("%Y-%m-%d")
    ))
}

fn list_log_files(log_dir: &Path) -> Vec<LogFileInfo> {
    let Ok(entries) = fs::read_dir(log_dir) else {
        return Vec::new();
    };

    let mut files = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            Some(LogFileInfo {
                name: entry.file_name().to_string_lossy().to_string(),
                path: path.to_string_lossy().to_string(),
                size_bytes: metadata.len(),
                modified_epoch_ms: metadata.modified().ok().map(system_time_to_epoch_ms),
            })
        })
        .collect::<Vec<_>>();
    files.sort_by(|a, b| b.modified_epoch_ms.cmp(&a.modified_epoch_ms));
    files
}

fn system_time_to_epoch_ms(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_millis() as u64
}

fn cleanup_old_logs(log_dir: &Path) {
    let Ok(entries) = fs::read_dir(log_dir) else {
        return;
    };
    let cutoff = Local::now().date_naive()
        - ChronoDuration::days(LOG_RETENTION_DAYS.saturating_sub(1) as i64);
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let Some(log_date) = dated_log_file_date(file_name) else {
            continue;
        };
        if log_date < cutoff {
            let _ = fs::remove_file(path);
        }
    }
}

fn dated_log_file_date(file_name: &str) -> Option<NaiveDate> {
    capture_log_date(file_name).or_else(|| crash_log_date(file_name))
}

fn capture_log_date(file_name: &str) -> Option<NaiveDate> {
    let date = file_name
        .strip_prefix("captures-")?
        .strip_suffix(".ndjson")?;
    NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()
}

fn crash_log_date(file_name: &str) -> Option<NaiveDate> {
    let date = file_name
        .strip_prefix("crashes-")?
        .strip_suffix(".ndjson")?;
    NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()
}

fn start_adb_reverse_worker(app: AppHandle, shared: SharedAppState) {
    thread::spawn(move || loop {
        if is_shutting_down(&shared) {
            break;
        }
        apply_auto_reverse(&app, &shared);
        sleep_until_next_reverse_attempt(&shared);
    });
}

fn sleep_until_next_reverse_attempt(shared: &SharedAppState) {
    let mut remaining_ms = AUTO_REVERSE_INTERVAL_MS;
    while remaining_ms > 0 {
        if is_shutting_down(shared) {
            break;
        }
        let interval_ms = remaining_ms.min(250);
        thread::sleep(Duration::from_millis(interval_ms));
        remaining_ms -= interval_ms;
    }
}

fn is_shutting_down(shared: &SharedAppState) -> bool {
    let model = shared.0.lock().expect("state lock poisoned");
    model.shutting_down
}

fn apply_auto_reverse(app: &AppHandle, shared: &SharedAppState) {
    if is_shutting_down(shared) {
        return;
    }

    let (server_running, host_port, device_port) = {
        let model = shared.0.lock().expect("state lock poisoned");
        (
            model.server.running,
            model.server.port,
            model.server.device_port,
        )
    };

    let now = now_ms();
    shared.mutate(|model| {
        model.server.usb_reverse.active = true;
        model.server.usb_reverse.last_attempt_epoch_ms = Some(now);
        model.server.usb_reverse.error = None;
        model.server.usb_reverse.message = Some(if server_running {
            format!(
                "正在检查 USB 映射 tcp:{} -> tcp:{}。",
                device_port, host_port
            )
        } else {
            "等待本地 WebSocket 服务启动。".to_string()
        });
    });
    emit_state(app, shared);

    if !server_running {
        shared.mutate(|model| {
            model.server.usb_reverse.active = false;
        });
        emit_state(app, shared);
        return;
    }

    let device_result = list_adb_devices_inner(shared);
    if !device_result.ok {
        shared.mutate(|model| {
            model.server.usb_reverse.active = false;
            model.server.usb_reverse.adb = device_result.adb.clone();
            model.server.usb_reverse.devices = Vec::new();
            model.server.usb_reverse.error = device_result
                .error
                .clone()
                .or_else(|| Some(device_result.stderr.clone()))
                .filter(|message| !message.is_empty());
            model.server.usb_reverse.message = model
                .server
                .usb_reverse
                .error
                .clone()
                .or_else(|| Some(ADB_INSTALL_HINT.to_string()));
        });
        emit_state(app, shared);
        return;
    }

    let devices = device_result.devices.clone().unwrap_or_default();
    let eligible_count = devices
        .iter()
        .filter(|device| device.state == "device")
        .count();
    let mut mapped_devices = Vec::new();
    let mut success_count = 0usize;

    for device in &devices {
        if is_shutting_down(shared) {
            break;
        }

        if device.state != "device" {
            mapped_devices.push(UsbReverseDeviceState {
                serial: device.serial.clone(),
                state: device.state.clone(),
                description: device.description.clone(),
                mapped: false,
                last_attempt_epoch_ms: now,
                error: device_state_message(&device.state),
                stderr: None,
            });
            continue;
        }

        let reverse_result =
            reverse_debug_port_inner(shared, Some(&device.serial), host_port, device_port);
        if reverse_result.ok {
            success_count += 1;
        }
        mapped_devices.push(UsbReverseDeviceState {
            serial: device.serial.clone(),
            state: device.state.clone(),
            description: device.description.clone(),
            mapped: reverse_result.ok,
            last_attempt_epoch_ms: now,
            error: reverse_result.error.clone(),
            stderr: if reverse_result.stderr.is_empty() {
                None
            } else {
                Some(reverse_result.stderr)
            },
        });
    }

    shared.mutate(|model| {
        model.server.usb_reverse.active = false;
        model.server.usb_reverse.host_port = host_port;
        model.server.usb_reverse.device_port = device_port;
        model.server.usb_reverse.adb = device_result.adb.clone();
        model.server.usb_reverse.devices = mapped_devices;
        model.server.usb_reverse.last_success_epoch_ms = if success_count > 0 {
            Some(now)
        } else {
            model.server.usb_reverse.last_success_epoch_ms
        };
        model.server.usb_reverse.error = if eligible_count > 0 && success_count == 0 {
            Some("没有已授权 USB 设备完成映射。".to_string())
        } else {
            None
        };
        model.server.usb_reverse.message = Some(if devices.is_empty() {
            "未检测到 USB 设备。".to_string()
        } else if eligible_count == 0 {
            "检测到 USB 设备，但没有已授权设备。".to_string()
        } else {
            format!(
                "USB 映射已完成：{}/{} 台已授权设备。",
                success_count, eligible_count
            )
        });
    });
    emit_state(app, shared);
}

fn device_state_message(state: &str) -> Option<String> {
    match state {
        "device" => None,
        "unauthorized" => Some("设备未授权。请在 Android 设备上确认 USB 调试授权。".to_string()),
        "offline" => Some("设备离线。请重新连接 USB 或重启 ADB。".to_string()),
        other => Some(format!("设备状态为 {}。", other)),
    }
}

fn list_adb_devices_inner(shared: &SharedAppState) -> AdbCommandResult {
    let adb = detect_adb(shared);
    if !adb.available {
        return AdbCommandResult {
            ok: false,
            stdout: String::new(),
            stderr: String::new(),
            error: Some(ADB_INSTALL_HINT.to_string()),
            devices: Some(Vec::new()),
            adb: Some(adb),
        };
    }

    let Some(path) = adb.path.clone() else {
        return AdbCommandResult {
            ok: false,
            stdout: String::new(),
            stderr: String::new(),
            error: Some(ADB_INSTALL_HINT.to_string()),
            devices: Some(Vec::new()),
            adb: Some(adb),
        };
    };

    match Command::new(path).args(["devices", "-l"]).output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let devices = parse_adb_devices(&stdout);
            AdbCommandResult {
                ok: output.status.success(),
                stdout,
                stderr: stderr.clone(),
                error: if output.status.success() {
                    None
                } else {
                    Some(stderr)
                },
                devices: Some(devices),
                adb: Some(adb),
            }
        }
        Err(error) => AdbCommandResult {
            ok: false,
            stdout: String::new(),
            stderr: String::new(),
            error: Some(error.to_string()),
            devices: Some(Vec::new()),
            adb: Some(adb),
        },
    }
}

fn reverse_debug_port_inner(
    shared: &SharedAppState,
    serial: Option<&str>,
    host_port: u16,
    device_port: u16,
) -> AdbCommandResult {
    let adb = detect_adb(shared);
    if !adb.available {
        return AdbCommandResult {
            ok: false,
            stdout: String::new(),
            stderr: String::new(),
            error: Some(ADB_INSTALL_HINT.to_string()),
            devices: None,
            adb: Some(adb),
        };
    }

    let Some(path) = adb.path.clone() else {
        return AdbCommandResult {
            ok: false,
            stdout: String::new(),
            stderr: String::new(),
            error: Some(ADB_INSTALL_HINT.to_string()),
            devices: None,
            adb: Some(adb),
        };
    };

    let device_target = format!("tcp:{}", device_port);
    let host_target = format!("tcp:{}", host_port);
    let mut command = Command::new(path);
    if let Some(serial) = serial {
        command.args(["-s", serial]);
    }
    command.args(["reverse", &device_target, &host_target]);

    let _guard = ADB_REVERSE_LOCK.lock().expect("adb reverse lock poisoned");
    match command.output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            AdbCommandResult {
                ok: output.status.success(),
                stdout,
                stderr: stderr.clone(),
                error: if output.status.success() {
                    None
                } else {
                    Some(stderr)
                },
                devices: None,
                adb: Some(adb),
            }
        }
        Err(error) => AdbCommandResult {
            ok: false,
            stdout: String::new(),
            stderr: String::new(),
            error: Some(error.to_string()),
            devices: None,
            adb: Some(adb),
        },
    }
}

fn remove_all_reverse_mappings(shared: &SharedAppState, device_port: u16) -> AdbCommandResult {
    let device_result = list_adb_devices_inner(shared);
    if !device_result.ok {
        return AdbCommandResult {
            ok: false,
            stdout: device_result.stdout,
            stderr: device_result.stderr.clone(),
            error: device_result.error,
            devices: device_result.devices,
            adb: device_result.adb,
        };
    }

    let adb = device_result.adb.clone();
    let devices = device_result.devices.clone().unwrap_or_default();
    let authorized = devices
        .iter()
        .filter(|device| device.state == "device")
        .collect::<Vec<_>>();

    if authorized.is_empty() {
        return AdbCommandResult {
            ok: true,
            stdout: "未检测到已授权 USB 设备，跳过 reverse 清理。".to_string(),
            stderr: String::new(),
            error: None,
            devices: Some(devices),
            adb,
        };
    }

    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut failures = Vec::new();
    for device in authorized {
        let result = remove_reverse_port_inner(shared, Some(&device.serial), device_port);
        if !result.stdout.trim().is_empty() {
            stdout.push_str(&format!("{}: {}\n", device.serial, result.stdout.trim()));
        }
        if !result.stderr.trim().is_empty() {
            stderr.push_str(&format!("{}: {}\n", device.serial, result.stderr.trim()));
        }
        if !result.ok {
            failures.push(device.serial.clone());
        }
    }

    AdbCommandResult {
        ok: failures.is_empty(),
        stdout,
        stderr: stderr.clone(),
        error: if failures.is_empty() {
            None
        } else {
            Some(format!(
                "{} 台设备 reverse 清理失败：{}",
                failures.len(),
                failures.join(", ")
            ))
        },
        devices: Some(devices),
        adb,
    }
}

fn remove_reverse_port_inner(
    shared: &SharedAppState,
    serial: Option<&str>,
    device_port: u16,
) -> AdbCommandResult {
    let adb = detect_adb(shared);
    if !adb.available {
        return AdbCommandResult {
            ok: false,
            stdout: String::new(),
            stderr: String::new(),
            error: Some(ADB_INSTALL_HINT.to_string()),
            devices: None,
            adb: Some(adb),
        };
    }

    let Some(path) = adb.path.clone() else {
        return AdbCommandResult {
            ok: false,
            stdout: String::new(),
            stderr: String::new(),
            error: Some(ADB_INSTALL_HINT.to_string()),
            devices: None,
            adb: Some(adb),
        };
    };

    let device_target = format!("tcp:{}", device_port);
    let mut command = Command::new(path);
    if let Some(serial) = serial {
        command.args(["-s", serial]);
    }
    command.args(["reverse", "--remove", &device_target]);

    let _guard = ADB_REVERSE_LOCK.lock().expect("adb reverse lock poisoned");
    match command.output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            AdbCommandResult {
                ok: output.status.success() || reverse_remove_error_is_harmless(&stderr),
                stdout,
                stderr: stderr.clone(),
                error: if output.status.success() || reverse_remove_error_is_harmless(&stderr) {
                    None
                } else {
                    Some(stderr)
                },
                devices: None,
                adb: Some(adb),
            }
        }
        Err(error) => AdbCommandResult {
            ok: false,
            stdout: String::new(),
            stderr: String::new(),
            error: Some(error.to_string()),
            devices: None,
            adb: Some(adb),
        },
    }
}

fn reverse_remove_error_is_harmless(stderr: &str) -> bool {
    let normalized = stderr.to_lowercase();
    normalized.contains("not found")
        || normalized.contains("no such")
        || normalized.contains("cannot remove listener")
}

fn detect_adb(shared: &SharedAppState) -> AdbInfo {
    let candidates = adb_candidates(shared);
    let checked_paths = candidates
        .iter()
        .map(|candidate| candidate.path.clone())
        .collect::<Vec<_>>();

    for candidate in candidates {
        if let Some(version) = adb_version(&candidate.path) {
            return AdbInfo {
                available: true,
                path: Some(candidate.path),
                source: Some(candidate.source),
                version: Some(version),
                checked_paths,
                install_hint: ADB_INSTALL_HINT.to_string(),
            };
        }
    }

    AdbInfo {
        available: false,
        path: None,
        source: None,
        version: None,
        checked_paths,
        install_hint: ADB_INSTALL_HINT.to_string(),
    }
}

fn adb_candidates(shared: &SharedAppState) -> Vec<AdbCandidate> {
    let resource_dir = {
        let model = shared.0.lock().expect("state lock poisoned");
        model.resource_dir.clone()
    };
    let mut candidates = Vec::new();

    if let Ok(path) = env::var("ADB_PATH") {
        if !path.trim().is_empty() {
            candidates.push(AdbCandidate {
                path,
                source: "ADB_PATH".to_string(),
            });
        }
    }

    if let Some(resource_dir) = resource_dir {
        candidates.push(AdbCandidate {
            path: resource_dir
                .join("platform-tools")
                .join(platform_tools_dir())
                .join(adb_binary_name())
                .to_string_lossy()
                .to_string(),
            source: "bundled".to_string(),
        });
    }

    for var_name in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        if let Ok(root) = env::var(var_name) {
            candidates.push(AdbCandidate {
                path: Path::new(&root)
                    .join("platform-tools")
                    .join(adb_binary_name())
                    .to_string_lossy()
                    .to_string(),
                source: var_name.to_string(),
            });
        }
    }

    if let Ok(home) = env::var("HOME") {
        candidates.push(AdbCandidate {
            path: Path::new(&home)
                .join("Library")
                .join("Android")
                .join("sdk")
                .join("platform-tools")
                .join(adb_binary_name())
                .to_string_lossy()
                .to_string(),
            source: "default sdk".to_string(),
        });
    }

    candidates.push(AdbCandidate {
        path: adb_binary_name().to_string(),
        source: "PATH".to_string(),
    });

    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|candidate| seen.insert(candidate.path.clone()))
        .collect()
}

fn adb_version(path: &str) -> Option<String> {
    let output = Command::new(path).arg("version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
}

fn parse_adb_devices(stdout: &str) -> Vec<AdbDevice> {
    stdout
        .lines()
        .skip(1)
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return None;
            }
            let mut parts = trimmed.split_whitespace();
            let serial = parts.next()?.to_string();
            let state = parts.next().unwrap_or_default().to_string();
            let description = parts.collect::<Vec<_>>().join(" ");
            Some(AdbDevice {
                serial,
                state,
                description,
            })
        })
        .collect()
}

fn export_file_path() -> PathBuf {
    let filename = format!("okhttp-debug-captures-{}.json", now_ms());
    if let Ok(home) = env::var("HOME") {
        let desktop = Path::new(&home).join("Desktop");
        if desktop.is_dir() {
            return desktop.join(filename);
        }
    }
    env::temp_dir().join(filename)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_capture_log_dates() {
        assert_eq!(
            capture_log_date("captures-2026-07-23.ndjson"),
            NaiveDate::from_ymd_opt(2026, 7, 23)
        );
        assert_eq!(
            dated_log_file_date("crashes-2026-07-23.ndjson"),
            NaiveDate::from_ymd_opt(2026, 7, 23)
        );
        assert!(capture_log_date("capture-2026-07-23.ndjson").is_none());
        assert!(capture_log_date("captures-latest.ndjson").is_none());
        assert!(dated_log_file_date("crashes-latest.ndjson").is_none());
    }

    #[test]
    fn cleanup_old_logs_keeps_latest_seven_calendar_days() {
        let log_dir = env::temp_dir().join(format!("okhttp-debug-log-cleanup-test-{}", now_ms()));
        fs::create_dir_all(&log_dir).expect("create test log dir");

        let today = Local::now().date_naive();
        let stale_date = today - ChronoDuration::days(LOG_RETENTION_DAYS as i64);
        let kept_date = today - ChronoDuration::days(LOG_RETENTION_DAYS as i64 - 1);
        let stale_log = log_dir.join(format!("captures-{}.ndjson", stale_date.format("%Y-%m-%d")));
        let kept_log = log_dir.join(format!("captures-{}.ndjson", kept_date.format("%Y-%m-%d")));
        let stale_crash = log_dir.join(format!("crashes-{}.ndjson", stale_date.format("%Y-%m-%d")));
        let kept_crash = log_dir.join(format!("crashes-{}.ndjson", kept_date.format("%Y-%m-%d")));
        let unrelated_log = log_dir.join("desktop.log");

        fs::write(&stale_log, "old").expect("write stale log");
        fs::write(&kept_log, "kept").expect("write kept log");
        fs::write(&stale_crash, "old crash").expect("write stale crash log");
        fs::write(&kept_crash, "kept crash").expect("write kept crash log");
        fs::write(&unrelated_log, "other").expect("write unrelated log");

        cleanup_old_logs(&log_dir);

        assert!(!stale_log.exists());
        assert!(kept_log.exists());
        assert!(!stale_crash.exists());
        assert!(kept_crash.exists());
        assert!(unrelated_log.exists());

        let _ = fs::remove_dir_all(log_dir);
    }
}

fn platform_tools_dir() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "darwin-arm64"
    }
    #[cfg(all(target_os = "macos", not(target_arch = "aarch64")))]
    {
        "darwin-x64"
    }
    #[cfg(target_os = "windows")]
    {
        "win32"
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        "linux-arm64"
    }
    #[cfg(all(target_os = "linux", not(target_arch = "aarch64")))]
    {
        "linux-x64"
    }
}

fn adb_binary_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "adb.exe"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "adb"
    }
}
