import { create } from 'zustand';
import { storage } from '@core/storage';
import { httpClient } from '@core/http';
import { createLogger } from '@core/logger';
import { eventBus, EventNames } from '@shared/utils/eventBus';

const logger = createLogger('Auth');

const AUTH_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const USER_INFO_KEY = 'user_info';

// ---- 类型 ----

export interface UserInfo {
  id: string;
  name: string;
  avatar?: string;
  phone?: string;
  email?: string;
  roles: string[];
  permissions: string[];
}

export interface LoginParams {
  username: string;
  password: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  userInfo: UserInfo;
}

interface AuthState {
  /** 是否已登录 */
  isAuthenticated: boolean;
  /** 是否正在初始化（从本地恢复登录态） */
  isInitializing: boolean;
  /** 当前用户信息 */
  userInfo: UserInfo | null;
  /** accessToken（内存缓存，避免频繁读 storage） */
  accessToken: string | null;

  // Actions
  initialize: () => Promise<void>;
  login: (params: LoginParams) => Promise<void>;
  logout: () => Promise<void>;
  updateUserInfo: (info: Partial<UserInfo>) => void;
  setAccessToken: (token: string) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  isInitializing: true,
  userInfo: null,
  accessToken: null,

  // 应用启动时恢复登录态
  initialize: async () => {
    try {
      // 注册全局登出事件监听（仅注册一次，由 store 单例保证）
      eventBus.on(EventNames.FORCE_LOGOUT, () => {
        logger.warn('Force logout triggered by HTTP layer');
        get().logout();
      });

      const [token, userInfo] = await Promise.all([
        storage.get<string>(AUTH_TOKEN_KEY),
        storage.get<UserInfo>(USER_INFO_KEY),
      ]);

      if (token && userInfo) {
        set({
          isAuthenticated: true,
          accessToken: token,
          userInfo,
          isInitializing: false,
        });
        logger.info('Auth restored from storage');
      } else {
        set({ isInitializing: false });
      }
    } catch (error) {
      logger.error('Auth initialization failed', error);
      set({ isInitializing: false });
    }
  },

  login: async (params: LoginParams) => {
    const result = await httpClient.post<LoginResult>('/auth/login', params);

    await storage.set(AUTH_TOKEN_KEY, result.accessToken);
    await storage.set(REFRESH_TOKEN_KEY, result.refreshToken);
    await storage.set(USER_INFO_KEY, result.userInfo);

    set({
      isAuthenticated: true,
      accessToken: result.accessToken,
      userInfo: result.userInfo,
    });

    logger.info('Login success', { userId: result.userInfo.id });
  },

  logout: async () => {
    try {
      // 调后端登出接口（可选，失败不阻塞本地清理）
      await httpClient.post('/auth/logout').catch(() => {});
    } finally {
      await Promise.all([
        storage.remove(AUTH_TOKEN_KEY),
        storage.remove(REFRESH_TOKEN_KEY),
        storage.remove(USER_INFO_KEY),
      ]);

      set({
        isAuthenticated: false,
        accessToken: null,
        userInfo: null,
      });

      logger.info('Logout completed');
    }
  },

  updateUserInfo: (info: Partial<UserInfo>) => {
    const current = get().userInfo;
    if (!current) return;

    const updated = { ...current, ...info };
    storage.set(USER_INFO_KEY, updated);
    set({ userInfo: updated });
  },

  setAccessToken: async (token: string) => {
    await storage.set(AUTH_TOKEN_KEY, token);
    set({ accessToken: token });
  },
}));
