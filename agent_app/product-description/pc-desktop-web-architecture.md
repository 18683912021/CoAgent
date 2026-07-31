# AI 面试助手 — PC 桌面端 + Web 端 完整设计方案

## Context

当前项目是基于 React Native (Android) + FastAPI 的 AI 面试助手 App。由于 Android 平台对 VoIP 通话音频采集的系统级限制（`USAGE_VOICE_COMMUNICATION` 被框架禁止、App 主动设 `ALLOW_CAPTURE_BY_NONE`、VoIP 私有音频通道隔离），且 Android 不支持窗口隐身——本质上有两个核心能力在移动端无法实现。

本方案将产品从 Android 单平台扩展为 **Electron 桌面端（主力）+ Web 端（辅助）** 的双平台架构，利用 PC 操作系统的 WASAPI Loopback 系统音频采集和 `SetWindowDisplayAffinity` 窗口隐身 API，彻底解决移动端的两个根本限制。

### 设计目标

1. **Electron 桌面端**：聚焦面试场景，实现系统音频内录（WASAPI Loopback）、AI 浮窗隐身（ContentProtection）、本地文件转换（LibreOffice）
2. **Web 端**：独立于桌面端的辅助查看端，可单独用于面试（走麦克风采集），也可与桌面端协同
3. **代码复用最大化**：共享 API 层、状态管理（reducer）、主题系统、类型定义；仅 UI 渲染层和平台特定能力（音频采集/窗口管理/文件系统）分层实现
4. **后端几乎不变**：现有 FastAPI 服务（auth、ASR、LLM、interview、resume、tools）可直接复用，仅需少量适配（WebSocket client_hello 增加 `pc-windows`/`web` 标识）

---

## 一、项目结构

```
f:\CoAgent\
├── agent_app/                       # 现有 FastAPI 后端（基本不变）
├── desktop/                         # 🆕 Electron 桌面端
│   ├── package.json
│   ├── electron-builder.yml         # 打包配置
│   ├── electron/                    # 主进程代码
│   │   ├── main.ts                  # BrowserWindow 生命周期
│   │   ├── preload.ts               # 安全的 IPC 桥接
│   │   ├── windows/                 # 窗口管理
│   │   │   ├── main-window.ts       # 主窗口（配置/工具）
│   │   │   └── overlay-window.ts    # AI 浮窗（ContentProtection 隐身）
│   │   ├── audio/                   # 🆕 WASAPI 音频采集
│   │   │   ├── wasapi-capture.ts    # WASAPI loopback + 麦克风
│   │   │   ├── pcm-normalizer.ts    # 同 Android 的线性插值归一化
│   │   │   └── frame-accumulator.ts # 1280 字节帧累积
│   │   ├── stream/                  # WebSocket 客户端
│   │   │   ├── ws-client.ts         # 替换 Android AudioStreamClient
│   │   │   └── wire-protocol.ts     # 同 Android AudioWireProtocol
│   │   ├── file-convert/            # 本地文件转换
│   │   │   └── libreoffice.ts       # spawn LibreOffice/Pandoc
│   │   └── ipc-handlers.ts          # IPC 路由注册
│   ├── src/                         # 渲染进程（React，和 web/ 共享）
│   │   ├── main.tsx                 # React 入口
│   │   ├── App.tsx                  # 路由/布局
│   │   └── ...
│   └── vite.config.ts
├── web/                             # 🆕 Web 端
│   ├── package.json
│   ├── src/
│   │   ├── main.tsx                 # Web 入口
│   │   └── ...
│   ├── public/
│   └── vite.config.ts
├── shared/                          # 🆕 共享代码
│   ├── package.json
│   ├── api/                         # 从 fe-app/src/api/ 迁移
│   │   ├── client.ts                # fetch 封装（100% 复用）
│   │   ├── auth.ts                  # 认证 API
│   │   ├── interview.ts             # 面试 API
│   │   ├── resume.ts                # 简历 API
│   │   └── tools.ts                 # 工具 API（新增）
│   ├── store/                       # 纯 TS 状态管理
│   │   ├── interview-reducer.ts     # 从 useAudioCaptureController reducer 提取
│   │   └── types.ts                 # ConversationMessage 等共享类型
│   ├── utils/
│   │   ├── token-storage.ts         # 统一 token/profile 存储接口
│   │   ├── interview-state.ts       # 面试锁定状态（100% 复用）
│   │   └── auth-context.ts          # Auth React Context（100% 复用）
│   ├── theme/
│   │   ├── tokens.ts                # 颜色/间距/字体设计令牌
│   │   └── use-theme.ts             # 暗色模式 hook
│   ├── config.ts                    # 从 fe-app/src/config.ts 迁移
│   └── i18n/                        # 多语言（后续扩展）
│       ├── zh.json
│       └── en.json
├── fe-app/                          # 现有 Android RN 项目（保留，不再主力迭代）
└── docs/
    └── architecture.md              # 本文档
```

---

## 二、代码复用策略

### 2.1 从现有 RN 代码可 100% 复用的部分

