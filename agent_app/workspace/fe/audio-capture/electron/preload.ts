/**
 * Preload script —— contextBridge 暴露 IPC API 给渲染进程
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // 音频控制
  audio: {
    startCapture: (opts: unknown) => ipcRenderer.invoke('audio:start-capture', opts),
    stopCapture: () => ipcRenderer.invoke('audio:stop-capture'),
    getSnapshot: () => ipcRenderer.invoke('audio:get-snapshot'),
    onState: (cb: (data: unknown) => void) => {
      const listener = (_: unknown, data: unknown) => cb(data);
      ipcRenderer.on('audio:state', listener);
      return () => ipcRenderer.removeListener('audio:state', listener);
    },
    onTranscription: (cb: (data: unknown) => void) => {
      const listener = (_: unknown, data: unknown) => cb(data);
      ipcRenderer.on('audio:transcription', listener);
      return () => ipcRenderer.removeListener('audio:transcription', listener);
    },
    onLLMChunk: (cb: (data: unknown) => void) => {
      const listener = (_: unknown, data: unknown) => cb(data);
      ipcRenderer.on('audio:llm-chunk', listener);
      return () => ipcRenderer.removeListener('audio:llm-chunk', listener);
    },
    onLLMDone: (cb: (data: unknown) => void) => {
      const listener = (_: unknown, data: unknown) => cb(data);
      ipcRenderer.on('audio:llm-done', listener);
      return () => ipcRenderer.removeListener('audio:llm-done', listener);
    },
  },

  // 文件转换
  fileConvert: {
    getLibreOfficeStatus: () => ipcRenderer.invoke('file:libreoffice-status'),
    convert: (inputPath: string, format: string) => ipcRenderer.invoke('file:convert', inputPath, format),
    pickFile: (extensions?: string[]) => ipcRenderer.invoke('file:pick', extensions),
    saveFile: (data: Uint8Array, defaultName: string) => ipcRenderer.invoke('file:save', data, defaultName),
  },

  // 窗口管理
  window: {
    openOverlay: () => ipcRenderer.invoke('window:open-overlay'),
    closeOverlay: () => ipcRenderer.invoke('window:close-overlay'),
    toggleOverlay: () => ipcRenderer.invoke('window:toggle-overlay'),
    setAlwaysOnTop: (on: boolean) => ipcRenderer.invoke('window:set-always-on-top', on),
    toggleContentProtection: () => ipcRenderer.invoke('window:toggle-content-protection'),
    getContentProtection: () => ipcRenderer.invoke('window:get-content-protection'),
  },

  // 存储（IPC → 主进程文件系统）
  storage: {
    get: (key: string) => ipcRenderer.invoke('storage:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('storage:set', key, value),
    remove: (key: string) => ipcRenderer.invoke('storage:remove', key),
  },
});
