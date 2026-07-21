import React, {useEffect, useState} from 'react';
import {StyleSheet, Text} from 'react-native';

export function Timer({startedAtUtc, active}: {startedAtUtc: string | null; active: boolean}) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!startedAtUtc) {
      setElapsedMs(0);
      return;
    }
    const startedAt = Date.parse(startedAtUtc);
    const update = () => setElapsedMs(Math.max(0, Date.now() - startedAt));
    update();
    if (!active) {return;}
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [active, startedAtUtc]);

  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return (
    <Text style={styles.text} accessibilityLabel={`采集时长 ${hours} 小时 ${minutes} 分钟 ${seconds} 秒`}>
      {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: {fontSize: 30, fontVariant: ['tabular-nums'], fontWeight: '800', color: '#0f172a'},
});
