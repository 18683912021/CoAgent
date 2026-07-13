import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { OutputFiles } from '../../../../modules/audio-capture';

interface FileInfoProps {
  files: OutputFiles | null;
  captureSource: string;
}

const needsMic = (src: string) => src === 'mic' || src === 'both';
const needsSystem = (src: string) => src === 'system' || src === 'both';

export default function FileInfo({ files, captureSource }: FileInfoProps): React.ReactElement {
  if (!files || (!files.mic && !files.system)) return <View />;

  const renderFileRow = (label: string, path: string) => (
    <View key={label} style={styles.row}>
      <Text style={styles.fileLabel}>{label}</Text>
      <Text style={styles.filePath} numberOfLines={2} ellipsizeMode="middle">
        {path}
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>💾 音频文件</Text>
        <Text style={styles.hint}>adb pull 导出</Text>
      </View>
      {needsMic(captureSource) && files.mic ? renderFileRow('🎤 MIC', files.mic) : null}
      {needsSystem(captureSource) && files.system ? renderFileRow('🔊 系统', files.system) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  hint: {
    fontSize: 11,
    color: '#aaa',
  },
  row: {
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
    gap: 4,
  },
  fileLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  filePath: {
    fontSize: 11,
    color: '#666',
    fontFamily: 'monospace',
  },
});
