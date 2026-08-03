/**
 * LibreOffice Portable 下载器
 *
 * 按需下载 LibreOffice Portable 到 userData 目录。
 * 首次使用时 App 内引导下载，之后无需重复下载。
 */
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { spawn } from 'child_process';
import type { IncomingMessage } from 'http';

const LIBREOFFICE_DOWNLOAD_URL = process.platform === 'darwin'
  ? 'https://download.documentfoundation.org/libreoffice/stable/25.2.0/mac/x86_64/LibreOffice_25.2.0_MacOS_x86-64.dmg'
  : 'https://download.documentfoundation.org/libreoffice/portable/25.2.0/LibreOfficePortable_25.2.0.paf.exe';

const DOWNLOAD_DIR = path.join(app.getPath('userData'), 'libreoffice-portable');

/**
 * 检查是否已下载 LibreOffice Portable
 */
export function isLibreOfficeDownloaded(): boolean {
  const exe = process.platform === 'win32'
    ? path.join(DOWNLOAD_DIR, 'program', 'soffice.exe')
    : path.join(DOWNLOAD_DIR, 'MacOS', 'soffice');
  return fs.existsSync(exe);
}

/**
 * 获取安装包下载路径
 */
function getInstallerPath(): string {
  const ext = process.platform === 'darwin' ? '.dmg' : '.exe';
  return path.join(app.getPath('userData'), `libreoffice-installer${ext}`);
}

/**
 * 下载 LibreOffice Portable 安装包
 *
 * @param onProgress 下载进度回调 (0-100)
 * @returns Portable 目录路径
 */
export async function downloadLibreOffice(
  onProgress: (pct: number) => void,
): Promise<string> {
  // 已存在则跳过
  if (isLibreOfficeDownloaded()) {
    onProgress(100);
    return DOWNLOAD_DIR;
  }

  const installerPath = getInstallerPath();

  // 下载安装包
  const file = createWriteStream(installerPath);

  const { response } = await new Promise<{ response: IncomingMessage }>(
    (resolve, reject) => {
      https.get(LIBREOFFICE_DOWNLOAD_URL, (res) => {
        // 处理重定向
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          https.get(res.headers.location, (redirectRes) => {
            resolve({ response: redirectRes });
          }).on('error', reject);
          return;
        }
        resolve({ response: res });
      }).on('error', reject);
    },
  );

  const totalBytes = parseInt(response.headers['content-length'] ?? '0', 10);
  let downloadedBytes = 0;

  response.on('data', (chunk: Buffer) => {
    downloadedBytes += chunk.length;
    if (totalBytes) {
      onProgress(Math.round((downloadedBytes / totalBytes) * 100));
    }
  });

  await pipeline(response, file);

  // 解压 Portable 包到 userData 目录
  await extractPortable(installerPath, DOWNLOAD_DIR);

  // 删除安装包
  try { fs.unlinkSync(installerPath); } catch { /* ignore */ }

  return DOWNLOAD_DIR;
}

/**
 * 解压 Portable 安装包
 *
 * Windows: .paf.exe 是 7z 自解压包，用 --silent 模式解压
 * macOS: .dmg 直接挂载复制
 */
async function extractPortable(installerPath: string, destDir: string): Promise<void> {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  if (process.platform === 'win32') {
    // PortableApps.com 格式：自解压 exe
    return new Promise((resolve, reject) => {
      const proc = spawn(installerPath, [
        '/DEST', destDir,
        '/VERYSILENT',
        '/SUPPRESSMSGBOXES',
        '/NORESTART',
      ], { timeout: 300_000 });

      proc.on('close', (code: number | null) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`LibreOffice extraction failed with code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }

  // macOS: .dmg mount + copy
  // 简化处理：直接 reject 让用户手动安装
  throw new Error('macOS LibreOffice 自动安装暂不支持，请手动安装 LibreOffice。');
}
