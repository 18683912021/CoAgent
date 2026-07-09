# SKILL.md — FE Agent 技能书（On-demand）

## 技术选型速查

### 项目类型 → 推荐栈

| 项目类型 | 框架 | 组件库 | 状态管理 | 构建工具 |
|---------|------|--------|---------|---------|
| 中后台管理系统 | React + Ant Design 5 | Ant Design Pro | Zustand + TanStack Query | Vite |
| 移动端 H5 | Vue 3 + Vant 4 | Vant | Pinia | Vite |
| 微信小程序 | uni-app (Vue 3) | uView / uni-ui | Pinia | uni-app CLI |
| 跨端 App | React Native / Flutter | — | Zustand / Provider | Metro / Flutter CLI |
| 桌面端 | Electron + React | Ant Design / shadcn | Zustand | Vite + electron-builder |
| 官网/营销站 | Next.js SSG | Tailwind + shadcn | — | Next.js |
| 数据大屏 | React + ECharts | AntV + DataV | — | Vite |
| 低代码/表单密集 | React + Formily / Amis | — | — | Vite |
| 组件库开发 | — | — | — | Vite + Storybook + tsup |
| BFF 层 | Nest.js / Next.js API Routes | — | — | — |

### 移动端选择矩阵

| 需求 | 方案 |
|------|------|
| 只做微信小程序 | 原生 + WeUI |
| 微信+支付宝+抖音 | uni-app (Vue 3) |
| 微信+H5 同构 | Taro 3 (React) |
| 高性能长列表 | 原生 + Skyline 渲染引擎 |
| 需要原生能力 | React Native / Flutter |
| 已有 React Web 代码 | React Native (代码复用) |
| 快速验证 MVP | uni-app / Flutter |

### 状态管理选择

| 复杂度 | 推荐 |
|--------|------|
| 简单（几个组件共享） | Context + useReducer |
| 中等（页面级状态） | Zustand |
| 服务端状态 | TanStack Query |
| 复杂（多页面共享 + 中间件） | Redux Toolkit |
| Vue 项目 | Pinia |
| 状态机 | XState |

## 组件模式库

### 列表页（最常用）
```
PageLayout
├── SearchBar (防抖 300ms, 可清空)
├── FilterPanel (可选, 折叠)
├── ActionBar (新建按钮 + 批量操作)
├── DataTable / List
│   ├── LoadingSkeleton (骨架屏, 模拟行数)
│   ├── EmptyState (图标 + 引导文案 + 操作按钮)
│   └── ErrorRetry (错误信息 + 重试按钮)
└── Pagination (前端分页 or 后端分页)
```

### 表单页
```
FormPage
├── Form (React Hook Form / Formik)
│   ├── FieldGroup (分组标题)
│   ├── FormField (label + control + error message)
│   └── Validation (Zod schema)
├── DraftSaver (自动草稿保存)
└── SubmitBar (提交 + 重置, loading + 防重复)
```

### 详情页
```
DetailPage
├── PageHeader (标题 + 面包屑 + 操作按钮)
├── DescriptionList (字段展示)
├── TabPanel (关联信息 tab 切换)
└── LoadingSkeleton / ErrorRetry
```

## 代码模板

### React + TypeScript 组件模板
```typescript
// components/UserTable/index.tsx
import { useState } from 'react';
import { Table, Button, Space } from 'antd';
import type { ColumnsType } from 'antd/es/table';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface Props {
  data: User[];
  loading?: boolean;
  onEdit: (user: User) => void;
  onDelete: (id: string) => void;
}

export default function UserTable({ data, loading, onEdit, onDelete }: Props) {
  const columns: ColumnsType<User> = [
    { title: '姓名', dataIndex: 'name', key: 'name' },
    { title: '邮箱', dataIndex: 'email', key: 'email' },
    { title: '角色', dataIndex: 'role', key: 'role' },
    {
      title: '操作', key: 'action',
      render: (_, record) => (
        <Space>
          <Button type="link" onClick={() => onEdit(record)}>编辑</Button>
          <Button type="link" danger onClick={() => onDelete(record.id)}>删除</Button>
        </Space>
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      dataSource={data}
      loading={loading}
      rowKey="id"
      locale={{ emptyText: '暂无数据' }}
    />
  );
}
```

