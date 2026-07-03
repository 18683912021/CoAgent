import { isDev } from '@core/config';
import { captureError } from '@core/monitoring';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_MAP: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const CURRENT_LEVEL = isDev ? 'debug' : 'error';

class Logger {
  private tag: string;

  constructor(tag: string) {
    this.tag = tag;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_MAP[level] >= LOG_LEVEL_MAP[CURRENT_LEVEL];
  }

  private format(level: LogLevel, message: string, data?: unknown): void {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.tag}]`;

    if (data !== undefined) {
      console[level](prefix, message, data);
    } else {
      console[level](prefix, message);
    }
  }

  debug(message: string, data?: unknown): void {
    if (this.shouldLog('debug')) this.format('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    if (this.shouldLog('info')) this.format('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    if (this.shouldLog('warn')) this.format('warn', message, data);
  }

  error(message: string, error?: unknown): void {
    if (this.shouldLog('error')) {
      this.format('error', message, error);
      // 生产环境上报到 Sentry
      if (!isDev && error instanceof Error) {
        captureError(error, { tag: this.tag, message });
      }
    }
  }
}

export function createLogger(tag: string): Logger {
  return new Logger(tag);
}
