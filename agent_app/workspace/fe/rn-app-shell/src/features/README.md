# Feature 模板

```
features/
└── feature-name/              # kebab-case 命名
    ├── index.ts               # 桶导出
    ├── screens/               # 页面级组件（一个 screen = 一个路由）
    │   ├── ListScreen.tsx     # 列表页（四态：loading/success/empty/error）
    │   └── DetailScreen.tsx   # 详情页
    ├── components/            # Feature 内部组件
    │   ├── FeatureCard.tsx
    │   └── FeatureForm.tsx
    ├── hooks/                 # Feature 内部 hooks
    │   ├── useFeatureList.ts  # TanStack Query 封装
    │   └── useFeatureMutation.ts
    ├── api.ts                 # Feature 独享的 API 函数（基于 @core/http）
    ├── types.ts               # Feature 类型定义
    └── constants.ts           # Feature 常量
```

## 规则

1. **一个 Feature = 一个业务领域**，如 `user-management`、`order-list`、`product-catalog`
2. **API 层**：所有 HTTP 请求通过 `api.ts` 集中管理，使用 `@core/http` 的 httpClient
3. **状态管理**：优先 TanStack Query（服务端状态），需要客户端状态用 Zustand store（放在 feature 内部）
4. **类型**：Feature 内的类型定义在 `types.ts`，共享类型抽到 `@shared/types/`
5. **路由**：Feature 的 screen 通过 Expo Router 的文件路由自动注册
6. **四态必须覆盖**：loading（骨架屏）、success、empty、error（重试按钮）
