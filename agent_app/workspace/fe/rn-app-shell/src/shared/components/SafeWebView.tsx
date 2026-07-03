/**
 * SafeWebView — WebView 安全封装
 *
 * 四态覆盖：
 * - loading: 顶部进度条 + 骨架
 * - loaded: 正常展示
 * - error: 错误页 + 重试按钮
 * - empty: url 为空时占位
 *
 * JS Bridge 基础接口：
 * - onMessage: 接收网页 postMessage
 * - postMessage: 向网页发送消息
 */

import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView, WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';
import { useAppTheme } from '@design-system/theme';
import { radii, spacing, fontSizes, fontWeights } from '@design-system/tokens';

interface WebViewBridgeMessage {
  type: string;
  payload?: unknown;
}

interface SafeWebViewProps {
  uri?: string | null;
  /** 注入到网页的 JS（在页面加载前注入） */
  injectedJavaScript?: string;
  /** 接收网页消息 */
  onBridgeMessage?: (message: WebViewBridgeMessage) => void;
  /** 外部样式 */
  style?: object;
  /** 是否允许后退手势，默认 true */
  allowBackForwardGestures?: boolean;
  /** 自定义 Loading 组件 */
  LoadingComponent?: React.ReactElement;
  /** 自定义 Error 组件 */
  ErrorComponent?: React.ReactElement;
}

/**
 * 默认注入的 JS Bridge 脚本
 * 网页端通过 window.ReactNativeWebView.postMessage(JSON.stringify({ type, payload })) 通信
 */
const DEFAULT_BRIDGE_JS = `
(function() {
  window.RNBridge = {
    postMessage: function(msg) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(msg));
      }
    }
  };
})();
true;
`;

export function SafeWebView({
  uri,
  injectedJavaScript,
  onBridgeMessage,
  style,
  allowBackForwardGestures = true,
  LoadingComponent,
  ErrorComponent,
}: SafeWebViewProps): React.ReactElement {
  const theme = useAppTheme();
  const webViewRef = useRef<WebView>(null);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [loadProgress, setLoadProgress] = useState(0);
  const [errorKey, setErrorKey] = useState(0);

  // ---- 消息处理 ----
  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const data = JSON.parse(event.nativeEvent.data) as WebViewBridgeMessage;
        onBridgeMessage?.(data);
      } catch {
        // 忽略非 JSON 消息
      }
    },
    [onBridgeMessage],
  );

  // ---- 导航状态 ----
  const handleNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    if (navState.loading) {
      setStatus('loading');
    }
  }, []);

  const handleLoadEnd = useCallback(() => {
    setStatus('loaded');
    setLoadProgress(1);
  }, []);

  const handleError = useCallback(() => {
    setStatus('error');
    setLoadProgress(0);
  }, []);

  const handleRetry = useCallback(() => {
    setStatus('loading');
    setLoadProgress(0);
    setErrorKey((k) => k + 1);
    webViewRef.current?.reload();
  }, []);

  // ---- 向网页发送消息 ----
  const postMessage = useCallback((message: WebViewBridgeMessage) => {
    webViewRef.current?.injectJavaScript(
      `window.RNBridge && window.RNBridge.postMessage(${JSON.stringify(message)}); true;`,
    );
  }, []);

  // 暴露方法给父组件（通过 ref 或其他方式，这里先提供基础封装）

  // ---- 空 URI ----
  if (!uri) {
    return (
      <View
        style={[
          styles.center,
          { backgroundColor: theme.isDark ? '#1a1a1a' : '#f0f0f0', borderRadius: radii.md },
          style,
        ]}
      >
        <Text style={[styles.emptyText, { color: theme.colors.semantic.textTertiary }]}>暂无内容</Text>
      </View>
    );
  }

  return (
    <View style={[{ flex: 1, overflow: 'hidden', borderRadius: radii.md }, style]}>
      {/* 进度条 */}
      {status === 'loading' && (
        <View style={[styles.progressBar, { backgroundColor: theme.colors.semantic.border }]}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${Math.max(loadProgress * 100, 10)}%`,
                backgroundColor: theme.colors.primary,
              },
            ]}
          />
        </View>
      )}

      {/* Loading 遮罩 */}
      {status === 'loading' && (
        <View style={[styles.loadingOverlay, { backgroundColor: theme.colors.semantic.background }]}>
          {LoadingComponent ?? <ActivityIndicator size="small" color={theme.colors.primary} />}
        </View>
      )}

      {/* Error 遮罩 */}
      {status === 'error' && (
        <View style={[styles.center, styles.errorOverlay, { backgroundColor: theme.colors.semantic.background }]}>
          {ErrorComponent ?? (
            <View style={styles.errorContent}>
              <Text style={styles.errorIcon}>⚠</Text>
              <Text style={[styles.errorTitle, { color: theme.colors.semantic.textPrimary }]}>加载失败</Text>
              <Text style={[styles.errorDesc, { color: theme.colors.semantic.textTertiary }]}>
                请检查网络连接后重试
              </Text>
              <TouchableOpacity
                style={[styles.retryBtn, { backgroundColor: theme.colors.primary }]}
                onPress={handleRetry}
              >
                <Text style={styles.retryBtnText}>重新加载</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      <WebView
        key={`webview_${errorKey}`}
        ref={webViewRef}
        source={{ uri }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        allowsBackForwardNavigationGestures={allowBackForwardGestures}
        injectedJavaScript={injectedJavaScript ?? DEFAULT_BRIDGE_JS}
        onMessage={handleMessage}
        onNavigationStateChange={handleNavigationStateChange}
        onLoadProgress={({ nativeEvent }) => setLoadProgress(nativeEvent.progress)}
        onLoadEnd={handleLoadEnd}
        onError={handleError}
        startInLoadingState={false}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

// 暴露 postMessage 的 hook 方式——通过 ref
export type SafeWebViewHandle = {
  postMessage: (message: WebViewBridgeMessage) => void;
  reload: () => void;
};

export function useWebViewRef() {
  return useRef<SafeWebViewHandle>(null);
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  progressBar: {
    height: 2,
    width: '100%',
  },
  progressFill: {
    height: '100%',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  errorContent: {
    alignItems: 'center',
    padding: spacing.xxxl,
  },
  errorIcon: {
    fontSize: 40,
    marginBottom: spacing.md,
  },
  errorTitle: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.medium,
    marginBottom: spacing.xs,
  },
  errorDesc: {
    fontSize: fontSizes.md,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  retryBtn: {
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.md,
  },
  retryBtnText: {
    color: '#fff',
    fontSize: fontSizes.md,
    fontWeight: fontWeights.medium,
  },
  emptyText: {
    fontSize: fontSizes.md,
  },
});
