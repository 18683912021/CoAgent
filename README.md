# CoAgent — 多智能体协作开发系统

三人 P8 级开发团队通过飞书群协同，从需求到代码全自动完成。

| Agent | 角色 | 名字 | 级别 | 核心能力 |
|-------|------|------|------|---------|
| **PM** | 产品总监 | 小吴 | P8 | 调研/竞品分析/产品设计/PRD/路线图/AI产品 |
| **FE** | 前端架构师 | 小柯 | P8 | React/Vue/RN/Flutter/小程序/Electron/可视化 |
| **BE** | 后端架构师 | 酱瓜 | P8 | FastAPI/Go/Spring/数据库/消息队列/云原生 |

---

## 快速开始

```bash
cd agent_app
pip install -r requirements.txt
cp .env.example .env
# 编辑 .env 填入飞书应用凭证和 API Key
python main.py
```

`.env` 配置：

```env
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
ANTHROPIC_API_KEY=sk-your-key
ANTHROPIC_MODEL=deepseek-v4-pro

FEISHU_PM_APP_ID=cli_xxx
FEISHU_PM_APP_SECRET=xxx
FEISHU_FE_APP_ID=cli_xxx
FEISHU_FE_APP_SECRET=xxx
FEISHU_BE_APP_ID=cli_xxx
FEISHU_BE_APP_SECRET=xxx
```

## 飞书配置

