# CoAgent — 多智能体协作开发系统

三人 P8 级开发团队通过飞书群协同，从需求调研到代码产出全自动。

| Agent | 名字 | 角色 | 核心能力 |
|-------|------|------|---------|
| **小吴** | PM | 产品总监 | 需求分析、竞品调研、PRD、审查验收 |
| **小柯** | FE | 前端架构师 | React/Vue/RN/Flutter/小程序/可视化 |
| **酱瓜** | BE | 后端架构师 | FastAPI/Go/Spring/数据库/云原生 |

---

## 快速开始

```bash
cd agent_app
pip install -r requirements.txt
cp .env.example .env
# 编辑 .env 填入飞书凭证和 API Key
python main.py
```

`.env` 配置：

```env
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
ANTHROPIC_API_KEY=sk-your-key
ANTHROPIC_MODEL=deepseek-v4-pro

# 可选：启用高质量联网搜索（免费 1000 次/月，专为 AI Agent 设计，https://tavily.com/）
TAVILY_API_KEY=

FEISHU_PM_APP_ID=cli_xxx
FEISHU_PM_APP_SECRET=xxx
FEISHU_FE_APP_ID=cli_xxx
FEISHU_FE_APP_SECRET=xxx
FEISHU_BE_APP_ID=cli_xxx
FEISHU_BE_APP_SECRET=xxx
```

### 飞书配置

