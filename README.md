# OkHttp Debug Desktop

## 中文

OkHttp Debug Desktop 是一个跨平台桌面端调试控制台，用来接收 Android 应用通过 OkHttpDebugKit 插件发送过来的 OkHttp 请求和响应数据。

这个项目不能单独完成抓包。它必须和 Android 端的 [OkHttpDebugKit](https://github.com/yifanfengshun930115-afk/OkHttpDebugKit) 一起使用：桌面端负责监听、展示、过滤、导出和诊断，Android 插件负责接入目标应用的 OkHttpClient 并把捕获数据发到桌面端。

### 功能

- 通过本地 WebSocket 接收 Android OkHttp 捕获数据。
- 支持普通明文捕获，也支持加密接口调试所需的 `plain` / `wire` 双阶段视图。
- USB 调试模式下自动维护 `adb reverse` 映射。
- 支持局域网连接，Android 应用可以连接桌面端 IP + WebSocket 地址。
- 支持按状态、方法、设备、应用和阶段筛选请求。
- 支持 JSON 美化、折叠查看、原文查看和请求/响应对比。
- 支持 macOS、Windows、Linux 打包。
- release 包默认不再记录完整接口捕获文件，避免 `captures-*.ndjson` 随请求量持续膨胀；开发构建仍会输出该文件用于调试。

### 和 Android 插件一起使用

1. 在 Android 项目中集成 OkHttpDebugKit 的 debug AAR。
2. 在生产 release 包中集成 no-op AAR，保持 API 一致但不执行捕获。
3. 启动 OkHttp Debug Desktop。
4. USB 调试时连接手机，使用桌面端的 USB 映射能力，或手动执行：

```bash
adb reverse tcp:19090 tcp:19090
```

5. Android 插件连接：

```text
ws://127.0.0.1:19090/session
```

如果桌面端 `19090` 被占用，应用会自动尝试 `19091` 到 `19109`。USB 模式下 Android 侧端口仍可以固定为 `19090`，桌面端会把设备侧 `tcp:19090` 映射到实际监听端口。

局域网模式下，Android 插件需要连接桌面端所在电脑的局域网 IP，例如：

```text
ws://192.168.1.10:19090/session
```

### 开发运行

```bash
npm install
npm run tauri:dev
```

### 打包

```bash
npm run prepare:adb
npm run tauri:package:mac
```

GitHub Actions 可以产出：

- Windows: NSIS 安装包
- macOS: arm64 和 x64 DMG
- Linux: AppImage 和 deb

更多信息：

- ADB 说明：[docs/ADB.md](docs/ADB.md)
- 打包说明：[docs/PACKAGING.md](docs/PACKAGING.md)
- 日志和问题反馈：[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

## English

OkHttp Debug Desktop is a cross-platform desktop debugging console that receives OkHttp request and response captures sent from Android apps through the OkHttpDebugKit plugin.

This project is not useful by itself. It must be used together with the Android-side [OkHttpDebugKit](https://github.com/yifanfengshun930115-afk/OkHttpDebugKit): the desktop app listens, displays, filters, exports, and diagnoses captures, while the Android plugin integrates with the target app's OkHttpClient and sends captured data to the desktop app.

### Features

- Receives Android OkHttp captures through a local WebSocket server.
- Supports regular application-level captures and `plain` / `wire` dual-stage views for encrypted API debugging.
- Automatically manages `adb reverse` mappings for USB debugging.
- Supports LAN connections by letting the Android app connect to the desktop IP and WebSocket endpoint.
- Filters captures by status, method, device, application, and stage.
- Provides JSON formatting, collapsible JSON viewing, raw body viewing, and request/response comparison.
- Builds macOS, Windows, and Linux desktop packages.
- Release builds do not write full capture files by default, preventing `captures-*.ndjson` from growing with every request. Development builds still write those files for debugging.

### Use With The Android Plugin

1. Add the real OkHttpDebugKit debug AAR to your Android project.
2. Add the no-op AAR to production release builds. It keeps the same API but performs no capture work.
3. Start OkHttp Debug Desktop.
4. For USB debugging, connect the device and use the desktop USB mapping feature, or run:

```bash
adb reverse tcp:19090 tcp:19090
```

5. Configure the Android plugin to connect to:

```text
ws://127.0.0.1:19090/session
```

If desktop port `19090` is busy, the app automatically tries `19091` through `19109`. In USB mode, Android clients can still keep their device-side port fixed at `19090`; the desktop app maps device `tcp:19090` to the actual desktop listening port.

For LAN mode, configure the Android plugin to connect to the desktop machine's LAN IP, for example:

```text
ws://192.168.1.10:19090/session
```

### Development

```bash
npm install
npm run tauri:dev
```

### Packaging

```bash
npm run prepare:adb
npm run tauri:package:mac
```

GitHub Actions can produce:

- Windows: NSIS installer
- macOS: arm64 and x64 DMG
- Linux: AppImage and deb

More information:

- ADB notes: [docs/ADB.md](docs/ADB.md)
- Packaging: [docs/PACKAGING.md](docs/PACKAGING.md)
- Logs and issue reports: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
