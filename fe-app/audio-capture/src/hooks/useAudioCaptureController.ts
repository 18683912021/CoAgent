import {useCallback, useEffect, useMemo, useReducer, useRef} from 'react';
import {
  AppState,
  PermissionsAndroid,
  Platform,
  type Permission,
} from 'react-native';

import {
  AudioCapture,
  type AudioCapabilities,
  type AudioLevels,
  type CaptureResult,
  type CaptureSource,
  type CaptureState,
  type LLMStartEvent,
  type LLMChunkEvent,
  type LLMDoneEvent,
  type NativeCaptureError,
  type StreamState,
  type StreamStats,
  type TrackSource,
} from '../native';
import {STREAM_URL} from '../config';

// ── Constants ──────────────────────────────────────────────
const EMPTY_LEVELS: AudioLevels = {mic: 0, system: 0};
const EMPTY_STREAM_STATS: StreamStats = {
  queuedBytes: 0, transportBytes: 0, acknowledgedBytes: 0,
  realtimeFrames: 0, droppedFrames: 0, backfillBytes: 0,
};

// ── Types ──────────────────────────────────────────────────
export type ConversationBubbleStatus = 'loading' | 'streaming' | 'done' | 'error';

export interface ConversationMessage {
  id: string;
  role: 'interviewer' | 'user' | 'ai';
  text: string;
  status: ConversationBubbleStatus;
  timestamp: number;
}

interface ControllerState {
  capabilities: AudioCapabilities | null;
  captureState: CaptureState;
  streamState: StreamState;
  source: CaptureSource;
  projectionGranted: boolean;
  levels: AudioLevels;
  streamStats: StreamStats;
  startedAtUtc: string | null;
  result: CaptureResult | null;
  pendingBackfill: boolean;
  error: NativeCaptureError | null;
  streamMessage: string | null;
  conversation: ConversationMessage[];
  pendingLLMQueue: string[];
  currentStreamingAIId: string | null;
  language: 'zh' | 'en';
}

type Action =
  | {type: 'capabilities'; value: AudioCapabilities}
  | {type: 'source'; value: CaptureSource}
  | {type: 'projection'; value: boolean}
  | {type: 'captureState'; value: CaptureState; payload?: Partial<ControllerState>}
  | {type: 'streamState'; value: StreamState; message?: string}
  | {type: 'levels'; value: AudioLevels}
  | {type: 'streamStats'; value: StreamStats}
  | {type: 'result'; value: CaptureResult}
  | {type: 'error'; value: NativeCaptureError | null}
  | {type: 'transcription'; text: string; isFinal: boolean; source: 'mic' | 'system'; timestamp: number}
  | {type: 'llm_start'; question_text: string; language: string; timestamp: number}
  | {type: 'llm_chunk'; chunk_index: number; delta: string; timestamp: number}
  | {type: 'llm_done'; full_answer: string; timestamp: number; error?: string}
  | {type: 'snapshot'; value: Partial<ControllerState>}
  | {type: 'llm_query_sent'; aiBubbleId: string; insertedAfterId: string; timestamp: number}
  | {type: 'llm_answer_error'; aiBubbleId: string}
  | {type: 'set_language'; value: 'zh' | 'en'};

// ── Initial State ─────────────────────────────────────────
const INITIAL_STATE: ControllerState = {
  capabilities: null,
  captureState: 'idle',
  streamState: 'idle',
  source: 'both',
  projectionGranted: false,
  levels: EMPTY_LEVELS,
  streamStats: EMPTY_STREAM_STATS,
  startedAtUtc: null,
  result: null,
  pendingBackfill: false,
  error: null,
  streamMessage: null,
  conversation: [],
  pendingLLMQueue: [],
  currentStreamingAIId: null,
  language: 'zh',
};

// ── Helpers ───────────────────────────────────────────────
function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function insertAfter<T extends {id: string}>(arr: T[], afterId: string, item: T): T[] {
  const idx = arr.findIndex(x => x.id === afterId);
  if (idx === -1) { return [...arr, item]; }
  return [...arr.slice(0, idx + 1), item, ...arr.slice(idx + 1)];
}

