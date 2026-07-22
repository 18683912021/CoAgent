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
  type LLMAnswerEvent,
  type NativeCaptureError,
  type StreamState,
  type StreamStats,
  type TrackSource,
} from '../../../native/audio-capture';
import {STREAM_URL} from '../config';

// ── Constants ──────────────────────────────────────────────
const EMPTY_LEVELS: AudioLevels = {mic: 0, system: 0};
const EMPTY_STREAM_STATS: StreamStats = {
  queuedBytes: 0, transportBytes: 0, acknowledgedBytes: 0,
  realtimeFrames: 0, droppedFrames: 0, backfillBytes: 0,
};

// ── Types ──────────────────────────────────────────────────
export type ConversationBubbleStatus = 'loading' | 'streaming' | 'done' | 'error';
export type LLMMode = 'brief' | 'normal' | 'detailed';

export interface ConversationMessage {
  id: string;
  role: 'interviewer' | 'user' | 'ai';
  text: string;
  status: ConversationBubbleStatus;
  mode?: LLMMode;
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
  // ── 0.5 新增 ──
  selectedMessageId: string | null;
  showModeSheet: boolean;
  pendingLLMQueue: string[];
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
  | {type: 'llm_answer'; chunk: string; chunk_index: number; is_final: boolean; mode?: string}
  | {type: 'snapshot'; value: Partial<ControllerState>}
  | {type: 'select_bubble'; bubbleId: string}
  | {type: 'dismiss_sheet'}
  | {type: 'llm_query_sent'; aiBubbleId: string; insertedAfterId: string; mode: LLMMode; timestamp: number}
  | {type: 'llm_answer_error'; aiBubbleId: string};

// ── Initial State ─────────────────────────────────────────
const INITIAL_STATE: ControllerState = {
  capabilities: null,
  captureState: 'idle',
  streamState: 'idle',
  source: 'mic',
  projectionGranted: false,
  levels: EMPTY_LEVELS,
  streamStats: EMPTY_STREAM_STATS,
  startedAtUtc: null,
  result: null,
  pendingBackfill: false,
  error: null,
  streamMessage: null,
  conversation: [],
  selectedMessageId: null,
  showModeSheet: false,
  pendingLLMQueue: [],
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

// ── Reducer ───────────────────────────────────────────────
function reducer(state: ControllerState, action: Action): ControllerState {
  switch (action.type) {
    case 'capabilities':
      return {...state, capabilities: action.value};
    case 'source':
      return {...state, source: action.value};
    case 'projection':
      return {...state, projectionGranted: action.value};
    case 'captureState':
      return {...state, captureState: action.value, ...(action.payload ?? {})};
    case 'streamState':
      return {...state, streamState: action.value, streamMessage: action.message ?? state.streamMessage};
    case 'levels':
      return {...state, levels: action.value};
    case 'streamStats':
      return {...state, streamStats: action.value};
    case 'result':
      return {...state, result: action.value};
    case 'error':
      return {...state, error: action.value};
    case 'snapshot':
      return {...state, ...action.value};

    // ── 0.5: Transcription → bubble ──
    case 'transcription': {
      const role = action.source === 'system' ? 'interviewer' : 'user';
      const now = action.timestamp;

      // 查找同 role 的流式气泡（正在被更新的）
      const streamingIdx = state.conversation.findIndex(
        m => m.role === role && m.status === 'streaming',
      );

      if (streamingIdx !== -1) {
        return {
          ...state,
          conversation: state.conversation.map((m, i) =>
            i === streamingIdx
              ? {...m, text: action.text, status: action.isFinal ? 'done' : 'streaming'}
              : m,
          ),
        };
      }

      // 无流式气泡 → 新建
      const newMsg: ConversationMessage = {
        id: genId(role === 'interviewer' ? 'int' : 'usr'),
        role,
        text: action.text,
        status: action.isFinal ? 'done' : 'streaming',
        timestamp: now,
      };
      return {...state, conversation: [...state.conversation, newMsg]};
    }

    // ── 0.5: 选择气泡 ──
    case 'select_bubble':
      return {...state, selectedMessageId: action.bubbleId, showModeSheet: true};

    // ── 0.5: 关闭面板 ──
    case 'dismiss_sheet':
      return {...state, showModeSheet: false, selectedMessageId: null};

    // ── 0.5: 发送 llm_query → 插入 loading AI 气泡 ──
    case 'llm_query_sent': {
      const aiMsg: ConversationMessage = {
        id: action.aiBubbleId,
        role: 'ai',
        text: '',
        status: 'loading',
        mode: action.mode,
        timestamp: action.timestamp,
      };
      return {
        ...state,
        conversation: insertAfter(state.conversation, action.insertedAfterId, aiMsg),
        pendingLLMQueue: [...state.pendingLLMQueue, action.aiBubbleId],
        showModeSheet: false,
        selectedMessageId: null,
      };
    }

    // ── 0.5: 流式回答 ──
    case 'llm_answer': {
      if (action.chunk_index === 0) {
        if (state.pendingLLMQueue.length === 0) {
          console.warn('[LLM] 收到非预期 llm_answer（无 pending query），静默丢弃');
          return state;
        }
        const [aiBubbleId, ...restQueue] = state.pendingLLMQueue;
        return {
          ...state,
          pendingLLMQueue: restQueue,
          conversation: state.conversation.map(m =>
            m.id === aiBubbleId
              ? {
                  ...m,
                  text: action.chunk,
                  status: action.is_final ? 'done' : 'streaming',
                  mode: (action.mode as LLMMode) ?? m.mode,
                }
              : m,
          ),
        };
      }
      // 后续 chunk
      const streamingAi = state.conversation.find(
        m => m.role === 'ai' && m.status === 'streaming',
      );
      if (!streamingAi) {
        console.warn('[LLM] 收到非预期 llm_answer chunk（无 streaming AI 气泡），静默丢弃');
        return state;
      }
      return {
        ...state,
        conversation: state.conversation.map(m =>
          m.id === streamingAi.id
            ? {...m, text: m.text + action.chunk, status: action.is_final ? 'done' : 'streaming'}
            : m,
        ),
      };
    }

    case 'llm_answer_error': {
      return {
        ...state,
        conversation: state.conversation.map(m =>
          m.id === action.aiBubbleId ? {...m, status: 'error'} : m,
        ),
        pendingLLMQueue: state.pendingLLMQueue.filter(id => id !== action.aiBubbleId),
      };
    }

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

  const canUseSystem = Platform.OS === 'android' && (state.capabilities?.systemAudio ?? false);

  // ── Snapshot Sync ──
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
      AudioCapture.onLevels(value => dispatch({type: 'levels', value})),
      AudioCapture.onStreamStats(value => dispatch({type: 'streamStats', value})),
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
      AudioCapture.onLLMAnswer((event: LLMAnswerEvent) => {
        console.log('[LLM] chunk=%d isFinal=%s mode=%s text=%s',
          event.chunk_index, event.is_final, event.mode ?? '-',
          event.chunk.slice(0, 40));
        dispatch({
          type: 'llm_answer',
          chunk: event.chunk,
          chunk_index: event.chunk_index,
          is_final: event.is_final,
          mode: event.mode,
        });
      }),
    ];

    const appStateSub = AppState.addEventListener('change', next => {
      if (next === 'active') { syncSnapshot(); }
    });

    return () => {
      subscriptions.forEach(s => s.remove());
      appStateSub.remove();
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
      if (state.source !== 'mic' && !state.projectionGranted) {
        throw createError('E_PROJECTION_REQUIRED', 'consent', '开始采集前请先授权系统音频。');
      }
      if (state.streamState !== 'ready' && state.streamState !== 'connecting') {
        console.log('[Controller] 自动连接 WebSocket:', STREAM_URL);
        await AudioCapture.connectStream(STREAM_URL);
      }
      operationCounter.current += 1;
      const operationId = `${Date.now()}-${operationCounter.current}`;
      dispatch({type: 'captureState', value: 'preparing'});
      await AudioCapture.startCapture(operationId, state.source);
    } catch (error) {
      dispatch({type: 'error', value: normalizeError(error, 'E_START')});
    }
  }, [state.source, state.projectionGranted, state.streamState]);

