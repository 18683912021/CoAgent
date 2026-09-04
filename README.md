# CoAgent — 多智能体协作开发系统

三人 P8 级开发团队通过飞书群协同，从需求调研到代码产出全自动。

| Agent | 名字 | 角色 | 核心能力 |
|-------|------|------|---------|
| **小吴** | PM | 产品总监 | 需求分析、竞品调研、PRD、审查验收 |
| **小柯** | FE | 前端架构师 | React/Vue/RN/Flutter/小程序/可视化/Android 原生/Electron |
| **酱瓜** | BE | 后端架构师 | FastAPI/Go/Spring/数据库/云原生/WebSocket |

---

## 快速开始

```bash
cd agent_app
pip install -r requirements.txt
# 编辑 .env 填入飞书凭证和 API Key
python main.py
```

`.env` 配置：

```env
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
ANTHROPIC_API_KEY=sk-your-key
ANTHROPIC_MODEL=deepseek-v4-flash

# 可选：启用联网搜索（免费 1000 次/月，专为 AI Agent 设计，https://tavily.com/）
TAVILY_API_KEY=

# 飞书三个 Bot
FEISHU_PM_APP_ID=cli_xxx
FEISHU_PM_APP_SECRET=xxx
FEISHU_FE_APP_ID=cli_xxx
FEISHU_FE_APP_SECRET=xxx
FEISHU_BE_APP_ID=cli_xxx
FEISHU_BE_APP_SECRET=xxx

# 可选：邮箱验证码 SMTP
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_USER=xxx@qq.com
SMTP_PASSWORD=xxx
SMTP_FROM_NAME=AI面试助手
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
| **chat** | 问候、短消息 | 3 句话闲聊，用裁剪版 prompt 省 token | `@小柯 早` |
| **read** | 发链接、"看一下" | 搜索 + 读全文 + 摘要 | `@小吴 offer蛙是什么` |
| **plan** | "方案""怎么设计" | 出分析方案，不写代码 | `@小吴 这个怎么架构` |
| **work** | "写""做""搭建" | 调研→PRD→FE/BE并行→审查→验收 | `@小吴 做个企业知识库` |

> **Token 优化**：chat 模式只加载 AGENTS.md（~2000 tokens），work/plan 模式加载完整 prompt（~3500 tokens），闲聊省 ~40%。

### 常用指令

```bash
# 完整协作（@PM → PRD → FE+BE 并行 → Review → 验收）
@小吴 创建一个 Todo 应用，支持增删改查

