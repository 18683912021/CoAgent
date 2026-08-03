# AI 面试助手 — PC 桌面端 + Web 端 完整设计方案

## Context

当前项目是基于 React Native (Android) + FastAPI 的 AI 面试助手 App。Android 平台存在三个无法逾越的限制：

1. **VoIP 通话音频无法采集**：`USAGE_VOICE_COMMUNICATION` 被 Android 框架层禁止捕获，且微信/会议 App 主动设 `ALLOW_CAPTURE_BY_NONE` + VoIP 私有音频通道隔离
2. **AI 助手窗口无法隐身**：Android 没有窗口级截屏保护 API，面试共享屏幕时 AI 答案会被面试官看到
3. **文件转换不可靠**：服务端用 `dxpdf`（频繁报错需要多次重试 + XML 清理回退）+ `pdf2docx`（排版保真度不稳定）+ LLM 增强（速度慢、成本高）三重方案接力，维持 150+ 行复杂容错逻辑，本质上是因为没有本地原生的文档渲染引擎

本方案将产品从 Android 单平台扩展为 **Electron 桌面端（主力）+ Web 端（辅助）** 的双平台架构，利用 PC 操作系统的三项原生能力彻底解决这三个限制：

| 限制 | Android | PC 解决方案 |
|------|:---:|------|
| 通话音频采集 | ❌ VoIP 被禁止 | WASAPI Loopback，捕获所有系统混音输出 |
| AI 窗口隐身 | ❌ 无截屏保护 | `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` |
| 文件转换 | ⚠️ 三种工具接力兜底 | LibreOffice 本地渲染引擎，一行命令替代 150 行 |

### 设计目标

1. **Electron 桌面端**：聚焦面试场景，实现系统音频内录（WASAPI Loopback）、AI 浮窗隐身（ContentProtection）、本地文件转换（LibreOffice）
2. **Web 端**：独立于桌面端的辅助查看端，可单独用于面试（走麦克风采集），也可与桌面端协同
3. **代码复用最大化**：共享 API 层、状态管理（reducer）、主题系统、类型定义；仅 UI 渲染层和平台特定能力（音频采集/窗口管理/文件系统）分层实现
4. **后端几乎不变**：现有 FastAPI 服务（auth、ASR、LLM、interview、resume、tools）可直接复用，仅需少量适配（WebSocket client_hello 增加 `pc-windows`/`web` 标识）

---

## 一、项目结构

```
f:\CoAgent\
├── agent_app/
│   ├── main.py / orchestrator.py / ...  # Agent 编排系统
│   ├── prompts/                         # Agent 提示词
│   ├── workspace/
│   │   ├── be/poc-audio-capture/        # 🟢 现有 FastAPI 后端（基本不变）
│   │   ├── fe/                          # 🆕 FE Agent 产出目录
│   │   │   ├── desktop/                 # 🆕 Electron 桌面端
│   │   │   │   ├── package.json
│   │   │   │   ├── electron-builder.yml
│   │   │   │   ├── electron/            # 主进程代码
│   │   │   │   │   ├── main.ts
│   │   │   │   │   ├── preload.ts
│   │   │   │   │   ├── windows/         # 窗口管理
│   │   │   │   │   │   ├── main-window.ts
│   │   │   │   │   │   └── overlay-window.ts
│   │   │   │   │   ├── audio/           # WASAPI 音频采集
│   │   │   │   │   │   ├── wasapi-capture.ts
│   │   │   │   │   │   ├── pcm-normalizer.ts
│   │   │   │   │   │   └── frame-accumulator.ts
│   │   │   │   │   ├── stream/          # WebSocket 客户端
│   │   │   │   │   │   ├── ws-client.ts
│   │   │   │   │   │   └── wire-protocol.ts
│   │   │   │   │   ├── file-convert/    # 本地文件转换
│   │   │   │   │   │   └── libreoffice.ts
│   │   │   │   │   └── ipc-handlers.ts
│   │   │   │   ├── src/                 # 渲染进程（React）
│   │   │   │   │   ├── main.tsx
│   │   │   │   │   ├── App.tsx
│   │   │   │   │   └── ...
│   │   │   │   └── vite.config.ts
│   │   │   ├── web/                     # 🆕 Web 端
│   │   │   │   ├── package.json
│   │   │   │   ├── src/
│   │   │   │   │   ├── main.tsx
│   │   │   │   │   └── ...
│   │   │   │   ├── public/
│   │   │   │   └── vite.config.ts
│   │   │   └── shared/                  # 🆕 共享代码
│   │   │       ├── package.json
│   │   │       ├── api/                 # 从 fe-app/src/api/ 迁移
│   │   │       │   ├── client.ts
│   │   │       │   ├── auth.ts
│   │   │       │   ├── interview.ts
│   │   │       │   ├── resume.ts
│   │   │       │   └── tools.ts
│   │   │       ├── store/               # 纯 TS 状态管理
│   │   │       │   ├── interview-reducer.ts
│   │   │       │   └── types.ts
│   │   │       ├── utils/
│   │   │       │   ├── token-storage.ts
│   │   │       │   ├── interview-state.ts
│   │   │       │   └── auth-context.ts
│   │   │       ├── theme/
│   │   │       │   ├── tokens.ts
│   │   │       │   └── use-theme.ts
│   │   │       ├── config.ts
│   │   │       └── i18n/
│   │   │           ├── zh.json
│   │   │           └── en.json
│   │   ├── shared/                      # Agent 协作共享目录
│   │   │   ├── API_CONTRACT.md
│   │   │   ├── STATUS.md
│   │   │   ├── COLLABORATION.md
│   │   │   └── tasks/
│   │   └── prd/                         # PM Agent 产出
│   └── product-description/             # 产品方案文档
│       └── pc-desktop-web-architecture.md
└── fe-app/                              # 现有 Android RN App（已发布产品）
    └── audio-capture/
```

---

## 二、代码复用策略

### 2.1 从现有 RN 代码可 100% 复用的部分

源文件路径以 `fe-app/audio-capture/` 为基准，迁移到 `agent_app/workspace/fe/shared/`：

| 源文件 | 迁移到 | 改动 |
|--------|--------|------|
| `fe-app/audio-capture/src/api/client.ts` | `workspace/fe/shared/api/client.ts` | ⚪ 零改动 |
| `fe-app/audio-capture/src/api/auth.ts` | `workspace/fe/shared/api/auth.ts` | ⚪ 零改动 |
| `fe-app/audio-capture/src/api/interview.ts` | `workspace/fe/shared/api/interview.ts` | 提取 ConversationMessage 类型到 `workspace/fe/shared/store/types.ts` |
| `fe-app/audio-capture/src/api/resume.ts` | `workspace/fe/shared/api/resume.ts` | ⚪ 零改动 |
| `fe-app/audio-capture/src/utils/interviewState.ts` | `workspace/fe/shared/utils/interview-state.ts` | ⚪ 零改动 |
| `fe-app/audio-capture/src/utils/AuthContext.ts` | `workspace/fe/shared/utils/auth-context.ts` | ⚪ 零改动 |
| `fe-app/audio-capture/src/theme.ts` | `workspace/fe/shared/theme/tokens.ts` + `use-theme.ts` | 替换 RN shadow 为 CSS box-shadow |
| `fe-app/audio-capture/src/config.ts` | `workspace/fe/shared/config.ts` | 替换硬编码 IP 为环境变量 |
| `useAudioCaptureController` 中的 reducer | `workspace/fe/shared/store/interview-reducer.ts` | 提取纯函数，去除 RN 依赖 |

### 2.2 需要平台适配的部分

```
workspace/fe/shared/utils/token-storage.ts       # 定义接口
  ├── workspace/fe/desktop/electron/storage.ts   # Electron: localStorage 或 electron-store
  └── workspace/fe/web/src/storage.ts            # Web: localStorage
```

### 2.3 需要完全重写的部分（RN 原生能力 → Electron/Web 等价物）

| Android 原生模块 | Electron 等价物 | Web 等价物 |
|------------------|----------------|-----------|
| `AudioCaptureEngine` | WASAPI via `@fappurbate/naudiodon` 或自定义 Node addon | `navigator.mediaDevices.getUserMedia()` |
| `AudioStreamClient` (OkHttp WS) | 浏览器原生 `WebSocket` | 浏览器原生 `WebSocket` |
| `AudioWireProtocol` | Node.js 重写（Buffer，Big Endian） | JS 重写（DataView，Big Endian） |
| `AudioCaptureService` (Android Service) | Electron 主进程 + 系统托盘 | 无（页面即可） |
| `MediaProjection` consent | `desktopCapturer.getSources()` | `getDisplayMedia()` |
| `ContentProtection` | `win.setContentProtection(true)` | ❌ 不支持 |
| 文件选用 (`pickDocument`) | `dialog.showOpenDialog()` | `<input type="file">` |
| 文件保存 (`saveFile`) | `dialog.showSaveDialog()` + `fs.writeFile` | `<a download>` |
| SharedPreferences | `localStorage` / `electron-store` | `localStorage` |

---

## 三、音频采集架构（Electron）

这是整个方案的核心差异点。PC 端用 WASAPI Loopback 替代 Android 的 AudioRecord + MediaProjection。

### 3.1 技术选型

**Windows**: WASAPI (Windows Audio Session API) Loopback 模式
- `IMMDeviceEnumerator` → 获取默认渲染设备
- `IAudioClient::Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, ...)`
- `IAudioCaptureClient::GetBuffer()` 循环读取

