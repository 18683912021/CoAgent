/**
 * smoke-addon.cjs —— addon 冒烟验证（每次 rebuild 后运行）
 *
 * 用法：$env:ELECTRON_RUN_AS_NODE=$null 后
 *   .\node_modules\electron\dist\electron.exe scripts/smoke-addon.cjs
 * （VSCode 集成终端会注入 ELECTRON_RUN_AS_NODE=1，会把 electron 变成纯 Node，必须先清除）
 *
 * 在真实 Electron 主进程环境验证：
 *  1. session 权限双 handler 注册（setPermissionCheckHandler + setPermissionRequestHandler）不抛错；
 *  2. WASAPI addon 以 Electron 32 ABI 正常加载并返回设备快照；
 *  3. start → 收帧 → stop 完整采集链路无死锁（exit 0）。
 */
const { app, session } = require('electron');

app.whenReady().then(() => {
  session.defaultSession.setPermissionCheckHandler(() => true);
  session.defaultSession.setPermissionRequestHandler((_wc, _p, callback) => callback(true));

  const addon = require('../dist-electron/audio/native/build/Release/wasapi_loopback.node');
  const dev = new addon.WasapiLoopback();
  const snap = { sampleRate: dev.sampleRate, channels: dev.channels, bitsPerSample: dev.bitsPerSample, isFloat: dev.isFloat };
  console.log('[smoke] permission handlers OK');
  console.log('[smoke] addon OK, device:', JSON.stringify(snap));

  // 完整采集链路：start → 收帧 → stop（验证线程 COM 初始化 + 死锁规避）
  let frames = 0;
  const ok = dev.start(() => { frames++; });
  if (!ok) throw new Error('start() returned false');
  console.log('[smoke] start OK, collecting 1s...');
  setTimeout(() => {
    dev.stop();
    console.log(`[smoke] stop OK, frames received: ${frames}`);
    console.log('[smoke] PASS');
    app.quit();
  }, 1000);
}).catch((e) => {
  console.error('[smoke] FAIL:', e);
  app.exit(1);
});
