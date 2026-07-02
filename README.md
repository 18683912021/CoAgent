# CoAgent — 多智能体协作开发系统

三人开发团队通过飞书群协同，从需求到代码全自动完成。

| Agent | 角色 | 名字 | 人格 |
|-------|------|------|------|
| **PM** | 产品经理 | Lin | 精准追问者，不脑补不编造 |
| **FE** | 前端开发 | Seven | 像素强迫症，组件复用狂魔 |
| **BE** | 后端开发 | Atlas | API 设计洁癖，数据模型信仰 |

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
  用户: @PM_Bot 创建 Todo 应用
    → PM Bot (Lin): "收到。PRD 完成，@FE @BE 开始开发"
    → 内部 asyncio.gather 并行执行:
        ├─ FE Agent (Seven): 生成 workspace/fe/*
        └─ BE Agent (Atlas): 生成 workspace/be/*
    → FE Bot: "收到 PM 前端任务，已完成。[code]"
    → BE Bot: "收到 PM 后端任务，已完成。[code]"
    → PM Bot: "任务完成。代码已生成。"
```

### Agent 文件集（对标 OpenMOSS）

每个 Agent 拥有 5 个标准定义文件：

```
prompts/{agent}/
├── AGENTS.md    ← 操作规则，Always Loaded
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

### 技术栈

- **模型**: DeepSeek-v4-pro（Anthropic SDK 兼容接口）
- **入口**: 飞书 WebSocket 长连接（lark-oapi 官方 SDK），无需公网 IP
- **调度**: Orchestrator + asyncio.gather 并行 + 指数退避重试
- **通信**: 飞书 REST API 消息发送，WebSocket 事件接收
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
2. 权限 → `im:message` + `im:message:send_as_bot`
3. 事件订阅 → **使用长连接接收事件** → 添加 `im.message.receive_v1`
4. 创建版本 → 发布
5. 三 Bot 加入同一群聊

## 使用

```bash
# 群内 @PM_Bot 触发完整协作：
@PM_Bot 创建一个简单的 Todo 应用，支持添加和删除任务

# 直接 @FE_Bot 或 @BE_Bot 执行单项任务：
@FE_Bot 把按钮颜色改成蓝色
@BE_Bot 添加 DELETE /api/todos/{id} 接口
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
├── orchestrator.py                  # 调度器（状态机/信息过滤/重试/并行）
├── requirements.txt                 # Python 依赖
├── .env / .env.example              # 环境变量
│
├── agents/                          # [代码] Agent 实现
│   ├── base.py                      #   基类（Anthropic SDK/记忆/工具循环）
│   ├── pm.py                        #   PM Agent — Lin
│   ├── fe.py                        #   FE Agent — Seven
│   └── be.py                        #   BE Agent — Atlas
│
├── prompts/                         # [定义] Agent 文件集（对标 OpenMOSS）
│   ├── pm/                          #   PM Agent 定义
│   │   ├── AGENTS.md                #     操作规则 (Always)
│   │   ├── prompt.md                #     人格 SOUL (Always)
│   │   ├── SKILL.md                 #     技能书 (On-demand)
│   │   ├── COMMAND.md               #     工作流 (On-demand)
│   │   └── MEMORY.md                #     长期记忆
│   ├── fe/                          #   FE Agent 定义（同上 5 文件）
│   └── be/                          #   BE Agent 定义（同上 5 文件）
│
├── tools/                           # [工具] MCP 外部能力
│   ├── search.py                    #   Web 搜索（DuckDuckGo）
│   ├── feishu.py                    #   飞书消息发送（PM 调用）
│   ├── feishu_utils.py              #   飞书 API（Token/多Bot发送）
│   ├── feishu_ws.py                 #   WebSocket 长连接（三Bot子进程）
│   └── code_editor.py               #   代码读写（路径隔离 + 逃逸检测）
│
├── memory/                          # 对话记忆 JSON（运行时生成）
│   ├── memory-pm.md
│   ├── memory-fe.md
│   └── memory-be.md
│
├── workspace/                       # 代码产出（运行时生成）
│   ├── prd/                         #   PM 产出 PRD
│   ├── fe/                          #   FE 产出前端代码
│   └── be/                          #   BE 产出后端代码
│
└── logs/                            # 失败任务日志
```