**实现方式**: Node.js C++ addon（node-addon-api）
- 可选开源方案：[naudiodon](https://github.com/Streampunk/naudiodon)（已有 WASAPI loopback 支持）
- 或参考 [naudiodon 源码](https://github.com/Streampunk/naudiodon/blob/main/src/naudiodon.cc) 自写 addon

**macOS**: AudioKit / AVAudioEngine
- 可选开源方案：BlackHole 虚拟声卡 + CoreAudio

### 3.2 音频流水线（对应 Android AudioCaptureEngine）

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│ WASAPI Loopback  │────→│ PcmNormalizer│────→│ PcmFrameAccum.  │
│ (系统音频, 48kHz)│     │ → 16kHz mono │     │ → 1280 bytes/fr │
└─────────────────┘     └──────────────┘     └────────┬────────┘
                                                      │
┌─────────────────┐     ┌──────────────┐              │
│ 麦克风(44.1kHz)  │────→│ PcmNormalizer│──────────────┤
│                 │     │ → 16kHz mono │              │
└─────────────────┘     └──────────────┘              │
                                                      ▼
                                          ┌──────────────────────┐
                                          │ AudioWireProtocol    │
                                          │ → 44字节 Big Endian  │
                                          │   二进制帧            │
                                          └──────────┬───────────┘
                                                     │
                                          ┌──────────▼───────────┐
                                          │ WebSocket → 现有 BE  │
                                          │ ws://host:8010/api/  │
                                          │ ws/audio/stream      │
                                          └──────────────────────┘
```

### 3.3 关键实现细节

**PcmNormalizer 必须和 Android 端字节级等价**：
- 线性插值重采样，`sourceStep = inputRate / 16000`
- 立体声→单声道：`(L + R) / 2`
- 输出：16kHz，mono，PCM16 LE

**AudioWireProtocol 必须和 Android 端字节级等价**：
- 44 字节 Big Endian 二进制头部
- MAGIC: `0x41 0x43 0x50 0x31` ("ACP1")
- Version: 1
- packet_kind: 1=REALTIME, 2=BACKFILL
- source: 1=MIC, 2=SYSTEM
- session_id: UUID 的 MSB(8字节)+LSB(8字节)
- 所有控制消息 JSON 字段名和结构必须匹配

**client_hello 标识符**：`"client": "pc-windows"` 或 `"pc-macos"`

### 3.4 和 Android 的关键差异

| | Android | Electron |
|------|------|------|
| 系统音频源 | AudioPlaybackCapture（被 VoIP 限制） | WASAPI Loopback（捕获所有混音输出，无限制） |
| 音频捕获 API | AudioRecord (Java) | WASAPI (C++ Node addon) |
| 麦克风冲突 | ⚠️ 通话 App 占用 | ✅ 多 App 共享 |
| Foreground Service | 必须 | 不需要（系统托盘图标即可） |
| 线程模型 | Java Thread | Node.js Worker Thread |
| 文件存储 | `context.filesDir` | `app.getPath('userData')` / 可配置 |

---

## 四、窗口隐身方案（Electron）

### 4.1 核心 API

```typescript
// electron/main.ts
import { BrowserWindow } from 'electron';

// AI 浮窗配置
const overlayWindow = new BrowserWindow({
  width: 400,
  height: 600,
  transparent: true,          // 透明背景
  frame: false,               // 无边框
  alwaysOnTop: true,          // 始终最前
  skipTaskbar: true,          // 任务栏不显示
  type: 'toolbar',            // macOS 不抢焦点
  backgroundColor: '#00000000',
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
  },
});

// ★ 核心：窗口在屏幕共享/截屏中完全隐身
overlayWindow.setContentProtection(true);

// 在所有桌面/全屏应用中可见
overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

// 鼠标穿透（浮窗不阻挡底部操作）
overlayWindow.setIgnoreMouseEvents(true, { forward: true });
```

### 4.2 平台对应

| 方法 | Windows | macOS |
|------|---------|-------|
| `setContentProtection(true)` | `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` | `NSWindow.sharingType = NSWindowSharingNone` |
| 兼容软件 | Zoom/Teams/Google Meet/OBS/所有标准截屏 | 同上（部分 App 测试） |

### 4.3 已知坑点

| 问题 | 版本 | 应对 |
|------|------|------|
| Electron 35.0.1 回归：ContentProtection → 黑块而非隐身 | ≥35.0.1 | 锁定 Electron 32.x 或 33.x |
| `win.hide()` 后 ContentProtection 丢失 | ≥33.0.0 | show 后重新调用 `setContentProtection(true)` |
| 硬件采集卡绕过 | 物理硬件 | 面试场景不涉及 |
| `WS_EX_LAYERED` + ContentProtection → 黑块 | Windows | 浮窗不要用透明+LAYERED 组合 |

### 4.4 多窗口架构

```
┌── 主窗口（可见）──────────────┐   ┌── AI 浮窗（隐身）──────────────┐
│                              │   │                              │
│  面试控制面板                  │   │  面试官问题（ASR 转写）          │
│  ├── 编程语言选择              │   │  AI 实时答案（流式输出）         │
│  ├── 答案风格                  │   │  关键提示                     │
│  ├── 麦克风/系统音频电平表      │   │                              │
│  ├── 开始/停止采集             │   │  此窗口在屏幕共享中             │
│  └── 转写历史                  │   │  完全不可见                   │
│                              │   │                              │
└──────────────────────────────┘   └──────────────────────────────┘
```

用户可以自由拖拽两个窗口到合适位置——主窗口控制面试流程，浮窗显示 AI 提示。因为浮窗通过 `setContentProtection(true)` 在屏幕共享中对面试官不可见，用户无需刻意隐藏。

---

## 五、WebSocket 客户端（Electron + Web 共用）

### 5.1 协议栈

用浏览器原生 `WebSocket` + JS/TS 重写 Android 端的 `AudioStreamClient` + `AudioWireProtocol`：

```typescript
// shared/stream/ws-client.ts
class AudioStreamClient {
  private ws: WebSocket;
  private sessionId: string;
  
  async connect(url: string): Promise<void> {
    this.ws = new WebSocket(url);
    // ...
  }
  
  // 实时帧发送（对应 Android enqueueRealtime）
  enqueueRealtime(sessionId, source, sequence, captureOffsetUs, payload, isFinal): void {
    const packet = WireProtocol.encode({
      kind: 'realtime',
      source,
      sessionId: this.sessionId,
      sequence,
      captureOffsetUs,
      payload,
      isFinal,
    });
    this.ws.send(packet); // Binary frame
  }
  
  // 控制消息
  sendControl(msg: object): void {
    this.ws.send(JSON.stringify(msg));
  }
}
```

### 5.2 协议要点（必须和 Android 端一致）

```
二进制帧头部（44字节，Big Endian）：
  Offset  Size  Field
  0       4     MAGIC "ACP1" (0x41 0x43 0x50 0x31)
  4       1     VERSION = 1
  5       1     KIND (1=REALTIME, 2=BACKFILL)
  6       1     SOURCE (1=MIC, 2=SYSTEM)
  7       1     FLAGS (1=FINAL)
  8       8     session_id MSB (int64 Big Endian)
  16      8     session_id LSB (int64 Big Endian)
  24      8     sequence (int64 Big Endian)
  32      8     capture_offset_us (int64 Big Endian)
  40      4     payload_length (uint32 Big Endian)
  44      N     payload (PCM16 LE mono, normalized)

控制消息（JSON text frame）：
  握手: client_hello → ready
  会话: session_start → session_ready
  轨道: track_start → track_ready
  回溯: file_start → BACKFILL binary → file_end
  完成: track_end → session_stopped → session_complete
  ASR:  transcription (server→client)
  LLM:  llm_start → llm_chunk* → llm_done (server→client)
```

### 5.3 和现有后端的兼容性

后端 WebSocket 代码在 `agent_app/workspace/be/poc-audio-capture/app/routers/audio.py`，已经支持 JSON 控制消息 + 二进制帧混合协议。**唯一的适配点**是将 `client_hello` 中的 `"client"` 字段从 `"rn-android"` 改为 `"pc-windows"` / `"pc-macos"` / `"web"`——这只是为了服务端标识客户端类型。

### 5.4 WebSocket 重连机制

网络断开或后端重启时，WebSocket 会意外关闭。Android 端 `AudioStreamClient.kt` 中有 `socketGeneration` 防陈旧回调 + `retryOnConnectionFailure = true`。PC 端用浏览器原生 `WebSocket` 实现等价机制。

#### 5.4.1 重连状态机

```
IDLE → CONNECTING → READY ←→ DEGRADED
  ↑        ↓           ↓
  └── CLOSED ←─────────┘ (超过最大重试次数)
  
DEAD: 最终放弃，通知用户手动重试
```

#### 5.4.2 实现

```typescript
// shared/stream/ws-client.ts
export class AudioStreamClient {
  private ws: WebSocket | null = null;
  private url: string;
  private sessionId: string | null = null;
  private generation = 0;        // 防陈旧回调，等同 Android socketGeneration
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private connectPromise: Promise<void> | null = null;
  private emitter = new EventEmitter();

  // ── 重连配置 ──
  private readonly MAX_RETRY = 10;
  private readonly INITIAL_DELAY_MS = 500;
  private readonly MAX_DELAY_MS = 30_000;
  private readonly CONNECT_TIMEOUT_MS = 10_000;

  constructor(url: string) {
    this.url = url;
  }

  async connect(): Promise<void> {
    this.retryCount = 0;
    return this._connect();
  }

  private async _connect(): Promise<void> {
    this.generation += 1;
    const gen = this.generation;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (gen !== this.generation) return;
        this.ws?.close();
        reject(new Error('WebSocket connect timeout'));
      }, this.CONNECT_TIMEOUT_MS);

      this.ws = new WebSocket(this.url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        clearTimeout(timeout);
        if (gen !== this.generation) return;
        this.retryCount = 0;
        this.ws!.send(JSON.stringify({
          type: 'client_hello',
          protocol: 'audio.capture.v1',
          client: 'pc-windows',
        }));
        // 如果当前有活跃 session，重发 session_start + track_start
        this._resyncAfterReconnect();
        resolve();
      };

      this.ws.onmessage = (event) => {
        if (gen !== this.generation) return;
        if (typeof event.data === 'string') {
          this._handle(JSON.parse(event.data));
        }
      };

      this.ws.onclose = (e) => {
        clearTimeout(timeout);
        if (gen !== this.generation) return;
        if (e.code === 1000) {
          this.emitter.emit('streamState', 'closed');
          return; // 正常关闭，不重连
        }
        this.emitter.emit('streamState', 'degraded');
        this._scheduleReconnect();
      };

      this.ws.onerror = () => {
        clearTimeout(timeout);
        if (gen !== this.generation) return;
        reject(new Error('WebSocket connection failed'));
      };
    });
  }

  private _scheduleReconnect(): void {
    if (this.retryCount >= this.MAX_RETRY) {
      this.emitter.emit('streamState', 'dead');
      this.emitter.emit('error', {
        code: 'E_WS_MAX_RETRY',
        stage: 'stream',
        message: `WebSocket 重连失败，已达最大重试次数 (${this.MAX_RETRY})`,
        recoverable: false,
      });
      return;
    }

    const delay = Math.min(
      this.INITIAL_DELAY_MS * Math.pow(2, this.retryCount),
      this.MAX_DELAY_MS,
    );
    this.retryCount += 1;

    this.emitter.emit('streamState', 'reconnecting', {
      attempt: this.retryCount,
      maxRetry: this.MAX_RETRY,
      delayMs: delay,
    });

    this.retryTimer = setTimeout(() => {
      this._connect().catch(() => {
        // _scheduleReconnect 已在 onclose 中触发
      });
    }, delay);
  }

  private _resyncAfterReconnect(): void {
    if (!this.sessionId || !this.activeTracks.size) return;
    // 重连后重新同步会话状态，让服务端知道轨道的格式和序列号起点
    this._send({
      type: 'session_start',
      session_id: this.sessionId,
      source_mode: this.activeTracks.size > 1 ? 'both' : this.activeTracks.has('mic') ? 'mic' : 'system',
    });
    for (const [source] of this.activeTracks) {
      this._send({
        type: 'track_start',
        session_id: this.sessionId,
        source,
        format: { sample_rate: 16000, bit_depth: 16, channels: 1, encoding: 'pcm_s16le', chunk_duration_ms: 40 },
      });
    }
  }

  private _handle(msg: any): void {
    switch (msg.type) {
      case 'ready':
        this.sessionId = msg.session_id;
        this.emitter.emit('streamState', 'ready');
        break;
      case 'session_ready': break;
      case 'transcription':
        this.emitter.emit('transcription', msg);
        break;
      case 'llm_start':
        this.emitter.emit('llmStart', msg);
        break;
      case 'llm_chunk':
        this.emitter.emit('llmChunk', msg);
        break;
      case 'llm_done':
        this.emitter.emit('llmDone', msg);
        break;
      case 'chunk_ack': break;
      case 'error':
        this.emitter.emit('error', msg);
        break;
    }
  }

  // ── 发送 PCM 帧（采集线程调用） ──
  sendPcm(frame: ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(frame);
  }

  // ── 发送 JSON 控制消息 ──
  private _send(msg: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  sendControl(msg: object): void { this._send(msg); }

  disconnect(): void {
    this.retryCount = this.MAX_RETRY; // 防止重连
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close(1000);
    this.ws = null;
  }
}
```

#### 5.4.3 采集中的连贯处理

重连期间音频帧会暂时丢失，但不会影响后续会话：

```
重连前 5s 的音频帧 → 丢弃（实时场景下容错）
重连后新音频帧     → 正常发送（新 sequence 从 0 开始重新编号）
ASR 结果          → 重连成功后继续正常接收
LLM 流            → 同上
```

**不需要**像 Android 端那样做音频帧回补（backfill），因为面试是实时场景——断连几秒钟的音频即使补发也没有意义。backfill 只在采集结束后的 PCM 文件上传场景有意义。

#### 5.4.4 UI 反馈

重连过程中渲染进程应显示：

| 状态 | UI 表现 |
|------|---------|
| CONNECTING | 连接中... 加载指示器 |
| READY | 正常，不显示任何提示 |
| DEGRADED（重连中） | 顶部 Toast："连接断开，正在重连... (第 3/10 次)" |
| DEAD（重连失败） | 红色 Toast："连接失败，请检查网络后手动重试 [重试按钮]" |

---

## 六、文件转换（Electron）

### 6.1 方案：spawn LibreOffice

```typescript
// electron/file-convert/libreoffice.ts
import { spawn } from 'child_process';
import path from 'path';