### Vue 3 Composition API 模板
```vue
<script setup lang="ts">
import { ref, computed } from 'vue';
import { useQuery } from '@tanstack/vue-query';

interface Todo {
  id: string;
  title: string;
  completed: boolean;
}

const filter = ref<'all' | 'active' | 'done'>('all');

const { data: todos, isLoading, error } = useQuery({
  queryKey: ['todos'],
  queryFn: () => fetch('/api/todos').then(r => r.json()),
});

const filteredTodos = computed(() => {
  if (!todos.value) return [];
  if (filter.value === 'active') return todos.value.filter((t: Todo) => !t.completed);
  if (filter.value === 'done') return todos.value.filter((t: Todo) => t.completed);
  return todos.value;
});
</script>
```

### uni-app 小程序模板
```vue
<template>
  <view class="page">
    <u-navbar title="订单列表" />
    <u-search v-model="keyword" @search="onSearch" />
    <u-list v-if="!loading">
      <u-list-item v-for="item in list" :key="item.id">
        <order-card :data="item" @click="onDetail(item.id)" />
      </u-list-item>
    </u-list>
    <u-loadmore :status="loadStatus" />
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app';

const keyword = ref('');
const list = ref([]);
const page = ref(1);
const loadStatus = ref('loadmore');

const fetchList = async (isRefresh = false) => {
  if (isRefresh) page.value = 1;
  const res = await uni.request({ url: `/api/orders?page=${page.value}&keyword=${keyword.value}` });
  const items = res.data.items || [];
  list.value = isRefresh ? items : [...list.value, ...items];
  loadStatus.value = items.length < 20 ? 'nomore' : 'loadmore';
};

onReachBottom(() => { if (loadStatus.value === 'loadmore') { page.value++; fetchList(); } });
onPullDownRefresh(() => { fetchList(true).finally(() => uni.stopPullDownRefresh()); });
</script>
```

### Electron 主进程模板
```typescript
// main.ts
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// IPC: 文件保存对话框
ipcMain.handle('dialog:saveFile', async (_, { content, defaultName }) => {
  const { dialog } = require('electron');
  const { filePath } = await dialog.showSaveDialog(mainWindow!, { defaultPath: defaultName });
  if (filePath) require('fs').writeFileSync(filePath, content, 'utf-8');
  return filePath;
});
```

## TypeScript 编码规范

> P8 前端必须写出让 TypeScript 编译器满意的代码，而不是跟编译器打架。

### 禁止项（红线）

| 禁止 | 原因 | 正确做法 |
|------|------|----------|
| `as any` | 完全绕过类型检查，埋雷 | `as User` 用具体类型，或用 type guard 收窄 |
| `@ts-ignore` | 掩耳盗铃，隐藏真实问题 | 修复类型错误本身，或 `@ts-expect-error` + 注释原因 |
| 裸 `any` 类型 | 让类型系统失效 | `unknown` → type guard 收窄 |
| `// eslint-disable` | 有 lint 错误说明代码有问题 | 修复代码，不是关闭检查 |
| `as` 强制类型断言（除非必要） | 伪造类型，运行时原形毕露 | type guard (`if (x is Type)`) 或 zod 运行时校验 |

### 推荐模式

#### 1. API 状态用 Discriminated Union（不用多个 boolean flag）
```typescript
// ❌ 不好——多种状态靠 boolean 组合，可能出现不可能的状态
interface State {
  loading: boolean;
  data: User[] | null;
  error: string | null;
}

// ✅ 好——每种状态互斥，TypeScript 自动收窄类型
type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: User[] }
  | { status: 'error'; error: string };
```

#### 2. Props 接口必须显式定义（不用 `React.FC<{...}>` 内联或隐式 any）
```typescript
// ❌
const Card = ({ title, children }: any) => { ... };
const Card: React.FC<{title: string; children: React.ReactNode}> = ({ title, children }) => { ... };

// ✅
interface CardProps {
  title: string;
  children: React.ReactNode;
}
function Card({ title, children }: CardProps) { ... }
```

#### 3. 可选 Props 给默认值或用可选链，不假设一定有值
```typescript
interface Props {
  onPress?: () => void;
  className?: string;
}
function Button({ onPress, className = '' }: Props) {
  // ✅ 用默认值 + 可选链
  const handlePress = () => onPress?.();
  return <button className={className}>...</button>;
}
```

#### 4. 泛型约束——让类型更精确
```typescript
// ❌ 没有任何约束
function getFirst<T>(arr: T[]): T | undefined { return arr[0]; }

// ✅ 有约束，且使用者知道能做什么
interface Identifiable { id: string; }
function findById<T extends Identifiable>(items: T[], id: string): T | undefined {
  return items.find(item => item.id === id);
}
```

