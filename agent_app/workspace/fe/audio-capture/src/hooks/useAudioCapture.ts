/**
 * useAudioCapture —— PC 端音频采集 Hook
 *
 * 对接 AudioStreamClient（WebSocket 音频流客户端），业务逻辑和移动端 useAudioCaptureController 对齐。
 */
import { useReducer, useCallback, useEffect, useRef } from 'react';
import { interviewReducer, INITIAL_STATE, genId } from '../store/interview-reducer';
import { AudioStreamClient } from '../stream/ws-client';
import { STREAM_URL, getProgLang, getLanguage } from '../config';
import type { ConversationMessage } from '../store/types';

export function useAudioCapture() {
  const [state, dispatch] = useReducer(interviewReducer, INITIAL_STATE);
  const clientRef = useRef<AudioStreamClient | null>(null);
  const sessionIdRef = useRef<string>('');

  // ── 初始化 WebSocket 客户端 ──
  useEffect(() => {
    const client = new AudioStreamClient(STREAM_URL);
    clientRef.current = client;

    client.on('streamState', (s: string) => {
      dispatch({ type: 'streamState', value: s as any });
    });
    client.on('transcription', (evt: any) => {
      dispatch({ type: 'transcription', text: evt.text, isFinal: evt.is_final, source: evt.source, timestamp: Date.now() });
    });
    client.on('llmStart', (evt: any) => {
      dispatch({ type: 'llm_start', question_text: evt.question_text, language: evt.language, timestamp: Date.now() });
    });
    client.on('llmChunk', (evt: any) => {
      dispatch({ type: 'llm_chunk', chunk_index: evt.chunk_index ?? 0, delta: evt.delta, timestamp: Date.now() });
    });
    client.on('llmDone', (evt: any) => {
      dispatch({ type: 'llm_done', full_answer: evt.full_answer, timestamp: Date.now(), error: evt.error });
    });
    client.on('error', (evt: any) => {
      dispatch({ type: 'error', value: evt });
    });

    return () => { client.disconnect(); };
  }, []);

  // ── Start ──
  const start = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      await client.connect();
      const sid = crypto.randomUUID();
      sessionIdRef.current = sid;
      client.startSession(sid, 'both');
      dispatch({ type: 'captureState', value: 'capturing' });
      dispatch({ type: 'streamState', value: 'ready' });
      client.sendControl({ type: 'config', llm: {}, track: getProgLang().toLowerCase() });
    } catch (e: any) {
      dispatch({ type: 'error', value: { code: 'E_START', stage: 'connect', message: e.message || '连接失败', recoverable: true } });
    }
  }, []);

  // ── Stop ──
  const stop = useCallback(async () => {
    const client = clientRef.current;
    if (client) {
      client.sendControl({ type: 'track_end', session_id: sessionIdRef.current, source: 'mic' });
      client.sendControl({ type: 'track_end', session_id: sessionIdRef.current, source: 'system' });
      client.sendControl({ type: 'session_stop', session_id: sessionIdRef.current });
      client.disconnect();
    }
    dispatch({ type: 'captureState', value: 'idle' });
    dispatch({ type: 'streamState', value: 'idle' });
    dispatch({ type: 'reset' });
  }, []);

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
    clientRef.current?.sendControl({
      type: 'llm_query', text: clickedMsg.text, language: getLanguage(),
      track: getProgLang().toLowerCase(), bubble_source: clickedMsg.role === 'interviewer' ? 'system' : 'mic',
    });
  }, [state.conversation]);

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
    clientRef.current?.sendControl({
      type: 'llm_query', text: clickedMsg.text, language: getLanguage(),
      track: getProgLang().toLowerCase(), bubble_source: clickedMsg.role === 'interviewer' ? 'system' : 'mic',
    });
  }, [state.conversation]);

  return { state, dispatch, start, stop, sendLLMQuery, retryLLM };
}
