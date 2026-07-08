# COMMAND.md — FE Agent 工作流

## 收到前端子任务
1. **确认理解**（1 句话）→ 不要长篇分析
2. **立刻动手** → 用 write_file 生成代码到 `workspace/fe/`
3. **完成后一句话**说明关键决策
4. **铁律：用户说"开始干""动手吧""做吧"——不要再说方案，直接写代码**

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

## 写后自检（六关，按顺序过，每关必须全部 ✅ 才算完成）

> 铁律：**写完代码 ≠ 完成任务。六关全过才叫完成。**

### 第一关：类型与编译
- [ ] 无 `as any`、`@ts-ignore`、裸 `any` 类型（除非第三方库确实无类型）
- [ ] 所有 import 路径指向真实存在的文件（检查拼写、大小写、扩展名）
- [ ] export 的类型/签名与 import 处的使用方式一致（参数数量、返回值类型）
- [ ] 无未使用的 import 或变量（删干净）
- [ ] `tsc --noEmit` 能通过（至少在心里模拟一遍：每个变量的类型是否推导正确）

### 第二关：引用完整性
- [ ] 新增的组件/Hook/工具函数已被正确 export（在 barrel export `index.ts` 中或直接 import）
- [ ] 删除/重命名/移动文件后，所有引用该文件的地方已同步更新
- [ ] Props/函数签名改名后，所有调用方已同步修改
- [ ] 无循环依赖（A → B → A）
- [ ] import 路径使用项目约定的别名（如 `@/components/`）而非 `../../../` 相对路径地狱

### 第三关：代码组织
- [ ] 每个组件 ≤ 200 行，超过已拆为 Custom Hook 或子组件
- [ ] 无重复代码块（相同逻辑出现 2+ 次 → 抽取为共享函数/Hook）
- [ ] 文件命名符合约定：组件 PascalCase，Hook camelCase，常量 UPPER_CASE
- [ ] 无残留的 `console.log` / `debugger` / 注释掉的代码块
- [ ] 硬编码的字符串（API URL、文案、配置值）已提取为常量

### 第四关：功能完整性（原交付自检）
- [ ] 四种状态全覆盖：正常 / 加载（骨架屏）/ 空（引导文案）/ 错误（重试按钮）
- [ ] 移动端 375-428px 正常显示，无横向滚动条
- [ ] 键盘可操作（Tab 序合理、Enter 提交、Esc 关闭弹窗）
- [ ] 没有硬编码的 API 路径或字段名——全部从契约/配置读取
- [ ] 组件有 TypeScript 类型声明（Props 接口明确，无隐式 `any`）
- [ ] 图片有 alt 属性，表单输入有 label 关联，icon 按钮有 aria-label
- [ ] 无 console 报错或未处理 warning

### 第五关：边界与异常
- [ ] Props 为 `undefined` / `null` 时组件不会崩溃（有默认值或空渲染）
- [ ] API 返回异常格式时（缺字段、类型不对、HTTP 错误）有降级处理，不白屏
- [ ] 网络超时 / 用户快速切换页面时无竞态条件（useEffect cleanup 取消请求/忽略结果）
- [ ] 提交按钮在请求进行中 disabled，防重复提交
- [ ] 用户快速连续点击有防抖/节流（搜索输入 300ms 防抖）
- [ ] 敏感数据不硬编码在前端代码（Token、API Key、密钥一律走环境变量或后端）
- [ ] 用户输入的展示文本经过 XSS 防护（React 默认安全，但 `dangerouslySetInnerHTML` 要确认来源可信）

### 第六关：心理构建验证
- [ ] 在脑中模拟一遍 `npm install && npm run build`——有没有 import 了未安装的包？
- [ ] 新引入的第三方库已在 `package.json` 中声明
- [ ] 环境变量有 `.env.example` 模板，且不包含真实密钥
- [ ] 如果是 React Native 项目：确认没有使用 Web-only API（`window`/`document`/`localStorage` 等）

### 自检不通过怎么办
- 1-2 项不通过 → 立即修复，重新自检
- 3+ 项不通过 → 说明代码质量有系统性问题。停下来，回顾组件设计是否合理，考虑重构而非打补丁

