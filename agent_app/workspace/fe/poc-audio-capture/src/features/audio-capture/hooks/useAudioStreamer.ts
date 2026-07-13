import { useCallback, useRef, useState } from 'react';

export type StreamerState = 'idle' | 'connecting' | 'connected' | 'streaming' | 'disconnected' | 'error';

export interface StreamerStats {
  bytesSent: number;
  framesSent: number;
  durationMs: number;
  error: string | null;
}

const FRAME_SIZE = 640; // 20ms @ 16kHz/16bit/mono

export function useAudioStreamer() {
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<StreamerState>('idle');
  const [stats, setStats] = useState<StreamerStats>({
    bytesSent: 0,
    framesSent: 0,
    durationMs: 0,
    error: null,
  });
  const statsRef = useRef(stats);
  statsRef.current = stats;

  const connect = useCallback(
    (url: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (wsRef.current) {
          wsRef.current.close();
        }

        setState('connecting');
        setStats({ bytesSent: 0, framesSent: 0, durationMs: 0, error: null });

        try {
          const ws = new WebSocket(url);
          ws.binaryType = 'arraybuffer';
          wsRef.current = ws;

          ws.onopen = () => {
            // Send config handshake
            const handshake = JSON.stringify({
              config: {
                sample_rate: 16000,
                bit_depth: 16,
                channels: 1,
              },
            });
            ws.send(handshake);
          };

          ws.onmessage = (event) => {
            // First message should be JSON "ready"
            if (typeof event.data === 'string') {
              try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'ready') {
                  setState('connected');
                  resolve();
                }
              } catch {
                // Not JSON, ignore
              }
            }
          };

          ws.onerror = () => {
            const errMsg = 'WebSocket connection error';
            setState('error');
            setStats((prev) => ({ ...prev, error: errMsg }));
            reject(new Error(errMsg));
          };

          ws.onclose = () => {
            wsRef.current = null;
            if (statsRef.current.bytesSent > 0) {
              setState('disconnected');
            } else if (state !== 'error') {
              setState('idle');
            }
          };
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : 'Failed to create WebSocket';
          setState('error');
          setStats((prev) => ({ ...prev, error: errMsg }));
          reject(new Error(errMsg));
        }
      });
    },
    [state]
  );

  /** Send a single PCM frame (640 bytes) */
  const sendFrame = useCallback((buffer: ArrayBuffer): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      ws.send(buffer);
      setStats((prev) => ({
        ...prev,
        bytesSent: prev.bytesSent + buffer.byteLength,
        framesSent: prev.framesSent + 1,
        durationMs: (prev.framesSent + 1) * 20,
      }));
      return true;
    } catch {
      setState('error');
      setStats((prev) => ({ ...prev, error: 'Failed to send frame' }));
      return false;
    }
  }, []);

  /** Stream an entire PCM file in 640-byte frames */
  const streamPcmFile = useCallback(
    async (fileUri: string): Promise<void> => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket not connected');
      }

      setState('streaming');

      try {
        // Read PCM file as ArrayBuffer via fetch
        const response = await fetch(fileUri);
        if (!response.ok) {
          throw new Error(`Failed to read PCM file: ${response.status}`);
        }

        const fullBuffer = await response.arrayBuffer();
        const totalFrames = Math.floor(fullBuffer.byteLength / FRAME_SIZE);

        for (let i = 0; i < totalFrames; i++) {
          const offset = i * FRAME_SIZE;
          const frame = fullBuffer.slice(offset, offset + FRAME_SIZE);

          const sent = sendFrame(frame);
          if (!sent) {
            throw new Error('WebSocket disconnected during streaming');
          }

          // 20ms pacing — use a small delay to simulate real-time
          // In real-time streaming we'd use native events, but for file-based PoC
          // we pace the sends to match 20ms frame intervals
          await new Promise((r) => setTimeout(r, 5)); // 5ms gap between frames
        }

        setState('connected');
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : 'Streaming error';
        setState('error');
        setStats((prev) => ({ ...prev, error: errMsg }));
        throw e;
      }
    },
    [sendFrame]
  );

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState('idle');
  }, []);

  return {
    state,
    stats,
    connect,
    disconnect,
    sendFrame,
    streamPcmFile,
  };
}
