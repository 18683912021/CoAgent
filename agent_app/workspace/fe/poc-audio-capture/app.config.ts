import type { ExpoConfig } from '@expo/config-types';

const PROJECT_ID = '3961934d-f420-41c3-906d-f05e46e4d31a';

const appConfig: ExpoConfig = {
  name: 'AudioCapture PoC',
  slug: 'poc-audio-capture',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'poc-audiocapture',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,

  icon: './assets/images/icon.png',
  splash: {
    image: './assets/images/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff',
    dark: {
      image: './assets/images/splash-icon-dark.png',
      resizeMode: 'contain',
      backgroundColor: '#1a1a2e',
    },
  },

  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.poc.audiocapture',
    buildNumber: '1',
  },

  android: {
    package: 'com.poc.audiocapture',
    versionCode: 1,
    minSdkVersion: 29, // AudioPlaybackCapture 需要 API 29+
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },
  },

  updates: {
    url: `https://u.expo.dev/${PROJECT_ID}`,
    requestHeaders: {
      'expo-channel-name': 'production',
    },
  },
  runtimeVersion: {
    policy: 'appVersion',
  },

  extra: {
    eas: {
      projectId: PROJECT_ID,
    },
  },

  plugins: [
    'expo-router',
    [
      'expo-build-properties',
      {
        android: {
          minSdkVersion: 29,
        },
      },
    ],
    ['./modules/audio-capture/plugin', {}],
  ],

  experiments: {
    typedRoutes: true,
  },
};

export default appConfig;
