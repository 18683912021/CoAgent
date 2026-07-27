import React, {useState} from 'react';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import TabNavigator from './src/navigation/TabNavigator';
import AuthScreen from './src/screens/AuthScreen';

export default function App(): React.JSX.Element {
  // TODO: 接入后端后改为持久化登录态（Token/AsyncStorage）
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  return (
    <SafeAreaProvider>
      {isLoggedIn ? (
        <TabNavigator />
      ) : (
        <AuthScreen onLogin={() => setIsLoggedIn(true)} onRegister={() => setIsLoggedIn(true)} />
      )}
    </SafeAreaProvider>
  );
}
