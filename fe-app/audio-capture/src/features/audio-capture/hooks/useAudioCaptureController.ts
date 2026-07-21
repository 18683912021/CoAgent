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
  type NativeCaptureError,
  type StreamState,
  type StreamStats,
  type TrackSource,
} from '../../../native/audio-capture';

const EMPTY_LEVELS: AudioLevels = {mic: 0, system: 0};
const EMPTY_STREAM_STATS: StreamStats = {
  queuedBytes: 0,
  transportBytes: 0,
  acknowledgedBytes: 0,
  realtimeFrames: 0,
  droppedFrames: 0,
  backfillBytes: 0,
};

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
  | {type: 'snapshot'; value: Partial<ControllerState>};

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
};

function reducer(state: ControllerState, action: Action): ControllerState {
  switch (action.type) {
    case 'capabilities':
      return {...state, capabilities: action.value};
    case 'source':
      return {
        ...state,
        source: action.value,
        projectionGranted: false,
        result: null,
        error: null,
      };
    case 'projection':
      return {...state, projectionGranted: action.value, error: null};
    case 'captureState':
      return {...state, captureState: action.value, ...action.payload};
    case 'streamState':
      return {
        ...state,
        streamState: action.value,
        streamMessage: action.message ?? null,
      };
    case 'levels':
      return {...state, levels: action.value};
    case 'streamStats':
      return {...state, streamStats: action.value};
    case 'result':
      return {
        ...state,
        result: action.value,
        captureState: 'completed',
        levels: EMPTY_LEVELS,
      };
    case 'error':
      return {...state, error: action.value};
    case 'snapshot':
      return {...state, ...action.value};
    default:
      return state;
  }
}

