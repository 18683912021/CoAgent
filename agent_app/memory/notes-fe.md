- **[07-09 11:04]** Android 10 引入的隐私保护机制——App 可以通过 `allowAudioPlaybackCapture="false"` 拒绝音频被采集。腾讯会议/飞书等企业通讯 App 大概率设了 false，不是我们能控制的
- **[07-09 17:40]** AudioRecord 初始化失败直接崩的根因已定位——原生层缺少运行时权限检查和异常保护
- **[07-14 10:20]** [队友] 酱瓜 完成「记得记得，之前光顾着对端口对路径，语气干得跟接口文档似的 😂」

- **[07-14 10:21]** [归档] 2. 🛑 卡壳就停——技术走不通立刻群里抛问题等 boss 判断，别换任务绕道。这条已写入铁律 #14

- **[07-14 11:21]** [归档] boss 你打包测试的节奏不变，小柯做好可视化界面你就能直观看到采集状态了 🫡

- **[07-14 11:33]** [压缩锚点] 📁 文件: app/build.gradle、components/StreamingControl.tsx、hooks/useAudioStreamer.ts、src/App.tsx
🔌 端口: 8010
⚙️ 服务: docker, expo
✍️ 决策: * ✅

@酱瓜 你确认下 WebSocket 端点路径是 `/api/ws/audio/stream` 没变？是的话我这边直接连 `ws:；OTA 配套的版本锁定 |
| `extra.eas` | EAS 项目 ID |

—— 回答你：**完全不影响。** 两张图说清楚：

- **[07-14 11:36]** [压缩锚点] 📁 文件: app/build.gradle、components/StreamingControl.tsx、hooks/useAudioStreamer.ts、src/App.tsx、workspace/fe/rn-app-shell、workspace/fe/rn-app-shell/android/app/src/main/java/com/poc/MainActivity.kt、workspace/fe/rn-app-shell/android/app/src/main/java/com/poc/MainApplication.kt
🔌 端口: 8010
⚙️ 服务: docker, expo
✍️ 决策: * ✅

@酱瓜 你确认下 WebSocket 端点路径是 `/api/ws/audio/stream` 没变？是的话我这边直接连 `ws:；；OTA 配套的版本锁定 |
| `extra.eas` | EAS 项目 ID |

—— 回答你：**完全不影响。** 两张图说清楚：

- **[07-14 13:48]** [归档] @AI小柯（前端） 音频格式咱们对齐一下：16kHz / 16bit / 单声道 PCM，你看行不行？这是腾讯云 ASR 的标准入参，也是通用格式，你那边 PCM 流直接按这个规格出就行。通信方式我倾向 WebSocket——你推流我收流，实时性最好。有异议现在说，没异议我就按这个开工。

- **[07-14 13:48]** 只编译一个架构，路径深度直接砍掉 3/4。真机调试用这个就够了。要打 release 包的时候再恢复成 `armeabi-v7a,arm64-v8a`。

- **[07-14 13:49]** [归档] 小柯你确认格式，我就直接出代码 👇

- **[07-14 14:18]** [压缩锚点] 📁 文件: app/build.gradle、components/StreamingControl.tsx、hooks/useAudioStreamer.ts、src/App.tsx、workspace/fe/rn-app-shell、workspace/fe/rn-app-shell/android/app/src/main/java/com/poc/AudioCaptureModule.kt、workspace/fe/rn-app-shell/android/app/src/main/java/com/poc/MainActivity.kt、workspace/fe/rn-app-shell/android/app/src/main/java/com/poc/MainApplication.kt
🔌 端口: 8010
⚙️ 服务: docker, expo
✍️ 决策: * ✅

@酱瓜 你确认下 WebSocket 端点路径是 `/api/ws/audio/stream` 没变？是的话我这边直接连 `ws:；；OTA 配套的版本锁定 |
|

- **[07-14 14:48]** [压缩锚点] 📁 文件: app/build.gradle、components/StreamingControl.tsx、hooks/useAudioStreamer.ts、src/App.tsx、workspace/fe/poc-audio-capture、workspace/fe/poc-audio-capture/android、workspace/fe/rn-app-shell、workspace/fe/rn-app-shell/android、workspace/fe/rn-app-shell/android/app/build.gradle、workspace/fe/rn-app-shell/android/app/src/main/java/com/poc/AudioCaptureModule.kt、workspace/fe/rn-app-shell/android/app/src/main/java/com/poc/MainActivity.kt、workspace/fe/rn-app-shell/android/app/src/main/java/com/poc/MainApplication.kt
🔌 端口: 8010
⚙️ 服务: docker, expo

- **[07-14 17:52]** [归档] 0.2.5 等你打完包出 PCM 文件我就接着做质量评估，现在架子摆好了，就缺你的 .pcm 喂进来～ 🎤

- **[07-21 16:36]** [队友] 小吴 完成「好的 boss，记住了——」

- **[07-21 16:37]** [队友] 酱瓜 完成「boss 你这优化不小啊，从「能跑就行」直接干到了「协议级」🚀」

- **[07-21 16:38]** [队友] 酱瓜 完成「对，就差你吼一嗓子了 🎤」

- **[07-21 16:39]** [归档] @AI小柯（前端） 协议完全匹配，逐项确认：

- **[07-21 16:39]** [归档] 用户指令: 后端说已确认，路径没变 ✅

- **[07-21 16:39]** [队友] 酱瓜 完成「接口全绿，随时接客 ✅」

- **[07-21 16:40]** [队友] 小吴 完成「确认了——小柯说的没错：」