export async function convertToPdf(inputPath: string, outputDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const soffice = getLibreOfficePath(); // 检测安装路径
    const proc = spawn(soffice, [
      '--headless',
      '--convert-to', 'pdf:writer_pdf_Export',
      '--outdir', outputDir,
      inputPath,
    ], { timeout: 60_000 });
    
    proc.on('close', (code) => {
      if (code === 0) {
        const name = path.basename(inputPath, path.extname(inputPath)) + '.pdf';
        resolve(path.join(outputDir, name));
      } else {
        reject(new Error(`LibreOffice exited with code ${code}`));
      }
    });
  });
}
```

### 6.2 格式支持矩阵

| 操作 | 工具 | 命令 |
|------|------|------|
| Word → PDF | LibreOffice | `soffice --headless --convert-to pdf` |
| PDF → Word | LibreOffice | `soffice --headless --convert-to docx` |
| Markdown → PDF | Pandoc | `pandoc input.md -o output.pdf` |
| DOCX → Markdown | Pandoc | `pandoc input.docx -o output.md` |
| HTML → PDF | Electron 内置 | `BrowserWindow.webContents.printToPDF()` |
| 其他任意互转 | Pandoc | 30+ 格式 |

### 6.3 LibreOffice 检测策略

```
1. 检测常见安装路径
   ├── Windows: %PROGRAMFILES%\LibreOffice\program\soffice.exe
   ├── macOS:   /Applications/LibreOffice.app/Contents/MacOS/soffice
   └── Linux:   /usr/bin/soffice

2. 如果未安装 → 引导用户下载安装（提供链接）
3. 作为兜底 → 回退到现有服务端 API（tools.py 的端点）
```

### 6.4 服务端 API 保留为兜底

如果用户没装 LibreOffice，仍然可以走现有的服务端转换（`/api/tools/word-to-pdf`、`/api/tools/pdf-to-word`）。这是一个优雅降级策略。

### 6.5 打包 LibreOffice Portable 到安装包（推荐）

上面的"检测系统安装 → 未装则回落服务端"方案有一个问题：**用户体验差**。更好的做法是参考 [Docket](https://github.com/Wis7Com/Docket) 项目的策略，把 LibreOffice 便携版作为 Electron App 的资源文件直接打包。

**Windows 便携版来源：**

- [LibreOffice Portable](https://www.libreoffice.org/download/portable-versions/)（官方，约 350MB 解压后）——安装时不需要管理员权限，核心功能完整
- 或从常规 LibreOffice 安装目录中提取最小所需文件（`program/` + `share/`），精简到约 250MB

**检测优先级（从快到慢）：**

```
1. 系统已安装 LibreOffice？（检测注册表 / 常见路径）
   → 用系统的，最快

2. App 自带的便携版？（app.getPath('exe') 同级目录或 resources/）
   → 用自带的，开箱即用

3. 都没有？
   → 回退到服务端 API
```

**electron-builder 配置：**

```yaml
# electron-builder.yml
extraResources:
  # 把 LibreOffice Portable 目录整个打入 resources/
  - from: 'vendor/libreoffice-portable'
    to: 'libreoffice'
    filter:
      - '**/*'
```

```typescript
// electron/file-convert/libreoffice.ts
import path from 'path';
import { app } from 'electron';

function getLibreOfficePath(): string {
  // 1. 优先用系统安装的
  const systemPaths = [
    process.platform === 'win32' && 'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    process.platform === 'win32' && 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    process.platform === 'darwin' && '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    process.platform === 'linux' && '/usr/bin/soffice',
  ].filter(Boolean) as string[];

  for (const p of systemPaths) {
    if (fs.existsSync(p)) return p;
  }

  // 2. 用 App 自带的便携版
  const portablePath = process.env.NODE_ENV === 'development'
    ? path.join(__dirname, '..', '..', 'vendor', 'libreoffice-portable', 'program', 'soffice.exe')
    : path.join(process.resourcesPath, 'libreoffice', 'program', 'soffice.exe');

  if (fs.existsSync(portablePath)) return portablePath;

  // 3. 都没找到，抛错，由上层调用方回退到服务端 API
  throw new LibreOfficeNotFoundError();
}
```

**体积权衡：**

| 策略 | 安装包大小 | 用户体验 |
|------|:---:|------|
| 不带 LibreOffice | ~150MB | 需手动安装或联网转换 |
| 带 LibreOffice Portable 精简 | ~400MB | ✅ 开箱即用 |
| 带全套 LibreOffice | ~500MB | 开箱即用，但下载慢 |

建议：**默认不带 LibreOffice（减小安装包），首次使用文件转换时引导用户一键下载 Portable 版本**（App 内下载 → 解压到 `userData` 目录）。这样安装包保持 ~150MB，转换能力按需获取。

```typescript
// 首次使用时的交互流程
async function ensureLibreOffice(): Promise<string> {
  try { return getLibreOfficePath(); } catch {}
  
  // 弹窗："文件转换需要 LibreOffice，是否现在下载？（约 350MB）"
  const confirmed = await dialog.showMessageBox({
    type: 'info',
    title: '安装 LibreOffice',
    message: '文件转换功能需要 LibreOffice。',
    detail: '是否从官网下载？或使用在线转换。',
    buttons: ['下载 LibreOffice', '使用在线转换', '取消'],
  });

  if (confirmed.response === 0) {
    shell.openExternal('https://www.libreoffice.org/download/');
  }
  // 如果选择"使用在线转换"→ 回退到服务端 API
  throw new LibreOfficeNotFoundError();
}
```

---

## 七、Web 端设计

### 7.1 定位

独立的面试辅助工具，适用于：
- 用户在另一台设备上面试（PC 开 Zoom，手机/平板打开 Web 看 AI 答案）
- 用户不共享屏幕的面试场景（纯语音面试）
- 面试历史回顾、简历管理、账户管理

### 7.2 能力边界

| 能力 | Web | 说明 |
|------|:---:|------|
| 麦克风采集 | ✅ | `getUserMedia({ audio: true })` |
| 系统音频内录 | ❌ | 纯 Web 无法实现 |
| 窗口隐身 | ❌ | 纯 Web 无法实现（用户自行调整窗口位置） |
| 认证/登录 | ✅ | 和桌面端完全一样 |
| AI 面试对话 | ✅ | 麦克风 → PCM → WebSocket → ASR → LLM |
| 面试历史 | ✅ | 完全的 CRUD |
| 文件转换 | ⚠️ | 需走服务端 API（不依赖本地 LibreOffice） |
| 简历上传 | ✅ | `<input type="file" accept=".pdf">` |
| 账户管理 | ✅ | 偏好设置、订阅 |

### 7.3 音频采集方案

```typescript
// 简单场景：麦克风采集 → PCM → WebSocket
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    sampleRate: 16000,        // 直接请求 16kHz，省去重采样
    channelCount: 1,
    echoCancellation: false,  // 关键：关闭回声消除，避免 AEC 干扰
    noiseSuppression: false,  // 关闭降噪，保持原始信号
    autoGainControl: false,   // 关闭自动增益
  }
});

