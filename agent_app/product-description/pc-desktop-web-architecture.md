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
# pnpm-workspace.yaml
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
cd f:\CoAgent
mkdir desktop\electron              # Electron 主进程
mkdir desktop\src                   # Electron 渲染进程
mkdir web\src                       # Web 端
mkdir shared\src                    # 共享代码
```

项目必须放在**短路径、纯英文目录**中：

```text
f:\CoAgent\desktop        ✅
f:\CoAgent\web            ✅
f:\CoAgent\shared         ✅
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
