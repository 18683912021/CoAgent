# AudioCapture RN CLI 重构任务计划

## 执行策略

- 命令**一个一个执行**，确认成功后再执行下一个
- 遇到错误**立即修正**，不跳过
- 网络连接使用 **HTTPS**
- 依赖版本**预先校验兼容性**，避免冲突

---

## 任务分解

### Phase 1：RN CLI 项目初始化

#### Task 1.1 — 使用 RN CLI 创建项目
- 命令：`npx @react-native-community/cli@15 init AudioCapturePoC --directory fe-app --version 0.76.6 --skip-git-init --skip-install`
- 目的：生成标准 RN CLI 项目骨架（android/、ios/、index.js、metro/babel 配置等）
- 验证：检查 `fe-app/package.json`、`fe-app/android/` 是否存在
- 注意：`--skip-git-init` 因为 fe-app 已在 CoAgent git 仓库内；`--skip-install` 允许我们单独控制安装步骤

#### Task 1.2 — 安装 npm 依赖
- 命令：`npm install`（在 fe-app 目录内）
- 目的：安装 RN 初始模板依赖
- 验证：`node_modules/` 生成，无错误

#### Task 1.3 — 验证项目骨架
- 检查所有关键文件存在：`index.js`、`App.tsx`、`babel.config.js`、`metro.config.js`、`tsconfig.json`
- 检查 `android/` Gradle 工程完整性

---

### Phase 2：安装业务依赖

#### Task 2.1 — 安装导航与 UI 依赖
```bash
npm install \
  @react-navigation/native@^6.1.18 \
  @react-navigation/native-stack@^6.9.26 \
  react-native-gesture-handler@~2.20.0 \
  react-native-reanimated@~3.16.0 \
  react-native-safe-area-context@~4.12.0 \
  react-native-screens@~4.4.0
```
- 目的：安装导航栈、手势、动画、安全区域等依赖
- 验证：`package.json` dependencies 更新，无 peer dependency 警告

#### Task 2.2 — 安装 TypeScript 类型依赖
```bash
npm install --save-dev \
  @types/react@~18.3.0 \
  typescript@~5.3.3
```
- 验证：TypeScript 编译器可用

---

### Phase 3：配置与源码迁移

#### Task 3.1 — 配置 babel（Reanimated 插件）
- 编辑 `babel.config.js`：添加 `react-native-reanimated/plugin`
- 目的：Reanimated 需要此插件作为 babel 最后一项

#### Task 3.2 — 配置 metro
- 编辑 `metro.config.js`：确认默认配置可用
- 目的：确保 Metro bundler 正确解析所有模块

#### Task 3.3 — 配置 tsconfig 路径别名
- 编辑 `tsconfig.json`：添加 `@features/*`、`@shared/*` 路径映射
- 目的：支持原项目的 import 路径风格

#### Task 3.4 — 迁移类型定义模块
- 创建 `src/modules/audio-capture/src/AudioCapture.types.ts`
- 内容：从原项目 Copy `CaptureSource`, `AudioCaptureConfig`, `AudioLevels`, `OutputFiles` 等类型

#### Task 3.5 — 迁移原生桥接模块
- 创建 `src/modules/audio-capture/src/AudioCaptureModule.ts`
- 创建 `src/modules/audio-capture/index.ts`
- 内容：`NativeModules.AudioCapture` 桥接类，与原项目一致

#### Task 3.6 — 迁移 WebSocket Hook
- 创建 `src/features/audio-capture/hooks/useAudioStreamer.ts`
- 内容：原项目完整 WebSocket 流式传输逻辑

#### Task 3.7 — 迁移 UI 组件（6 个）
依次创建：
1. `StatusLight.tsx` — 采集状态脉冲灯
2. `Timer.tsx` — 计时器
3. `VolumeBar.tsx` — 音量条动画
4. `AudioVisualizer.tsx` — 均衡器可视化
5. `FileInfo.tsx` — 文件路径展示
6. `StreamingControl.tsx` — WebSocket 控制面板

#### Task 3.8 — 迁移主屏幕
- 创建 `src/features/audio-capture/screen.tsx`
- 内容：完整主屏幕（采集源选择、可视化、控制按钮等），修正 import 路径

#### Task 3.9 — 迁移 App 入口
- 覆盖 `App.tsx`（RN CLI 生成的默认 App）
- 内容：NavigationContainer + GestureHandlerRootView + Stack Navigator

#### Task 3.10 — 配置 Android 原生端
- 编辑 `android/app/src/main/AndroidManifest.xml`：添加 `RECORD_AUDIO` 权限、`FOREGROUND_SERVICE` 权限
- 确认 `android/build.gradle` 和 `android/app/build.gradle` 配置正确

---

### Phase 4：原生模块（Android）

#### Task 4.1 — 创建 Android 原生音频捕获模块
- 创建 `android/app/src/main/java/com/audiocapturepoc/audiocapture/AudioCaptureModule.kt`
- 实现 `isSupported()`, `hasMediaProjection()`, `requestMediaProjection()`, `configure()`, `start()`, `stop()`, `getAudioLevels()`, `getOutputFiles()`
- 目的：在标准 RN NativeModule 中实现音频采集（替代 expo-module）

#### Task 4.2 — 创建 Android 原生模块 Package
- 创建 `AudioCapturePackage.kt`，注册 `AudioCaptureModule`

#### Task 4.3 — 注册原生模块到 MainApplication
- 编辑 `MainApplication.kt`：在 `getPackages()` 中添加 `AudioCapturePackage()`

---

### Phase 5：验证

#### Task 5.1 — TypeScript 类型检查
```bash
npx tsc --noEmit
```
- 目的：确保零类型错误

#### Task 5.2 — Metro bundler 启动测试
```bash
npx react-native start
```
- 目的：验证 Metro 能正确打包 JS bundle

#### Task 5.3 — Android 构建验证
```bash
cd android && ./gradlew assembleDebug
```
- 目的：验证完整 Android 构建通过

---

## 任务依赖关系

```
Task 1.1 ──► 1.2 ──► 1.3
                      │
                      ▼
               Task 2.1 ──► 2.2
                      │
                      ▼
               3.1, 3.2, 3.3（并行）
                      │
                      ▼
               3.4 ──► 3.5
                      │
                      ▼
               3.6（独立）
               3.7（独立）
                      │
                      ▼
               3.8 ──► 3.9 ──► 3.10
                      │
                      ▼
               4.1 ──► 4.2 ──► 4.3
                      │
                      ▼
               5.1 ──► 5.2 ──► 5.3
```

---

## 风险与对策

| 风险 | 对策 |
|---|---|
| RN 0.76.6 与 Node 21 不兼容 | 降级到 RN 0.75.4（兼容性更广） |
| npm 依赖冲突 | 逐个排查，使用 `--legacy-peer-deps` |
| Metro 无法解析路径别名 | 调整 `metro.config.js` 的 resolver |
| Android 原生模块编译失败 | 检查 Kotlin 版本、Gradle 插件版本 |
| 网络连接 GitHub 失败 | 检查 HTTPS 连通性，必要时配置代理 |