| 源文件 | 迁移到 | 改动 |
|--------|--------|------|
| `fe-app/src/api/client.ts` | `shared/api/client.ts` | ⚪ 零改动 |
| `fe-app/src/api/auth.ts` | `shared/api/auth.ts` | ⚪ 零改动 |
| `fe-app/src/api/interview.ts` | `shared/api/interview.ts` | 提取 ConversationMessage 类型到 `shared/store/types.ts` |
| `fe-app/src/api/resume.ts` | `shared/api/resume.ts` | ⚪ 零改动 |
| `fe-app/src/utils/interviewState.ts` | `shared/utils/interview-state.ts` | ⚪ 零改动 |
| `fe-app/src/utils/AuthContext.ts` | `shared/utils/auth-context.ts` | ⚪ 零改动 |
| `fe-app/src/theme.ts` | `shared/theme/tokens.ts` + `use-theme.ts` | 替换 RN shadow 为 CSS box-shadow |
| `fe-app/src/config.ts` | `shared/config.ts` | 替换硬编码 IP 为环境变量 |
| `useAudioCaptureController` 中的 reducer | `shared/store/interview-reducer.ts` | 提取纯函数，去除 RN 依赖 |

### 2.2 需要平台适配的部分

```
shared/utils/token-storage.ts       # 定义接口
  ├── desktop/electron/storage.ts   # Electron: localStorage 或 electron-store
  └── web/src/storage.ts            # Web: localStorage
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

### 4.5 双屏辅助方案

如果用户有两个显示器，AI 浮窗可以直接放在副屏上，主屏共享 IDE/代码给面试官，副屏永远不被共享——**和 ContentProtection 形成双重保险**。

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
| 窗口隐身 | ❌ | 纯 Web 无法实现（可通过放在副屏缓解） |
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

## 八、共享 UI 组件映射

### 8.1 React Native → React DOM 映射表

| RN 组件 | React DOM 等价 | 备注 |
|---------|---------------|------|
| `<View>` | `<div>` | 使用 CSS `display: flex` 默认 |
| `<Text>` | `<p>` / `<span>` | 不带默认样式 |
| `<TouchableOpacity>` | `<button>` 或 `<div onClick>` | 用 CSS `:active` 实现按压效果 |
| `<Pressable>` | `<div onClick onKeyDown>` | 需额外处理键盘可访问性 |
| `<ScrollView>` | `<div style={{overflow:'auto'}}>` | 或用 CSS `overflow-y: auto` |
| `<FlatList>` | 普通 `.map()` + `<div>` | 长列表可用 `react-window` 虚拟化 |
| `<TextInput>` | `<input type="text">` | 或用 `<textarea>` |
| `<Modal>` | 自定义 Portal + 遮罩 | 使用 `ReactDOM.createPortal()` |
| `<ActivityIndicator>` | CSS spinner | 简单的 `@keyframes spin` 动画 |
| `<SafeAreaView>` | CSS `env(safe-area-inset-*)` | 移动端 Web 可用 |
| `<Animated.View>` | CSS `transition` / `@keyframes` | 或用 `framer-motion` |
| `StyleSheet.create` | CSS Modules 或 Tailwind CSS | 选一个固定的样式方案 |

### 8.2 样式方案：Tailwind CSS

推荐使用 Tailwind CSS 替代 RN 的 `StyleSheet.create`，原因：
- 和现有 `theme.ts` 的设计令牌可以完美映射到 Tailwind 配置
- 组件样式简洁直观
- 桌面端和 Web 端共用同一套 Tokens

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        // 从 shared/theme/tokens.ts 导入
        bg: 'var(--color-bg)',
        'bg-surface': 'var(--color-bg-surface)',
        accent: 'var(--color-accent)',
        // ...
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '14px',
        xl: '18px',
        full: '9999px',
      },
    },
  },
};
```

### 8.3 主题系统

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
  
  // 应用到 CSS 自定义属性
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

Android 端 `useAudioCaptureController.ts` 中有约 200 行的**纯 reducer 函数**，可以完整提取到 `shared/store/interview-reducer.ts`：

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

## 十一、构建和打包

### 11.1 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 包管理 | pnpm | monorepo workspace |
| 构建工具 | Vite | 快速 HMR，Electron + Web 共用 |
| 桌面端框架 | Electron 32.x | 稳定版，ContentProtection 无回归 |
| 桌面打包 | electron-builder | Windows NSIS / macOS DMG |
| 样式 | Tailwind CSS | 映射 theme.ts 设计令牌 |
| 类型 | TypeScript 5.x | 严格模式 |
| Node addon 编译 | node-gyp / cmake-js | WASAPI C++ addon |

### 11.2 Monorepo 配置

```json
// pnpm-workspace.yaml
packages:
  - 'shared'
  - 'desktop'
  - 'web'
```

### 11.3 共享 tsconfig

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
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

### Phase 4：共享 UI 重构（3-5 天）
- [ ] Auth 页面（登录/注册）
- [ ] Interview 页面（对话气泡、流式文本、电平表）
- [ ] Tools 页面（随机出题、文件转换）
- [ ] Profile 页面（用户信息、偏好、简历）
- [ ] Interview History 页面
- [ ] 导航组件（同 RN TabNavigator 的三栏结构）

### Phase 5：文件转换集成（1 天）
- [ ] LibreOffice 检测 + spawn
- [ ] IPC 封装
- [ ] UI 集成（替换现有服务端上传逻辑）

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
