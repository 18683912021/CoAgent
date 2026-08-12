/**
 * launch-electron.cjs —— 等 Vite 就绪后启动 Electron
 *
 * 两个坑：
 * 1. macOS 的 VSCode 集成终端会继承 ELECTRON_RUN_AS_NODE=1，该变量让 Electron
 *    以纯 Node 模式运行：require('electron') 返回空、窗口永远无法创建，且无报错。
 *    因此在 Node 层删除该变量再 spawn（Windows 无此问题，但脚本必须跨平台）。
 * 2. 原方案用 wait-on 探测 http://localhost:5173，但它会走 shell 的
 *    HTTP_PROXY/HTTPS_PROXY 代理（如 Clash），代理返回 502 时永远等不到就绪。
 *    改用 TCP 连接探测端口，完全不受代理影响。
 */
const { spawn } = require('child_process');
const net = require('net');
const electronPath = require('electron'); // npm 包导出 Electron 二进制路径

const PORT = 5173;
const HOSTS = ['::1', '127.0.0.1']; // 依次探测 IPv6/IPv4 回环
const POLL_INTERVAL_MS = 500;
const TIMEOUT_MS = 60000;

function isPortOpen(host) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: PORT, timeout: 1000 });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

async function waitForVite() {
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    for (const host of HOSTS) {
      if (await isPortOpen(host)) return;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  console.error(`[launch-electron] 等待 Vite 端口 ${PORT} 超时（${TIMEOUT_MS / 1000}s），请确认 vite 已启动`);
  process.exit(1);
}

async function main() {
  await waitForVite();

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronPath, ['.'], { stdio: 'inherit', env });

  child.on('exit', (code) => process.exit(code ?? 1));
  child.on('error', (err) => {
    console.error('[launch-electron] 启动失败:', err.message);
    process.exit(1);
  });
}

main();
