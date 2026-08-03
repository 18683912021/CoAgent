/**
 * IPC 路由注册 —— 连接 preload 暴露的 channel 和主进程实现
 */
import { ipcMain, dialog, BrowserWindow } from 'electron';
import { getOverlayWindow, createOverlayWindow, destroyOverlayWindow } from './windows/overlay-window.js';
import { getLibreOfficePath, convertToPdf } from './file-convert/libreoffice.js';
import { audioCapture } from './audio/audio-capture.js';
import fs from 'fs';
import path from 'path';
import net from 'node:net';
import { app } from 'electron';
import { mainWindow } from './main.js';

// ── 存储（简易文件系统实现） ──
const storagePath = path.join(app.getPath('userData'), 'preferences.json');

function readStorage(): Record<string, string> {
  try {
    if (fs.existsSync(storagePath)) {
      return JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return {};
}

function writeStorage(data: Record<string, string>): void {
  fs.writeFileSync(storagePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ── 端口检查工具 ──
export function checkPort(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
    server.on('error', () => resolve(false));
  });
}

export function registerIpcHandlers(): void {
  // ═══════════════════════════════════════════════════════════
  // 音频事件桥接 —— 把 AudioCaptureManager 事件推到渲染进程
  // ═══════════════════════════════════════════════════════════
  audioCapture.on('captureState', (data: unknown) => {
    mainWindow?.webContents.send('audio:state', data);
  });
  audioCapture.on('transcription', (data: unknown) => {
    mainWindow?.webContents.send('audio:transcription', data);
  });
  audioCapture.on('llmStart', (data: unknown) => {
    mainWindow?.webContents.send('audio:llm-chunk', { type: 'llm_start', ...(data as object) });
  });
  audioCapture.on('llmChunk', (data: unknown) => {
    mainWindow?.webContents.send('audio:llm-chunk', data);
  });
  audioCapture.on('llmDone', (data: unknown) => {
    mainWindow?.webContents.send('audio:llm-done', data);
  });

  // ── 存储 ──
  ipcMain.handle('storage:get', (_e, key: string) => {
    const data = readStorage();
    return data[key] ?? null;
  });

  ipcMain.handle('storage:set', (_e, key: string, value: string) => {
    const data = readStorage();
    data[key] = value;
    writeStorage(data);
  });

  ipcMain.handle('storage:remove', (_e, key: string) => {
    const data = readStorage();
    delete data[key];
    writeStorage(data);
  });

  // ── 窗口管理 ──
  ipcMain.handle('window:open-overlay', () => {
    createOverlayWindow();
  });

  ipcMain.handle('window:close-overlay', () => {
    destroyOverlayWindow();
  });

  ipcMain.handle('window:toggle-overlay', () => {
    const overlay = getOverlayWindow();
    if (overlay) {
      destroyOverlayWindow();
    } else {
      createOverlayWindow();
    }
  });

  ipcMain.handle('window:set-always-on-top', (_e, on: boolean) => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      win.setAlwaysOnTop(on);
    }
  });

  // ── ContentProtection 开关 ──
  let contentProtectionOn = false;

  ipcMain.handle('window:toggle-content-protection', () => {
    contentProtectionOn = !contentProtectionOn;
    // 应用到所有窗口
    BrowserWindow.getAllWindows().forEach(w => w.setContentProtection(contentProtectionOn));
    return contentProtectionOn;
  });

  ipcMain.handle('window:get-content-protection', () => {
    return contentProtectionOn;
  });

  // ── 文件转换 ──
  ipcMain.handle('file:libreoffice-status', () => {
    return { available: getLibreOfficePath() !== null };
  });

  ipcMain.handle('file:convert', async (_e, inputPath: string, format: string) => {
    if (format === 'pdf') {
      const outputDir = path.dirname(inputPath);
      return convertToPdf(inputPath, outputDir);
    }
    throw new Error(`Unsupported format: ${format}`);
  });

  ipcMain.handle('file:pick', async (_e, extensions?: string[]) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: extensions ? [{ name: 'Files', extensions }] : [],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('file:save', async (_e, data: Uint8Array, defaultName: string) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;
    const result = await dialog.showSaveDialog(win, { defaultPath: defaultName });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, data);
    return result.filePath;
  });

  // ── 音频采集 ──
  let audioSessionId: string | null = null;

  ipcMain.handle('audio:start-capture', async (_e, opts: { source?: string }) => {
    audioSessionId = crypto.randomUUID();
    return audioCapture.start(
      (opts?.source as 'mic' | 'system' | 'both') || 'both',
      audioSessionId,
    );
  });

  ipcMain.handle('audio:stop-capture', async () => {
    await audioCapture.stop();
    audioSessionId = null;
    return {};
  });

  ipcMain.handle('audio:get-snapshot', async () => {
    return audioCapture.getSnapshot();
  });
}