每个 Bot 在 [飞书开放平台](https://open.feishu.cn) 创建企业自建应用：

1. 添加**机器人**能力
2. 权限管理 → 添加：`im:message` `im:message:send_as_bot` `im:message:readonly` `im:message.group_at_msg:readonly` `im:chat:readonly` `im:chat.members:bot_access` `im:resource` `im:message:reaction` `contact:user.base:readonly` `docx:document:readonly` `bitable:app:readonly` `wiki:wiki:readonly`
3. 事件订阅 → **使用长连接接收事件** → 添加 `im.message.receive_v1`
4. 创建版本 → 发布
5. 三个 Bot 加入同一群聊

---

## 使用

### 四种意图（自动识别）

| 意图 | 触发条件 | 行为 | 示例 |
|------|---------|------|------|
| **chat** | 问候、短消息 | 3 句话闲聊 | `@小柯 早` |
| **read** | 发链接、"看一下" | 搜索 + 读全文 + 深度调研 + 引用来源 | `@小吴 offer蛙是什么` |
| **plan** | "方案""怎么设计" | 出分析方案，不写代码 | `@小吴 这个怎么架构` |
| **work** | "写""做""搭建" | 调研→PRD→FE/BE 并行→审查→验收 | `@小吴 做个企业知识库` |

### 常用指令

```bash
# 完整协作（@PM → PRD → FE+BE 并行 → Review → 验收 Checklist）
@小吴 创建一个 Todo 应用，支持增删改查

# 调研（ChatGPT 风格：多角度搜索 → 打开链接读全文 → 交叉验证 → 引来源）
@小吴 分析一下 Notion 的竞品

# 单独调用
@小柯 写个登录页面
@酱瓜 设计订单系统的数据模型

# 读文档（只读 + 摘要，不写代码）
@小柯 https://feishu.cn/wiki/ABC123

# Agent 间委派（回复里 @队友 自动递任务）
@小柯 写个登录页。@酱瓜 把登录接口补上

# 延续任务（系统记住上下文，自动知道往哪个项目改）
@小柯 把按钮颜色改成蓝色
```

---

## 架构

```
python main.py
├── ws-pm / ws-fe / ws-be 子进程 ── 飞书 WebSocket 长连接
├── msg-consumer 线程 → Queue → Orchestrator
├── 消息标准化层 → 意图分类（chat/read/plan/work）
└── Agent 执行：✍️ Reaction + 进度消息原地编辑 + 审查闭环
```

**协作流程**：用户 @PM → PM 深度调研（search_web + web_fetch）→ 输出 PRD + 验收 Checklist → FE/BE 并行开发 → PM Light Review（PASS/FAIL）→ 自动清理测试文件 → 发结果

---

## 核心机制

### 智能交互

| 机制 | 说明 |
|------|------|
| **四种意图** | chat/read/plan/work 自动分流 |
| **深度调研** | ChatGPT 风格：多角度搜索 → web_fetch 打开 3-5 个链接读全文 → 交叉验证 → 引来源 |
| **联网搜索** | Brave Search（实时网页）+ DuckDuckGo 兜底；三个 Agent 都有 `search_web` + `web_fetch` |
| **✍️ 打字指示器** | Reaction API；失败回退文字"正在输入..." |
| **进度原地编辑** | 同一条消息反复编辑，不刷屏 |
| **Patrol 沉默检测** | 48s 无进度 → 发提醒 |
| **测试文件自动清理** | 每次代码生成后删 `_Test*`、`*.test.*`、`__tests__/` |

### 审查闭环

| 机制 | 说明 |
|------|------|
| **PM Light Review** | 对照 PRD 验收标准审查 FE/BE，不通过带反馈返工一次 |
| **验收 Checklist** | PM 输出 `- [ ]` 格式清单，Review 时自动勾选 |
| **STATUS 持久化** | 三 Agent 状态独立记录，不互相覆盖 |

### 记忆与会话（借鉴 OpenClaw）

| 机制 | 说明 |
|------|------|
| **LLM 语义压缩** | 30 条触发，调 LLM 生成摘要替代截断拼接；压缩前 flush 到 notes |
| **精选笔记** | `notes-{name}.md`，Agent 自主记录技术经验 |
| **每日日志** | `daily/YYYY-MM-DD-{name}.md`，系统自动写 |
| **TaskSession** | 记住项目上下文，延续任务自动注入；30 分钟过期 |
| **Agent 锁** | asyncio.Lock 防并发记忆损坏 |

### 执行引擎

| 机制 | 说明 |
|------|------|
| **并行执行** | FE/BE 通过 asyncio.gather 并行，各自 30 轮工具调用 |
| **超时保护** | work 720s / PM 480s / 重试 900s / HTTP 720s |
| **PUA 重试** | L0-L4 五级压力 + 失败模式检测（打转/甩锅/空壳） |
| **流式进度** | on_progress 回调 + queue.Queue 桥接同步→异步 |
| **代码验证** | Python `ast.parse` + 前端括号/import/export 检查 |

---

## 工具

三个 Agent 共享以下工具：

| 工具 | 说明 | PM | FE | BE |
|------|------|:--:|:--:|:--:|
| `search_web` | Tavily / DuckDuckGo 联网搜索 | ✅ | ✅ | ✅ |
| `web_fetch` | 直接访问 URL 读网页全文 | ✅ | ✅ | ✅ |
| `read_file` / `list_dir` | 读本地文件 / 列目录 | ✅ | ✅ | ✅ |
| `read_feishu_wiki` | 读飞书知识库 | ✅ | ✅ | ✅ |
| `read_feishu_doc` | 读飞书文档 | ✅ | ✅ | ✅ |
| `search_feishu_wiki` | 搜索飞书知识库 | ✅ | ✅ | ✅ |
| `read_feishu_bitable` | 读多维表格 | ✅ | ✅ | ✅ |
| `write_file` | 写代码 | — | ✅ | ✅ |

---

## 测试

```bash
cd agent_app
python -m pytest tests/ -v
# 47 passed
```

```bash
curl http://localhost:8000/health
curl http://localhost:8000/task/{task_id}
```

## 项目结构

```
agent_app/
├── main.py                    # FastAPI + WebSocket 生命周期
├── orchestrator.py            # 调度（路由/意图/Session/Review/委派）
├── task_runner.py             # 执行（超时/重试/流式/验证/清理）
├── monitor.py                 # 指标 + 日志
├── .env / .env.example
├── agents/                    # Agent 类定义
│   ├── base.py                #   BaseAgent（LLM调用 + 工具循环 + 记忆管理）
│   ├── pm.py                  #   PM Agent（小吴）
│   ├── fe.py                  #   FE Agent（小柯）
│   └── be.py                  #   BE Agent（酱瓜）
├── prompts/
│   ├── shared/
│   │   └── COLLABORATION.md    #   三人协作协议（任务生命周期/联调/验收）
│   ├── pm/
│   │   ├── prompt.md           #     身份定义（P8 产品总监 · 小吴）
│   │   ├── AGENTS.md           #     操作规则（聊天/工作模式 + 任务生命周期）
│   │   ├── COMMAND.md          #     工作流 + PRD五关自检 + PRD缺陷修复流程
│   │   ├── SKILL.md            #     技能书（需求分析 + PRD模板 + 任务拆解规范）
│   │   └── MEMORY.md           #     长期记忆模板
│   ├── fe/
│   │   ├── prompt.md           #     身份定义（P8 前端架构师 · 小柯）
│   │   ├── AGENTS.md           #     操作规则（聊天/工作模式 + 协作）
│   │   ├── COMMAND.md          #     工作流 + 写后六关自检 + Bug修复六步法
│   │   ├── SKILL.md            #     技能书（技术选型 + 组件模式 + TS规范）
│   │   └── MEMORY.md           #     长期记忆模板
│   ├── be/
│   │   ├── prompt.md           #     身份定义（P8 后端架构师 · 酱瓜）
│   │   ├── AGENTS.md           #     操作规则（聊天/工作模式 + 协作）
│   │   ├── COMMAND.md          #     工作流 + 写后六关自检 + Bug修复六步法
│   │   ├── SKILL.md            #     技能书（技术选型 + API规范 + Python规范）
│   │   └── MEMORY.md           #     长期记忆模板
│   └── pua/                    #   PUA 引擎 L0-L4 重试策略
├── tools/
│   ├── search.py              #   Brave Search + DuckDuckGo
│   ├── web_fetch.py           #   URL 直接访问
│   ├── feishu_utils.py        #   飞书 API（消息/Reaction/编辑/文档）
│   ├── feishu_docs.py         #   云文档工具
│   ├── feishu_ws.py           #   WebSocket 长连接
│   ├── message_normalizer.py  #   消息标准化
│   └── code_editor.py         #   代码读写
├── tests/                     # 47 个单元测试
├── memory/                    # 运行时记忆 + notes + daily 日志
├── workspace/                 # 代码产出
│   ├── fe/                    #   前端项目（如 rn-app-shell）
│   ├── be/                    #   后端项目
│   ├── prd/                   #   PM 产出的 PRD
│   └── shared/                #   共享文件（API_CONTRACT.md / STATUS.md / tasks/）
└── logs/                      # 失败任务日志
```
