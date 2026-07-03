import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import { storage } from '@core/storage';
import { createLogger } from '@core/logger';

// ---- 语言资源 ----
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';

const logger = createLogger('i18n');

export const SUPPORTED_LANGUAGES = ['zh-CN', 'en-US'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = 'zh-CN';

const resources = {
  'zh-CN': { translation: zhCN },
  'en-US': { translation: enUS },
};

/**
 * 获取设备首选语言（带本地缓存回退）
 */
async function detectLanguage(): Promise<SupportedLanguage> {
  try {
    // 1. 用户手动设置的语言优先
    const savedLang = await storage.get<SupportedLanguage>('app_language');
    if (savedLang && SUPPORTED_LANGUAGES.includes(savedLang)) {
      return savedLang;
    }

    // 2. 设备语言
    const locales = Localization.getLocales();
    const deviceLang = locales[0]?.languageCode;
    if (deviceLang === 'zh') return 'zh-CN';
    if (deviceLang === 'en') return 'en-US';

    return DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

let initPromise: Promise<void> | null = null;

export async function initI18n(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const language = await detectLanguage();

    await i18n.use(initReactI18next).init({
      resources,
      lng: language,
      fallbackLng: DEFAULT_LANGUAGE,
      interpolation: {
        escapeValue: false, // React Native 不需要 XSS 转义
      },
      returnNull: false,
      returnEmptyString: false,
    });

    logger.info(`i18n initialized with language: ${language}`);
  })();

  return initPromise;
}

/**
 * 切换语言（运行时）
 */
export async function changeLanguage(lang: SupportedLanguage): Promise<void> {
  await i18n.changeLanguage(lang);
  await storage.set('app_language', lang);
  logger.info(`Language changed to: ${lang}`);
}

export default i18n;
