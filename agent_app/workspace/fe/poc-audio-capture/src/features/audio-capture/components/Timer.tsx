import React, { useEffect, useRef, useState } from 'react';
import { Text, StyleSheet } from 'react-native';

interface TimerProps {
  isActive: boolean;
}

function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export default function Timer({ isActive }: TimerProps): React.ReactElement {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (isActive) {
      startRef.current = Date.now();
      setElapsed(0);

      const timer = setInterval(() => {
        if (startRef.current) {
          setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
        }
      }, 200);

      return () => clearInterval(timer);
    } else {
      startRef.current = null;
    }
  }, [isActive]);

  return <Text style={styles.time}>{formatTime(elapsed)}</Text>;
}

const styles = StyleSheet.create({
  time: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1a1a2e',
    fontVariant: ['tabular-nums'],
    letterSpacing: 2,
  },
});