// ── ASR 累积文本裁剪 ──
// 火山引擎 ASR 的 text 字段是累积文本（从第一句开始），跨句不会自动清零。
// 传入 oldText（气泡已有内容），返回 incoming 中相对于 oldText 的新增部分。
function stripOverlap(incoming: string, oldText: string): string {
  if (!oldText) { return incoming; }
  if (incoming.startsWith(oldText)) { return incoming.slice(oldText.length); }
  // 断句分裂后 oldText 只是 delta，但 ASR 发来的是全量累积文本
  const idx = incoming.lastIndexOf(oldText);
  if (idx !== -1) { return incoming.slice(idx + oldText.length); }
  return incoming;
}

// ── 裁剪对话 ──
function _cap(conv: ConversationMessage[]): ConversationMessage[] {
  return conv.length > 80 ? conv.slice(-80) : conv;
}

// ── Reducer ───────────────────────────────────────────────
function reducer(state: ControllerState, action: Action): ControllerState {
  switch (action.type) {
    case 'capabilities':
      return {...state, capabilities: action.value};
    case 'source':
      return {...state, source: action.value, projectionGranted: false, result: null, error: null};
    case 'projection':
      return {...state, projectionGranted: action.value, error: null};
    case 'captureState':
      return {...state, captureState: action.value, ...(action.payload ?? {})};
    case 'streamState':
      return {...state, streamState: action.value, streamMessage: action.message ?? state.streamMessage};
    case 'levels':
      return {...state, levels: action.value};
    case 'streamStats':
      return {...state, streamStats: action.value};
    case 'result':
      return {...state, result: action.value, captureState: 'completed', levels: EMPTY_LEVELS};
    case 'error':
      return {...state, error: action.value};
    case 'snapshot':
      // 不覆盖 source（用户手动选择的优先）
      return {...state, ...action.value, source: state.source};

    // ── 0.5: Transcription → bubble（3 秒断句）──
    case 'transcription': {
      const role = action.source === 'system' ? 'interviewer' : 'user';
      const now = action.timestamp;

      const streamingIdx = state.conversation.findIndex(
        m => m.role === role && m.status === 'streaming',
      );

      if (streamingIdx !== -1) {
        const streamingBubble = state.conversation[streamingIdx]!;
        const gap = now - streamingBubble.timestamp;
        const shouldSplit = gap > 3000 || action.isFinal;

        if (shouldSplit) {
          // 断句：提取新增文本，关闭旧泡，起新泡
          const delta = stripOverlap(action.text, streamingBubble.text);
          if (!delta.trim()) {
            return {...state, conversation: _cap(state.conversation.map((m, i) =>
              i === streamingIdx ? {...m, status: 'done' as const, timestamp: now} : m))};
          }
          const doneBubble = {...streamingBubble, status: 'done' as const};
          const newMsg: ConversationMessage = {
            id: genId(role === 'interviewer' ? 'int' : 'usr'),
            role,
            text: delta.trim(),
            status: 'streaming',
            timestamp: now,
          };
          return {
            ...state,
            conversation: _cap(state.conversation.map((m, i) =>
              i === streamingIdx ? doneBubble : m,
            ).concat(newMsg)),
          };
        }

        // 流式更新：提取增量追加到当前气泡
        const delta = stripOverlap(action.text, streamingBubble.text);
        if (!delta) { return state; }
        return {
          ...state,
          conversation: _cap(state.conversation.map((m, i) =>
            i === streamingIdx
              ? {...m, text: m.text + delta, timestamp: now}
              : m,
          )),
        };
      }

      // 无 streaming 气泡 → 新句子起泡，先裁掉上一句 done 气泡的重叠
      let cleanText = action.text;
      const lastDone = [...state.conversation].reverse().find(
        m => m.role === role && m.status === 'done',
      );
      if (lastDone) {
        cleanText = stripOverlap(cleanText, lastDone.text);
      }
      if (!cleanText.trim()) { return state; }

      const newMsg: ConversationMessage = {
        id: genId(role === 'interviewer' ? 'int' : 'usr'),
        role,
        text: cleanText.trim(),
        status: 'streaming',
        timestamp: now,
      };
      return {...state, conversation: _cap([...state.conversation, newMsg])};
    }

    // ── 0.5: Insert loading AI bubble after clicked ──
    case 'llm_query_sent': {
      const aiMsg: ConversationMessage = {
        id: action.aiBubbleId,
        role: 'ai',
        text: '',
        status: 'loading',
        timestamp: action.timestamp,
      };
      return {
        ...state,
        conversation: _cap(insertAfter(state.conversation, action.insertedAfterId, aiMsg)),
        pendingLLMQueue: [...state.pendingLLMQueue, action.aiBubbleId],
      };
    }

    // ── 0.6: LLM 三态协议 ──
    case 'llm_start': {
      if (state.pendingLLMQueue.length === 0) {
        console.warn('[LLM] 收到非预期 llm_start（无 pending query），静默丢弃');
        return state;
      }
      const aiBubbleId = state.pendingLLMQueue[0]!;
      const restQueue = state.pendingLLMQueue.slice(1);
      // 0.5 手动触发：被点击的气泡本身就是问题，不需要重复插入面试官气泡
      const conversation = state.conversation.map(m =>
        m.id === aiBubbleId
          ? {
              ...m,
              text: '',
              status: 'streaming' as ConversationBubbleStatus,
            }
          : m,
      );
      return {
        ...state,
        pendingLLMQueue: restQueue,
        currentStreamingAIId: aiBubbleId,
        conversation: _cap(conversation),
      };
    }

    case 'llm_chunk': {
      if (!state.currentStreamingAIId) {
        console.warn('[LLM] 收到非预期 llm_chunk（无 currentStreamingAIId），静默丢弃');
        return state;
      }
      return {
        ...state,
        conversation: _cap(state.conversation.map(m =>
          m.id === state.currentStreamingAIId
            ? {...m, text: m.text + action.delta}
            : m,
        )),
      };
    }

    case 'llm_done': {
      const targetId = state.currentStreamingAIId;
      if (!targetId) {
        console.warn('[LLM] 收到非预期 llm_done（无 currentStreamingAIId），静默丢弃');
        return state;
      }
      const isError = !!action.error;
      return {
        ...state,
        currentStreamingAIId: null,
        conversation: _cap(state.conversation.map(m =>
          m.id === targetId
            ? {
                ...m,
                text: isError ? m.text || action.full_answer : action.full_answer,
                status: isError ? 'error' as const : 'done' as const,
              }
            : m,
        )),
      };
    }

    case 'llm_answer_error': {
      return {
        ...state,
        conversation: _cap(state.conversation.map(m =>
          m.id === action.aiBubbleId ? {...m, status: 'error'} : m,
        )),
        pendingLLMQueue: state.pendingLLMQueue.filter(id => id !== action.aiBubbleId),
      };
    }

    case 'set_language':
      return {...state, language: action.value};

    default:
      return state;
  }
}