export function useAudioCaptureController() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const operationCounter = useRef(0);

  const syncSnapshot = useCallback(async () => {
    try {
      const snapshot = await AudioCapture.getSnapshot();
      dispatch({
        type: 'snapshot',
        value: {
          captureState: snapshot.captureState,
          streamState: snapshot.streamState,
          levels: snapshot.levels,
          streamStats: snapshot.streamStats,
          startedAtUtc: snapshot.startedAtUtc ?? null,
          result: snapshot.lastResult ?? null,
          pendingBackfill: snapshot.pendingBackfill,
        },
      });
    } catch (error) {
      dispatch({type: 'error', value: normalizeError(error, 'E_SNAPSHOT')});
    }
  }, [state.source]);

  useEffect(() => {
    AudioCapture.getCapabilities()
      .then(value => dispatch({type: 'capabilities', value}))
      .catch(error =>
        dispatch({type: 'error', value: normalizeError(error, 'E_CAPABILITIES')}),
      );
    syncSnapshot();

    const subscriptions = [
      AudioCapture.onCaptureState(event => {
        dispatch({
          type: 'snapshot',
          value: {
            captureState: event.state,
            streamState: event.streamState,
            levels: event.levels,
            streamStats: event.streamStats,
            startedAtUtc: event.startedAtUtc ?? null,
            result: event.lastResult ?? null,
            pendingBackfill: event.pendingBackfill,
          },
        });
      }),
      AudioCapture.onLevels(value => dispatch({type: 'levels', value})),
      AudioCapture.onStreamState(event =>
        dispatch({
          type: 'streamState',
          value: event.state,
          message: event.message,
        }),
      ),
      AudioCapture.onStreamStats(value =>
        dispatch({type: 'streamStats', value}),
      ),
      AudioCapture.onError(value => dispatch({type: 'error', value})),
    ];

    const appStateSubscription = AppState.addEventListener('change', next => {
      if (next === 'active') {syncSnapshot();}
    });

    return () => {
      subscriptions.forEach(subscription => subscription.remove());
      appStateSubscription.remove();
    };
  }, [syncSnapshot]);

  const setSource = useCallback((source: CaptureSource) => {
    dispatch({type: 'source', value: source});
  }, []);

  const authorizeSystemAudio = useCallback(async () => {
    dispatch({type: 'captureState', value: 'preparing'});
    dispatch({type: 'error', value: null});
    try {
      const granted = await AudioCapture.requestProjectionConsent();
      dispatch({type: 'projection', value: granted});
      dispatch({type: 'captureState', value: 'idle'});
      if (!granted) {
        dispatch({
          type: 'error',
          value: {
            code: 'E_PROJECTION_DENIED',
            stage: 'consent',
            recoverable: true,
            message: '系统音频权限未获得授权。',
          },
        });
      }
      return granted;
    } catch (error) {
      dispatch({type: 'error', value: normalizeError(error, 'E_PROJECTION')});
      return false;
    }
  }, []);

  const start = useCallback(async () => {
    dispatch({type: 'error', value: null});
    try {
      await requestRuntimePermissions();
      if (state.source !== 'mic' && !state.projectionGranted) {
        throw createError(
          'E_PROJECTION_REQUIRED',
          'consent',
          '开始采集前请先授权系统音频。',
        );
      }
      operationCounter.current += 1;
      const operationId = `${Date.now()}-${operationCounter.current}`;
      dispatch({
        type: 'captureState',
        value: 'preparing',
        payload: {result: null, startedAtUtc: null},
      });
      const info = await AudioCapture.startCapture(operationId, state.source);
      dispatch({type: 'projection', value: false});
      dispatch({
        type: 'captureState',
        value: 'capturing',
        payload: {startedAtUtc: info.startedAtUtc},
      });
    } catch (error) {
      dispatch({type: 'captureState', value: 'error'});
      dispatch({type: 'error', value: normalizeError(error, 'E_CAPTURE_START')});
    }
  }, [state.projectionGranted, state.source]);

  const stop = useCallback(async () => {
    dispatch({type: 'captureState', value: 'stopping'});
    dispatch({type: 'error', value: null});
    try {
      const result = await AudioCapture.stopCapture();
      dispatch({type: 'result', value: result});
    } catch (error) {
      dispatch({type: 'captureState', value: 'error'});
      dispatch({type: 'error', value: normalizeError(error, 'E_CAPTURE_STOP')});
    }
  }, []);

  const connect = useCallback(async (url: string) => {
    dispatch({type: 'streamState', value: 'connecting'});
    dispatch({type: 'error', value: null});
    try {
      await AudioCapture.connectStream(url.trim());
      dispatch({type: 'streamState', value: 'ready'});
    } catch (error) {
      dispatch({type: 'error', value: normalizeError(error, 'E_WS_CONNECT')});
      dispatch({type: 'streamState', value: 'error'});
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await AudioCapture.disconnectStream();
      dispatch({type: 'streamState', value: 'idle'});
    } catch (error) {
      dispatch({type: 'error', value: normalizeError(error, 'E_WS_DISCONNECT')});
    }
  }, []);

  const retryBackfill = useCallback(async () => {
    try {
      await AudioCapture.retryBackfill();
    } catch (error) {
      dispatch({type: 'error', value: normalizeError(error, 'E_BACKFILL')});
    }
  }, []);

  const shareOutput = useCallback(
    async (source: TrackSource, kind: 'pcm' | 'wav') => {
      if (!state.result) {return;}
      try {
        await AudioCapture.shareOutput(state.result.sessionId, source, kind);
      } catch (error) {
        dispatch({type: 'error', value: normalizeError(error, 'E_FILE_SHARE')});
      }
    },
    [state.result],
  );

  const clearError = useCallback(() => {
    dispatch({type: 'error', value: null});
    if (state.captureState === 'error') {
      dispatch({type: 'captureState', value: 'idle'});
    }
  }, [state.captureState]);

  const isBusy = useMemo(
    () =>
      ['preparing', 'capturing', 'stopping', 'finalizing'].includes(
        state.captureState,
      ),
    [state.captureState],
  );
  const canUseSystem = state.capabilities?.systemAudio === true;
  const needsProjection = state.source !== 'mic';

  return {
    state,
    isBusy,
    canUseSystem,
    needsProjection,
    setSource,
    authorizeSystemAudio,
    start,
    stop,
    connect,
    disconnect,
    retryBackfill,
    shareOutput,
    clearError,
  };
}

async function requestRuntimePermissions(): Promise<void> {
  if (Platform.OS !== 'android') {return;}
  const recordResult = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  );
  if (recordResult !== PermissionsAndroid.RESULTS.GRANTED) {
    throw createError(
      'E_RECORD_PERMISSION',
      'permission',
      '麦克风权限是音频采集的必要条件。',
    );
  }

  if (Number(Platform.Version) >= 33) {
    const notificationPermission =
      'android.permission.POST_NOTIFICATIONS' as Permission;
    await PermissionsAndroid.request(notificationPermission);
  }
}

function normalizeError(error: unknown, fallbackCode: string): NativeCaptureError {
  const value = error as Partial<NativeCaptureError> & {message?: string};
  return {
    code: value.code ?? fallbackCode,
    stage: value.stage ?? 'javascript',
    source: value.source,
    recoverable: value.recoverable ?? true,
    message: value.message ?? String(error),
  };
}

function createError(
  code: string,
  stage: string,
  message: string,
): NativeCaptureError {
  return {code, stage, recoverable: true, message};
}
