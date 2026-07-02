# CoAgent — 多智能体协作开发系统

三人开发团队通过飞书群协同，从需求到代码全自动完成。

| Agent | 角色 | 名字 | 人格 |
|-------|------|------|------|
| **PM** | 产品经理 | 小吴 | 精准追问者，不脑补不编造 |
| **FE** | 前端开发 | 小柯 | 像素强迫症，组件复用狂魔 |
| **BE** | 后端开发 | 酱瓜 | API 设计洁癖，数据模型信仰 |

---

## 架构

### 系统拓扑

```
python main.py
├── ws-pm 子进程 ──── wss://msg-frontier.feishu.cn  ← PM Bot WebSocket
├── ws-fe 子进程 ──── wss://msg-frontier.feishu.cn  ← FE Bot WebSocket
├── ws-be 子进程 ──── wss://msg-frontier.feishu.cn  ← BE Bot WebSocket
└── msg-consumer 线程 → Queue → Orchestrator → 三 Agent 协作
```

### 协作流程

```
飞书群
  用户: "@小吴 @小柯 @酱瓜 做个 Todo 应用"

  ┌─ 意图预分类 ─────────────────────────────────────┐
  │ "做个 Todo 应用" → 命中工作关键词 → work 模式      │
  └──────────────────────────────────────────────────┘

  ┌─ 打字指示器 ─────────────────────────────────────┐
  │ 用户消息下出现 ✍️ Reaction，每 6s 刷新             │
  └──────────────────────────────────────────────────┘

  ┌─ PM (小吴) ──────────────────────────────────────┐
  │ 分析需求 → 输出 PRD                              │
  │ → API 契约自动写入 workspace/shared/API_CONTRACT.md │
  └──────────────────────────────────────────────────┘

  ┌─ 并行执行 ───────────────────────────────────────┐
  │ asyncio.gather:                                  │
  │  ├─ FE (小柯): 读 API_CONTRACT → 写前端代码        │
  │  │    → 产出验证: workspace/fe/ 有新文件 ✓           │
  │  └─ BE (酱瓜): 读 API_CONTRACT → 写后端代码        │
  │       → 产出验证: workspace/be/ 有新文件 ✓           │
  └──────────────────────────────────────────────────┘

  ┌─ 共享状态更新 ───────────────────────────────────┐
  │ workspace/shared/STATUS.md ← FE ✓  BE ✓           │
  └──────────────────────────────────────────────────┘

  → FE Bot: "收到，登录页面已生成。[3 个文件]"
  → BE Bot: "收到，API 已实现。[2 个文件]"
```

### 闲聊流程（群呼模式）

```
飞书群
  用户: "洋洋得意" + @小吴 @小柯 @酱瓜

  ┌─ 意图预分类 ────────────────────────────────────┐
  │ "洋洋得意" → 无工作关键词 → chat 模式             │
  │ max_tokens=512, Chat Budget: ≤3句话              │
  └──────────────────────────────────────────────────┘

  ┌─ 群呼上下文注入 ─────────────────────────────────┐
  │ "用户同时 @了你和小柯、酱瓜——这不是派活"            │
  │ "你只代表你自己，不替别人回答"                      │
  └──────────────────────────────────────────────────┘

  → 小柯: "哈哈，今天心情不错啊～"
  → 酱瓜: "在呢"
  → 小吴: "有啥好事？"
  （各说各的，不替别人回答，不追要需求）
```

### Agent 文件集（对标 OpenMOSS + OpenClaw）

每个 Agent 拥有 5 个标准定义文件：

```
prompts/{agent}/
├── AGENTS.md    ← 操作规则（铁律/Chat Budget），Always Loaded
├── prompt.md    ← 人格/SOUL，Always Loaded
├── SKILL.md     ← 技能书，On-demand
├── COMMAND.md   ← 工作流，On-demand
└── MEMORY.md    ← 长期记忆
```

- **AGENTS.md + prompt.md** → 启动时合并注入 system prompt
- **SKILL.md + COMMAND.md** → LLM 按需读取，不占常驻 Token
- **MEMORY.md** → 跨会话积累的项目经验、组件库、踩坑记录

### 三层隔离

| 层级 | PM | FE | BE |
|------|----|----|----|
| Prompt | 只做需求，不写代码 | 只做 UI/组件，不碰后端 | 只做 API/模型，不写前端 |
| 文件系统 | workspace/prd/ | workspace/fe/ | workspace/be/ |
| 记忆 | memory/memory-pm.md | memory/memory-fe.md | memory/memory-be.md |

### 共享上下文（借鉴 OpenClaw shared-context/）

```
workspace/shared/
├── API_CONTRACT.md   ← PM 出 PRD 后自动写入，FE/BE 以此为准
├── STATUS.md         ← 各 Agent 完成后自动更新进度
└── DECISIONS.md      ← 技术决策日志（影响队友的决策写这里）
```

FE 和 BE 开工前先读共享目录，避免各自发明接口。

---

## 核心机制

### 社交智能

