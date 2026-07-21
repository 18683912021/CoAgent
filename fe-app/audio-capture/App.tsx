import React from 'react';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import AudioCaptureScreen from './src/features/audio-capture/AudioCaptureScreen';

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <AudioCaptureScreen />
    </SafeAreaProvider>
  );
}