const audioContext = new AudioContext({ sampleRate: 16000 });
const processor = audioContext.createScriptProcessor(1280, 1, 1); // 1280 samples = 40ms
processor.onaudioprocess = (e) => {
  const pcm = e.inputBuffer.getChannelData(0);   // Float32 [-1, 1]
  const pcm16 = floatToPcm16(pcm);                // → Int16LE
  wsClient.enqueueRealtime(sessionId, 'mic', seq++, offset, pcm16, false);
};
```

### 7.4 构建和部署

```bash
# 开发
cd web && pnpm dev             # Vite dev server

# 构建 → 静态文件 → 部署到任何静态托管
cd web && pnpm build           # → dist/
# Nginx / Vercel / Cloudflare Pages / 直接放 Electron 里
```

---

## 八、PC 端 UI 重构

> 手机端是竖屏 375-428px 宽的单栏堆叠布局，PC 端是横屏 + 多窗口 + 可拖拽缩放。  
> 不是"把手机界面挪到大屏幕上"——要从信息架构层面重新设计。

### 8.1 布局转变：从竖屏单栏到横屏多栏

现有 RN 端是典型移动端布局：

```
移动端（375×812）
┌──────────────┐
│   Header     │  ← 标题
├──────────────┤
│              │
│  对话列表     │  ← 占据全部宽度
│  (面试官问题  │
│   + AI 答案) │
│              │
├──────────────┤
│  电平表+按钮  │  ← 控制区压缩在底部
├──────────────┤
│  Tab Bar     │  ← 面试 | 工具箱 | 我的
└──────────────┘
```

PC 端有 800-1600px 的可用宽度和独立浮窗，应该改为**多栏 + 多窗口**架构：

```
PC 端主窗口（800×700，可缩放）
┌──────────────────────────────────────┐
│  ← 面板              │  设置栏       │
│  编程语言选择          │  ├ 编程语言   │
│  麦克风电平表          │  ├ 答案风格   │
│  系统音频电平表        │  └ 快捷键提示 │
│  开始/停止按钮         │              │
│                      │              │
├──────────────────────┤              │
│  对话面板              │              │
│  ┌──────────────────┐│              │
│  │ 面试官：闭包原理？ ││  实时转写     │
│  │ AI：闭包是指...   ││  (只显示原始   │
│  └──────────────────┘│   ASR 结果)   │
│                      │              │
│  ┌──────────────────┐│              │
│  │ 面试官：原型链？   ││              │
│  │ AI：原型链是...   ││              │
│  └──────────────────┘│              │
└──────────────────────────────────────┘

AI 浮窗（独立窗口，ContentProtection 隐身，300×500）
┌──────────────────┐
│ 最新 AI 答案      │
│                  │
│ 面试官问什么 →    │
│ AI 怎么回答 →    │
│ 关键代码/要点 →   │
│                  │
│ (此窗口在面试官   │
│  屏幕分享中不可见) │
└──────────────────┘
```

### 8.2 主窗口布局：三栏结构

```
┌──────────────────────────────────────────────┐
│ Toolbar（高度 32px，可隐藏）                    │
│ [面试] [工具箱] [我的]            [⚙] [−][□][×] │
├──────────┬───────────────────────┬───────────┤
│          │                      │           │
│  控制栏   │    对话面板            │  上下文栏  │
│  240px   │    flex: 1            │  280px    │
│          │                      │           │
│ [开始]   │  ● 面试官（12:03）     │  当前语言   │
│ [停止]   │  解释一下闭包的原理     │  JavaScript│
│          │                      │           │
│ 🎤 ▂▃▅▇  │  用自然流畅的语气回答   │  实时转写   │
│ 🔊 ▁▂▃▄  │  你的答案是...         │  （原始ASR）│
│          │                      │           │
│ 编程语言  │                      │  历史对话   │
│ JavaScript│                      │  快速跳转   │
│          │                      │           │
└──────────┴───────────────────────┴───────────┘
```

**控制栏**（左，240px）：
- 采集开关（大按钮，开始/停止）
- 音频源显示（麦克风/系统音频 ± 电平条）
- 编程语言下拉
- 答案风格切换
- 面试计时器

**对话面板**（中，flex: 1）：
- 虚拟滚动对话气泡列表
- 面试官消息（左对齐，浅色背景）
- AI 答案（右对齐，流式混入动画，framer-motion）
- 自动滚到底部（新消息到达时）
- 面试结束时显示"保存历史"按钮

**上下文栏**（右，280px，可折叠）：
- 当前面试语言/赛道信息
- 原始 ASR 实时转写文本（面试官原话）
- 快捷操作（切换浮窗显隐、手动触发 LLM 回答）

### 8.3 各页面 PC 端布局

#### 面试页（InterviewScreen）

核心页面，使用上述三栏布局。关键交互：

- **流式文本**：和移动端的逐字动画逻辑 100% 复用，用 `requestAnimationFrame` 实现
- **自动滚动**：新消息到达时自动滚底，用户上滑查看历史时暂停自动滚动，出现"回到底部↓"浮动按钮
- **快捷键**：`Ctrl+Enter` 手动触发 LLM、`Ctrl+B` 切换浮窗
- **对话气泡**：和移动端相同的四种状态（loading / streaming / done / error），framer-motion 替代 RN Animated

#### 工具箱页（ToolsScreen）

```
┌──────────────────────────────────────┐
│  工具箱                              │
├─────────────────┬───────────────────┤
│  工具卡片列表     │  转换操作区        │
│  ┌───────────┐  │                   │
│  │ 🎲 随机出题 │  │  拖拽文件到此处     │
│  │ JavaScript│  │  或点击选择文件     │
│  │ 点击抽题    │  │                   │
│  ├───────────┤  │  已选: resume.docx │
│  │ 📄 Word→PDF│  │  ┌──────┐         │
│  │ 支持 .docx │  │  │ 开始转换│        │
│  ├───────────┤  │  └──────┘         │
│  │ 📝 PDF→Word│  │                   │
│  │ 支持 .pdf  │  │  输出: resume.pdf │
│  ├───────────┤  │  [保存到本地]      │
│  │ 📐 简历优化 │  │                   │
│  │ 🎨 样式优化 │  │                   │
│  │ ✍️ 内容优化 │  │                   │
│  └───────────┘  │                   │
└─────────────────┴───────────────────┘
```

左栏工具卡片列表（320px），右栏当前工具的操作区（flex: 1）。和移动端竖屏卡片堆叠完全不同。

#### 个人中心页（ProfileScreen）

```
┌──────────────────────────────────────┐
│  我的                               │
├─────────────────────┬───────────────┤
│                     │               │
│  👨‍💻 用户名           │  偏好设置     │
│  ✨ 高级会员          │               │
│  剩余时长 02:34:17    │  编程语言      │
│  有效期至 2026-12-31  │  [JavaScript] │
│  [续费]              │  面试语言 [中文]│
│                     │  答案风格 [标准]│
├─────────────────────┤               │
│  📋 面试历史 (47次)   │               │
│  📄 简历 (已上传)     │               │
│  🚪 退出登录          │               │
│                     │               │
└─────────────────────┴───────────────┘
```

两栏布局，左栏（个人信息 + 数据统计），右栏（偏好设置表单）。

#### 面试历史页（InterviewHistoryScreen）

表格布局——移动端的 FlatList 卡片堆叠替换为真正的表格：

```
┌──────────────────────────────────────┐
│  面试历史                  [清除全部]  │
├──────┬──────────┬──────┬─────────────┤
│ 日期  │ 时长     │ 语言  │ 对话数      │
├──────┼──────────┼──────┼─────────────┤
│ 7/28 │ 00:34:17 │ JS   │ 12 条       │
│ 7/27 │ 00:28:05 │ Python│ 8 条       │
│ ...  │          │      │             │
└──────┴──────────┴──────┴─────────────┘
    点击行 → 展开完整对话详情（右侧面板或新页面）
