# CoAgent — 多智能体协作开发系统

三人 P8 级开发团队通过飞书群协同，从需求到代码全自动完成。

| Agent | 角色 | 名字 | 级别 | 核心能力 |
|-------|------|------|------|---------|
| **PM** | 产品总监 | 小吴 | P8 | 调研/竞品分析/产品设计/PRD/路线图/AI产品 |
| **FE** | 前端架构师 | 小柯 | P8 | React/Vue/RN/Flutter/小程序/Electron/可视化 |
| **BE** | 后端架构师 | 酱瓜 | P8 | FastAPI/Go/Spring/数据库/消息队列/云原生 |

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

  ┌─ 意图预分类 ─────────────────────────────────────┐
  │ "做个企业知识库" → 命中工作关键词 → work 模式      │
  └──────────────────────────────────────────────────┘

  ┌─ 打字指示器 ─────────────────────────────────────┐
  │ 用户消息下 ✍️ Reaction（每6s刷新），无 message_id 时发 "正在输入..." │
  └──────────────────────────────────────────────────┘

  ┌─ PM (小吴) ──────────────────────────────────────┐
  │ search_web 竞品调研 → read_feishu_wiki 读文档    │
  │ → 分析需求 → 输出 PRD                            │
  │ → API 契约自动写入 workspace/shared/API_CONTRACT.md │
  │ → 进度通知: "需求分析完成，前后端并行开发..."       │
  └──────────────────────────────────────────────────┘

  ┌─ 并行执行 FE/BE ─────────────────────────────────┐
  │ asyncio.gather (带超时 + 重试):                   │
  │  ├─ FE (小柯): 读 API_CONTRACT → 代码              │
  │  │    → AST/结构验证 → 产出文件 ✓                   │
  │  └─ BE (酱瓜): 读 API_CONTRACT → 代码              │
  │       → Python 编译检查 → 产出文件 ✓                │
  └──────────────────────────────────────────────────┘

  ┌─ 共享状态更新 ───────────────────────────────────┐
  │ STATUS.md ← FE ✓ BE ✓   DECISIONS.md ← 技术决策  │
  └──────────────────────────────────────────────────┘

  → FE Bot: "中后台已生成，Ant Design + React。[5 个文件]"
  → BE Bot: "API 已实现。[3 个文件]"
```

### 群呼闲聊

```
用户: "早上好" + @小吴 @小柯 @酱瓜
  → 意图预分类: "chat"
  → 群呼上下文注入: "不是派活，各回各的"
  → 三 Agent 并行思考+回复（不再串行等待）
  → 小柯: "早～"  酱瓜: "在呢"  小吴: "早！"
