# Troubleshooting

## What Users Should Send

When reporting a desktop app problem, ask users for:

1. A screenshot or short description of what failed.
2. The copied diagnostics payload from the drawer: `日志与反馈 -> 复制诊断信息`.
3. The latest files from the log directory opened by: `日志与反馈 -> 打开日志目录`.

The diagnostics payload includes the app version, OS, CPU architecture, listener
state, USB reverse state, ADB detection result, log directory, current capture
log path, and recent log files.

## Runtime Logs

The app writes logs under the platform app log directory. The drawer shows the
current path.

Log files:

```text
captures-YYYY-MM-DD.ndjson
crashes-YYYY-MM-DD.ndjson
```

`captures-*.ndjson` contains connections, handshake messages, captured HTTP
records, ADB/port related events, and renderer errors.

`crashes-*.ndjson` contains Rust panic information when the desktop process can
record it before exiting.

Logs older than 7 calendar days are cleaned on startup. Users can also clear
logs manually from `日志与反馈 -> 清理日志`.

## Install Failures

If installation fails before the app starts, in-app logs do not exist yet. Ask
users to send:

```text
OS version
CPU architecture
package filename
installer screenshot or error text
whether the package was downloaded from GitHub Release or Actions artifact
```

For Windows, also ask whether SmartScreen, antivirus software, or corporate
device management blocked the unsigned installer.
