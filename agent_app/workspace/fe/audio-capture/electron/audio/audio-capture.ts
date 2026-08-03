/**
 * AudioCapture —— 音频采集主模块
 *
 * 管理 WASAPI Loopback（系统音频）+ 麦克风采集的生命周期。
 */
import { EventEmitter } from 'events';
import { normalizePcm } from './pcm-normalizer.js';
import { PcmFrameAccumulator } from './frame-accumulator.js';

export type CaptureState = 'idle' | 'preparing' | 'capturing' | 'completed';
export type StreamState = 'idle' | 'connecting' | 'ready' | 'degraded' | 'reconnecting' | 'dead' | 'closed';
export type CaptureSource = 'mic' | 'system' | 'both';

export interface AudioLevels {
  mic: number;
  system: number;
}

export interface TranscriptionEvent {
  text: string;
  isFinal: boolean;
  source: 'mic' | 'system';
}

export interface LLMStartEvent {
  question_text: string;
  language: string;
}

export interface LLMChunkEvent {
  delta: string;
  chunk_index: number;
}

export interface LLMDoneEvent {
  full_answer: string;
  error?: string;
}

export class AudioCaptureManager extends EventEmitter {
  private state: CaptureState = 'idle';
  private streamState: StreamState = 'idle';
  private startedAtUtc: string | null = null;
  private wasapiInstance: any = null;
  private micStream: MediaStream | null = null;
  private accumulators = new Map<string, PcmFrameAccumulator>();
  private seq = new Map<string, number>();
  private offset = new Map<string, number>();

  getState(): CaptureState { return this.state; }
  getStreamState(): StreamState { return this.streamState; }

  /**
   * 开始采集 —— WASAPI Loopback + 麦克风
   */
  async start(source: CaptureSource, sessionId: string): Promise<{ startedAtUtc: string }> {
    this.startedAtUtc = new Date().toISOString();
    this.state = 'capturing';
    this.emit('captureState', { state: 'capturing', startedAtUtc: this.startedAtUtc });

    const needsSystem = source === 'system' || source === 'both';
    // ── 系统音频（WASAPI Loopback） ──
    if (needsSystem) {
      try {
        const { WasapiLoopback } = require('./native/build/Release/wasapi_loopback.node');
        this.wasapiInstance = new WasapiLoopback();

        const accum = new PcmFrameAccumulator();
        this.accumulators.set('system', accum);
        this.seq.set('system', 0);
        this.offset.set('system', 0);

        accum.onFrame((frame: Buffer) => {
          const s = this.seq.get('system') || 0;
          const o = this.offset.get('system') || 0;
          this.seq.set('system', s + 1);
          this.offset.set('system', o + frame.length);

          this.emit('pcmFrame', {
            sessionId,
            source: 'system',
            sequence: s,
            captureOffsetUs: (o * 1_000_000) / 32000,
            bytes: frame,
            isFinal: false,
          });
        });

        this.wasapiInstance.start((err: Error | null, buffer: Buffer) => {
          if (err) {
            this.emit('error', { code: 'E_WASAPI', stage: 'capture', source: 'system', message: err.message });
            return;
          }

          const normalized = normalizePcm(buffer, this.wasapiInstance?._sampleRate || 48000, this.wasapiInstance?._channels || 2);
          accum.push(normalized);
        });
      } catch (e: any) {
        console.warn('[AudioCapture] WASAPI addon not available:', e.message);
        console.warn('[AudioCapture] Run: cd electron/audio/native && npx node-gyp rebuild');
      }
    }

    // ── 麦克风（通过渲染进程 getUserMedia，这里只做接收） ──
    // 麦克风采在渲染进程通过 Web Audio API 完成，PCM 帧通过 IPC 送到这里

    return { startedAtUtc: this.startedAtUtc! };
  }

  /**
   * 停止采集
   */
  async stop(): Promise<void> {
    if (this.wasapiInstance) {
      this.wasapiInstance.stop();
      this.wasapiInstance = null;
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }

    // flush 所有 accumulator
    for (const [source, accum] of this.accumulators) {
      const remaining = accum.flush();
      if (remaining.length > 0) {
        const s = this.seq.get(source) || 0;
        const o = this.offset.get(source) || 0;
        this.emit('pcmFrame', {
          source,
          sequence: s,
          captureOffsetUs: (o * 1_000_000) / 32000,
          bytes: remaining,
          isFinal: true,
        });
      }
    }

    this.accumulators.clear();
    this.seq.clear();
    this.offset.clear();
    this.state = 'completed';
    this.emit('captureState', { state: 'completed' });
  }

  getSnapshot() {
    return {
      captureState: this.state,
      streamState: this.streamState,
      levels: { mic: 0, system: 0 } as AudioLevels,
      startedAtUtc: this.startedAtUtc,
    };
  }
}

export const audioCapture = new AudioCaptureManager();