  // ── Stop ──
  const stop = useCallback(async () => {
    dispatch({type: 'error', value: null});
    try {
      const result = await AudioCapture.stopCapture();
      dispatch({type: 'result', value: result});
    } catch (error) {
      dispatch({type: 'error', value: normalizeError(error, 'E_STOP')});
    }
  }, []);

  // ── 0.5: 点击气泡 → 弹出模式选择 ──
  const selectBubble = useCallback((bubbleId: string) => {
    const msg = state.conversation.find(m => m.id === bubbleId);
    if (!msg || msg.role === 'ai') { return; }
    dispatch({type: 'select_bubble', bubbleId});
  }, [state.conversation]);

  // ── 0.5: 关闭模式面板 ──
  const dismissSheet = useCallback(() => {
    dispatch({type: 'dismiss_sheet'});
  }, []);

  // ── 0.5: 发送 LLM 查询 ──
  const sendLLMQuery = useCallback((mode: LLMMode) => {
    const clickedMsg = state.selectedMessageId
      ? state.conversation.find(m => m.id === state.selectedMessageId)
      : null;
    if (!clickedMsg || clickedMsg.role === 'ai') { return; }

    const aiBubbleId = genId('llm');
    const bubbleSource = clickedMsg.role === 'interviewer' ? 'system' : 'mic';
    const now = Date.now();

    dispatch({
      type: 'llm_query_sent',
      aiBubbleId,
      insertedAfterId: clickedMsg.id,
      mode,
      timestamp: now,
    });

    AudioCapture.sendControl({
      type: 'llm_query',
      text: clickedMsg.text,
      mode,
      bubble_source: bubbleSource,
    });

    console.log('[LLM] 发送 llm_query:', {text: clickedMsg.text.slice(0, 40), mode, bubble_source});
  }, [state.selectedMessageId, state.conversation]);

