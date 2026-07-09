# PoC: Audio Capture

验证系统音频采集技术路径。基于 rn-app-shell 壳子，注入 expo-module 原生音频采集模块。

## 技术路径
- **Android**: AudioPlaybackCapture API (Android 10+)
- **iOS**: AVAudioSession (stub, 后续接 ReplayKit)

## 快速开始
```bash
npm install
npx expo start
```

## 构建安装
```bash
npm run eas:build:dev    # development APK
npm run eas:build:preview # preview APK
```
