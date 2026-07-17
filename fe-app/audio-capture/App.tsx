import React from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AudioCaptureScreen from './src/features/audio-capture/screen';

const Stack = createStackNavigator();

export default function App(): React.ReactElement {
  const colorScheme = useColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar
        barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colorScheme === 'dark' ? '#0a0a0a' : '#f5f5f5'}
      />
      <NavigationContainer>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            cardStyle: {
              backgroundColor: colorScheme === 'dark' ? '#0a0a0a' : '#f5f5f5',
            },
          }}
        >
          <Stack.Screen name="Home" component={AudioCaptureScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}