```

### 8.4 响应式断点

主窗口和浮窗都是用户可缩放的自由尺寸。组件在不同宽度下自适应：

| 断点 | 宽度 | 主窗口布局 | 变化 |
|------|------|------|------|
| XS | < 600px | 单栏（和移动端一致） | 控制栏和上下文栏折叠到 toolbar 下拉 |
| SM | 600-900px | 双栏（对话 + 控制栏切换） | 上下文栏折叠，控制栏缩为浮层 |
| MD | 900-1200px | 标准三栏 | 上下文栏 240px |
| LG | > 1200px | 宽松三栏 | 上下文栏 320px |

```css
/* 关键容器 */
.main-layout {
  display: grid;
  grid-template-columns: 240px 1fr 280px;
  height: 100%;
}

@media (max-width: 900px) {
  .main-layout {
    grid-template-columns: 1fr;           /* 回退到单栏 */
  }
  .context-panel { display: none; }      /* 隐藏上下文栏 */
  .control-bar { 
    position: fixed; bottom: 0; left: 0; right: 0; /* 变成底栏 */ 
  }
}
```

### 8.5 最小窗口尺寸约束

Electron 主进程设置下限：

```typescript
mainWindow.setMinimumSize(480, 400);   // 低于这个尺寸 UI 会坏
```

低于 480px 时不强制三栏，所有内容自动切换到移动端风格的单栏堆叠。

### 8.6 键盘快捷键

| 快捷键 | 作用域 | 功能 |
|--------|--------|------|
| `Ctrl + Enter` | 面试页 | 手动触发 LLM 回答（重问当前上下文） |
| `Ctrl + B` | 全局 | 显示/隐藏 AI 浮窗 |
| `Ctrl + Shift + A` | 全局 | 主窗口始终置顶/取消 |
| `Ctrl + S` | 面试页 | 保存当前面试记录 |
| `Ctrl + ,` | 全局 | 打开偏好设置 |
| `Ctrl + 1/2/3` | 全局 | 切换到面试/工具箱/我的 |
| `Esc` | 全局 | 关闭弹窗、收起上下文栏 |

### 8.7 React Native → React DOM 组件映射

| RN 组件 | React DOM 等价 | 备注 |
|---------|---------------|------|
| `<View>` | `<div>` | 使用 CSS `display: flex` 默认 |
| `<Text>` | `<p>` / `<span>` | 不带默认样式 |
| `<TouchableOpacity>` | `<button>` 或 `<div onClick>` | 用 CSS `:active` + `transition` 替代 `activeOpacity` |
| `<Pressable>` | `<div onClick onKeyDown>` | 增加 `tabIndex` 支持键盘可访问 |
| `<ScrollView>` | `<div style={{overflow:'auto'}}>` | 用 CSS `scroll-behavior: smooth` |
| `<FlatList>` | `react-virtuoso` 或 `react-window` | 对话列表上千条消息必须虚拟化 |
| `<TextInput>` | `<input type="text">` / `<textarea>` | PC 端隐藏焦点轮廓用 `outline: none` |
| `<Modal>` | `ReactDOM.createPortal()` + 遮罩 | ESC 关闭，点击遮罩关闭 |
| `<ActivityIndicator>` | CSS `@keyframes spin` | SVG/CSS 旋转动画 |
| `<SafeAreaView>` | 不需要 | PC 端没有刘海屏和底部指示条 |
| `<Animated.View>` | `framer-motion` | 流式文本混入用 `motion.div` |
| `StyleSheet.create` | Tailwind CSS + CSS Modules | 组件样式用 Tailwind 原子类，复杂规则用 CSS Module |
| `Vibration` | 不需要 | 替换为窗口闪烁或视觉提醒 |
| `PermissionsAndroid` | 不需要 | Electron 桌面端无运行时权限模型 |
| `AppState` | `document.visibilitychange` | Web 端用；Electron 用主进程 `win.focus/blur` IPC |

### 8.8 样式方案：Tailwind CSS + CSS 变量

```js
// tailwind.config.js
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        'bg-surface': 'var(--color-bg-surface)',
        accent: 'var(--color-accent)',
        'accent-light': 'var(--color-accent-light)',
        'accent-soft': 'var(--color-accent-soft)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-tertiary': 'var(--color-text-tertiary)',
        divider: 'var(--color-divider)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
      },
      borderRadius: {
        sm: '6px', md: '10px', lg: '14px', xl: '18px', full: '9999px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(0,0,0,0.05)',
        md: '0 2px 8px rgba(0,0,0,0.08)',
        lg: '0 4px 16px rgba(0,0,0,0.12)',
      },
      fontSize: {
        caption: ['12px', { lineHeight: '16px' }],
        'body-sm': ['13px', { lineHeight: '18px' }],
        body: ['15px', { lineHeight: '22px' }],
        heading: ['20px', { lineHeight: '28px' }],
        title: ['22px', { lineHeight: '30px' }],
      },
      spacing: {
        xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '20px', '2xl': '28px', '3xl': '36px',
      },
    },
  },
  plugins: [],
};
```

### 8.9 主题系统

```typescript
// shared/theme/use-theme.ts
import { useEffect, useState } from 'react';

export function useTheme() {
  const [dark, setDark] = useState(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const tokens = dark ? darkTokens : lightTokens;
  useEffect(() => {
    const root = document.documentElement;
    Object.entries(tokens.colors).forEach(([key, value]) => {
      root.style.setProperty(`--color-${key}`, value);
    });
  }, [dark, tokens]);

  return tokens;
}
```

---

## 九、状态管理

### 9.1 从现有 reducer 提取核心逻辑

Android 端 `useAudioCaptureController.ts` 中有约 200 行的**纯 reducer 函数**，可以完整提取到 `workspace/fe/shared/store/interview-reducer.ts`：

```typescript
// shared/store/interview-reducer.ts
// 从 fe-app/src/hooks/useAudioCaptureController.ts 提取
// 所有 Action 类型、reducer 函数、helper 函数 皆可复用

export type ConversationBubbleStatus = 'loading' | 'streaming' | 'done' | 'error';

export interface ConversationMessage {
  id: string;
  role: 'interviewer' | 'user' | 'ai';
  text: string;
  status: ConversationBubbleStatus;
  timestamp: number;
}

// ... Action联合类型，reducer纯函数，genId, insertAfter, _isOnlyPunct, _cap 等
```

### 9.2 平台适配层

桌面端和 Web 端各自实现 `useAudioCapture` hook，但内部调用相同的 reducer：

```
shared/store/interview-reducer.ts    ← 纯逻辑，两个平台共用
  ├── desktop/src/hooks/use-audio-capture.ts  ← 调 Electron IPC + reducer
  └── web/src/hooks/use-audio-capture.ts      ← 调 getUserMedia + reducer
```

---

## 十、IPC 通信（Electron 特有）

### 10.1 主进程 ↔ 渲染进程

```typescript
// electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // 音频控制
  audio: {
    startCapture: (opts) => ipcRenderer.invoke('audio:start-capture', opts),
    stopCapture: () => ipcRenderer.invoke('audio:stop-capture'),
    getSnapshot: () => ipcRenderer.invoke('audio:get-snapshot'),
    onState: (cb) => ipcRenderer.on('audio:state', (_, data) => cb(data)),
    onTranscription: (cb) => ipcRenderer.on('audio:transcription', (_, data) => cb(data)),
    onLLMChunk: (cb) => ipcRenderer.on('audio:llm-chunk', (_, data) => cb(data)),
    onLLMDone: (cb) => ipcRenderer.on('audio:llm-done', (_, data) => cb(data)),
  },
  
  // 文件转换
  fileConvert: {
    convert: (inputPath, format) => ipcRenderer.invoke('file:convert', inputPath, format),
    pickFile: (extensions) => ipcRenderer.invoke('file:pick', extensions),
    saveFile: (data, defaultName) => ipcRenderer.invoke('file:save', data, defaultName),
  },
  
  // 窗口管理
  window: {
    openOverlay: () => ipcRenderer.invoke('window:open-overlay'),
    closeOverlay: () => ipcRenderer.invoke('window:close-overlay'),
  },
  
  // 存储
  storage: {
    get: (key) => ipcRenderer.invoke('storage:get', key),
    set: (key, value) => ipcRenderer.invoke('storage:set', key, value),
    remove: (key) => ipcRenderer.invoke('storage:remove', key),
  },
});
```

---

## 十一、构建和打包 —— 固定版本基线

> 基线日期：2026-07-31  
> Node.js 基线：`22.23.1 LTS`  
> 所有版本号均已锁定，不使用 `^` 或 `~` 自动漂移。

### 11.1 结论

下面这组组合可以支持 Electron 桌面端 + Vite Web 端的 monorepo 正常开发、构建、调试和打包：

| 组件 | 固定版本 | 说明 |
|------|---------|------|
| Node.js | `22.23.1 LTS` | 全平台统一基线 |
| pnpm | `9.15.0` | monorepo workspace 管理 |
| React | `19.0.0` | 和现有 RN 项目一致 |
| React DOM | `19.0.0` | 和 React 版本对齐 |
| TypeScript | `5.6.3` | 严格模式 |
| Electron | `32.2.8` | ContentProtection 稳定，无 33/35 回归 |
| electron-builder | `25.1.8` | Windows NSIS + macOS DMG |
| Vite | `6.0.5` | Electron + Web renderer 共用 |
| @vitejs/plugin-react | `4.3.4` | React Fast Refresh |
| Tailwind CSS | `3.4.17` | 映射 theme.ts 设计令牌（v3 稳定，不用 v4） |
| postcss | `8.4.49` | Tailwind 依赖 |
| autoprefixer | `10.4.20` | Tailwind 依赖 |
| React Router DOM | `7.1.1` | SPA 路由（Web + Electron renderer） |
| framer-motion | `11.15.0` | 动画库（替代 RN Animated） |
| eventemitter3 | `5.0.1` | 跨平台事件总线 |
| electron-store | `10.0.0` | 主进程安全持久化存储 |
| electron-updater | `6.3.9` | 自动更新 |
| node-abi | `3.71.0` | N-API addon 编译兼容性检测 |
| node-gyp | `11.0.0` | WASAPI C++ addon 编译 |
| Vitest | `2.1.8` | 单元测试（Vite 原生集成） |
| @testing-library/react | `16.1.0` | React 组件测试 |
| Playwright | `1.49.1` | E2E 测试（Electron + Web） |
| ESLint | `9.16.0` | 静态检查 |
| Prettier | `3.4.2` | 代码格式化 |

兼容性依据：

1. Electron 32.x 使用 Chromium 128 和 Node 20，但与系统 Node 22.23.1 的 TypeScript/ESLint 工具链完全兼容。Electron 主进程的运行时 Node 由 Electron 自带（Node 20），开发阶段的 Vite/TS/eslint 使用系统 Node 22。
2. Electron 32.2.x 的 `setContentProtection(true)` 未出现 33.x 的 hide 后丢失 bug，也未出现 35.x 的黑块回归问题。
3. React 19.0.0 是现有 RN 项目的版本，共享代码（api/store/utils/theme）无需适配不同 React 大版本。
4. Tailwind CSS 3.4.x 是 v3 的最后稳定线，v4 在 2025 年发布但 API 变化大且插件生态仍在迁移中。
5. TypeScript 5.6.3 和 Vite 6.0.5 的组合已在 Electron + Web 场景有大量验证案例。

### 11.2 版本兼容性约束

```
Node 22.23.1
  ├── pnpm 9.15.0        ← 使用 packageManager 字段锁定
  ├── TypeScript 5.6.3   ← 不支持 TS 5.7+ 的新语法（可选升级，暂缓）
  ├── Vite 6.0.5         ← Electron renderer + Web 共用
  │     └── @vitejs/plugin-react 4.3.4
  ├── Electron 32.2.8    ← 自带 Node 20 + Chromium 128，和系统 Node 22 隔离
  │     ├── electron-builder 25.1.8
  │     ├── electron-store 10.0.0
  │     └── electron-updater 6.3.9
  ├── React 19.0.0
  │     ├── react-dom 19.0.0
  │     ├── react-router-dom 7.1.1
  │     └── framer-motion 11.15.0
  ├── Tailwind CSS 3.4.17
  │     ├── postcss 8.4.49
  │     └── autoprefixer 10.4.20
  └── Dev
        ├── Vitest 2.1.8
        ├── @testing-library/react 16.1.0
        ├── Playwright 1.49.1
        ├── ESLint 9.16.0
        ├── Prettier 3.4.2
        ├── node-gyp 11.0.0
        └── node-abi 3.71.0