#### 5. 类型守卫收窄 `unknown` / 联合类型
```typescript
// API 返回的数据在编译时是 unknown，运行时才知道是什么
function isUser(obj: unknown): obj is User {
  return typeof obj === 'object' && obj !== null && 'id' in obj && 'name' in obj;
}
const data: unknown = await fetch('/api/user').then(r => r.json());
if (isUser(data)) {
  console.log(data.name); // ✅ 这里 data 类型自动收窄为 User
}
```

#### 6. `as const` 固定字面量类型
```typescript
// ✅ 用 as const 让数组变为 readonly tuple 类型
const STATUSES = ['idle', 'loading', 'success', 'error'] as const;
type Status = typeof STATUSES[number]; // 'idle' | 'loading' | 'success' | 'error'
```

#### 7. 不要过度使用 `useEffect`
```typescript
// ❌ 用 useEffect 做"当 X 变化时计算 Y"
useEffect(() => { setFullName(firstName + ' ' + lastName); }, [firstName, lastName]);

// ✅ 用 useMemo 直接计算
const fullName = useMemo(() => `${firstName} ${lastName}`, [firstName, lastName]);
```

### 类型文件组织
- 组件专用类型：与组件同目录，如 `UserTable/types.ts`
- 业务模块共享类型：`features/users/types.ts`
- 全局通用类型：`src/shared/types/index.ts`
- API 响应类型：与 API 调用同文件，如 `features/users/api.ts`

## CSS 样式实战

### 响应式断点系统
```css
/* 移动优先 */
:root {
  --bp-sm: 640px;
  --bp-md: 768px;
  --bp-lg: 1024px;
  --bp-xl: 1280px;
  --bp-2xl: 1536px;
}

/* Tailwind 风格 */
@custom-media --sm (min-width: 640px);
@custom-media --md (min-width: 768px);
@custom-media --lg (min-width: 1024px);

@media (--md) { /* 平板及以上 */ }
```

### 流体排版 (clamp)
```css
h1 { font-size: clamp(1.5rem, 4vw, 3rem); }
p  { font-size: clamp(1rem, 1.5vw, 1.25rem); }
```

### Flexbox 常用布局
```css
/* 水平垂直居中 */
.center { display: flex; justify-content: center; align-items: center; }

/* 两端对齐 */
.header { display: flex; justify-content: space-between; align-items: center; }

/* 等分列 */
.grid-3 { display: flex; gap: 1rem; }
.grid-3 > * { flex: 1; }

/* 圣杯布局 */
.holy-grail { display: flex; flex-direction: column; min-height: 100vh; }
.holy-grail main { flex: 1; }
```

### Grid 常用布局
```css
/* 响应式卡片网格 */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1.5rem;
}

/* 仪表盘布局 */
.dashboard {
  display: grid;
  grid-template-areas:
    "stats  stats  stats"
    "chart  chart  sidebar"
    "table  table  sidebar";
  grid-template-columns: 1fr 1fr 300px;
  gap: 1rem;
}
```

### 暗黑模式 (Design Token + CSS 变量)
```css
:root {
  --color-bg: #ffffff;
  --color-text: #1a1a2e;
  --color-primary: #6366f1;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
}

[data-theme="dark"] {
  --color-bg: #0f172a;
  --color-text: #e2e8f0;
  --color-primary: #818cf8;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
}

/* 跟随系统 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* 自动暗黑 */ }
}
```

### 常用动画
```css
/* 淡入 + 上移 */
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
.fade-in { animation: fadeInUp 0.3s ease-out both; }

/* 骨架屏闪烁 */
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.skeleton {
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

/* 入场交错 */
.stagger > * { opacity: 0; animation: fadeInUp 0.3s ease-out forwards; }
.stagger > *:nth-child(1) { animation-delay: 0.05s; }
.stagger > *:nth-child(2) { animation-delay: 0.10s; }
.stagger > *:nth-child(3) { animation-delay: 0.15s; }
```

### 移动端适配
```css
/* 安全区域 */
.safe-bottom { padding-bottom: env(safe-area-inset-bottom, 16px); }
.safe-top    { padding-top: env(safe-area-inset-top, 0px); }

/* 1px 边框（Retina 屏） */
.hairline {
  position: relative;
  &::after {
    content: '';
    position: absolute; left: 0; bottom: 0; right: 0;
    height: 1px;
    transform: scaleY(0.5);
    background: #e5e7eb;
  }
}

/* 滚动平滑 */
.scroll-container {
  -webkit-overflow-scrolling: touch;
  scroll-behavior: smooth;
  overscroll-behavior: contain;
}
```

