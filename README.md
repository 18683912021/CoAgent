# CoAgent — 多智能体协作开发系统

三人开发团队：**PM Agent**（需求分析）+ **FE Agent**（前端开发）+ **BE Agent**（后端开发），通过飞书群 @Bot 触发协作，自动完成从需求到代码的全流程。

## 架构

```
飞书群 @PM_Bot "创建Todo应用"
  → PM Agent 分析需求，生成 PRD
  → FE Agent 生成前端代码（workspace/fe/）
  → BE Agent 生成后端代码（workspace/be/）
  → 三 Bot 各自在群内回复结果
```

- 模型：DeepSeek-v4-pro（Anthropic 兼容接口）
- 入口：飞书 WebSocket 长连接（无需公网 IP）
- 隔离：三 Agent 独立 Prompt / 记忆 / 工作目录，团队认知但不越界

## 环境要求

- Python 3.11+
- 飞书开放平台企业自建应用 ×3（PM / FE / BE）

## 快速开始

```bash
# 1. 进入目录
cd agent_app

# 2. 安装依赖
pip install -r requirements.txt

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 DeepSeek API Key 和三组飞书 Bot 凭证

# 4. 启动服务
python main.py
```

## .env 配置

```env
# DeepSeek
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
ANTHROPIC_API_KEY=sk-your-key
ANTHROPIC_MODEL=deepseek-v4-pro

# PM Bot
FEISHU_PM_APP_ID=cli_xxx
FEISHU_PM_APP_SECRET=xxx

# FE Bot
FEISHU_FE_APP_ID=cli_xxx
FEISHU_FE_APP_SECRET=xxx

# BE Bot
FEISHU_BE_APP_ID=cli_xxx
FEISHU_BE_APP_SECRET=xxx
```

## 飞书配置

每个 Bot 在飞书开放平台进行相同配置：

1. 创建企业自建应用 → 添加**机器人**能力
2. 权限管理 → 开通 `im:message`、`im:message:send_as_bot`
3. **事件与回调** → 选择「使用长连接接收事件」→ 添加 `im.message.receive_v1`
4. 创建版本 → 发布
5. 将三个 Bot 加入同一个群聊

## 使用

在群内 @Bot 发送指令：

```
@PM_Bot 创建一个简单的Todo应用，可以添加和删除任务
```

PM Bot 分析需求后，FE Bot 和 BE Bot 会自动在群内回复各自生成的代码。

也可以直接 @FE_Bot 或 @BE_Bot 执行单项任务：

```
@FE_Bot 修改按钮颜色为蓝色
@BE_Bot 添加一个 DELETE /api/todos/{id} 接口
```

## 项目结构

```
agent_app/
├── main.py              # 入口，WebSocket 长连接 + FastAPI
├── orchestrator.py      # 任务调度器（信息过滤 + 重试 + 状态机）
├── agents/
│   ├── base.py          # Agent 基类（Anthropic SDK + 记忆 + 工具循环）
│   ├── pm.py            # PM Agent
│   ├── fe.py            # FE Agent（工作区 workspace/fe/）
│   └── be.py            # BE Agent（工作区 workspace/be/）
├── prompts/             # 三个 Agent 的系统提示词
├── tools/               # 工具函数（搜索/飞书消息/代码编辑）
├── memory/              # Agent 独立记忆（运行时生成）
├── workspace/           # Agent 代码产出（运行时生成）
└── logs/                # 失败任务日志
```

## 健康检查

```bash
curl http://localhost:8000/health
```
