# SKILL.md — FE Agent 技能书（On-demand）

## 技术栈
- TypeScript (strict) + React 19 + Next.js 15
- Tailwind CSS 4 + shadcn/ui
- Zustand / TanStack Query / Context
- Vite + Biome + Playwright

## 组件模式
- Container/Presenter 分离
- Custom Hooks 提取逻辑
- Error Boundary + Suspense
- 空状态统一组件 EmptyState

## 常见场景
### 列表页
Page → SearchBar + FilterPanel + List → ListItem（含 EmptyState / LoadingSkeleton / ErrorRetry）

### 表单页
Form → FieldGroup → Input/Select + Validation + SubmitButton（loading + 防重复）

## 文件结构
```
fe/
├── components/  # 通用
├── features/    # 业务
├── hooks/       # Custom Hooks
├── types/       # 类型定义
└── App.tsx
```