```

关键约束：
- Electron 自带 Node 运行时，**不要在 Electron 主进程中使用系统 Node 22 才有的 API**（如 `fs.glob`、`import.meta.dirname` 等）。主进程代码应在 Electron 内建 Node 20 的能力范围内编写。
- 不要使用 pnpm 10.x——pnpm 10 默认使用 `link-workspace-packages=false`，会改变 monorepo 的包解析行为。
- Tailwind 3.4.x 使用 PostCSS 8.x。如果未来升级 Tailwind 4，需要同时迁移 PostCSS 10，暂不纳入基线。

### 11.3 包管理器锁定

```json
// 根 package.json
{
  "packageManager": "pnpm@9.15.0",
  "engines": {
    "node": ">=22.23.1 <23",
    "pnpm": ">=9.15.0 <10"
  }
}
```

### 11.4 Monorepo 配置

```yaml
# agent_app/workspace/fe/pnpm-workspace.yaml
packages:
  - 'shared'
  - 'desktop'
  - 'web'
```

```ini
# .npmrc（根目录）
shamefully-hoist=false
strict-peer-dependencies=true
auto-install-peers=true
```

- `shamefully-hoist=false`：pnpm 默认行为，不提升依赖到根 `node_modules`，避免幽灵依赖。
- `strict-peer-dependencies=true`：peer 依赖不匹配时构建失败，防止运行时异常。
- `auto-install-peers=true`：自动安装缺失的 peer 依赖。

### 11.5 共享 tsconfig

```jsonc
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": false,      // 事件处理器签名允许省略参数
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noEmit": true                    // Vite 处理 emit
  }
}
```

### 11.6 Electron 主进程 tsconfig

```jsonc
// desktop/electron/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "noEmit": false,
    "outDir": "../dist-electron",
    "types": ["node"]
  },
  "include": ["**/*.ts"]
}
```

注意：Electron 主进程的 `target` 保持 ES2022（对应 Node 20 内置能力），不使用 ES2023/ES2024 新特性。

### 11.7 Electron Builder 配置

```yaml
# desktop/electron-builder.yml
appId: com.coagent.interview-assistant
productName: AI面试助手
directories:
  output: release
files:
  - dist-electron/**/*
  - dist-renderer/**/*
  - package.json
# ── 可选：把 LibreOffice Portable 打入安装包 ──
# 如果不带，用户可以首次使用时按需下载
# extraResources:
#   - from: 'vendor/libreoffice-portable'
#     to: 'libreoffice'
#     filter: ['**/*']
asar:
  smartUnpack: true
win:
  target:
    - target: nsis
      arch:
        - x64
  icon: assets/icon.ico
  signAndEditExecutable: false
mac:
  target:
    - target: dmg
      arch:
        - x64
        - arm64
  icon: assets/icon.icns
  category: public.app-category.productivity
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  deleteAppDataOnUninstall: false
publish:
  provider: generic
  url: https://update.coagent.example.com
```

---

## 十二、后端需要的改动

| 改动 | 文件 | 优先级 |
|------|------|--------|
| WebSocket client_hello 增加 `"pc-windows"`/`"pc-macos"`/`"web"` 标识支持 | `routers/audio.py` | P0 |
| WebSocket 全局状态改为连接级别（当前 `_transcription_queue` 是全局单例） | `routers/audio.py` | P1 |
| 文件转换端点增加 CORS 支持（Web 端跨域） | `main.py` | P1 |
| 可选：WebSocket 认证（当前无） | `routers/audio.py` | P2 |
| 可选：email_service 改为 `asyncio.to_thread` 避免阻塞 | `services/email_service.py` | P2 |

---

## 十三、后端完全复用部分

以下后端模块**零改动即可复用**：

- `routers/auth.py` — 完整认证流程
- `routers/interview.py` — 面试历史 CRUD
- `routers/resume.py` — 简历上传/解析
- `routers/tools.py` — 文件转换（作为 Electron 本地转换的兜底）
- `routers/stt.py` — 批量 STT
- `services/llm_service.py` — DeepSeek LLM 服务
- `services/stt_streaming.py` — 火山引擎流式 ASR
- `services/asr_text_corrector.py` — ASR 文本纠错
- `services/auth_service.py` — 认证业务逻辑
- `services/tracks/` — 全部 7 个编程语言赛道
- `models/db_models.py` — 数据库模型
- `models/schemas.py` — Pydantic 协议定义
- `db.py` / `redis.py` — 基础设施

---

## 十四、实施路线图

### Phase 1：项目搭建（1-2 天）
- [ ] pnpm monorepo 初始化（desktop/、web/、shared/）
- [ ] Vite + TypeScript 配置
- [ ] Tailwind CSS 配置，映射 `theme.ts` 令牌
- [ ] 迁移 shared 层：api/、store/、utils/、config.ts、theme/

### Phase 2：核心音频采集（3-5 天）
- [ ] WASAPI Loopback Node addon（或集成 naudiodon）
- [ ] PcmNormalizer 重写（JS/TS 版，和 Android 端字节级等价）
- [ ] PcmFrameAccumulator 重写
- [ ] AudioWireProtocol 重写（JS/TS 版，Big Endian 二进制编码）
- [ ] WebSocket 客户端（AudioStreamClient 的 TS 版）
- [ ] 主进程音频管理

### Phase 3：Electron 窗口管理（1-2 天）
- [ ] 主窗口（面试控制面板）
- [ ] AI 浮窗（ContentProtection 隐身）
- [ ] 系统托盘图标 + 菜单
- [ ] IPC 桥接（preload.ts）

### Phase 4：PC 端 UI 重构（4-6 天）
- [ ] 主窗口三栏布局框架（CSS Grid，响应式断点）
- [ ] 面试页 InterviewScreen（对话面板 + 控制栏 + 上下文栏）
- [ ] AI 浮窗（独立窗口，仅 AI 答案，ContentProtection 隐身）
- [ ] 工具箱页 ToolsScreen（左栏列表 + 右栏操作区）
- [ ] 个人中心页 ProfileScreen（个人信息 + 偏好设置双栏）
- [ ] 面试历史页 InterviewHistoryScreen（表格布局 + 详情展开）
- [ ] 认证页 AuthScreen（居中卡片布局，非移动全屏）
- [ ] 对话气泡组件 ConversationBubble（流式文本动画，framer-motion）
- [ ] 弹窗组件 AppAlert（Portal + 遮罩 + ESC 关闭）
- [ ] 导航组件（Toolbar 或侧边栏，替代底部 Tab Bar）
- [ ] 键盘快捷键注册（全局 + 面试页专用）
- [ ] 响应式适配（< 600px 回退到移动端单栏风格）

### Phase 5：文件转换集成（1-2 天）
- [ ] LibreOffice 检测策略实现（系统安装 → portable → 服务端 API 三级回退）
- [ ] IPC 封装（`file:convert` / `file:pick` / `file:save`）
- [ ] UI 集成（替换现有服务端上传逻辑）
- [ ] LibreOffice Portable 打包策略决策（默认不带 / 按需下载 / 可选带）

### Phase 6：Web 端独立开发（2-3 天）
- [ ] Vite web 项目配置
- [ ] getUserMedia 麦克风采集
- [ ] WebSocket 客户端接入
- [ ] 所有页面（复用 shared UI 组件）
- [ ] 构建部署

### Phase 7：打包发布（1-2 天）
- [ ] electron-builder 配置（Windows + macOS）
- [ ] 自动更新（electron-updater）
- [ ] Web 端部署

---

## 十五、风险与注意事项

1. **AudioWireProtocol 字节级兼容**：这是最容易出错的地方。建议写跨平台测试——同一段 PCM 输入，验证 Android 和 PC 产出相同的二进制帧。后端 `audio_service.py` 的 `AudioPacketHeader` 可以做验证。

2. **Electron 版本锁定**：ContentProtection 在不同 Electron 版本行为不一致（35.x 黑块回归、33.x hide 后失效），建议锁定 32.x LTS。

3. **WASAPI addon 编译**：C++ addon 需要在各平台编译，macOS 需要 Xcode，Windows 需要 VS Build Tools。建议 CI/CD 中实现跨平台构建矩阵。

4. **LibreOffice 依赖**：不是所有用户装了 LibreOffice。优雅降级到服务端 API 是必须的。

5. **Web 端 CORS**：如果 Web 部署在不同域名，需要后端添加 CORS 中间件。

6. **后端全局状态问题**：`routers/audio.py` 中的 `_transcription_queue` 是全局变量，多连接时会冲突。Phase 1 就应修复。

---

## 十六、验证方案

### 16.1 单元测试
- `AudioWireProtocol.encode/decode` 往返测试（和 Android 端捕获的二进制帧对比）
- `PcmNormalizer` 输出一致性测试
- `interview-reducer` 状态转换测试（所有 Action 类型）
- API client 错误处理测试

### 16.2 集成测试
- WebSocket 握手 → 实时帧发送 → ASR 结果返回 → LLM 结果返回（完整链路）
- 文件转换：LibreOffice 本地 → 服务端 API 兜底切换
- ContentProtection：用 OBS 录屏验证浮窗不可见

### 16.3 E2E 测试
- 完整面试流程：登录 → 选择语言 → 开启采集 → 说话 → 收到 ASR 转写 → 收到 AI 回答 → 结束 → 保存历史
- 文件转换流程：选择文件 → 转换 → 保存本地

---

## 十七、稳定开发环境指南

> 适用项目：Electron 桌面端 + Vite Web 端 monorepo  
> 适用系统：Windows 10/11 64 位（macOS 参考但路径不同）  
> 目标：能够通过 pnpm 稳定完成依赖安装、TypeScript 编译、Vite 开发服务器启动、Electron 主进程运行、打包 exe/dmg 及日常前端开发  
> 基线日期：2026-07-31  
> Node 基线：`22.23.1 LTS`

### 17.1 系统前提

#### Windows

| 工具 | 版本 | 用途 | 安装方式 |
|------|------|------|---------|
| Windows 10 / 11 | 64 位，build 19041+ | 运行环境 | — |
| Git | 最新版 | 版本管理 | `winget install Git.Git` |
| Visual Studio Build Tools 2022 | 最新 | C++ addon 编译（WASAPI） | `winget install Microsoft.VisualStudio.2022.BuildTools` |
| Python 3.11+ | 3.11.x | node-gyp 依赖 | `winget install Python.Python.3.11` |
| LibreOffice | 25.2（可选） | 本地文件转换 | `winget install TheDocumentFoundation.LibreOffice` |
| Pandoc | 3.6（可选） | 格式转换 | `winget install Pandoc.Pandoc` |

Visual Studio Build Tools 安装时**必须勾选 "使用 C++ 的桌面开发" 工作负载**，包含 MSVC v143 编译器和 Windows 11 SDK。

```powershell
# 验证
git --version
python --version    # 3.11+
```

#### macOS

| 工具 | 版本 | 用途 | 安装方式 |
|------|------|------|---------|
| Xcode Command Line Tools | 最新稳定 | C++ addon 编译 | `xcode-select --install` |
| LibreOffice | 25.2（可选） | 本地文件转换 | `brew install --cask libreoffice` |
| Pandoc | 3.6（可选） | 格式转换 | `brew install pandoc` |

### 17.2 安装 Node.js 22.23.1

#### Windows（nvm-windows）

```powershell
nvm install 22.23.1
nvm use 22.23.1

