import React from 'react';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import InterviewScreen from './src/InterviewScreen';

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <InterviewScreen />
    </SafeAreaProvider>
  );
}
