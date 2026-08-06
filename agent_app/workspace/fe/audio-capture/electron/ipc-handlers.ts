/**
 * IPC 路由注册 —— 连接 preload 暴露的 channel 和主进程实现
 */
import { ipcMain, dialog, BrowserWindow } from 'electron';
import { getOverlayWindow, createOverlayWindow, destroyOverlayWindow } from './windows/overlay-window.js';
import { getLibreOfficePath, convertFile } from './file-convert/libreoffice.js';
import { downloadLibreOffice, pauseDownload, getPartialDownload, cleanupPartialDownload, installFromLocalFile } from './file-convert/downloader.js';
import { shell } from 'electron';
import { audioCapture } from './audio/audio-capture.js';
import fs from 'fs';
import os from 'os';
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

  // LibreOffice 按需下载（支持暂停/续传）
  ipcMain.handle('file:download-libreoffice', async (event, resume: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    try {
      const dir = await downloadLibreOffice(
        (pct: number, stage: string) => {
          win?.webContents.send('file:download-progress', { progress: pct, stage });
        },
        resume,
      );
      return { success: true, path: dir };
    } catch (err: any) {
      if (err.message === 'PAUSED') return { success: false, paused: true };
      win?.webContents.send('file:download-progress', { progress: -1, stage: 'error', error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('file:pause-download', () => {
    pauseDownload();
    return { ok: true };
  });

  ipcMain.handle('file:check-partial-download', () => {
    const partial = getPartialDownload();
    return partial ? { hasPartial: true, ...partial } : { hasPartial: false };
  });

  ipcMain.handle('file:cleanup-download', () => {
    cleanupPartialDownload();
    return { ok: true };
  });

  // 打开下载页面（用户手动下载）
  ipcMain.handle('file:open-download-page', () => {
    const url = 'https://zh-cn.libreoffice.org/download/portable-versions/';
    shell.openExternal(url);
    return { ok: true };
  });

  // 从本地安装包安装
  ipcMain.handle('file:install-local', async (event, localPath: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    try {
      const dir = await installFromLocalFile(localPath, (pct: number, stage: string) => {
        win?.webContents.send('file:download-progress', { progress: pct, stage });
      });
      return { success: true, path: dir };
    } catch (err: any) {
      win?.webContents.send('file:download-progress', { progress: -1, stage: 'error', error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('file:write-temp', async (_e, data: Uint8Array, suffix: string) => {
    const tmp = path.join(os.tmpdir(), `pdf2word-${Date.now()}.${suffix}`);
    fs.writeFileSync(tmp, data);
    return tmp;
  });

  ipcMain.handle('file:read-base64', async (_e, filePath: string) => {
    const data = fs.readFileSync(filePath);
    return data.toString('base64');
  });

  ipcMain.handle('file:convert', async (_e, inputPath: string, format: string) => {
    // 输出到临时目录，避免在用户文件夹留下中间产物
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-convert-'));
    try {
      if (format === 'docx' && inputPath.toLowerCase().endsWith('.pdf')) {
        return convertFile(inputPath, outputDir, 'docx', 'writer_pdf_import');
      }
      return convertFile(inputPath, outputDir, format);
    } finally {
      // 转换完成后，返回临时文件路径；调用方负责保存后清理
    }
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

  ipcMain.handle('file:save-output', async (_e, sourcePath: string) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;
    const defaultName = path.basename(sourcePath);
    const result = await dialog.showSaveDialog(win, { defaultPath: defaultName });
    if (result.canceled || !result.filePath) return null;
    fs.copyFileSync(sourcePath, result.filePath);
    // 保存后清理临时文件及其所在临时目录
    try { fs.unlinkSync(sourcePath); } catch {}
    try { fs.rmdirSync(path.dirname(sourcePath)); } catch {}
    return result.filePath;
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
