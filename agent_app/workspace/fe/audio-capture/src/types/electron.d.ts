/// <reference types="vite/client" />

interface ElectronAPI {
  audio: {
    startCapture(opts: unknown): Promise<unknown>;
    stopCapture(): Promise<void>;
    getSnapshot(): Promise<unknown>;
    onState(cb: (data: unknown) => void): () => void;
    onTranscription(cb: (data: unknown) => void): () => void;
    onLLMChunk(cb: (data: unknown) => void): () => void;
    onLLMDone(cb: (data: unknown) => void): () => void;
  };
  fileConvert: {
    getLibreOfficeStatus(): Promise<{ available: boolean }>;
    convert(inputPath: string, format: string): Promise<string>;
    pickFile(extensions?: string[]): Promise<string | null>;
    saveFile(data: Uint8Array, defaultName: string): Promise<string | null>;
  };
  window: {
    openOverlay(): Promise<void>;
    closeOverlay(): Promise<void>;
    toggleOverlay(): Promise<void>;
    setAlwaysOnTop(on: boolean): Promise<void>;
  };
  storage: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