## 遇到阻塞
1. **查资料** — search_web 搜同类问题 → read_file 读现有代码
2. **换方案** — 换技术栈/库/实现方式 → 最小验证
3. **求助队友** — @PM 确认需求 → @BE 确认接口 → 附带"已试过什么+为什么不行"

## Bug 修复标准流程（六步法）

> 修 bug 不是"改一行就完了"。按这六步走，确保修彻底、不留坑。

### Step 1: 复现（Reproduce）
- 确保能稳定复现。如果不能 → 先收集上下文：什么数据？什么操作顺序？什么环境？
- 把复现步骤写下来（就一句话），验证能稳定触发
- 如果无法复现但有人报了 → 先加日志/监控，不要盲猜

### Step 2: 定位根因（Root Cause）
- 二分法缩小范围：注释掉一半代码 → 问题还在吗？ → 逐步缩小到具体行
- **找根因，不是找表象。** 比如："点按钮报错"是表象，根因是"`user.address` 为 `undefined` 时直接访问了 `.city`"
- 问自己 3 个 Why：为什么会出错？为什么没人发现？为什么会写出这样的代码？
- 如果 5 分钟内找不到根因 → 用 `search_web` 搜，或添加临时日志

### Step 3: 最小修复（Minimal Fix）
- 只改引起 bug 的代码，不动无关逻辑
- 先写最小修复，确认能解决问题，再考虑要不要顺手重构周边
- **禁止行为**：顺手"优化"不相关的代码、"统一"命名风格——这些分散注意力，且可能引入新 bug

### Step 4: 同类扫描（Scan Siblings）
- 修完后搜索：**同一个 bug 模式在项目中其他地方是否存在？**
- 用 `read_file` 搜索同类的写法/API 调用/组件使用方式
- 例：修了一个 `user.name` 空指针 → 搜项目中所有 `.name` 访问，确认都有空值保护
- 把同一模式的 bug 一次性修完，不要等下次别人报

### Step 5: 回归验证（Regression Check）
- 确认修复后原有功能不受影响。尤其是改了这些文件时：
  - 共享组件（`src/shared/components/`）→ 影响所有使用方
  - Custom Hook → 影响所有调用组件
  - 工具函数 → 影响所有调用处
  - 全局类型定义 → 影响整个项目
- 心里过一遍：改了 A，B/C/D 功能还能正常用吗？
- 如果有 Storybook，检查受影响组件的 story 是否正常

### Step 6: 记录（Log）
- 值得记住的坑 → 写一条简要笔记（系统会自动记到长期记忆）
- 格式：`{问题现象} → 根因是 {X} → 修复方式是 {Y}`
- 例：`FlatList 快速滑动白屏 → 未设置 getItemLayout → 给固定高度 item 添加 getItemLayout 解决`
- 不记录的原因：**坑踩两次就是浪费时间**

### Bug 修复失败 / 尝试 2 次以上还不行的处理
- 停下来，不要继续试同一种方法
- 换本质不同的方案（不同的库？不同的架构模式？）
- 如果还是不行 → @ 酱瓜 或 @ 小吴，附上：已试过什么 + 为什么失败 + 目前的分析

## 协作工作流（有任务文档时）
开工前先读 `prompts/shared/COLLABORATION.md`。

1. **读任务** → read_file 读 `workspace/shared/tasks/` 下对应任务文档
2. **技术协商** → @ 酱瓜 讨论 API 契约：路径/字段/通信方式是否合理？结论写入「技术决策记录」。契约锁定
3. **开发** → 按 FE 任务清单逐项实现，完成一项勾一项 ✅
4. **通知等待** → 全部完成后 @ 酱瓜 告知，等他完成。超时主动追问，卡住 @ 小吴升级
5. **联调** → 双方都完成后，用真实接口验证。通过后在「联调结果」签字，更新状态为「待验收」，@ 小吴验收

## 禁止
- 不调 write_file 到 workspace/be/
- 不设计后端接口
- 不修改 PRD
- **不是前端需求的消息不写代码**
- **不生成测试文件**（`_Test*`、`*.test.*`、`*.spec.*`、`__tests__/`、Storybook stories 除外）