```

---

## 核心机制

### 执行引擎

| 机制 | 说明 |
|------|------|
| **三 Agent 并行** | `run_coroutine_threadsafe` 同时调度，LLM 在线程池并行执行 |
| **4 层超时保护** | HTTP(90s) → Agent(chat 15s/work 60s) → 重试(90s) → 总超时 |
| **PUA 分级重试** | L0-L4 五级压力升级 + 失败模式检测（打转/甩锅/空壳） |
| **TaskRunner 独立** | 超时/重试/验证/编译检查一体化，与 Orchestrator 解耦 |
| **状态机** | IDLE → PLANNING → DISPATCHING → FE/BE_RUNNING → COMPLETED/FAILED |

### 社交智能

| 机制 | 说明 |
|------|------|
| **群呼上下文** | 用户 @多人时，Agent 知道是社交招呼 |
| **铁律：只代表自己** | 不替队友说话 |
| **Chat Budget** | 闲聊 ≤3 句，省 Token + 自然交互 |
| **意图预分类** | 58 个关键词分流 chat/work，chat→512 tokens，work→4096 |
| **Agent 间委派** | FE 说 "@酱瓜 加个接口" → 自动委派，38 个委派关键词 |
| **名字智能映射** | @前端/@后端/@产品经理 都能正确路由 |

### 飞书深度集成

| 能力 | API |
|------|-----|
| ✍️ 打字指示器 | Reaction API + 文字兜底 |
| 📖 读文档 | `read_feishu_doc` — docx |
| 📖 读 Wiki | `read_feishu_wiki` — feishu.cn/wiki/XXX |
| 📊 读多维表格 | `read_feishu_bitable` — Bitable |
| 🔍 搜知识库 | `search_feishu_wiki` |
| 👤 解析用户 | `get_user_info` — ID → 姓名 |
| 👥 群成员 | `get_chat_members` |
| 📎 发文件 | `send_file_message` — 突破 800 字截断 |
| 💬 线程回复 | `reply_message` — 不刷屏 |
| 📥 下载附件 | `download_file` |
| @自动转换 | `@小柯` → `<at user_id>` |

### 代码质量

| 机制 | BE | FE |
|------|----|----|
| 编译检查 | `ast.parse` Python 语法 | 括号平衡/import/export 结构 |
| 产出验证 | workspace 快照对比，无新文件 → 警告 |
| 空壳检测 | 42 个空壳信号词识别"嘴上说说" |

### 记忆系统

| 层级 | 说明 |
|------|------|
| **个人记忆** | 每个 Agent 独立，自动提取关键事实（35 个触发词） |
| **共享记忆** | `shared-memory.md`，全局性事实自动同步 |
| **上下文压缩** | 超 20 条时压缩为摘要而非丢弃 |

### 可观测性

| 能力 | 说明 |
|------|------|
| **53 个单元测试** | pytest，覆盖 TaskRunner/Orchestrator/BaseAgent 纯函数 |
| **Metrics** | 任务计数/成功率/响应时间/Agent 维度 |
| **结构化日志** | `[时间] LEVEL event key=value` |
| **健康检查** | `GET /health` → `{status, bots, metrics}` |

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

## 环境要求

- Python 3.11+
- 飞书开放平台企业自建应用 ×3（PM / FE / BE）

## 快速开始

```bash
cd agent_app
pip install -r requirements.txt
cp .env.example .env
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
      "contact:user.base:readonly",
      "docx:document:readonly", "bitable:app:readonly", "wiki:wiki:readonly"
    ]
  }
}
```
3. 事件订阅 → **使用长连接接收事件** → 添加 `im.message.receive_v1`
4. 创建版本 → 发布
5. 三 Bot 加入同一群聊

## 使用

```bash
# 完整协作（@PM）
@小吴 创建一个 Todo 应用，支持添加和删除任务

# 引用文档
@小吴 参考这个 Wiki 文档做需求分析
[发送 feishu.cn/wiki/XXX 链接]

# 单独调用
@小柯 搭建一个 React Native 企业级 App Shell
@酱瓜 设计一个订单系统的数据模型

# 队友委派
@小柯 写个登录页。@酱瓜 把登录接口补上

# 闲聊
@小吴 @小柯 @酱瓜 早上好
```

## 测试

```bash
cd agent_app
python -m pytest tests/ -v
# 53 passed
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
├── orchestrator.py                  # 调度器（路由/意图分类/社交上下文/委派/消息）
├── task_runner.py                   # 执行器（超时/重试/验证/编译检查）
├── monitor.py                       # 指标收集 + 结构化日志
├── requirements.txt
├── .env / .env.example
│
├── agents/                          # Agent 实现
│   ├── base.py                      #   基类（SDK/记忆/事实提取/共享记忆/压缩）
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
│   ├── feishu.py                    #   飞书消息发送
│   ├── feishu_utils.py              #   飞书 API（Token/消息/文档/Wiki/文件/用户/群组）
│   ├── feishu_docs.py               #   飞书云文档工具（Agent 可调用）
│   ├── feishu_ws.py                 #   WebSocket 长连接
│   └── code_editor.py               #   代码读写（隔离+逃逸检测）
│
├── tests/                           # 单元测试 (53 个)
│   ├── conftest.py
│   ├── test_base.py
│   ├── test_orchestrator.py
│   └── test_task_runner.py
│
├── memory/                          # 记忆（运行时）
│   ├── memory-pm.md / fe.md / be.md   # 个人记忆
│   └── shared-memory.md               # 团队共享记忆
│
├── workspace/                       # 代码产出
│   ├── shared/                      #   共享上下文
│   ├── prd/ / fe/ / be/
│
└── logs/                            # 失败任务日志
```
