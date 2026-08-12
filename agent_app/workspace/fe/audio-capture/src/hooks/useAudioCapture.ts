/**
 * useAudioCapture —— PC 端音频采集 Hook
 *
 * 业务逻辑和移动端 useAudioCaptureController 对齐，但架构为：
 *   采集（WASAPI system + WS 推流）都在主进程；渲染进程只做——
 *   1. 麦克风采集（getUserMedia → AudioContext 16kHz mono → IPC 送主进程）
 *   2. 控制消息（start/stop/llm_query/config）
 *   3. 事件消费（transcription/llm 三态/levels/streamState → reducer）
 */
import { useReducer, useCallback, useEffect, useRef } from 'react';
import { interviewReducer, INITIAL_STATE, genId } from '../store/interview-reducer';
import { MAIN_STREAM_URL, getProgLang, getLanguage } from '../config';
import type { ConversationMessage } from '../store/types';

interface MicHandle {
  ctx: AudioContext;
  stream: MediaStream;
  node: AudioWorkletNode;
}

export function useAudioCapture() {
  const [state, dispatch] = useReducer(interviewReducer, INITIAL_STATE);
  const api = window.electronAPI?.audio;
  const micRef = useRef<MicHandle | null>(null);

  // ── 事件订阅（主进程 → IPC → reducer，对齐移动端事件流） ──
  useEffect(() => {
    if (!api) return;
    const offs = [
      api.onState((evt: any) => {
        if (evt?.state) dispatch({ type: 'captureState', value: evt.state });
      }),
      api.onTranscription((evt: any) => {
        dispatch({ type: 'transcription', text: evt.text, isFinal: evt.is_final, source: evt.source, timestamp: Date.now() });
      }),
      api.onLLMStart((evt: any) => {
        dispatch({ type: 'llm_start', question_text: evt.question_text, language: evt.language, timestamp: Date.now() });
      }),
      api.onLLMChunk((evt: any) => {
        dispatch({ type: 'llm_chunk', chunk_index: evt.chunk_index ?? 0, delta: evt.delta, timestamp: Date.now() });
      }),
      api.onLLMDone((evt: any) => {
        dispatch({ type: 'llm_done', full_answer: evt.full_answer, timestamp: Date.now(), error: evt.error });
      }),
      api.onStreamState((evt: any) => {
        if (evt?.state) dispatch({ type: 'streamState', value: evt.state });
      }),
      api.onLevels((evt: any) => {
        if (evt) dispatch({ type: 'levels', value: { mic: evt.mic ?? 0, system: evt.system ?? 0 } });
      }),
      // 主进程采集/推流错误必须上屏（addon 缺失、声卡异常等），对齐移动端 onError
      api.onError((evt: any) => {
        if (evt?.message) dispatch({ type: 'error', value: evt });
      }),
    ];
    return () => { offs.forEach(off => off()); };
  }, [api]);

  // ── 挂载时恢复主进程状态（dev reload 场景：UI 与主进程失同步时对齐） ──
  useEffect(() => {
    if (!api) return;
    api.getSnapshot().then((snap: any) => {
      if (!snap) return;
      if (snap.captureState === 'capturing') {
        dispatch({ type: 'captureState', value: 'capturing' });
      }
      if (snap.streamState && snap.streamState !== 'idle') {
        dispatch({ type: 'streamState', value: snap.streamState });
      }
    }).catch(() => {});
  }, [api]);

  // ── 麦克风采集：AudioWorklet 16kHz mono float32 → int16 → IPC 帧 ──
  const startMic = useCallback(async (): Promise<void> => {
    if (!api || micRef.current) return;
    try {
      // AudioContext 直接输出 16kHz（浏览器高质量重采样），与主进程归一化目标一致；
      // worklet 在 context 采样率下运行，无需在 worklet 内重采样
      const ctx = new AudioContext({ sampleRate: 16000 });
      // worklet 独立文件（public/ 原样复制）：dev 下 Vite 伺服，打包后 file:// 相对路径
      await ctx.audioWorklet.addModule('./mic-processor.js');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'mic-capture-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
      // worklet 每 40ms 转移一个 640 样本的 ArrayBuffer；主线程仅做 int16 转换（微秒级）
      node.port.onmessage = (e) => {
        const samples = new Float32Array(e.data as ArrayBuffer);
        const out = new Int16Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
          const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
          out[i] = Math.round(v * 32767);
        }
        api.sendMicFrame(new Uint8Array(out.buffer));
      };
      source.connect(node);
      micRef.current = { ctx, stream, node };
    } catch (e: any) {
      dispatch({ type: 'error', value: { code: 'E_MIC', stage: 'capture', message: e?.message || '麦克风不可用，请检查权限', recoverable: true } });
    }
  }, [api]);

  const stopMic = useCallback((): void => {
    const mic = micRef.current;
    if (!mic) return;
    mic.stream.getTracks().forEach(t => t.stop());
    mic.node.port.onmessage = null;
    mic.node.disconnect();
    mic.ctx.close().catch(() => {});
    micRef.current = null;
  }, []);

  // ── Start（对齐移动端：连接 → 会话 → 采集；主进程统一执行） ──
  const start = useCallback(async () => {
    if (!api) return;
    try {
      // 清掉上一次的残留错误（对齐移动端 start 入口行为）
      dispatch({ type: 'error', value: null });
      dispatch({ type: 'captureState', value: 'preparing' });
      await api.startCapture({ source: 'both', streamUrl: MAIN_STREAM_URL });
      // 主进程 connect(等 ready) + session_start + track_start 已完成
      dispatch({ type: 'captureState', value: 'capturing' });
      dispatch({ type: 'streamState', value: 'ready' });
      // 初始赛道配置（对齐移动端 start 流程）
      await api.sendControl({ type: 'config', llm: {}, track: getProgLang().toLowerCase() });
      await startMic();
    } catch (e: any) {
      dispatch({ type: 'captureState', value: 'idle' });
      dispatch({ type: 'error', value: { code: 'E_START', stage: 'connect', message: e?.message || '连接失败', recoverable: true } });
    }
  }, [api, startMic]);

  // ── Stop（收尾顺序在主进程：flush isFinal → track_end → session_stopped → 断连） ──
  const stop = useCallback(async () => {
    stopMic();
    if (api) {
      try { await api.stopCapture(); } catch { /* ignore */ }
    }
    dispatch({ type: 'captureState', value: 'idle' });
    dispatch({ type: 'streamState', value: 'idle' });
    dispatch({ type: 'reset' });
  }, [api, stopMic]);

  // 卸载兜底：只停麦克风，不主动结束会话（结束由用户操作触发）
  useEffect(() => {
    return () => { stopMic(); };
  }, [stopMic]);

  // ── 发送 LLM 查询（点击气泡触发） ──
  const sendLLMQuery = useCallback((bubbleId: string) => {
    const conv = state.conversation;
    const clickedMsg = conv.find((m: ConversationMessage) => m.id === bubbleId);
    if (!clickedMsg || clickedMsg.role === 'ai') return;
    const idx = conv.findIndex((m: ConversationMessage) => m.id === bubbleId);
    const nextMsg = idx >= 0 ? conv[idx + 1] : undefined;
    if (nextMsg && nextMsg.role === 'ai' && nextMsg.status === 'done') return;

    const aiBubbleId = genId('llm');
    dispatch({ type: 'llm_query_sent', aiBubbleId, insertedAfterId: clickedMsg.id, timestamp: Date.now() });
    api?.sendControl({
      type: 'llm_query', text: clickedMsg.text, language: getLanguage(),
      track: getProgLang().toLowerCase(), bubble_source: clickedMsg.role === 'interviewer' ? 'system' : 'mic',
    });
  }, [state.conversation, api]);

  // ── Retry LLM ──
  const retryLLM = useCallback((aiBubbleId: string) => {
    const conv = state.conversation;
    const aiMsg = conv.find((m: ConversationMessage) => m.id === aiBubbleId);
    if (!aiMsg || aiMsg.role !== 'ai' || aiMsg.status !== 'error') return;
    const aiIdx = conv.findIndex((m: ConversationMessage) => m.id === aiBubbleId);
    if (aiIdx <= 0) return;
    const clickedMsg = conv[aiIdx - 1]!;
    if (clickedMsg.role === 'ai') return;

    const newAiId = genId('llm');
    dispatch({ type: 'llm_query_sent', aiBubbleId: newAiId, insertedAfterId: clickedMsg.id, timestamp: Date.now() });
    api?.sendControl({
      type: 'llm_query', text: clickedMsg.text, language: getLanguage(),
      track: getProgLang().toLowerCase(), bubble_source: clickedMsg.role === 'interviewer' ? 'system' : 'mic',
    });
  }, [state.conversation, api]);

  return { state, dispatch, start, stop, sendLLMQuery, retryLLM };
}