// ── Error Helpers ─────────────────────────────────────────
function createError(code: string, stage: string, message: string): NativeCaptureError {
  return {code, stage, message, recoverable: true};
}

function normalizeError(error: unknown, defaultCode: string): NativeCaptureError {
  if (error instanceof Error) {
    return {code: defaultCode, stage: 'unknown', message: error.message, recoverable: false};
  }
  return {code: defaultCode, stage: 'unknown', message: String(error), recoverable: false};
}

// ── Permissions ───────────────────────────────────────────
interface PermissionSpec { permission: Permission; label: string; }

const REQUIRED_PERMISSIONS: PermissionSpec[] =
  Platform.OS === 'android'
    ? [{permission: PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, label: '麦克风'}]
    : [];

async function requestRuntimePermissions(): Promise<boolean> {
  if (REQUIRED_PERMISSIONS.length === 0) { return true; }
  const results = await PermissionsAndroid.requestMultiple(
    REQUIRED_PERMISSIONS.map(p => p.permission),
  );
  const denied = REQUIRED_PERMISSIONS.filter(
    p => results[p.permission] !== PermissionsAndroid.RESULTS.GRANTED,
  );
  if (denied.length > 0) {
    const names = denied.map(p => p.label).join('、');
    throw new Error(`${names}权限被拒绝`);
  }
  return true;
}

