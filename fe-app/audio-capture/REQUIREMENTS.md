# AudioCapture RN CLI 重构需求文档

## 项目概述

将 `poc-audio-capture`（原 Expo 架构）重构为 **React Native CLI** 架构，部署在 `f:/CoAgent/fe-app/`，目标平台为 **Android**，用于 Android Studio 测试与打包。

---

## 1. 技术约束

| 约束项 | 值 | 说明 |
|---|---|---|
| **Node.js** | v21.0.0 | 不可降级 |
| **npm** | 10.2.0 | 随 Node 21 内置 |
| **React** | 18.x | 用户明确要求 |
| **RN 框架** | 0.76.x（稳定版） | 兼容 Node 21，React 18 的成熟版本 |
| **架构** | RN CLI（非 Expo） | 用于 Android Studio 直接构建 |
| **语言** | TypeScript 5.x | 严格模式 |
| **网络协议** | HTTPS | GitHub 等外部连接使用 HTTPS |

---

## 2. 保留功能清单（从原项目迁移）

### 2.1 音频采集核心
- [x] 双路音频采集：**麦克风** / **系统内部音频** / **双路并行**
- [x] 采样率 16000Hz，单声道，PCM 16bit
- [x] Android `AudioPlaybackCapture` API（Android 10+）
- [x] `MediaProjection` 授权流程（系统音频采集必需）
- [x] `RECORD_AUDIO` 运行时权限请求
- [x] 实时音量电平获取（轮询 100ms）
- [x] 采集输出 PCM 文件路径获取

### 2.2 原生模块桥接
- [x] TypeScript → NativeModules 桥接层
- [x] 完整的类型定义（AudioCaptureConfig, AudioLevels, OutputFiles 等）
- [x] fallback 机制（原生模块不可用时优雅降级）

### 2.3 UI 组件
- [x] **StatusLight** — 采集状态指示灯（脉冲呼吸动画）
- [x] **Timer** — 采集时长计时器（HH:MM:SS）
- [x] **VolumeBar** — 音量条形图（动画驱动）
- [x] **AudioVisualizer** — 均衡器风格 5 柱可视化（双路支持）
- [x] **StreamingControl** — WebSocket 连接控制面板
- [x] **FileInfo** — 输出文件路径展示
- [x] 采集源选择 Chip 组（mic / system / both）
- [x] 配置参数卡片
- [x] 设备兼容性检测卡片
- [x] 错误信息展示
- [x] 暗黑/浅色模式自适应

### 2.4 WebSocket 流式传输
- [x] WebSocket 连接管理（connect/disconnect）
- [x] 配置握手协议（发送采样率/位深/声道数）
- [x] PCM 帧分片发送（640 bytes/frame @ 20ms）
- [x] 流式传输统计（字节数、帧数、时长）
- [x] 文件模式流式推送（读取 PCM 文件 → 逐帧发送）

### 2.5 工具能力
- [x] TypeScript 类型检查
- [x] ESLint + Prettier 代码规范

---

## 3. 与原项目的差异

| 方面 | 原项目 (Expo) | 新项目 (RN CLI) |
|---|---|---|
| 构建系统 | Expo + eas build | Android Studio + Gradle |
| 原生模块注册 | expo-modules-core | RN 标准 NativeModule |
| 热更新 | expo-updates | Metro 标准 |
| 图标/启动屏 | Expo asset 系统 | Android mipmap/drawable |

---

## 4. 依赖选型（成熟优先）

| 依赖 | 版本 | 用途 |
|---|---|---|
| react | 18.3.1 | UI 框架 |
| react-native | 0.76.6 | RN 稳定版 |
| @react-navigation/native | ^6.1.18 | 导航容器 |
| @react-navigation/native-stack | ^6.9.26 | 原生堆栈导航 |
| react-native-gesture-handler | ~2.20.0 | 手势处理 |
| react-native-reanimated | ~3.16.0 | 动画引擎 |
| react-native-safe-area-context | ~4.12.0 | 安全区域 |
| react-native-screens | ~4.4.0 | 原生屏幕 |
| typescript | ~5.3.3 | 类型系统 |

> 版本号经过与 RN 0.76.6 兼容矩阵校验，确保无冲突。

---

## 5. 目录结构（目标）

```
fe-app/
├── android/                  # Android 原生工程
├── src/
│   ├── App.tsx               # 入口
│   ├── features/
│   │   └── audio-capture/
│   │       ├── screen.tsx    # 主屏幕
│   │       ├── components/
│   │       │   ├── AudioVisualizer.tsx
│   │       │   ├── FileInfo.tsx
│   │       │   ├── StatusLight.tsx
│   │       │   ├── StreamingControl.tsx
│   │       │   ├── Timer.tsx
│   │       │   └── VolumeBar.tsx
│   │       └── hooks/
│   │           └── useAudioStreamer.ts
│   ├── modules/
│   │   └── audio-capture/
│   │       ├── index.ts
│   │       └── src/
│   │           ├── AudioCapture.types.ts
│   │           └── AudioCaptureModule.ts
│   └── types/
│       └── env.d.ts
├── package.json
├── tsconfig.json
├── babel.config.js
├── metro.config.js
├── index.js
├── app.json
├── REQUIREMENTS.md           # 本文档
└── TASK_PLAN.md             # 任务计划
```

---

## 6. 验收标准

1. ✅ `npx react-native run-android` 可在 Android 模拟器/真机启动
2. ✅ TypeScript 编译零错误
3. ✅ Android Studio 可打开 `fe-app/android/` 目录直接构建
4. ✅ 所有 2.1-2.5 功能点可用
5. ✅ UI 与原项目视觉一致
