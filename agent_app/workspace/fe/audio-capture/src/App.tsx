/**
 * 根组件 —— Toolbar + 路由 + Auth 门
 *
 * PC 端：顶部固定 Toolbar 导航栏（不是底部 Tab Bar），页面内容区撑满剩余高度。
 */
import { useState, useEffect, useCallback } from 'react';
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AuthContext } from './utils/AuthContext';
import { useDarkMode } from './theme/tokens';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { verifyToken, clearToken, clearProfile } from './utils/token';
import InterviewScreen from './screens/InterviewScreen';
import ToolsScreen from './screens/ToolsScreen';
import ProfileScreen from './screens/ProfileScreen';
import InterviewHistoryScreen from './screens/InterviewHistoryScreen';
import AuthScreen from './screens/AuthScreen';
import OverlayScreen from './screens/OverlayScreen';

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [checking, setChecking] = useState(true);
  useDarkMode();

  useEffect(() => {
    verifyToken().then(email => {
      setIsLoggedIn(!!email);
      setChecking(false);
    });
  }, []);

  const logout = useCallback(() => {
    clearToken();
    clearProfile();
    setIsLoggedIn(false);
  }, []);

  if (checking) {
    return (
      <div className="h-full flex items-center justify-center bg-bg">
        <span className="text-text-secondary text-body">加载中…</span>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ logout }}>
      <HashRouter>
        <KeyboardShortcutHandler />
        {isLoggedIn ? <AuthenticatedApp /> : <AuthScreen onLogin={() => setIsLoggedIn(true)} />}
      </HashRouter>
    </AuthContext.Provider>
  );
}

/** ── 登录后的布局：Toolbar 导航 + 页面区 ── */
function AuthenticatedApp() {
  const location = useLocation();
  const currentTab = location.pathname.replace('/', '') || 'interview';

  return (
    <div className="h-full flex flex-col bg-bg">
      <Toolbar currentTab={currentTab} />
      <div className="flex-1 flex overflow-hidden">
        <Routes>
          <Route path="/" element={<Navigate to="/interview" />} />
          <Route path="/interview" element={<InterviewScreen />} />
          <Route path="/tools" element={<ToolsScreen />} />
          <Route path="/profile" element={<ProfileScreen />} />
          <Route path="/history" element={<InterviewHistoryScreen />} />
          <Route path="/overlay" element={<OverlayScreen />} />
        </Routes>
      </div>
    </div>
  );
}

/** ── Toolbar 导航栏 ── */
function Toolbar({ currentTab }: { currentTab: string }) {
  const navigate = useNavigate();
  const [stealth, setStealth] = useState(false);

  useEffect(() => {
    (window as any).electronAPI?.window?.getContentProtection().then((on: boolean) => setStealth(on));
  }, []);

  const toggleStealth = () => {
    (window as any).electronAPI?.window?.toggleContentProtection().then((on: boolean) => setStealth(on));
  };

  const tabs = [
    { key: 'interview', label: '面试', icon: '🎯' },
    { key: 'tools', label: '工具箱', icon: '🧰' },
    { key: 'profile', label: '我的', icon: '👤' },
  ];

  return (
    <header className="h-10 shrink-0 bg-bg-surface border-b border-divider flex items-center px-lg gap-0 select-none app-region-drag">
      <span className="text-body-sm font-bold text-accent mr-4xl app-region-no-drag">AI 面试助手</span>
      {tabs.map(tab => {
        const active = tab.key === currentTab;
        return (
          <button
            key={tab.key}
            onClick={() => navigate(`/${tab.key}`)}
            className={`app-region-no-drag h-full px-lg flex items-center gap-sm text-body-sm border-b-2 transition-colors ${
              active
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        );
      })}

      {/* 右侧操作区 */}
      <div className="ml-auto flex items-center gap-sm app-region-no-drag">
        {/* 隐身模式开关 */}
        <button
          onClick={toggleStealth}
          title={stealth ? '隐身中：屏幕共享/截屏不可见' : '点击开启隐身：屏幕共享/截屏中隐藏窗口'}
          className={`h-7 px-md rounded-full text-caption font-bold flex items-center gap-xs transition-all ${
            stealth
              ? 'bg-accent text-white shadow-sm'
              : 'bg-bg text-text-tertiary border border-divider hover:border-accent hover:text-accent'
          }`}
        >
          <span className="text-xs">{stealth ? '🛡️' : '🔓'}</span>
          <span>{stealth ? '隐身中' : '隐身'}</span>
        </button>
      </div>
    </header>
  );
}

/** ── 全局键盘快捷键 ── */
function KeyboardShortcutHandler(): null {
  const navigate = useNavigate();

  useKeyboardShortcuts({
    'Ctrl+1': () => navigate('/interview'),
    'Ctrl+2': () => navigate('/tools'),
    'Ctrl+3': () => navigate('/profile'),
    'Ctrl+,': () => navigate('/profile'),
    'Ctrl+B': () => {
      (window as any).electronAPI?.window?.toggleOverlay();
    },
    'Ctrl+Shift+P': () => {
      (window as any).electronAPI?.window?.toggleContentProtection?.();
    },
    'Ctrl+Shift+A': () => {
      (window as any).electronAPI?.window?.setAlwaysOnTop?.(true);
    },
  });

  return null;
}