node -v     # → v22.23.1
npm -v      # → 10.9.x（Node 22 自带）
where node  # → 确保只有一条路径
```

如果 `where node` 返回多个安装目录，清理旧 Node 安装或 PATH 冲突。

#### macOS（nvm）

```bash
nvm install 22.23.1
nvm use 22.23.1
nvm alias default 22.23.1

node -v     # → v22.23.1
```

#### 验证 npm 版本

```powershell
npm -v
# 应为 10.9.x（Node 22.23.1 自带）
# 不要手动升级到 npm 11，npm 11 更改了 lockfile 格式
```

### 17.3 安装 pnpm 9.15.0

```powershell
npm install -g pnpm@9.15.0

pnpm -v     # → 9.15.0
```

**不要**用 `corepack enable` 管理 pnpm 版本。Corepack 在 Node 22 中标记为实验性，且可能自动使用 pnpm 10。固定全局安装 `9.15.0` 并通过 `packageManager` 字段声明。

### 17.4 项目初始化

#### 1. 创建项目目录结构

```powershell
# 在 agent_app/workspace/fe 下创建
cd f:\CoAgent\agent_app\workspace\fe
mkdir desktop\electron              # Electron 主进程
mkdir desktop\src                   # Electron 渲染进程
mkdir web\src                       # Web 端
mkdir shared\src                    # 共享代码
```

项目必须放在**短路径、纯英文目录**中：

```text
f:\CoAgent\agent_app\workspace\fe\desktop       ✅
f:\CoAgent\agent_app\workspace\fe\web           ✅
f:\CoAgent\agent_app\workspace\fe\shared        ✅
```

避免：
- 中文目录名
- 空格（`C:\Program Files\...`）
- 过深目录（`C:\Users\...\Documents\Projects\...`）
- OneDrive 同步目录
- 网络磁盘（`\\server\share\...`）

#### 2. 根 package.json

```json
{
  "name": "coagent-monorepo",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "engines": {
    "node": ">=22.23.1 <23",
    "pnpm": ">=9.15.0 <10"
  },
  "scripts": {
    "dev:web": "pnpm -r --filter @coagent/web dev",
    "dev:electron": "pnpm -r --filter @coagent/electron dev",
    "build:shared": "pnpm -r --filter @coagent/shared build",
    "build:web": "pnpm -r --filter @coagent/web build",
    "build:electron": "pnpm -r --filter @coagent/electron build",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint"
  }
}
```

#### 3. 项目级 .nvmrc

```text
22.23.1
```

#### 4. 各子包 package.json

**shared/package.json：**

```json
{
  "name": "@coagent/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./api/*": "./src/api/*.ts",
    "./store/*": "./src/store/*.ts",
    "./utils/*": "./src/utils/*.ts",
    "./theme/*": "./src/theme/*.ts",
    "./types/*": "./src/types/*.ts"
  },
  "peerDependencies": {
    "react": "19.0.0"
  },
  "devDependencies": {
    "typescript": "5.6.3"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

**desktop/package.json（关键依赖）：**

```json
{
  "name": "@coagent/electron",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist-electron/main/index.js",
  "scripts": {
    "dev": "vite",
    "build": "npm run build:renderer && npm run build:main && electron-builder",
    "build:renderer": "vite build",
    "build:main": "tsc -p electron/tsconfig.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint ."
  },
  "dependencies": {
    "@coagent/shared": "workspace:*",
    "eventemitter3": "5.0.1",
    "electron-store": "10.0.0",
    "electron-updater": "6.3.9",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "react-router-dom": "7.1.1",
    "framer-motion": "11.15.0"
  },
  "devDependencies": {
    "electron": "32.2.8",
    "electron-builder": "25.1.8",
    "vite": "6.0.5",
    "@vitejs/plugin-react": "4.3.4",
    "typescript": "5.6.3",
    "vitest": "2.1.8",
    "eslint": "9.16.0",
    "prettier": "3.4.2",
    "node-gyp": "11.0.0",
    "node-abi": "3.71.0"
  }
}
```

**web/package.json（关键依赖）：**

```json
{
  "name": "@coagent/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 5173",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint ."
  },
  "dependencies": {
    "@coagent/shared": "workspace:*",
    "eventemitter3": "5.0.1",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "react-router-dom": "7.1.1",
    "framer-motion": "11.15.0"
  },
  "devDependencies": {
    "vite": "6.0.5",
    "@vitejs/plugin-react": "4.3.4",
    "typescript": "5.6.3",
    "tailwindcss": "3.4.17",
    "postcss": "8.4.49",
    "autoprefixer": "10.4.20",
    "vitest": "2.1.8",
    "@testing-library/react": "16.1.0",
    "eslint": "9.16.0",
    "prettier": "3.4.2"
  }
}
```

所有依赖均使用**精确版本号**（不带 `^` 或 `~`），通过 `package.json` 中的 `"pnpm.overrides"` 在根级别防止子依赖漂移。

#### 5. 首次依赖安装

```powershell
# 在项目根目录执行
pnpm install

# 验证所有 workspace 包已链接
pnpm ls -r --depth 0
```

预期输出包含三个包：
```text
@coagent/shared@0.1.0
@coagent/electron@0.1.0
@coagent/web@0.1.0
```

**不要**：
- 删除 `pnpm-lock.yaml` 后随意重新解析依赖
- npm、Yarn、pnpm 混用
- 使用 `pnpm update` 批量更新依赖

### 17.5 Tailwind CSS 配置

```js
// tailwind.config.js（desktop 和 web 各自一份，内容共享）
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',  // 手动切换，不依赖 prefers-color-scheme
  theme: {
    extend: {
      colors: {
        // 从 shared/theme/tokens.ts 映射
        bg: 'var(--color-bg)',
        'bg-surface': 'var(--color-bg-surface)',
        accent: 'var(--color-accent)',
        'accent-light': 'var(--color-accent-light)',
        'accent-soft': 'var(--color-accent-soft)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-tertiary': 'var(--color-text-tertiary)',
        divider: 'var(--color-divider)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '14px',
        xl: '18px',
        full: '9999px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(0,0,0,0.05)',
        md: '0 2px 8px rgba(0,0,0,0.08)',
        lg: '0 4px 16px rgba(0,0,0,0.12)',
      },
      fontSize: {
        caption: ['12px', { lineHeight: '16px' }],
        'body-sm': ['13px', { lineHeight: '18px' }],
        body: ['15px', { lineHeight: '22px' }],
        heading: ['20px', { lineHeight: '28px' }],
        title: ['22px', { lineHeight: '30px' }],
      },
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
        '2xl': '28px',
        '3xl': '36px',
      },
    },
  },
  plugins: [],
};
```

```js
// postcss.config.js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

### 17.6 Vite 配置

#### Electron 渲染进程

```typescript
// desktop/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: '.',
  base: './',  // Electron 用相对路径加载
  build: {
    outDir: 'dist-renderer',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@coagent/shared': path.resolve(__dirname, '../shared/src'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
```

#### Web

```typescript
// web/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: '.',
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@coagent/shared': path.resolve(__dirname, '../shared/src'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: 'COAGENT_',
});
```

### 17.7 ESLint + Prettier 配置

ESLint 使用扁平配置格式（ESLint 9.x 默认）：

```javascript
// eslint.config.js（根目录，所有子包继承）
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      'react/react-in-jsx-scope': 'off',   // React 19 不需要 import React
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
  {
    ignores: ['**/dist*/**', '**/node_modules/**', '**/*.js', '**/*.cjs'],
  },
];
```

Prettier 配置保持和现有 RN 项目一致：

```javascript
// .prettierrc.js
module.exports = {
  arrowParens: 'avoid',
  bracketSameLine: true,
  bracketSpacing: false,
  singleQuote: true,
  trailingComma: 'all',
  tabWidth: 2,
  printWidth: 100,
};
```

### 17.8 首次启动验证

完成项目初始化后，按顺序验证以下步骤全部通过：

#### Step 1：共享包类型检查

```powershell
cd f:\CoAgent
pnpm typecheck
```

预期：所有 workspace 包 TypeScript 编译无错误。

#### Step 2：Web 开发服务器

```powershell
cd f:\CoAgent
pnpm dev:web
```

浏览器访问 `http://localhost:5173`，应能看到空页面（无控制台错误）。