### 性能优化
```css
/* 减少重绘 */
.optimized {
  will-change: transform, opacity;          /* GPU 加速 */
  contain: layout style paint;              /* 隔离渲染 */
  content-visibility: auto;                 /* 虚拟滚动 */
}

/* 图片渲染优化 */
img {
  image-rendering: -webkit-optimize-contrast;
  content-visibility: auto;
  aspect-ratio: attr(width) / attr(height); /* CLS 防护 */
}

/* 异步字体加载 */
@font-face {
  font-family: 'Custom';
  src: url('/fonts/custom.woff2') format('woff2');
  font-display: swap; /* 先显示回退字体 */
}
```

### Tailwind 4 自定义 Design Token
```css
@theme {
  --color-primary: #6366f1;
  --color-primary-light: #818cf8;
  --color-surface: #ffffff;
  --color-surface-alt: #f8fafc;
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --shadow-card: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06);
}
```

## 原生开发（Android / iOS / 原生模块）

### Android 原生（Kotlin + Jetpack Compose）
```
场景: Expo 原生模块、React Native Turbo Module、原生 SDK 封装
技术栈: Kotlin + Coroutines + Room + Hilt + Retrofit
重点: AndroidManifest 权限、Gradle 依赖管理、ProGuard 混淆、多架构 so 库
```

### Android 模块模板（Expo Modules API）
```kotlin
// modules/audio-capture/android/src/main/java/expo/modules/audiocapture/AudioCaptureModule.kt
package expo.modules.audiocapture

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AudioCaptureModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AudioCapture")

    Function("startCapture") { options: Map<String, Any> ->
      // 原生音频采集逻辑
      return@Function mapOf("status" to "started")
    }

    Function("stopCapture") {
      return@Function mapOf("status" to "stopped")
    }

    View(AudioCaptureView::class) {
      Events("onAudioData")
      Prop("sampleRate") { view: AudioCaptureView, rate: Int ->
        view.setSampleRate(rate)
      }
    }
  }
}
```

### iOS 原生（Swift + SwiftUI）
```
场景: Expo 原生模块、RN Native View、原生 SDK 封装
技术栈: Swift + SwiftUI + Combine + Core Data + SPM
重点: Info.plist 权限声明、Podspec 配置、Framework 签名、App Store 审核
```

### iOS 模块模板（Expo Modules API）
```swift
// modules/audio-capture/ios/AudioCaptureModule.swift
import ExpoModulesCore

public class AudioCaptureModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AudioCapture")

    Function("startCapture") { (options: [String: Any]) -> [String: Any] in
      // 原生音频采集逻辑
      return ["status": "started"]
    }

    Function("stopCapture") { () -> [String: Any] in
      return ["status": "stopped"]
    }

    View(AudioCaptureView.self) {
      Events("onAudioData")
      Prop("sampleRate") { (view: AudioCaptureView, rate: Int) in
        view.setSampleRate(rate)
      }
    }
  }
}
```

### Expo 原生模块配置
```json
// modules/audio-capture/expo-module.config.json
{
  "platforms": ["ios", "android"],
  "ios": {
    "modules": ["AudioCaptureModule"],
    "appDelegateSubscribers": []
  },
  "android": {
    "modules": ["expo.modules.audiocapture.AudioCaptureModule"]
  }
}
```

### 原生 View 桥接（React Native）
```kotlin
// android: ViewManager + FrameLayout
class AudioCaptureView(context: Context) : FrameLayout(context) {
  fun setSampleRate(rate: Int) { ... }
}
```

```swift
// ios: UIView subclass
class AudioCaptureView: UIView {
  @objc func setSampleRate(_ rate: Int) { ... }
}
```

## 文件结构规范
```
workspace/fe/{project-name}/
├── public/               # 静态资源
├── src/
│   ├── components/       # 通用组件（Button, Modal, Table...）
│   ├── features/         # 业务模块（users/, orders/, auth/）
│   │   └── users/
│   │       ├── components/   # UserTable, UserModal
│   │       ├── hooks/        # useUsers, useUserDetail
│   │       ├── api.ts        # 接口调用
│   │       └── types.ts      # 本地类型
│   ├── hooks/            # 全局 Custom Hooks
│   ├── lib/              # 工具函数（formatDate, cn...）
│   ├── types/            # 全局类型定义
│   ├── App.tsx           # 根组件
│   └── main.tsx          # 入口
├── package.json
├── tsconfig.json
├── vite.config.ts / next.config.js
└── tailwind.config.ts
```