  // ── 0.5: 重试失败的 AI 回答 ──
  const retryLLM = useCallback((aiBubbleId: string) => {
    const aiMsg = state.conversation.find(m => m.id === aiBubbleId);
    if (!aiMsg || aiMsg.role !== 'ai' || aiMsg.status !== 'error') { return; }

    const aiIdx = state.conversation.findIndex(m => m.id === aiBubbleId);
    if (aiIdx <= 0) { return; }
    const clickedMsg = state.conversation[aiIdx - 1];
    if (clickedMsg.role === 'ai') { return; }

    const newAiBubbleId = genId('llm');
    const bubbleSource = clickedMsg.role === 'interviewer' ? 'system' : 'mic';
    const now = Date.now();

    dispatch({
      type: 'llm_query_sent',
      aiBubbleId: newAiBubbleId,
      insertedAfterId: clickedMsg.id,
      mode: aiMsg.mode ?? 'normal',
      timestamp: now,
    });

    AudioCapture.sendControl({
      type: 'llm_query',
      text: clickedMsg.text,
      mode: aiMsg.mode ?? 'normal',
      bubble_source: bubbleSource,
    });
  }, [state.conversation]);

  // ── Share ──
  const share = useCallback(async (sessionId: string, source: TrackSource, kind: 'pcm' | 'wav') => {
    try {
      await AudioCapture.shareOutput(sessionId, source, kind);
    } catch (error) {
      dispatch({type: 'error', value: normalizeError(error, 'E_SHARE')});
    }
  }, []);

  // ── Computed ──
  const selectedMessage = useMemo(
    () => state.selectedMessageId
      ? state.conversation.find(m => m.id === state.selectedMessageId) ?? null
      : null,
    [state.selectedMessageId, state.conversation],
  );

  return {
    state,
    canUseSystem,
    setSource,
    authorizeSystemAudio,
    start,
    stop,
    syncSnapshot,
    share,
    selectBubble,
    dismissSheet,
    sendLLMQuery,
    retryLLM,
    selectedMessage,
  };
}
