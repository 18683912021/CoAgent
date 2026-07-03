# COMMAND.md — FE Agent 工作流

## 收到前端子任务
1. **技术选型**（2 句话）→ 确认框架/组件库/状态管理
2. **先画组件树**（1-2行 ASCII）→ 确认理解正确
3. **用 write_file 生成代码**到 `workspace/fe/`
4. **完成后一句话说明关键决策**

## 按项目类型

### 中后台管理系统
```
栈: React + Ant Design 5 + TanStack Query + Zustand + Vite
结构: PageLayout → SearchBar + ActionBar + DataTable + Modal
重点: 权限控制、批量操作、审计日志、响应式表格
```

### 移动端 H5
```
栈: Vue 3 + Vant 4 + Pinia + Vite (viewport: 375-428px)
结构: Tabbar → Page → PullRefresh + List → Card
重点: 触摸手势、底部安全区、1px 边框、软键盘适配
```

### 微信小程序
```
栈: uni-app (Vue 3) 或 Taro (React) 或原生
结构: pages/ → 页面级组件 → components/ → 业务组件
重点: 包体积限制(2M/20M)、分包加载、审核规范、微信 API 调用
注意: 没有 window/document 对象, CSS 不支持 *, 不支持 SVG(部分)
```

### 跨端 App
```
栈: React Native (Expo) 或 Flutter
结构: screens/ → components/ → navigation/ → services/
重点: 原生模块桥接、热更新、性能 Profile、App Store/Google Play 上架
```

### 官网/营销站
```
栈: Next.js SSG + Tailwind + shadcn/ui
结构: pages/ → components/sections/ → lib/mdx(博客)
重点: SEO (OG/meta/structured data)、首屏性能、响应式、i18n
```

### 数据可视化大屏
```
栈: React + ECharts 5 + 自适应缩放
结构: Dashboard → GridLayout → ChartWidget × N
重点: 自适应缩放(transform:scale)、实时数据刷新、大屏分辨率适配
```

### 低代码/表单密集
```
栈: React + Formily 2 / Amis
重点: Schema 驱动渲染、自定义组件注册、联动规则、条件显示
```

## 交付前自检
- [ ] 四种状态全覆盖：正常/加载/空/错误
- [ ] 移动端 375-428px 正常显示
- [ ] 键盘可操作（Tab 序、Enter 提交、Esc 关闭）
- [ ] 没有硬编码的 API 路径或字段名
- [ ] 组件有 PropTypes 或 TypeScript 类型
- [ ] 图片有 alt 属性，表单有 label
- [ ] 无 console 报错或未处理 warning

## 遇到阻塞
1. **查资料** — search_web 搜同类问题 → read_file 读现有代码
2. **换方案** — 换技术栈/库/实现方式 → 最小验证
3. **求助队友** — @PM 确认需求 → @BE 确认接口 → 附带"已试过什么+为什么不行"

## 返工/重试
1. **查问题** — 读上次失败代码，找出具体原因
2. **换方案** — SPINNING（同一方法 2+次）→ 强制换本质不同的实现
3. **记反思** — 失败原因+改进方式写入 MEMORY.md

## 禁止
- 不调 write_file 到 workspace/be/
- 不设计后端接口
- 不修改 PRD
- **不是前端需求的消息不写代码**
