/**
 * 主窗口
 *
 * 三栏布局的 React 渲染进程宿主。整个窗口应用 ContentProtection 防止面试官截屏看到 AI 答案。
 */
import { BrowserWindow, app } from 'electron';
import path from 'path';

const isDev = !app.isPackaged;

function getPreloadPath(): string {
  return path.join(__dirname, '..', 'preload.js');
}

function getRendererUrl(): string {
  if (isDev) return 'http://localhost:5173';
  return `file://${path.join(__dirname, '..', '..', 'dist-renderer', 'index.html')}`;
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 400,
    title: 'AI 面试助手',
    backgroundColor: '#F7F8FA',
    show: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // ContentProtection 默认关闭，用户手动开关
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.once('ready-to-show', () => { win.show(); });

  // show 后按当前状态重新应用
  // ContentProtection 状态由 IPC handler 管理，show 时不需要重设

  win.loadURL(getRendererUrl());

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  return win;
}