// ── Hook ──────────────────────────────────────────────────
export function useAudioCaptureController() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const operationCounter = useRef(0);
  // 0.6: LLM chunk 帧缓冲合并，减少无效渲染
  const llmChunkBuf = useRef('');
  const llmChunkRaf = useRef<number | null>(null);
  // 防卡死：限制对话历史长度，关闭高频事件节流
  const MAX_CONVERSATION = 80;
  const levelsThrottle = useRef(0);
  const statsThrottle = useRef(0);

  const canUseSystem = Platform.OS === 'android' && (state.capabilities?.systemAudio ?? false);

  const syncSnapshot = useCallback(async () => {
    try {
      const snap = await AudioCapture.getSnapshot();
      dispatch({
        type: 'snapshot',
        value: {
          captureState: snap.captureState,
          streamState: snap.streamState,
          levels: snap.levels,
          streamStats: snap.streamStats,
          pendingBackfill: snap.pendingBackfill,
          startedAtUtc: snap.startedAtUtc ?? null,
        },
      });
    } catch (e) {
      console.warn('[Controller] getSnapshot 失败:', e);
    }
  }, []);

  // ── Subscriptions ──
  useEffect(() => {
    syncSnapshot();

    const subscriptions = [
      AudioCapture.onCaptureState(event => {
        console.log('[状态] capture:', event.state);
        dispatch({type: 'captureState', value: event.state, payload: event});
      }),
      AudioCapture.onStreamState(event => {
        console.log('[状态] stream:', event.state);
        dispatch({type: 'streamState', value: event.state, message: event.message});
      }),
      AudioCapture.onLevels(value => {
        // 节流 ~100ms，音频帧 ~60fps → 降到 ~10fps
        const now = Date.now();
        if (now - levelsThrottle.current < 100) { return; }
        levelsThrottle.current = now;
        dispatch({type: 'levels', value});
      }),
      AudioCapture.onStreamStats(value => {
        const now = Date.now();
        if (now - statsThrottle.current < 200) { return; }
        statsThrottle.current = now;
        dispatch({type: 'streamStats', value});
      }),
      AudioCapture.onError(value => {
        console.error(
          `[AudioCapture] ${value.code} (${value.stage})`,
          `\n  消息: ${value.message}`,
          value.source ? `\n  来源: ${value.source}` : '',
        );
        dispatch({type: 'error', value});
      }),
      AudioCapture.onTranscription(event => {
        console.log('[转录]', event.source, event.text.slice(0, 40), 'final:', event.isFinal);
        dispatch({
          type: 'transcription',
          text: event.text,
          isFinal: event.isFinal,
          source: event.source,
          timestamp: Date.now(),
        });
      }),
      AudioCapture.onLLMStart((event: LLMStartEvent) => {
        console.log('[LLM] start lang=%s qText=%s',
          event.language, event.question_text.slice(0, 40));
        dispatch({
          type: 'llm_start',
          question_text: event.question_text,
          language: event.language,
          timestamp: event.timestamp,
        });
      }),
      AudioCapture.onLLMChunk((event: LLMChunkEvent) => {
        // RAF 帧缓冲：同一帧内的 chunk 合并为一次 dispatch，首帧即出
        llmChunkBuf.current += event.delta;
        if (llmChunkRaf.current === null) {
          llmChunkRaf.current = requestAnimationFrame(() => {
            const delta = llmChunkBuf.current;
            llmChunkBuf.current = '';
            llmChunkRaf.current = null;
            if (delta) {
              dispatch({
                type: 'llm_chunk',
                chunk_index: 0,
                delta,
                timestamp: Date.now(),
              });
            }
          });
        }
      }),
      AudioCapture.onLLMDone((event: LLMDoneEvent) => {
        // 先 flush 残留缓冲，确保最后几个字不丢
        if (llmChunkRaf.current !== null) {
          cancelAnimationFrame(llmChunkRaf.current!);
          llmChunkRaf.current = null;
        }
        if (llmChunkBuf.current) {
          dispatch({
            type: 'llm_chunk',
            chunk_index: 0,
            delta: llmChunkBuf.current,
            timestamp: Date.now(),
          });
          llmChunkBuf.current = '';
        }
        console.log('[LLM] done len=%d error=%s',
          event.full_answer.length, event.error ?? '-');
        dispatch({
          type: 'llm_done',
          full_answer: event.full_answer,
          timestamp: event.timestamp,
          error: event.error,
        });
      }),
    ];

    const appStateSub = AppState.addEventListener('change', next => {
      if (next === 'active') { syncSnapshot(); }
      if (next === 'background') {
        // 退到后台：停止采集 + 断开连接，避免原生服务残留在后台
        AudioCapture.stopCapture().catch(() => {});
        AudioCapture.disconnectStream().catch(() => {});
      }
    });

    return () => {
      if (llmChunkRaf.current !== null) {
        cancelAnimationFrame(llmChunkRaf.current!);
        llmChunkRaf.current = null;
      }
      subscriptions.forEach(s => s.remove());
      appStateSub.remove();
      // 组件卸载时清理：停止采集 + 断开连接
      AudioCapture.stopCapture().catch(() => {});
      AudioCapture.disconnectStream().catch(() => {});
    };
  }, [syncSnapshot]);

  // ── Source ──
  const setSource = useCallback((source: CaptureSource) => {
    dispatch({type: 'source', value: source});
  }, []);

  // ── System Audio Auth ──
  const authorizeSystemAudio = useCallback(async () => {
    dispatch({type: 'captureState', value: 'preparing'});
    dispatch({type: 'error', value: null});
    try {
      const granted = await AudioCapture.requestProjectionConsent();
      dispatch({type: 'projection', value: granted});
      dispatch({type: 'captureState', value: 'idle'});
      if (!granted) {
        const err: NativeCaptureError = {
          code: 'E_PROJECTION_DENIED', stage: 'consent',
          recoverable: true, message: '系统音频权限未获得授权。',
        };
        console.error(`[AudioCapture] ${err.code} (${err.stage})`, err.message);
        dispatch({type: 'error', value: err});
      }
      return granted;
    } catch (error) {
      dispatch({type: 'error', value: normalizeError(error, 'E_PROJECTION')});
      return false;
    }
  }, []);

  // ── Start ──
  const start = useCallback(async () => {
    dispatch({type: 'error', value: null});
    try {
      await requestRuntimePermissions();
      if (!state.projectionGranted) {
        const granted = await authorizeSystemAudio();
        if (!granted) {
          throw createError('E_PROJECTION_DENIED', 'consent', '需要系统音频授权才能采集。');
        }
      }
      // 重连前先断开残留连接，避免卡死
      if (state.streamState !== 'idle') {
        try { await AudioCapture.disconnectStream(); } catch (e) { /* ignore */ }
        dispatch({type: 'streamState', value: 'idle'});
      }
      try { await AudioCapture.connectStream(STREAM_URL); } catch (e) { /* 可选 */ }
      operationCounter.current += 1;
      const operationId = `${Date.now()}-${operationCounter.current}`;
      dispatch({type: 'captureState', value: 'preparing', payload: {result: null, startedAtUtc: null}});
      const info = await AudioCapture.startCapture(operationId, 'both');
      dispatch({type: 'projection', value: false});
      dispatch({type: 'captureState', value: 'capturing', payload: {startedAtUtc: info.startedAtUtc}});
    } catch (error) {
      dispatch({type: 'projection', value: false});
      dispatch({type: 'error', value: normalizeError(error, 'E_START')});
    }
  }, [state.projectionGranted, state.streamState, authorizeSystemAudio]);

  // ── Stop ──
  const stop = useCallback(async () => {
    dispatch({type: 'error', value: null});
    try {
      const result = await AudioCapture.stopCapture();
      dispatch({type: 'result', value: result});
    } catch (error) {
      dispatch({type: 'error', value: normalizeError(error, 'E_STOP')});
    }
    // 断开 WebSocket
    try { await AudioCapture.disconnectStream(); } catch (e) { /* ignore */ }
    dispatch({type: 'streamState', value: 'idle'});
  }, []);

  // ── 0.5: Tap bubble → show mode sheet ──
  // ── 0.5: 点击气泡直接触发 LLM ──
  const sendLLMQuery = useCallback((bubbleId: string) => {
    const clickedMsg = state.conversation.find(m => m.id === bubbleId);
    if (!clickedMsg || clickedMsg.role === 'ai') { return; }

    const aiBubbleId = genId('llm');
    const bubbleSource = clickedMsg.role === 'interviewer' ? 'system' : 'mic';
    const now = Date.now();

    dispatch({
      type: 'llm_query_sent',
      aiBubbleId,
      insertedAfterId: clickedMsg.id,
      timestamp: now,
    });

    AudioCapture.sendControl({
      type: 'llm_query',
      text: clickedMsg.text,
      language: state.language,
      bubble_source: bubbleSource,
    });

    console.log('[LLM] 发送 llm_query:', {text: clickedMsg.text.slice(0, 40), language: state.language, bubble_source: bubbleSource});
  }, [state.conversation, state.language]);

  // ── 0.5: Retry failed AI answer ──
  const retryLLM = useCallback((aiBubbleId: string) => {
    const aiMsg = state.conversation.find(m => m.id === aiBubbleId);
    if (!aiMsg || aiMsg.role !== 'ai' || aiMsg.status !== 'error') { return; }

    const aiIdx = state.conversation.findIndex(m => m.id === aiBubbleId);
    if (aiIdx <= 0) { return; }
    const clickedMsg = state.conversation[aiIdx - 1]!;
    if (clickedMsg.role === 'ai') { return; }

    const newAiBubbleId = genId('llm');
    const bubbleSource = clickedMsg.role === 'interviewer' ? 'system' : 'mic';
    const now = Date.now();

    dispatch({
      type: 'llm_query_sent',
      aiBubbleId: newAiBubbleId,
      insertedAfterId: clickedMsg.id,
      timestamp: now,
    });

    AudioCapture.sendControl({
      type: 'llm_query',
      text: clickedMsg.text,
      language: state.language,
      bubble_source: bubbleSource,
    });
  }, [state.conversation, state.language]);

  // ── Share ──
  const share = useCallback(async (sessionId: string, source: TrackSource, kind: 'pcm' | 'wav') => {
    try {
      await AudioCapture.shareOutput(sessionId, source, kind);
    } catch (error) {
      dispatch({type: 'error', value: normalizeError(error, 'E_SHARE')});
    }
  }, []);

  // ── 0.6: 发送 LLM 配置帧 ──
  const sendConfig = useCallback((llmConfig: {enabled?: boolean; max_tokens?: number; model?: string}) => {
    AudioCapture.sendControl({
      type: 'config',
      llm: llmConfig,
    });
    console.log('[LLM] 发送 config:', JSON.stringify(llmConfig));
  }, []);

  return {
    state,
    canUseSystem,
    setSource,
    authorizeSystemAudio,
    start,
    stop,
    syncSnapshot,
    share,
    sendLLMQuery,
    retryLLM,
    sendConfig,
    setLanguage: useCallback((value: 'zh' | 'en') => dispatch({type: 'set_language', value}), []),
  };
}
