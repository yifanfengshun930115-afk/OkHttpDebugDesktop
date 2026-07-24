use crate::{cleanup_adb_reverse_inner, SharedAppState, DEFAULT_WS_PORT};
use serde::Serialize;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::{
    collections::HashSet,
    env, fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

const RELEASE_REPO_URL: &str = "https://github.com/yifanfengshun930115-afk/OkHttpDebugDesktop";
const RELEASE_LATEST_URL: &str =
    "https://github.com/yifanfengshun930115-afk/OkHttpDebugDesktop/releases/latest";
const RELEASE_DOWNLOAD_PATH_PREFIX: &str =
    "/yifanfengshun930115-afk/OkHttpDebugDesktop/releases/download/";
const UPDATE_INSTALL_PROGRESS_EVENT: &str = "update://install-progress";
const UPDATE_PROGRESS_INTERVAL_MS: u64 = 120;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseAssetInfo {
    name: String,
    browser_download_url: String,
    size_bytes: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    ok: bool,
    current_version: String,
    latest_version: Option<String>,
    has_update: bool,
    release_url: String,
    asset_name: Option<String>,
    asset_download_url: Option<String>,
    asset_size_bytes: Option<u64>,
    checked_at_epoch_ms: u64,
    message: String,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalOpenResult {
    ok: bool,
    message: String,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstallResult {
    ok: bool,
    message: String,
    file_path: Option<String>,
    error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstallProgress {
    stage: String,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    percent: Option<f64>,
    message: String,
    file_path: Option<String>,
}

struct DownloadedUpdateAsset {
    file_path: PathBuf,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
}

struct PartialDownloadGuard {
    path: PathBuf,
    active: bool,
}

impl PartialDownloadGuard {
    fn new(path: PathBuf) -> Self {
        Self { path, active: true }
    }

    fn disarm(&mut self) {
        self.active = false;
    }
}

impl Drop for PartialDownloadGuard {
    fn drop(&mut self) {
        if self.active {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[tauri::command]
pub async fn check_for_updates() -> UpdateCheckResult {
    match tauri::async_runtime::spawn_blocking(build_update_check_result).await {
        Ok(result) => result,
        Err(error) => update_check_error(format!("更新检查任务异常：{error}")),
    }
}

fn build_update_check_result() -> UpdateCheckResult {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let checked_at_epoch_ms = now_ms();

    match fetch_latest_release_info() {
        Ok((latest_version, release_url, assets)) => {
            let asset = select_release_asset(&assets, std::env::consts::OS, std::env::consts::ARCH);
            let version_order = compare_versions(&latest_version, &current_version);
            let has_update = version_order > 0;
            let message = if has_update {
                if let Some(asset) = &asset {
                    format!("可更新到适配当前系统的安装包：{}。", asset.name)
                } else {
                    "发现新版本，但没有找到适配当前系统的安装包。".to_string()
                }
            } else if version_order < 0 {
                format!(
                    "当前版本 v{} 高于最新 Release {}。",
                    current_version, latest_version
                )
            } else {
                format!("当前版本 v{} 已是最新。", current_version)
            };

            UpdateCheckResult {
                ok: true,
                current_version,
                latest_version: Some(latest_version),
                has_update,
                release_url,
                asset_name: asset.as_ref().map(|asset| asset.name.clone()),
                asset_download_url: asset
                    .as_ref()
                    .map(|asset| asset.browser_download_url.clone()),
                asset_size_bytes: asset.as_ref().and_then(|asset| asset.size_bytes),
                checked_at_epoch_ms,
                message,
                error: None,
            }
        }
        Err(error) => update_check_error_with_version(current_version, checked_at_epoch_ms, error),
    }
}

fn update_check_error(error: String) -> UpdateCheckResult {
    update_check_error_with_version(env!("CARGO_PKG_VERSION").to_string(), now_ms(), error)
}

fn update_check_error_with_version(
    current_version: String,
    checked_at_epoch_ms: u64,
    error: String,
) -> UpdateCheckResult {
    UpdateCheckResult {
        ok: false,
        current_version,
        latest_version: None,
        has_update: false,
        release_url: RELEASE_LATEST_URL.to_string(),
        asset_name: None,
        asset_download_url: None,
        asset_size_bytes: None,
        checked_at_epoch_ms,
        message: "更新检查失败。".to_string(),
        error: Some(error),
    }
}

#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    download_url: String,
    asset_name: Option<String>,
) -> UpdateInstallResult {
    let trimmed_url = download_url.trim().to_string();
    if !is_allowed_release_download_url(&trimmed_url) {
        return update_install_error("只允许下载当前项目 GitHub Release 的安装包。".to_string());
    }

    let app_for_download = app.clone();
    let download_result = tauri::async_runtime::spawn_blocking(move || {
        download_update_asset(&app_for_download, &trimmed_url, asset_name)
    })
    .await;

    let update_asset = match download_result {
        Ok(Ok(asset)) => asset,
        Ok(Err(error)) => return update_install_error(error),
        Err(error) => return update_install_error(format!("更新下载任务异常：{error}")),
    };
    let file_path = update_asset.file_path;

    emit_update_progress(
        &app,
        "installing",
        update_asset.downloaded_bytes,
        update_asset.total_bytes,
        Some(100.0),
        "安装程序已准备好，应用即将退出并开始安装。",
        Some(&file_path),
    );

    if let Err(error) = launch_update_installer(&file_path) {
        return update_install_error(error);
    }

    let state = app.state::<SharedAppState>();
    let _ = cleanup_adb_reverse_inner(&app, &state, DEFAULT_WS_PORT);
    let app_for_exit = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(700));
        app_for_exit.exit(0);
    });

    UpdateInstallResult {
        ok: true,
        message: "安装程序已启动。".to_string(),
        file_path: Some(file_path.to_string_lossy().to_string()),
        error: None,
    }
}

fn update_install_error(error: String) -> UpdateInstallResult {
    UpdateInstallResult {
        ok: false,
        message: "更新失败。".to_string(),
        file_path: None,
        error: Some(error),
    }
}

#[tauri::command]
pub fn open_external_url(url: String) -> ExternalOpenResult {
    let trimmed = url.trim();
    if !is_allowed_release_url(trimmed) {
        return ExternalOpenResult {
            ok: false,
            message: "外部链接不在允许范围内。".to_string(),
            error: Some("只允许打开当前项目的 GitHub Release 链接。".to_string()),
        };
    }

    match open_url(trimmed) {
        Ok(()) => ExternalOpenResult {
            ok: true,
            message: "已在浏览器中打开链接。".to_string(),
            error: None,
        },
        Err(error) => ExternalOpenResult {
            ok: false,
            message: format!("打开链接失败：{error}"),
            error: Some(error),
        },
    }
}

fn hidden_command(path: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new(path);
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new(path)
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn fetch_latest_release_info() -> Result<(String, String, Vec<ReleaseAssetInfo>), String> {
    let (final_url, latest_html) = fetch_text(RELEASE_LATEST_URL)?;
    let latest_version = extract_release_tag_from_url(&final_url)
        .or_else(|| extract_release_tag_from_html(&latest_html))
        .ok_or_else(|| "未能从 GitHub Release 页面解析最新版本。".to_string())?;
    let release_url = format!("{}/releases/tag/{}", RELEASE_REPO_URL, latest_version);
    let assets_url = format!(
        "{}/releases/expanded_assets/{}",
        RELEASE_REPO_URL, latest_version
    );
    let (_, assets_html) = fetch_text(&assets_url)?;
    let assets = parse_release_assets(&assets_html);
    Ok((latest_version, release_url, assets))
}

fn fetch_text(url: &str) -> Result<(String, String), String> {
    const FINAL_URL_MARKER: &str = "\n__OKHTTP_DEBUG_FINAL_URL__:";
    let write_out = format!("{FINAL_URL_MARKER}%{{url_effective}}");
    let output = hidden_command("curl")
        .args([
            "-fsSL",
            "--http1.1",
            "--connect-timeout",
            "8",
            "--max-time",
            "15",
            "--retry",
            "1",
            "--retry-delay",
            "1",
            "-A",
            concat!("OkHttpDebugDesktop/", env!("CARGO_PKG_VERSION")),
            "-H",
            "Accept: text/html,application/xhtml+xml",
        ])
        .arg("-w")
        .arg(write_out)
        .arg(url)
        .output()
        .map_err(|error| format!("无法执行 curl：{error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!(
                "GitHub 页面请求失败，curl 退出码 {:?}。",
                output.status.code()
            )
        } else {
            format!("GitHub 页面请求失败：{stderr}")
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if let Some(marker_index) = stdout.rfind(FINAL_URL_MARKER) {
        let text = stdout[..marker_index].to_string();
        let final_url = stdout[marker_index + FINAL_URL_MARKER.len()..]
            .trim()
            .to_string();
        Ok((final_url, text))
    } else {
        Ok((url.to_string(), stdout))
    }
}

fn download_update_asset(
    app: &AppHandle,
    download_url: &str,
    asset_name: Option<String>,
) -> Result<DownloadedUpdateAsset, String> {
    let file_name = update_download_file_name(download_url, asset_name.as_deref())?;
    let update_dir = env::temp_dir().join("okhttp-debug-desktop-updates");
    cleanup_update_download_dir(&update_dir);
    fs::create_dir_all(&update_dir).map_err(|error| format!("创建更新目录失败：{error}"))?;
    let destination = update_dir.join(file_name);
    let partial_destination = destination.with_extension("download");
    let _ = fs::remove_file(&partial_destination);
    let mut partial_guard = PartialDownloadGuard::new(partial_destination.clone());

    emit_update_progress(
        app,
        "downloading",
        0,
        None,
        Some(0.0),
        "正在连接 GitHub Release。",
        Some(&destination),
    );

    let client = reqwest::blocking::Client::builder()
        .user_agent(concat!("OkHttpDebugDesktop/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::limited(10))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(900))
        .build()
        .map_err(|error| format!("创建下载客户端失败：{error}"))?;

    let mut response = client
        .get(download_url)
        .header(reqwest::header::ACCEPT, "application/octet-stream")
        .send()
        .map_err(|error| format!("下载安装包失败：{error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("下载安装包失败，HTTP 状态码 {status}。"));
    }

    let total_bytes = response.content_length();
    let mut file = fs::File::create(&partial_destination)
        .map_err(|error| format!("创建安装包文件失败：{error}"))?;
    let mut downloaded_bytes = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    let mut last_progress = Instant::now();

    loop {
        let read = response
            .read(&mut buffer)
            .map_err(|error| format!("读取下载数据失败：{error}"))?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read])
            .map_err(|error| format!("写入安装包失败：{error}"))?;
        downloaded_bytes += read as u64;

        if last_progress.elapsed() >= Duration::from_millis(UPDATE_PROGRESS_INTERVAL_MS) {
            emit_download_progress(app, downloaded_bytes, total_bytes, Some(&destination));
            last_progress = Instant::now();
        }
    }

    file.flush()
        .map_err(|error| format!("写入安装包失败：{error}"))?;
    fs::rename(&partial_destination, &destination)
        .map_err(|error| format!("保存安装包失败：{error}"))?;
    partial_guard.disarm();

    emit_update_progress(
        app,
        "downloaded",
        downloaded_bytes,
        total_bytes.or(Some(downloaded_bytes)),
        Some(100.0),
        "安装包下载完成。",
        Some(&destination),
    );

    Ok(DownloadedUpdateAsset {
        file_path: destination,
        downloaded_bytes,
        total_bytes: total_bytes.or(Some(downloaded_bytes)),
    })
}

fn cleanup_update_download_dir(update_dir: &Path) {
    let Ok(entries) = fs::read_dir(update_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            let _ = fs::remove_file(path);
        }
    }
    let _ = fs::remove_dir(update_dir);
}

fn emit_download_progress(
    app: &AppHandle,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    file_path: Option<&Path>,
) {
    let percent = total_bytes
        .filter(|total| *total > 0)
        .map(|total| (downloaded_bytes as f64 / total as f64 * 100.0).min(99.0));
    emit_update_progress(
        app,
        "downloading",
        downloaded_bytes,
        total_bytes,
        percent,
        "正在下载安装包。",
        file_path,
    );
}

fn emit_update_progress(
    app: &AppHandle,
    stage: &str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    percent: Option<f64>,
    message: &str,
    file_path: Option<&Path>,
) {
    let _ = app.emit(
        UPDATE_INSTALL_PROGRESS_EVENT,
        UpdateInstallProgress {
            stage: stage.to_string(),
            downloaded_bytes,
            total_bytes,
            percent,
            message: message.to_string(),
            file_path: file_path.map(|path| path.to_string_lossy().to_string()),
        },
    );
}

fn update_download_file_name(
    download_url: &str,
    asset_name: Option<&str>,
) -> Result<String, String> {
    let candidate = asset_name
        .filter(|name| !name.trim().is_empty())
        .map(|name| name.trim().to_string())
        .or_else(|| {
            download_url
                .split(['?', '#'])
                .next()
                .and_then(|clean_url| clean_url.rsplit('/').next())
                .map(percent_decode)
        })
        .ok_or_else(|| "无法解析安装包文件名。".to_string())?;

    let sanitized = sanitize_file_name(&candidate);
    if sanitized.is_empty() {
        Err("安装包文件名无效。".to_string())
    } else {
        Ok(sanitized)
    }
}

fn sanitize_file_name(name: &str) -> String {
    name.chars()
        .filter(|character| {
            character.is_ascii_alphanumeric()
                || matches!(*character, '.' | '-' | '_' | ' ' | '(' | ')')
        })
        .collect::<String>()
        .trim_matches(['.', ' '])
        .to_string()
}

fn launch_update_installer(file_path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        launch_macos_update_installer(file_path)
    }

    #[cfg(target_os = "windows")]
    {
        launch_windows_update_installer(file_path)
    }

    #[cfg(target_os = "linux")]
    {
        launch_linux_update_installer(file_path)
    }
}

#[cfg(target_os = "macos")]
fn launch_macos_update_installer(file_path: &Path) -> Result<(), String> {
    let extension = file_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension != "dmg" {
        return open_path(file_path);
    }

    let app_path = current_app_bundle_path()
        .unwrap_or_else(|| PathBuf::from("/Applications/OkHttp Debug Desktop.app"));
    let script_path = file_path
        .parent()
        .unwrap_or_else(|| Path::new("/tmp"))
        .join(format!(
            "install-okhttp-debug-desktop-{}.sh",
            std::process::id()
        ));
    let script = macos_install_script(file_path, &app_path);
    fs::write(&script_path, script).map_err(|error| format!("创建安装脚本失败：{error}"))?;
    let mut command = Command::new("sh");
    command
        .arg(&script_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("启动安装脚本失败：{error}"))
}

#[cfg(target_os = "macos")]
fn current_app_bundle_path() -> Option<PathBuf> {
    let mut path = env::current_exe().ok()?;
    while path.pop() {
        if path.extension().and_then(|value| value.to_str()) == Some("app") {
            return Some(path);
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn macos_install_script(dmg_path: &Path, app_path: &Path) -> String {
    format!(
        r#"#!/bin/sh
set -eu
DMG_PATH={dmg_path}
APP_PATH={app_path}
SCRIPT_PATH="$0"
INSTALL_SUCCEEDED=0
MOUNT_DIR="$(mktemp -d "${{TMPDIR:-/tmp/}}okhttp-debug-desktop-update.XXXXXX")"
cleanup() {{
  hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true
  rmdir "$MOUNT_DIR" >/dev/null 2>&1 || true
  if [ "$INSTALL_SUCCEEDED" = "1" ]; then
    rm -f "$DMG_PATH" "$SCRIPT_PATH" >/dev/null 2>&1 || true
    rmdir "$(dirname "$DMG_PATH")" >/dev/null 2>&1 || true
  fi
}}
trap cleanup EXIT
hdiutil attach -nobrowse -quiet -readonly -mountpoint "$MOUNT_DIR" "$DMG_PATH"
SOURCE_APP="$(find "$MOUNT_DIR" -maxdepth 1 -name '*.app' -type d | head -n 1)"
if [ -z "$SOURCE_APP" ]; then
  exit 1
fi
while pgrep -x okhttp-debug-desktop-tauri >/dev/null 2>&1; do
  sleep 0.3
done
ditto "$SOURCE_APP" "$APP_PATH"
INSTALL_SUCCEEDED=1
open "$APP_PATH" >/dev/null 2>&1 || true
"#,
        dmg_path = shell_single_quote(&dmg_path.to_string_lossy()),
        app_path = shell_single_quote(&app_path.to_string_lossy()),
    )
}

#[cfg(target_os = "windows")]
fn launch_windows_update_installer(file_path: &Path) -> Result<(), String> {
    let script_path = env::temp_dir().join(format!(
        "install-okhttp-debug-desktop-{}.cmd",
        std::process::id()
    ));
    let script = windows_install_script(file_path);
    fs::write(&script_path, script).map_err(|error| format!("创建安装脚本失败：{error}"))?;
    let mut command = hidden_command("cmd");
    command
        .arg("/C")
        .arg("call")
        .arg(&script_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("启动 Windows 安装脚本失败：{error}"))
}

#[cfg(target_os = "windows")]
fn windows_install_script(file_path: &Path) -> String {
    let update_dir = file_path
        .parent()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    format!(
        r#"@echo off
setlocal
set "INSTALLER={installer}"
set "UPDATE_DIR={update_dir}"
:wait_app
tasklist /FI "IMAGENAME eq okhttp-debug-desktop-tauri.exe" 2>NUL | find /I "okhttp-debug-desktop-tauri.exe" >NUL
if not errorlevel 1 (
  timeout /T 1 /NOBREAK >NUL
  goto wait_app
)
start "" /WAIT "%INSTALLER%"
del /F /Q "%INSTALLER%" >NUL 2>NUL
rmdir "%UPDATE_DIR%" >NUL 2>NUL
del /F /Q "%~f0" >NUL 2>NUL
"#,
        installer = windows_batch_value(&file_path.to_string_lossy()),
        update_dir = windows_batch_value(&update_dir),
    )
}

#[cfg(target_os = "windows")]
fn windows_batch_value(value: &str) -> String {
    value.replace('%', "%%")
}

#[cfg(target_os = "linux")]
fn launch_linux_update_installer(file_path: &Path) -> Result<(), String> {
    let extension = file_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension == "deb" {
        return launch_linux_package_with_cleanup(file_path);
    }
    if extension == "appimage" {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(file_path)
                .map_err(|error| format!("读取 AppImage 权限失败：{error}"))?
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(file_path, permissions)
                .map_err(|error| format!("设置 AppImage 可执行权限失败：{error}"))?;
        }
    }
    open_path(file_path)
}

#[cfg(target_os = "linux")]
fn launch_linux_package_with_cleanup(file_path: &Path) -> Result<(), String> {
    let script_path = env::temp_dir().join(format!(
        "install-okhttp-debug-desktop-{}.sh",
        std::process::id()
    ));
    let script = linux_cleanup_script(file_path, 30 * 60);
    fs::write(&script_path, script).map_err(|error| format!("创建安装脚本失败：{error}"))?;
    let mut command = Command::new("sh");
    command
        .arg(&script_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("启动安装脚本失败：{error}"))
}

#[cfg(target_os = "linux")]
fn linux_cleanup_script(file_path: &Path, cleanup_delay_seconds: u64) -> String {
    format!(
        r#"#!/bin/sh
set -u
PACKAGE_PATH={package_path}
SCRIPT_PATH="$0"
xdg-open "$PACKAGE_PATH" >/dev/null 2>&1 || true
sleep {cleanup_delay_seconds}
rm -f "$PACKAGE_PATH" >/dev/null 2>&1 || true
rmdir "$(dirname "$PACKAGE_PATH")" >/dev/null 2>&1 || true
rm -f "$SCRIPT_PATH" >/dev/null 2>&1 || true
"#,
        package_path = shell_single_quote(&file_path.to_string_lossy()),
        cleanup_delay_seconds = cleanup_delay_seconds,
    )
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

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn extract_release_tag_from_url(url: &str) -> Option<String> {
    let marker = "/releases/tag/";
    let start = url.find(marker)? + marker.len();
    let tail = &url[start..];
    let end = tail
        .find(|character| matches!(character, '?' | '#' | '/'))
        .unwrap_or(tail.len());
    let tag = &tail[..end];
    if tag.is_empty() {
        None
    } else {
        Some(percent_decode(tag))
    }
}

fn extract_release_tag_from_html(html: &str) -> Option<String> {
    let marker = "/releases/tag/";
    let start = html.find(marker)? + marker.len();
    let tail = &html[start..];
    let end = tail
        .find(|character| matches!(character, '"' | '\'' | '<' | '?' | '#' | '/'))
        .unwrap_or(tail.len());
    let tag = &tail[..end];
    if tag.is_empty() {
        None
    } else {
        Some(percent_decode(tag))
    }
}

fn parse_release_assets(fragment: &str) -> Vec<ReleaseAssetInfo> {
    let mut assets = Vec::new();
    let mut seen = HashSet::new();
    let mut cursor = 0usize;

    while let Some(relative_index) = fragment[cursor..].find(RELEASE_DOWNLOAD_PATH_PREFIX) {
        let href_start = cursor + relative_index;
        let Some(relative_end) = fragment[href_start..].find('"') else {
            break;
        };
        let href_end = href_start + relative_end;
        let href = html_unescape(&fragment[href_start..href_end]);
        cursor = href_end;

        if !seen.insert(href.clone()) {
            continue;
        }

        let Some(encoded_name) = href.rsplit('/').next() else {
            continue;
        };
        let name = percent_decode(encoded_name);
        if name.is_empty() || name.eq_ignore_ascii_case("source code") {
            continue;
        }

        let browser_download_url = if href.starts_with("https://") {
            href
        } else {
            format!("https://github.com{href}")
        };
        let size_window_end = (href_end + 3200).min(fragment.len());
        let size_bytes = parse_asset_size_bytes(&fragment[href_end..size_window_end]);
        assets.push(ReleaseAssetInfo {
            name,
            browser_download_url,
            size_bytes,
        });
    }

    assets
}

fn parse_asset_size_bytes(text: &str) -> Option<u64> {
    for (unit, multiplier) in [
        (" GB", 1024_f64 * 1024_f64 * 1024_f64),
        (" MB", 1024_f64 * 1024_f64),
        (" KB", 1024_f64),
        (" B", 1_f64),
    ] {
        if let Some(unit_index) = text.find(unit) {
            let before = &text[..unit_index];
            let number = before
                .chars()
                .rev()
                .take_while(|character| character.is_ascii_digit() || *character == '.')
                .collect::<String>()
                .chars()
                .rev()
                .collect::<String>();
            if let Ok(value) = number.parse::<f64>() {
                return Some((value * multiplier).round() as u64);
            }
        }
    }
    None
}

fn select_release_asset(
    assets: &[ReleaseAssetInfo],
    os: &str,
    arch: &str,
) -> Option<ReleaseAssetInfo> {
    let normalized_os = os.to_ascii_lowercase();
    let normalized_arch = arch.to_ascii_lowercase();
    let arch_tokens: &[&str] =
        if normalized_arch.contains("aarch64") || normalized_arch.contains("arm64") {
            &["aarch64", "arm64"]
        } else {
            &["x64", "x86_64", "amd64"]
        };

    match normalized_os.as_str() {
        "macos" | "darwin" => find_asset_by_extension_and_arch(assets, ".dmg", arch_tokens),
        "windows" | "win32" => assets
            .iter()
            .find(|asset| {
                let name = asset.name.to_ascii_lowercase();
                name.ends_with(".exe") && name.contains("setup")
            })
            .or_else(|| {
                assets
                    .iter()
                    .find(|asset| asset.name.to_ascii_lowercase().ends_with(".exe"))
            })
            .cloned(),
        "linux" => assets
            .iter()
            .find(|asset| asset.name.to_ascii_lowercase().ends_with(".appimage"))
            .or_else(|| {
                assets
                    .iter()
                    .find(|asset| asset.name.to_ascii_lowercase().ends_with(".deb"))
            })
            .cloned(),
        _ => None,
    }
}

fn find_asset_by_extension_and_arch(
    assets: &[ReleaseAssetInfo],
    extension: &str,
    arch_tokens: &[&str],
) -> Option<ReleaseAssetInfo> {
    let candidates = assets
        .iter()
        .filter(|asset| asset.name.to_ascii_lowercase().ends_with(extension))
        .collect::<Vec<_>>();
    candidates
        .iter()
        .find(|asset| {
            let name = asset.name.to_ascii_lowercase();
            arch_tokens.iter().any(|token| name.contains(token))
        })
        .or_else(|| candidates.first())
        .map(|asset| (*asset).clone())
}

fn compare_versions(left: &str, right: &str) -> i8 {
    let left_parts = version_parts(left);
    let right_parts = version_parts(right);
    let length = left_parts.len().max(right_parts.len());
    for index in 0..length {
        let left = left_parts.get(index).copied().unwrap_or(0);
        let right = right_parts.get(index).copied().unwrap_or(0);
        if left > right {
            return 1;
        }
        if left < right {
            return -1;
        }
    }
    0
}

fn version_parts(version: &str) -> Vec<u64> {
    let normalized = version.trim().trim_start_matches(['v', 'V']);
    let numeric = normalized
        .chars()
        .take_while(|character| character.is_ascii_digit() || *character == '.')
        .collect::<String>();
    numeric
        .split('.')
        .filter_map(|part| part.parse::<u64>().ok())
        .collect()
}

fn is_allowed_release_url(url: &str) -> bool {
    url == RELEASE_REPO_URL || url.starts_with(&format!("{}/releases/", RELEASE_REPO_URL))
}

fn is_allowed_release_download_url(url: &str) -> bool {
    url.starts_with(&format!("{}/releases/download/", RELEASE_REPO_URL))
}

fn open_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg(url);
        command
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn html_unescape(text: &str) -> String {
    text.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[index + 1..index + 3]) {
                if let Ok(value) = u8::from_str_radix(hex, 16) {
                    output.push(value);
                    index += 3;
                    continue;
                }
            }
        }
        output.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&output).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_release_tag_from_redirect_url() {
        assert_eq!(
            extract_release_tag_from_url(
                "https://github.com/yifanfengshun930115-afk/OkHttpDebugDesktop/releases/tag/v0.1.2"
            )
            .as_deref(),
            Some("v0.1.2")
        );
    }

    #[test]
    fn parses_release_assets_from_expanded_fragment() {
        let html = r#"
          <a href="/yifanfengshun930115-afk/OkHttpDebugDesktop/releases/download/v0.1.2/OkHttp.Debug.Desktop_0.1.2_aarch64.dmg">mac</a>
          <span>21.7 MB</span>
          <a href="/yifanfengshun930115-afk/OkHttpDebugDesktop/releases/download/v0.1.2/OkHttp.Debug.Desktop_0.1.2_x64-setup.exe">win</a>
          <span>10.8 MB</span>
        "#;

        let assets = parse_release_assets(html);

        assert_eq!(assets.len(), 2);
        assert_eq!(assets[0].name, "OkHttp.Debug.Desktop_0.1.2_aarch64.dmg");
        assert!(assets[0]
            .browser_download_url
            .starts_with("https://github.com/"));
        assert_eq!(assets[0].size_bytes, Some(22_754_099));
    }

    #[test]
    fn selects_asset_for_current_platform_family() {
        let assets = vec![
            ReleaseAssetInfo {
                name: "OkHttp.Debug.Desktop_0.1.2_x64.dmg".to_string(),
                browser_download_url: "https://github.com/example/x64.dmg".to_string(),
                size_bytes: None,
            },
            ReleaseAssetInfo {
                name: "OkHttp.Debug.Desktop_0.1.2_aarch64.dmg".to_string(),
                browser_download_url: "https://github.com/example/aarch64.dmg".to_string(),
                size_bytes: None,
            },
            ReleaseAssetInfo {
                name: "OkHttp.Debug.Desktop_0.1.2_x64-setup.exe".to_string(),
                browser_download_url: "https://github.com/example/setup.exe".to_string(),
                size_bytes: None,
            },
        ];

        assert_eq!(
            select_release_asset(&assets, "macos", "aarch64")
                .map(|asset| asset.name)
                .as_deref(),
            Some("OkHttp.Debug.Desktop_0.1.2_aarch64.dmg")
        );
        assert_eq!(
            select_release_asset(&assets, "windows", "x86_64")
                .map(|asset| asset.name)
                .as_deref(),
            Some("OkHttp.Debug.Desktop_0.1.2_x64-setup.exe")
        );
    }

    #[test]
    fn release_url_allowlist_is_scoped_to_project_releases() {
        assert!(is_allowed_release_url(
            "https://github.com/yifanfengshun930115-afk/OkHttpDebugDesktop/releases/latest"
        ));
        assert!(is_allowed_release_url(
            "https://github.com/yifanfengshun930115-afk/OkHttpDebugDesktop/releases/download/v0.1.2/app.dmg"
        ));
        assert!(!is_allowed_release_url(
            "https://github.com/other/repo/releases/latest"
        ));
        assert!(!is_allowed_release_url("https://example.com/app.dmg"));
    }

    #[test]
    fn release_download_allowlist_requires_project_asset_url() {
        assert!(is_allowed_release_download_url(
            "https://github.com/yifanfengshun930115-afk/OkHttpDebugDesktop/releases/download/v0.1.2/app.dmg"
        ));
        assert!(!is_allowed_release_download_url(
            "https://github.com/yifanfengshun930115-afk/OkHttpDebugDesktop/releases/latest"
        ));
        assert!(!is_allowed_release_download_url(
            "https://github.com/other/repo/releases/download/v0.1.2/app.dmg"
        ));
    }

    #[test]
    fn update_download_file_name_prefers_safe_asset_name() {
        assert_eq!(
            update_download_file_name(
                "https://github.com/yifanfengshun930115-afk/OkHttpDebugDesktop/releases/download/v0.1.2/fallback.dmg",
                Some("../OkHttp Debug Desktop_0.1.2_aarch64.dmg")
            )
            .as_deref(),
            Ok("OkHttp Debug Desktop_0.1.2_aarch64.dmg")
        );
        assert_eq!(
            update_download_file_name(
                "https://github.com/yifanfengshun930115-afk/OkHttpDebugDesktop/releases/download/v0.1.2/OkHttp%20Debug%20Desktop_0.1.2_aarch64.dmg",
                None
            )
            .as_deref(),
            Ok("OkHttp Debug Desktop_0.1.2_aarch64.dmg")
        );
    }

    #[test]
    fn cleanup_update_download_dir_removes_stale_files() {
        let dir = env::temp_dir().join(format!(
            "okhttp-debug-desktop-cleanup-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("test dir should be created");
        let old_package = dir.join("old.dmg");
        let old_script = dir.join("install.cmd");
        fs::write(&old_package, "package").expect("old package should be written");
        fs::write(&old_script, "script").expect("old script should be written");

        cleanup_update_download_dir(&dir);

        assert!(!old_package.exists());
        assert!(!old_script.exists());
        assert!(!dir.exists());
    }

    #[test]
    fn partial_download_guard_removes_failed_partial_file() {
        let dir = env::temp_dir().join(format!(
            "okhttp-debug-desktop-partial-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("test dir should be created");
        let partial = dir.join("package.download");
        fs::write(&partial, "partial").expect("partial package should be written");

        {
            let _guard = PartialDownloadGuard::new(partial.clone());
        }

        assert!(!partial.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_install_script_removes_update_artifacts_after_success() {
        let script = macos_install_script(
            Path::new("/tmp/okhttp-debug-desktop-updates/app.dmg"),
            Path::new("/Applications/OkHttp Debug Desktop.app"),
        );

        assert!(script.contains("INSTALL_SUCCEEDED=1"));
        assert!(script.contains("rm -f \"$DMG_PATH\" \"$SCRIPT_PATH\""));
        assert!(script.contains("rmdir \"$(dirname \"$DMG_PATH\")\""));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_cleanup_script_removes_package_after_delay() {
        let script =
            linux_cleanup_script(Path::new("/tmp/okhttp-debug-desktop-updates/app.deb"), 1);

        assert!(script.contains("sleep 1"));
        assert!(script.contains("rm -f \"$PACKAGE_PATH\""));
        assert!(script.contains("rmdir \"$(dirname \"$PACKAGE_PATH\")\""));
        assert!(script.contains("rm -f \"$SCRIPT_PATH\""));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_install_script_removes_installer_after_wait() {
        let script = windows_install_script(Path::new(
            "C:\\Temp\\okhttp-debug-desktop-updates\\app-setup.exe",
        ));

        assert!(script.contains("start \"\" /WAIT \"%INSTALLER%\""));
        assert!(script.contains("del /F /Q \"%INSTALLER%\""));
        assert!(script.contains("rmdir \"%UPDATE_DIR%\""));
        assert!(script.contains("del /F /Q \"%~f0\""));
    }
}