#### Step 3：Electron 开发模式启动

```powershell
cd f:\CoAgent
pnpm dev:electron
```

预期：Electron 主窗口正常显示，DevTools 无错误。

#### Step 4：Electron ContentProtection 验证

1. 启动 Electron App
2. 打开 OBS Studio 或 Windows 截图工具
3. 确认 Electron 窗口在截图/录屏中**不可见**（或被覆盖为黑色/无内容）

#### Step 5：Web 端构建

```powershell
cd f:\CoAgent
pnpm build:web
```

预期：`web/dist/` 目录生成，包含 `index.html` + JS/CSS 资源。

#### Step 6：Electron 打包

```powershell
cd f:\CoAgent
pnpm build:electron
```

预期：`desktop/release/` 目录生成 `.exe`（Windows）或 `.dmg`（macOS）。

### 17.9 路由导航快捷键验证

在 Electron 开发模式下验证以下快捷键工作正常：

| 快捷键 | 功能 | 预期行为 |
|--------|------|---------|
| `Ctrl + Tab` | 下一个 Tab | 面试 → 工具箱 → 我的 |
| `Ctrl + Shift + Tab` | 上一个 Tab | 反向切换 |
| `Ctrl + B` | 切换浮窗显示 | AI 浮窗显示/隐藏 |
| `Ctrl + Shift + A` | 始终置顶 | 主窗口置顶/取消 |
| `Ctrl + Shift + P` | ContentProtection | 开关窗口隐身 |

### 17.10 开发工作流

日常开发流程（和 RN 项目截然不同——不需要 Metro、不需要 Gradle、不需要 Android Studio）：

```powershell
# 终端 A：开发服务
cd f:\CoAgent
pnpm dev:electron    # 或 pnpm dev:web

# 终端 B：TypeScript 守护
cd f:\CoAgent
pnpm typecheck --watch
```

日常 JS/TS 开发验证：

1. 修改组件代码。
2. Vite HMR 自动刷新（Electron renderer 和 Web 端均支持）。
3. 查看终端 TypeScript 编译结果。
4. Electron DevTools（`Ctrl+Shift+I`）检查 Console/Network/React Components。

只有在以下情况才进行完整清理：

- 切换 Node 大版本
- 新增或升级原生依赖（Electron 主进程）
- 新增 node-gyp 编译的 native addon
- 修改 pnpm workspace 结构
- 修改 TypeScript target 或 moduleResolution

清理命令：

```powershell
# 删除所有构建产物和依赖
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force desktop\node_modules -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force web\node_modules -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force shared\node_modules -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force desktop\dist-renderer -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force desktop\dist-electron -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force desktop\release -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force web\dist -ErrorAction SilentlyContinue

# 清理 pnpm store（仅在明确出现缓存问题时）
pnpm store prune

# 重新安装
pnpm install --frozen-lockfile
```

### 17.11 常见问题定位

#### Node 版本不正确

```powershell
node -v
# 不是 22.23.1？→ nvm use 22.23.1
# nvm 未安装该版本？→ nvm install 22.23.1
```

#### pnpm 版本不正确

```powershell
pnpm -v
# 不是 9.15.0？→ npm install -g pnpm@9.15.0
# Corepack 干扰？→ corepack disable
```

#### `MODULE_NOT_FOUND` 找不到 shared 包

```powershell
pnpm install --frozen-lockfile
# 确保 pnpm-workspace.yaml 包含 shared 包目录
# 确保 package.json 中使用 "workspace:*" 协议
```

#### Electron ContentProtection 效果不正常

检查：
1. Electron 版本是否为 `32.2.8`（`node_modules/.pnpm/electron@...`）
2. 主窗口是否调用了 `setContentProtection(true)`
3. Windows 10 build 是否 ≥ 19041（`winver` 命令查看）
4. 截图工具是否使用标准截屏 API（OBS/截图工具可验证，硬件采集卡不可验证）

#### TypeScript 报 `Cannot find module '@coagent/shared'`

```powershell
# 检查 shared 包的 exports 字段
# 确认 tsconfig 中有 paths 或使用 pnpm workspace 协议解析
pnpm typecheck
```

#### Vite 端口被占用

```powershell
# 查看占用 5173 端口的进程
netstat -ano | findstr :5173

# 杀掉对应 PID
taskkill /PID <PID> /F
```

### 17.12 禁止事项

为了维持稳定环境，不要：

1. 使用 Node 21、Node 23 或其他非 LTS 版本。
2. 将 pnpm 升级到 10.x（peer 依赖和 workspace 解析行为改变）。
3. 将 Electron 升级到 33.x（ContentProtection hide 后丢失）或 35.x（黑块回归）。
4. 将 Tailwind 升级到 v4（API 和 PostCSS 依赖大幅变化）。
5. 删除 `pnpm-lock.yaml` 后随意重新安装。
6. 混用 npm、Yarn 和 pnpm。
7. 在 Electron 主进程中使用 Node 22+ API（Electron 32 内建 Node 20）。
8. 在项目中硬编码本地代理端口或绝对路径。
9. 同时升级 React、TypeScript、Vite、Electron——每次只升级一个并全面验证。
10. 将项目放在中文、空格或过深目录中。
11. 接受 IDE 的自动依赖升级建议（VS Code 的 Version Lens、Renovate 等）。
12. 使用 `pnpm update` 批量更新所有依赖。

### 17.13 验收清单

完成环境配置和首次构建后，必须逐项通过：

#### 环境

- [ ] `node -v` 输出 `v22.23.1`
- [ ] `pnpm -v` 输出 `9.15.0`
- [ ] `pnpm typecheck` 所有包无错误
- [ ] `pnpm ls -r --depth 0` 显示三个 workspace 包

#### Web 端

- [ ] `pnpm dev:web` 启动成功
- [ ] 浏览器访问 `http://localhost:5173` 正常
- [ ] HMR 修改代码后自动刷新
- [ ] `pnpm build:web` 生成 `web/dist/` 产物

#### Electron 桌面端

- [ ] `pnpm dev:electron` 启动成功
- [ ] 主窗口正常显示、无崩溃
- [ ] DevTools 可以打开（`Ctrl+Shift+I`）
- [ ] `setContentProtection(true)` 窗口在截屏中不可见
- [ ] 浮窗 overlay 正常显示和关闭
- [ ] `pnpm build:electron` 生成 `.exe`（Windows）或 `.dmg`（macOS）

#### 代码规范

- [ ] ESLint 对所有包无错误
- [ ] Prettier 格式化一致
- [ ] 无 `console.log` 残留（除 `eslint-disable` 外）

全部通过后，即可认定 Electron + Web 开发、构建和日常前端开发链路已经跑通。

---

## 十八、官方参考

- Node.js 版本生命周期：<https://nodejs.org/en/about/previous-releases>
- Electron 32.x 发布说明：<https://www.electronjs.org/docs/latest/api/structures>
- Electron ContentProtection 文档：<https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable>
- pnpm workspace 文档：<https://pnpm.io/workspaces>
- Vite 配置文档：<https://vite.dev/config/>
- Tailwind CSS 3.x 文档：<https://tailwindcss.com/docs/installation>
- electron-builder 文档：<https://www.electron.build/>
- TypeScript 5.6 发布说明：<https://devblogs.microsoft.com/typescript/announcing-typescript-5-6/>
- React 19 升级指南：<https://react.dev/blog/2024/12/05/react-19>
- ESLint 9.x 扁平配置：<https://eslint.org/docs/latest/use/configure/configuration-files>