| 机制 | 说明 |
|------|------|
| **群呼上下文** | 用户 @多人时，Agent 知道这是社交招呼而非工作指派 |
| **铁律：只代表自己** | 不替队友说"XX也在"——他们是活人，自己会说话 |
| **Chat Budget** | 闲聊 ≤3 句话，工作才展开。省 Token + 自然交互 |
| **意图预分类** | 关键词匹配分流 chat/work，chat→max_tokens=512，work→4096 |

### 体验增强（借鉴 OpenClaw）

| 机制 | 说明 |
|------|------|
| **✍️ Reaction 打字指示器** | LLM 思考时在用户消息上加 ✍️ 表情回应，每 6s 刷新 |
| **@队友自动转换** | 回复中写 `@小柯` `@酱瓜` 自动转为飞书 `<at>` 标签 |
| **即时确认** | 被 @ 时先应一声（空消息→"嗯？"），不沉默 |

### 可靠性

| 机制 | 说明 |
|------|------|
| **产出验证** | Agent 声称"完成了"但 workspace 无新文件 → 自动注入警告 |
| **Honcho 风格长期记忆** | 自动提取关键事实（决策/偏好），每次 LLM 调用前注入 |
| **上下文压缩** | 对话超 20 条时压缩旧消息为摘要，而非直接丢弃 |
| **PUA 分级重试** | L0-L4 五级，含失败模式检测（打转/甩锅/空壳） |

### 技术栈

- **模型**: DeepSeek-v4-pro（Anthropic SDK 兼容接口）
- **入口**: 飞书 WebSocket 长连接（lark-oapi 官方 SDK），无需公网 IP
- **调度**: Orchestrator + asyncio.gather 并行 + 指数退避重试
- **通信**: 飞书 REST API 消息发送 + Reaction API 打字指示器
- **隔离**: multiprocessing 子进程，每 Bot 独立 event loop

---

## 环境要求

- Python 3.11+
- 飞书开放平台企业自建应用 ×3（PM / FE / BE）

## 快速开始

```bash
cd agent_app
pip install -r requirements.txt
cp .env.example .env   # 编辑填入凭证
python main.py          # 启动，三 Bot 自动连接飞书
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
2. 权限 → `im:message` + `im:message:send_as_bot` + `im:message:reaction`（打字指示器需要）
3. 事件订阅 → **使用长连接接收事件** → 添加 `im.message.receive_v1`
4. 创建版本 → 发布
5. 三 Bot 加入同一群聊

## 使用

### 完整协作（@PM）

```bash
# 群内 @小吴 触发完整 PRD → FE/BE 并行开发：
@小吴 创建一个简单的 Todo 应用，支持添加和删除任务
```

### 单独调用

```bash
@小柯 把按钮颜色改成蓝色
@酱瓜 添加 DELETE /api/todos/{id} 接口
```

### 闲聊

```bash
@小吴 @小柯 @酱瓜 早上好
# 三人各自回应，不追要需求，不替别人说话
```

## 健康检查

```bash
curl http://localhost:8000/health
# {"status":"ok","bots":{"pm":"configured","fe":"configured","be":"configured"}}
```

## 项目结构

```
agent_app/
├── main.py                          # FastAPI 入口 + WebSocket 生命周期
├── orchestrator.py                  # 调度器（状态机/意图分类/信息过滤/重试/并行/验证）
├── requirements.txt                 # Python 依赖
├── .env / .env.example              # 环境变量
│
├── agents/                          # [代码] Agent 实现
│   ├── base.py                      #   基类（Anthropic SDK/记忆/事实提取/压缩）
│   ├── pm.py                        #   PM Agent — 小吴
│   ├── fe.py                        #   FE Agent — 小柯
│   └── be.py                        #   BE Agent — 酱瓜
│
├── prompts/                         # [定义] Agent 文件集
│   ├── pua/SKILL.md                 #   PUA 引擎方法论（共享）
│   ├── pm/                          #   PM Agent 定义
│   │   ├── AGENTS.md                #     操作规则（铁律/Chat Budget/聊天示例）
│   │   ├── prompt.md                #     人格 SOUL
│   │   ├── COMMAND.md               #     工作流
│   │   └── MEMORY.md                #     长期记忆
│   ├── fe/                          #   FE Agent 定义
│   └── be/                          #   BE Agent 定义
│
├── tools/                           # [工具] MCP 外部能力
│   ├── search.py                    #   Web 搜索（DuckDuckGo）
│   ├── feishu.py                    #   飞书消息发送（PM 调用）
│   ├── feishu_utils.py              #   飞书 API（Token/多Bot发送/Reaction）
│   ├── feishu_ws.py                 #   WebSocket 长连接（三Bot子进程/群呼检测）
│   └── code_editor.py               #   代码读写（路径隔离 + 逃逸检测）
│
├── memory/                          # 对话记忆（{messages, facts} JSON，运行时生成）
│   ├── memory-pm.md
│   ├── memory-fe.md
│   └── memory-be.md
│
├── workspace/                       # 代码产出
│   ├── shared/                      #   共享上下文（API契约/状态/决策日志）
│   │   ├── API_CONTRACT.md
│   │   ├── STATUS.md
│   │   └── DECISIONS.md
│   ├── prd/                         #   PM 产出 PRD
│   ├── fe/                          #   FE 产出前端代码
│   └── be/                          #   BE 产出后端代码
│
└── logs/                            # 失败任务日志
```