# 调研（多角度搜索 → 打开链接读全文 → 交叉验证 → 引用来源）
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
├── ws-pm / ws-fe / ws-be 子进程 —— 飞书 WebSocket 长连接
├── msg-consumer 线程 → Queue → Orchestrator
├── 消息标准化层 → @_user_N 格式兼容 + 意图分类（chat/read/plan/work）
├── WebSocket 断线重连（指数退避 + 自动恢复订阅）
└── Agent 执行：👌 Reaction + "正在输入..." 文字并发 + 实时进度 + 完成后自动清理
```

**协作流程**：用户 @PM → PM 深度调研（search_web + web_fetch）→ 输出 PRD + 验收 Checklist → 审批门等确认 → FE/BE 并行（技术协商→开发→进度回填→联调签字）→ PM 验收（通过/退回+原因）→ 发结果。详见 [COLLABORATION.md](agent_app/prompts/shared/COLLABORATION.md)。

---

## 核心机制

### Token 优化（Claude Code 风格）

| 机制 | 说明 |
|------|------|
| **Prompt Cache** | System prompt + Tool 定义标记 `cache_control: ephemeral`，前缀不变时 API 自动复用缓存，免重新计算 |
| **稳定 Prompt 结构** | System → Tools → Messages 固定顺序，动态内容（mode_reminder/facts/daily）注入 user 消息末尾，不破坏缓存 |
| **Lazy Context** | chat 模式只加载 AGENTS.md，work/plan 模式加载完整 prompt.md + AGENTS.md |
| **LLM 语义摘要** | 上下文超 30 条触发压缩：当前轮文本拼接（0ms）+ 后台 daemon 线程 LLM 摘要异步升级 |
| **Token 估算** | `_estimate_tokens()` 粗略计数，>8000 tokens 打印警告 |

### 智能交互

| 机制 | 说明 |
|------|------|
| **四种意图** | chat/read/plan/work 自动分流，资源差异化分配 |
| **深度调研** | Read 模式：多角度搜索 → web_fetch 打开 3-5 个链接读全文 → 交叉验证 → 引用来源 |
| **联网搜索** | Tavily（优先）+ DuckDuckGo 兜底；三个 Agent 都有 `search_web` + `web_fetch` |
| **👌 打字指示器** | OK Reaction + "正在输入..." 文字并发，完成后自动清理 |
| **实时进度** | 1s 轮询，进度消息原地编辑不刷屏，完成后自动清除 |
| **Patrol 沉默检测** | 30s 无进度 → 发提醒 |
| **WebSocket 断线重连** | 指数退避 1s-64s，自动恢复订阅，子进程异常退出自动重启 |

### 记忆系统

三层存储，确保 Agent 跨会话不"失忆"：

| 层 | 存储 | 机制 |
|----|------|------|
| **L0 工作记忆** | `memory-{name}.md`（JSON transcript） | 上下文窗口内对话，超 30 条触发压缩。文本拼接摘要 + 后台 LLM 升级 |
| **L1 持久记忆** | `notes-{name}.md`（Markdown 笔记） | 每轮对话提取到笔记（write-before-compaction），不会被压缩，下次启动自动注入 |
| **facts 归档** | facts → notes | facts 上限 15 条，满后旧条目自动归档到 notes |
| **去重** | write_notes 内置 | 检查最近笔记，前 30 字相同则跳过 |
| **队友同步** | 写 notes 不写 memory | 队友动态写入持久笔记层，不污染对话上下文 |
| **每日日志** | `daily/YYYY-MM-DD-{name}.md` | 系统自动写，今天+昨天日志自动注入上下文 |

### 执行引擎

| 机制 | 说明 |
|------|------|
| **并行执行** | FE/BE 通过 asyncio.gather 并行，各自最多 360 轮工具调用 |
| **超时保护** | work 24min / PM 16min / 闲聊 16min / 重试 30min / HTTP 24min |
| **PUA 重试** | L0-L4 五级压力 + 失败模式检测（打转/甩锅/空壳）+ 最多 8 次 |
| **流式进度** | on_progress 回调 + queue.Queue 桥接同步→异步 + 1 秒实时轮询 |
| **代码验证** | Python `ast.parse` + 前端括号/import/export 检查 + `edit_file` 防幻觉校验 |
| **兜底熔断** | 同工具同错误连续 9 次自动中断，防死循环 |
| **优雅退出** | Ctrl+C → stop_event → terminate → join → kill，不残留子进程 |
| **工作区隔离** | FE 写 workspace/fe/，BE 写 workspace/be/，路径级隔离，读写分离 |

### 审查闭环

| 机制 | 说明 |
|------|------|
| **PM Light Review** | 对照 PRD 验收标准审查 FE/BE，不通过退回并注明原因 |
| **验收 Checklist** | PM 输出 `- [ ]` 格式清单，Review 时自动勾选 |
| **审批门** | PM 出 PRD 后等确认再派发；确认词无需 @mention 也能触发 |
| **需求反馈闭环** | FE/BE 可质疑 PRD → PM 接受或驳回（必须附理由）→ 全部记入「需求变更记录」 |
| **STATUS 持久化** | 三 Agent 状态独立记录，智能提取摘要，不互相覆盖 |

### 协作保障

| 机制 | 说明 |
|------|------|
| **TaskSession** | 记住项目上下文，延续任务自动注入；30 分钟过期 |
| **Agent 锁** | asyncio.Lock 防并发记忆损坏 |
| **群呼自然化** | @多人时不注入机械指令，自然传递消息上下文 |
| **Agent 间委派** | 回复中 @队友 + 行动词 → 自动检测 & 递任务 |
| **读写分离** | 读用 PROJECT_ROOT（全局可读 prompts/product-description/workspace）；写限定在 workspace/{fe,be} |

---

## 工具

三个 Agent 的工具集：

| 工具 | 说明 | PM | FE | BE |
|------|------|:--:|:--:|:--:|
| `search_web` | Tavily / DuckDuckGo 联网搜索 | ✅ | ✅ | ✅ |
| `web_fetch` | 直接访问 URL 读网页全文 | ✅ | ✅ | ✅ |
| `read_file` | 读本地文件（全局可读） | ✅ | ✅ | ✅ |
| `write_file` | 创建/覆盖文件 | ✅ | ✅ | ✅ |
| `edit_file` | 精确编辑（old→new，唯一匹配+防幻觉） | — | ✅ | ✅ |
| `delete_file` | 删除文件 | — | ✅ | ✅ |
| `list_dir` | 列出目录结构 | ✅ | ✅ | ✅ |
| `execute` | 终端命令（npm/pip/git/node/grep/find 等） | — | ✅ | ✅ |
| `check_code` | 代码自检（语法/import/引用完整性） | — | ✅ | ✅ |
| `read_feishu_wiki` | 读飞书知识库 | ✅ | ✅ | ✅ |
| `read_feishu_doc` | 读飞书文档 | ✅ | ✅ | ✅ |
| `search_feishu_wiki` | 搜索飞书知识库 | ✅ | ✅ | ✅ |
| `read_feishu_bitable` | 读多维表格 | ✅ | ✅ | ✅ |

> **读写分离**：`read_file`/`list_dir` 基于 PROJECT_ROOT，可读全局文件（prompts/、product-description/、workspace/ 等）。`write_file`/`edit_file`/`delete_file` 限定在 Agent 自己的 workspace 目录下，防止误写项目源码。

---

## 测试

```bash
cd agent_app
python -m pytest tests/ -v
# 70 tests: 63 passed, 1 failed (test_with_others), 6 errors (SHARED_MEMORY_FILE import)
```

```bash
curl http://localhost:8000/health
curl http://localhost:8000/task/{task_id}
```

---

## 项目结构

```
CoAgent/
├── README.md
├── deep-research-report.md           # 系统方案设计文档
├── implementation-progress.md        # 实现进度记录
├── RN_ANDROID_STUDIO_SETUP.md        # Android 开发环境配置指南
│
├── agent_app/                        # 多 Agent 协作调度系统
│   ├── main.py                       # FastAPI + WebSocket 生命周期管理
│   ├── orchestrator.py               # 调度器（路由/意图/Session/STATUS/Review/委派/队友同步）
│   ├── task_runner.py                # 执行器（超时/重试/流式/快照/验证/清理）
│   ├── monitor.py                    # 指标 + 日志
│   ├── requirements.txt
│   ├── .env
│   │
│   ├── agents/                       # Agent 类定义
│   │   ├── base.py                   #   BaseAgent（LLM调用+工具循环+记忆+上下文压缩+Prompt Cache+Lazy Context）
│   │   ├── pm.py                     #   PM Agent（小吴）
│   │   ├── fe.py                     #   FE Agent（小柯）
│   │   └── be.py                     #   BE Agent（酱瓜）
│   │
│   ├── prompts/                      # Agent 人格 & 操作规范
│   │   ├── shared/
│   │   │   └── COLLABORATION.md       #   三人协作协议（任务生命周期/技术协商/联调/验收）
│   │   ├── pm/
│   │   │   ├── prompt.md              #   身份定义（P8 产品总监 · 小吴）
│   │   │   ├── AGENTS.md              #   操作规则（聊天/工作模式+Chat Budget）
│   │   │   ├── COMMAND.md             #   工作流+PRD自检+缺陷修复流程
│   │   │   ├── SKILL.md               #   技能书
│   │   │   └── MEMORY.md              #   长期记忆模板
│   │   ├── fe/
│   │   │   ├── prompt.md              #   身份定义（P8 前端架构师 · 小柯）
│   │   │   ├── AGENTS.md              #   操作规则+Chat Budget
│   │   │   ├── COMMAND.md             #   工作流+自检+Bug修复流程
│   │   │   ├── SKILL.md               #   技能书
│   │   │   └── MEMORY.md              #   长期记忆模板
│   │   ├── be/
│   │   │   ├── prompt.md              #   身份定义（P8 后端架构师 · 酱瓜）
│   │   │   ├── AGENTS.md              #   操作规则+Chat Budget
│   │   │   ├── COMMAND.md             #   工作流+自检+Bug修复流程
│   │   │   ├── SKILL.md               #   技能书
│   │   │   └── MEMORY.md              #   长期记忆模板
│   │   └── pua/                       #   PUA 引擎 L0-L4 重试策略
│   │
│   ├── tools/                         # 工具实现
│   │   ├── search.py                  #   联网搜索（Tavily + DuckDuckGo）
│   │   ├── web_fetch.py               #   URL 直接访问
│   │   ├── code_editor.py             #   文件读写+精确编辑+防嵌套路径解析
│   │   ├── code_check.py              #   代码自检（语法/import/引用完整性）
│   │   ├── terminal.py                #   终端命令执行（沙箱+白名单+端口检测）
│   │   ├── feishu.py                  #   飞书消息发送
│   │   ├── feishu_utils.py            #   飞书 API（消息/Reaction/编辑/文档）
│   │   ├── feishu_docs.py             #   云文档工具
│   │   ├── feishu_ws.py               #   WebSocket 长连接（断线重连+子进程管理）
│   │   └── message_normalizer.py      #   消息标准化（@_user_N 格式兼容）
│   │
│   ├── product-description/           # 产品需求文档（source of truth，只读）
│   │   ├── core-functionality.md      #   核心功能定义
│   │   ├── product-plan.md            #   产品方案
│   │   ├── tasks.md                   #   研发阶段规划
│   │   └── pc-desktop-web-architecture.md  # PC 桌面端+Web 端双平台架构
│   │
│   ├── memory/                        # 运行时记忆
│   │   ├── memory-{fe,be,pm}.md       #   对话 transcript（L0 工作记忆，JSON）
│   │   ├── notes-{fe,be,pm}.md        #   精选笔记（L1 持久记忆，Markdown）
│   │   └── daily/                     #   每日工作日志
│   │
│   ├── workspace/                     # Agent 代码产出（面试助手项目已迁出，当前为空）
│   │   └── shared/                    #   共享文件（STATUS.md + tasks/，运行时自动重建）
│   │
│   ├── tests/                         # 单元测试（70 个）
│   └── logs/                          # 失败任务日志
│
# （原 fe-app/ 独立前端应用已迁出：2026-09-04 面试助手三端迁至 F:\interview-assistant 独立仓库）
```

---

## 最近变更

| 提交 | 内容 |
|------|------|
| `24d3cd2` | **chore**: 面试助手项目迁出（→ `F:\interview-assistant` 独立仓库）+ agent 团队记忆清空重置，详见 [MIGRATION_PLAN.md](MIGRATION_PLAN.md) |
| `1ca30d5` | **fix**: FE/BE 写文件路径修正 + list_dir 防嵌套逻辑修复 |
| `40ad40e` | **perf**: Prompt Cache + 稳定结构 + Lazy Context + 异步 LLM 摘要 |
| `1aba424` | **feat**: WebSocket 断线重连（指数退避）+ 子进程异常重启 |
| `be8e863` | **docs**: PC 桌面端架构设计 — 锁定版本号 + 稳定开发环境指南 |
| `dc32c31` | **feat**: PDF→Word 互转增强 — pdf2docx + LLM 结构分析 |
| `29f82bf` | **feat**: 面试历史回溯 + 订阅管理 + 文件转换工具集 |
