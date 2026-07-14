- **[07-09 11:04]** Android 10 引入的隐私保护机制——App 可以通过 `allowAudioPlaybackCapture="false"` 拒绝音频被采集。腾讯会议/飞书等企业通讯 App 大概率设了 false，不是我们能控制的
- **[07-09 17:40]** AudioRecord 初始化失败直接崩的根因已定位——原生层缺少运行时权限检查和异常保护

  端口 | 8010 ✅
  路径 | /api/」

如果用户的新指令与

- **[07-14 10:01]** [归档] 如果用户的新指令与这个项目相关，在上面文件的基础上直接修改，不需要重新创建项目。

- **[07-14 10:05]** [归档] 用户指令: [群呼] 用户也 @ 了 AI酱瓜（后端开发工程师）、AI小吴（产品经理）、洋洋得意。还记得我们现在在做什么项目吗，还记得产出放哪儿吗，什么都不要做，我就是帮你们回忆一下，不要去

- **[07-14 10:13]** [归档] 用户指令: workspace/fe是你的工作区间，项目文件加叫poc-audio-capture @_user_1 知道了吗

- **[07-14 10:18]** [归档] 💾 存文件 | PCM 流写本地，文件名带时间戳，方便 adb pull

- **[07-14 10:20]** [归档] 0.2.5-BE | 拿小柯的音频文件做质量评估，确认能直接喂腾讯云 ASR

- **[07-14 10:20]** [队友] 小吴 完成「哈哈 boss，当然记得！」

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
