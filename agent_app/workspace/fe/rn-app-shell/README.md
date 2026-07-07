# 轻松面试助手 — AI 面试辅助工具

> React Native 企业级模板（Expo SDK 52）

## 目录结构

```
rn-app-shell/
├── app/                    # Expo Router (文件路由)
│   ├── _layout.tsx         # 根布局
│   ├── index.tsx           # 首页路由分发
│   ├── (auth)/             # Auth 路由组
│   └── (tabs)/             # Tab 路由组
├── src/
│   ├── core/               # 核心基础设施
│   │   ├── config/         # 配置中心 + 多环境
│   │   ├── logger/         # 日志系统
│   │   ├── http/           # 网络请求层
│   │   ├── storage/        # 本地缓存
│   │   ├── auth/           # 认证 + Token 管理
│   │   └── error/          # ErrorBoundary
│   ├── design-system/      # 设计体系
│   │   ├── tokens/         # Design Tokens
│   │   └── theme/          # 主题（Light/Dark）
│   ├── i18n/               # 国际化
│   ├── shared/             # 共享层
│   │   ├── hooks/          # 公共 Hooks
│   │   ├── components/     # 公共组件
│   │   └── utils/          # 工具函数
│   └── features/           # 业务 Feature（按模块）
│       └── README.md       # Feature 模板说明
├── assets/                 # 静态资源
├── app.config.ts           # Expo 配置（多环境）
├── eas.json                # EAS Build/Update 配置
├── tsconfig.json
├── package.json
└── ...
```

## 技术栈

| 类别 | 选型 |
|------|------|
| 框架 | React Native 0.76 + Expo SDK 52 |
| 路由 | Expo Router (文件路由) |
| 状态管理 | Zustand |
| 网络请求 | Axios + 拦截器 |
| 服务端状态 | TanStack Query |
| 本地存储 | AsyncStorage（可替换为 MMKV） |
| 国际化 | i18next + react-i18next |
| 表单 | React Hook Form + Zod |
| 动画 | Reanimated 3 |
| 构建 | EAS Build |
| 热更新 | EAS Update |

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 启动开发环境
pnpm start:dev

# 3. 构建
pnpm eas:build:dev    # 开发构建
pnpm eas:build:preview # 预览构建
pnpm eas:build:prod   # 生产构建
```

## 新增 Feature

参考 `src/features/README.md`，复制模板结构即可。

## 环境变量

通过 `APP_ENV` 环境变量切换：
- `development` — 开发
- `testing` — 测试
- `staging` — 预发
- `production` — 生产

配置表在 `app.config.ts` 的 `ENV_CONFIG` 中维护。

## 架构原则

1. **Feature First** — 按业务模块组织代码
2. **单向依赖** — feature → shared → core，不可反向
3. **零 any** — 全局 TypeScript strict
4. **四态覆盖** — 每个组件：正常/加载/空/错误
5. **Token 优先** — 所有 UI 值引用 Design Tokens