每个 Bot 在 [飞书开放平台](https://open.feishu.cn) 操作：

1. 创建企业自建应用 → 添加**机器人**能力
2. 权限管理 → 添加所需权限：
```json
{
  "scopes": {
    "tenant": [
      "im:message", "im:message:send_as_bot", "im:message:readonly",
      "im:message.group_at_msg:readonly", "im:chat:readonly",
      "im:chat.members:bot_access", "im:resource",
      "im:message:reaction",
      "contact:user.base:readonly",
      "docx:document:readonly", "bitable:app:readonly", "wiki:wiki:readonly"
    ]
  }
}
```
3. 事件订阅 → **使用长连接接收事件** → 添加 `im.message.receive_v1`
4. 创建版本 → 发布
5. 三 Bot 加入同一群聊

---

## 使用方式

### 四种意图模式

系统根据消息内容自动判断意图，无需手动指定：

| 意图 | 触发条件 | 行为 | 示例 |
|------|---------|------|------|
| **chat** | 问候、短消息 | 3 句话内闲聊 | `@小柯 早上好` |
| **read** | 发飞书文档/Wiki 链接、"看一下" | 读文档 → 给摘要 → 待命 | `@小柯 https://feishu.cn/wiki/XXX` |
| **plan** | "方案""分析""怎么看" | 出分析+方案，不写代码 | `@小吴 分析一下这个架构` |
| **work** | "写""做""改""搭建"+强工作词 | 完整 pipeline：调研→PRD→代码 | `@小吴 做个企业知识库` |

### 任务协作

```bash
# 完整协作（@PM，自动触发 FE+BE 并行开发）
@小吴 创建一个 Todo 应用，支持添加和删除任务

# 引用文档
@小吴 参考这个 Wiki 文档做需求分析
[发送 feishu.cn/wiki/XXX 链接]

# 单独调用 FE/BE
@小柯 搭建一个 React Native 企业级 App Shell
@酱瓜 设计一个订单系统的数据模型

# 队友委派（Agent 回复里 @队友 自动递任务）
@小柯 写个登录页。@酱瓜 把登录接口补上

# 读文档（不发工作指令，只读+摘要）
@小柯 https://feishu.cn/wiki/ABC123

# 方案讨论（不写代码，只出方案）
@小吴 这个需求怎么设计方案比较合理

# 闲聊（群呼多人）
@小吴 @小柯 @酱瓜 早上好

# 延续任务（系统记住上次的项目上下文）
@小柯 把按钮改成蓝色    # 知道改的是 Todo 应用的按钮
```

---

## 架构

### 系统拓扑

```
python main.py
├── ws-pm 子进程 ──── wss://open.feishu.cn  ← PM Bot WebSocket
├── ws-fe 子进程 ──── wss://open.feishu.cn  ← FE Bot WebSocket
├── ws-be 子进程 ──── wss://open.feishu.cn  ← BE Bot WebSocket
└── msg-consumer 线程 → Queue → Orchestrator → 三 Agent 并行协作
```

### 协作流程

```
飞书群
  用户: "@小吴 做个企业知识库，参考这个 Wiki 文档"

  ┌─ 消息标准化 ───────────────────────────────────┐
  │ 飞书原始事件 → NormalizedMessage（统一格式）      │
  └────────────────────────────────────────────────┘

  ┌─ 意图预分类 ───────────────────────────────────┐
  │ "做个" + 工作关键词 → work 模式                  │
  │ 飞书文档链接 → read 模式（只看不写）              │
  │ "方案"/"分析" → plan 模式（只出方案）             │
  │ "早上好" → chat 模式（闲聊）                     │
  └────────────────────────────────────────────────┘

  ┌─ ✍️ Reaction + 进度消息 ───────────────────────┐
  │ 用户消息上 ✍️ Reaction（每 6s 刷新）              │
  │ 进度消息原地编辑，不刷屏                          │
  └────────────────────────────────────────────────┘

  ┌─ PM (小吴) ────────────────────────────────────┐
  │ search_web 竞品调研 → read_feishu_wiki 读文档   │
  │ → 分析需求 → 输出 PRD + 验收 Checklist          │
  │ → API 契约写入 workspace/shared/API_CONTRACT.md │
  └────────────────────────────────────────────────┘

  ┌─ 并行执行 FE/BE ───────────────────────────────┐
  │ asyncio.gather (带超时 + 重试 + agent 锁):      │
  │  ├─ FE (小柯): 读 API_CONTRACT → 代码           │
  │  └─ BE (酱瓜): 读 API_CONTRACT → 代码           │
  └────────────────────────────────────────────────┘

  ┌─ PM Light Review（审查闭环）────────────────────┐
  │ PM 对照 PRD 验收标准审查 FE/BE 产出              │
  │  ├─ PASS → 发给用户 + ✅ Checklist 勾选          │
  │  └─ FAIL → 带反馈让 FE/BE 返工一次               │
  └────────────────────────────────────────────────┘

  ┌─ 共享状态 + 会话管理 ──────────────────────────┐
  │ STATUS.md ← 三 Agent 各自状态（不互相覆盖）      │
  │ TaskSession ← 记住项目上下文，延续任务时自动注入  │
  └────────────────────────────────────────────────┘
```

---

## 核心机制

### 交互增强

| 机制 | 说明 |
|------|------|
| **✍️ 打字指示器** | Reaction API 在用户消息上加 ✍️，每 6s 刷新；失败回退文字"正在输入..." |
| **进度消息原地编辑** | 首次发 🔄 进度消息，后续编辑同一条（不刷屏）；编辑失败回退发新消息 |
| **Patrol 沉默检测** | 48s 无进度更新 → 发 ⏳ 提醒，防止用户不知道 Agent 在打转还是卡死 |
| **四种意图** | chat/read/plan/work 自动分流，发文档→读摘要，聊方案→只分析，写代码→全流程 |

### 审查闭环（OpenMOSS 风格）

| 机制 | 说明 |
|------|------|
| **PM Light Review** | PM 对照 PRD 验收标准审查 FE/BE 产出，PASS/FAIL 决策 |
| **验收 Checklist** | PM 输出 `- [ ]` 格式功能清单，Review 时自动勾选完成项 |
| **返工机制** | Review 不通过时带反馈让 Agent 返工一次（不做无限循环） |
| **STATUS 持久化** | 三 Agent 各自状态独立记录，不会互相覆盖 |

### 会话管理（OpenClaw 风格）

| 机制 | 说明 |
|------|------|
| **TaskSession** | 记住上一个任务的上下文（项目名、文件列表、原始指令） |
| **上下文注入** | 用户说"继续"/"改一下"时自动注入项目上下文 |
| **30 分钟过期** | 会话无活动 30 分钟后自动清理 |
| **Agent 锁** | asyncio.Lock 防止同一 Agent 并行执行导致记忆损坏 |

### 记忆系统（OpenClaw 风格）

| 层级 | 说明 |
|------|------|
| **运行时记忆** | JSON 格式，对话历史 + 提取的事实 |
| **精选笔记** | `notes-{name}.md`，Agent 自主记录技术经验 |
| **每日日志** | `daily/YYYY-MM-DD-{name}.md`，系统自动记录工作摘要 |
| **上下文压缩** | 重要性加权：关键技术 500 字 > 重要对话 200 字 > 闲聊 80 字 |

### 执行引擎

| 机制 | 说明 |
|------|------|
| **三 Agent 并行** | `run_coroutine_threadsafe` 同时调度，LLM 在线程池并行执行 |
| **4 层超时保护** | HTTP(360s) → Agent(chat 120s/work 360s) → 重试(600s) → 总超时 |
| **PUA 分级重试** | L0-L4 五级压力升级 + 失败模式检测（打转/甩锅/空壳） |
| **30 轮工具调用** | chat 除外，所有模式最多 30 轮工具调用 |
| **流式进度** | `on_progress` 回调 + `queue.Queue` 桥接同步→异步 |

### 飞书深度集成

| 能力 | API |
|------|-----|
| ✍️ 打字指示器 | Reaction API + 文字兜底 |
| 📖 读文档 | `read_feishu_doc` — docx |
| 📖 读 Wiki | `read_feishu_wiki` — feishu.cn/wiki/XXX |
| 📊 读多维表格 | `read_feishu_bitable` — Bitable |
| 🔍 搜知识库 | `search_feishu_wiki` |
| ✏️ 编辑消息 | `edit_message` — 进度消息原地更新 |
| 👤 解析用户 | `get_user_info` — ID → 姓名 |
| 👥 群成员 | `get_chat_members` |
| 📎 发文件 | `send_file_message` — 突破 800 字截断 |
| 💬 线程回复 | `reply_message` — 不刷屏 |
| 📥 下载附件 | `download_file` |
| @自动转换 | `@小柯` → `<at user_id>` |
| 表情包保留 | post 消息 emoji 元素转为 `[emoji_type]` 标记 |

### 代码质量

| 机制 | BE | FE |
|------|----|----|
| 编译检查 | `ast.parse` Python 语法 | 括号平衡/import/export 结构 |
| 产出验证 | workspace 快照对比，无新文件 → 警告 |
| 空壳检测 | 42 个空壳信号词识别"嘴上说说" |
| PM Review | 对照 PRD 验收标准语义审查 |

### 可观测性

| 能力 | 说明 |
|------|------|
| **53 个单元测试** | pytest，覆盖 TaskRunner/Orchestrator/BaseAgent 纯函数 |
| **Metrics** | 任务计数/成功率/响应时间/Agent 维度 |
| **结构化日志** | `[时间] LEVEL event key=value` |
| **健康检查** | `GET /health` → `{status, bots, metrics}` |
| **任务状态** | `GET /task/{task_id}` → `{state, checklist, review_result, ...}` |

---

## Agent 技能矩阵

### 小吴 (PM) — P8 产品总监

| 领域 | 技能 |
|------|------|
| 用户研究 | 用户访谈/Persona/旅程地图/可用性测试 |
| 竞品分析 | 功能矩阵/定价对比/差异化定位 |
| 产品设计 | 信息架构/交互流程/功能优先级(RICE/MoSCoW)/MVP 裁剪 |
| 商业策略 | 商业模式/增长(AARRR)/定价/路线图/OKR |
| 技术理解 | API 设计原则/技术边界速查/AI 产品设计(Prompt/RAG) |
| 工具 | search_web / read_feishu_doc / read_feishu_wiki / search_feishu_wiki |

### 小柯 (FE) — P8 前端架构师

| 领域 | 技能 |
|------|------|
| 框架 | React 19/Next.js 15、Vue 3/Nuxt 3、Vue 2 存量迁移 |
| 跨端 | React Native、Flutter、Electron、uni-app、Taro、原生小程序 |
| 组件库 | Ant Design 5、Element Plus、shadcn/ui、Naive UI、TDesign、Vant 4 |
| 可视化 | ECharts 5、AntV(G2/G6/L7)、Three.js |
| CSS | Tailwind/UnoCSS/styled-components/CSS Modules/Sass |
| 工程化 | Vite/Webpack/Turbopack/pnpm monorepo/模块联邦 |
| Node.js | Express/Nest.js/Next.js API Routes/tRPC/GraphQL |
| 测试 | Vitest/Playwright/Cypress/Storybook |

### 酱瓜 (BE) — P8 后端架构师

| 领域 | 技能 |
|------|------|
| 语言 | Python(FastAPI/Django/Flask)、Go(Gin/Fiber/gRPC)、Java(Spring Boot 3/Cloud)、Node(Nest.js) |
| 数据库 | PostgreSQL/MySQL/MongoDB/Redis/ES/ClickHouse/TiDB/TimescaleDB/Neo4j |
| 消息 | Kafka/RabbitMQ/RocketMQ/Pulsar/Redis Streams/Celery |
| 架构 | 微服务/DDD/CQRS/Event Sourcing/Saga/六边形架构 |
| 云 | AWS(ECS/RDS/S3/Lambda)、阿里云、腾讯云 |
| DevOps | Docker/K8s/Terraform/Helm/GitHub Actions |
| 监控 | Prometheus/Grafana/OpenTelemetry/Sentry/ELK |
| 安全 | OAuth2/JWT/RBAC/Rate Limiting/加密/SQL注入防护 |

---

## 测试

```bash
cd agent_app
python -m pytest tests/ -v
# 47 passed
```

## 健康检查

```bash
curl http://localhost:8000/health
# {"status":"ok","bots":{"pm":"connected","fe":"connected","be":"connected"},"metrics":{"tasks":{"total":42,...}}}

curl http://localhost:8000/task/{task_id}
# {"task_id":"a1b2c3d4","state":"completed","initiator":"pm","command":"...","error":""}
```

## 项目结构

```
agent_app/
├── main.py                          # FastAPI 入口 + WebSocket 生命周期
├── orchestrator.py                  # 调度器（路由/意图分类/社交上下文/委派/Review/Session）
├── task_runner.py                   # 执行器（超时/重试/流式进度/验证/编译检查）
├── monitor.py                       # 指标收集 + 结构化日志
├── requirements.txt
├── .env / .env.example
│
├── agents/                          # Agent 实现
│   ├── base.py                      #   基类（SDK/记忆/事实提取/压缩/日志/笔记）
│   ├── pm.py                        #   PM — 小吴 (P8 产品总监)
│   ├── fe.py                        #   FE — 小柯 (P8 前端架构师)
│   └── be.py                        #   BE — 酱瓜 (P8 后端架构师)
│
├── prompts/                         # Agent 定义文件
│   ├── pua/SKILL.md                 #   PUA 引擎方法论
│   ├── pm/                          #   PM: prompt/SKILL/AGENTS/COMMAND
│   ├── fe/                          #   FE: prompt/SKILL/AGENTS/COMMAND
│   └── be/                          #   BE: prompt/SKILL/AGENTS/COMMAND
│
├── tools/                           # 工具集
│   ├── search.py                    #   Web 搜索
│   ├── feishu.py                    #   飞书消息发送（Agent 可调用）
│   ├── feishu_utils.py              #   飞书 API（Token/消息/Reaction/编辑/文档/Wiki/文件/用户/群组）
│   ├── feishu_docs.py               #   飞书云文档工具（Agent 可调用）
│   ├── feishu_ws.py                 #   WebSocket 长连接（消息标准化）
│   ├── message_normalizer.py        #   消息标准化层（飞书→NormalizedMessage）
│   └── code_editor.py               #   代码读写（隔离+逃逸检测）
│
├── tests/                           # 单元测试 (53 个)
│   ├── conftest.py
│   ├── test_base.py
│   ├── test_orchestrator.py
│   └── test_task_runner.py
│
├── memory/                          # 记忆（运行时）
│   ├── memory-pm.json / fe / be     #   运行时对话历史
│   ├── notes-pm.md / fe / be        #   精选长期笔记（Agent 自主维护）
│   └── daily/                       #   每日工作日志
│
├── workspace/                       # 代码产出
│   ├── shared/                      #   共享上下文（API_CONTRACT / STATUS）
│   ├── prd/ / fe/ / be/
│
└── logs/                            # 失败任务日志
```
