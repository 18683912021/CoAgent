/**
 * LibreOffice 本地文件转换
 *
 * 用 spawn 直接调用 LibreOffice 渲染引擎，一行命令替代 Android 端 150+ 行容错逻辑。
 */
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

export function getLibreOfficePath(): string | null {
  // 1. 系统安装
  const systemPaths = [
    process.platform === 'win32' && 'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    process.platform === 'win32' && 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    process.platform === 'darwin' && '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    process.platform === 'linux' && '/usr/bin/soffice',
  ].filter(Boolean) as string[];

  for (const p of systemPaths) {
    if (fs.existsSync(p)) return p;
  }

  // 2. App 按需下载的 Portable 版
  const portableDir = path.join(app.getPath('userData'), 'libreoffice-portable');
  const portableExe = process.platform === 'win32'
    ? path.join(portableDir, 'program', 'soffice.exe')
    : path.join(portableDir, 'MacOS', 'soffice');

  if (fs.existsSync(portableExe)) return portableExe;

  // 3. 都没有
  return null;
}

export async function convertToPdf(inputPath: string, outputDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const soffice = getLibreOfficePath();
    if (!soffice) {
      reject(new Error('LibreOffice 未安装。请在设置中下载 LibreOffice Portable。'));
      return;
    }

    const proc = spawn(soffice, [
      '--headless',
      '--convert-to', 'pdf:writer_pdf_Export',
      '--outdir', outputDir,
      inputPath,
    ], { timeout: 60_000 });

    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code: number | null) => {
      if (code === 0) {
        const name = path.basename(inputPath, path.extname(inputPath)) + '.pdf';
        resolve(path.join(outputDir, name));
      } else {
        reject(new Error(`LibreOffice exited with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (err: Error) => {
      reject(new Error(`LibreOffice 启动失败: ${err.message}`));
    });
  });
}
