# 面试助手项目迁移 + Agent 团队记忆重置 — 执行计划

> 状态：待确认。本文件是执行前的盘点与方案，确认后再动手。
> 目标：让面试助手（App / 桌面端 / 后端）脱离 CoAgent 工作区独立管理，agent 团队（小吴/小柯/酱瓜）退出现役，记忆清空回到初始状态。

---

## 一、要迁走什么（现状盘点）

| # | 项目 | 当前位置 | 内容 | 体积 | git 状态 |
|---|------|---------|------|------|---------|
| 1 | **App 端**（RN Android） | `fe-app/audio-capture/` | React Native 0.78.3 纯 CLI 工程；Kotlin 原生采集模块；`config.ts` 已有**未提交改动**（ACTIVE_HOST → `47.108.205.102`） | 745MB（含 android 构建产物 455MB） | 113 个文件已追踪，代码全部干净 |
| 2 | **桌面端**（Electron） | `agent_app/workspace/fe/audio-capture/` | Electron 43 + React 19 + Vite + Tailwind + WASAPI/Mac 原生 addon；含 `docs/`（Storybook 两篇） | 1.2GB（node_modules 627MB、release 556MB、构建产物） | 源码完全追踪，无未提交改动 |
| 3 | **后端**（FastAPI） | `agent_app/workspace/be/poc-audio-capture/` | FastAPI + SQLAlchemy async + Postgres/Redis + Docker 部署；6 路由 12 服务 6 语言题库 | 45MB（含 node_modules 外的 data/） | 完全追踪 |
| 4 | **产品/需求文档** | `agent_app/product-description/`（5 份） | core-functionality / product-plan / tasks / pc-desktop-web-architecture / pdf-to-word-high-fidelity | 3.2W 行 | 追踪中 |
| 5 | **面试备考资料** | `agent_app/workspace/fe/` 根下 3 份 | JD压题与参考答案.md/.html、桌面端面试追问.md（属桌面端资料） | 632KB | 追踪中 |
| 6 | **Android 环境文档** | `RN_ANDROID_STUDIO_SETUP.md` | App 端开发环境配置（随 App 走） | 24KB | 追踪中 |

**必须手动带的文件（不在 git 中）：**

- `agent_app/workspace/fe/audio-capture/.env` — 桌面端配置：`VITE_API_HOST=47.108.205.102`、`ANTHROPIC_MODEL`
- `agent_app/workspace/be/poc-audio-capture/.env` — DeepSeek/火山/SMTP/数据库密钥（**含真实 API Key，严禁进 git**）
- `agent_app/workspace/be/data/auth/tokens.json` — 唯一用户数据（测试账号 token，已进 git）

**不迁移（注意区分）：**

- 🔴 `fe-app/audio-capture/.env` — **内容是 agent 系统凭证的副本**（飞书三 Bot 凭证 + DeepSeek/Tavily/火山/SMTP），不是 App 自己的配置；App 项目不读 .env（无 dotenv 依赖，域名写死在 config.ts）。该文件**留在 CoAgent**，差异已存在于 `agent_app/.env`（SMTP_USER、TAVILY key 两处与 agent_app/.env 不完全一致，见附注），迁移完成后删除此副本。
- 🔴 构建产物：node_modules / release / dist-electron / dist-renderer / native/build / android .gradle、build、.cxx / .pytest_cache —— 全部不进新仓库，重装重建。
- 🔴 `agent_app/logs/`、`agent_app/memory/` —— 属 agent 系统运行时数据。

**好消息：三端源码对 CoAgent 无硬编码耦合。** 已全文检索：桌面端、后端、RN 的代码/脚本/配置里均无 `agent_app`/`workspace` 绝对路径引用（仅 RN `config.ts` 里一句注释文字）；桌面端启动脚本用的是相对路径；agent 调度系统对项目目录也无硬编码（路径常量是 `WORKSPACE_ROOT`，迁走后 workspace 变空仍能正常启动运行）。

---

## 二、目标布局（推荐）

```
F:\interview-assistant\            ← 与 CoAgent 平级的独立目录（本次唯一新对外目录）
├── README.md                      # 三端总览：环境要求 / 启动 / 部署 / 端口约定
├── docs/
│   ├── product-description/       # ← 迁自 agent_app/product-description/（5 份）
│   ├── JD压题与参考答案.md / .html  # ← 迁自 workspace/fe/
│   └── 桌面端面试追问.md
├── mobile/                        # ← 迁自 fe-app/audio-capture/（RN Android）
│   ├── src/ android/ scripts/ docs/（含 AUDIO_PROTOCOL_V1.md、MIGRATION_MATRIX.md）
│   └── RN_ANDROID_STUDIO_SETUP.md
├── desktop/                       # ← 迁自 workspace/fe/audio-capture/（Electron）
│   ├── electron/ src/ scripts/ docs/（Storybook 两篇） installer/ assets/
└── backend/                       # ← 迁自 workspace/be/poc-audio-capture/（FastAPI）
    ├── app/ tests/ Dockerfile / docker-compose.yml / requirements.txt
    └── data/auth/tokens.json
```

**版本管理（推荐）：** 新仓库独立 `git init`，首次提交只含源码+文档（密钥排除），构建产物不入库。旧 git 历史不迁移（文件历史仍完整保存在 CoAgent 仓库的提交记录里，随时可查）；若确实需要"新仓库带历史"，需 `git filter-repo --subdirectory-filter` 提取（混合了 agent 系统提交，工作量和复杂度高，不建议）。

---

## 三、执行步骤

### 阶段 0 — 前置备份
1. 先提交 CoAgent 仓库当前基线：提交未提交的 `fe-app/audio-capture/src/config.ts` 改动（ACTIVE_HOST 切服务器，保留）。
2. 新建 `F:\interview-assistant\`，目录骨架如上。

### 阶段 1 — 迁移文件（3 个步骤）
1. **源码覆盖复制**（只复制 git 追踪清单 + .env + tokens.json，构建产物不搬）：
   - `fe-app/audio-capture/*` → `mobile/`
   - `agent_app/workspace/fe/audio-capture/*` → `desktop/`（含 `.env`）
   - `agent_app/workspace/be/poc-audio-capture/*` → `backend/`（含 `.env`、`data/`）
   - `RN_ANDROID_STUDIO_SETUP.md` → `mobile/`
   - 文档类：product-description、JD压题、桌面端面试追问 → `docs/`
2. **CoAgent 仓库移除旧路径**：`git rm -r` 上述各路径（git 历史保留），新增新仓库 `git init` + 首次提交。
3. **收尾**：删除已无用的 `fe-app/audio-capture/.env` 副本（内容合并差异已在下面附注）；`agent_app/workspace/` 其余部分保持（fe/be 移空后仅剩 pm/、shared/，供系统继续运行）。

### 阶段 2 — 三端依赖重建 + 冒烟验证
| 端 | 重建命令 | 冒烟验证 |
|----|---------|---------|
| desktop | `pnpm install`（**必须重装**：pnpm 用 junction 链接，移动位置后 node_modules 失效）→ `pnpm exec tsc` | `pnpm dev` 窗口能起；smoke-addon 通过 |
| mobile | `npm ci` → `npm run typecheck` | Android Studio 打开 / `gradlew assembleDebug` 可选 |
| backend | `pip install -r requirements.txt`（LOCAL_DEV=true 免 Docker） | `pytest` 通过；`uvicorn app.main:app --port 8010` 可起 |

### 阶段 3 — Agent 团队记忆重置（清空回初始状态）
1. **删除运行时记忆**（均被 git 追踪，删除前先提交一次留基线，如需回滚随时从历史恢复）：
   - `agent_app/memory/memory-{pm,fe,be}.md`（L0 工作记忆）
   - `agent_app/memory/notes-{pm,fe,be}.md`（L1 持久笔记）
   - `agent_app/memory/daily/2026-07-22-*.md`（每日日志）
   - `agent_app/workspace/shared/STATUS.md` + `workspace/shared/tasks/*`（工作模式状态/任务文档）
2. 处理方式：**直接删除即可回到初始状态**。`agents/base.py` 的 `_load_memory` 对不存在的文件自动跳过（`if self.memory_file.exists()`），`_save_memory` / `write_notes` / `write_daily_log` 会自动重建（空 `{"messages":[],"facts":[]}` + 空笔记 + 当日新日志）。无需写模板。
3. 保留不动：`prompts/*/MEMORY.md`（人格模板，属系统定义不是记忆）、`agent_app/.env`（飞书凭证，重新上岗要用）、`prompts/`（工作流定义）。

### 阶段 4 — 文档收尾
1. 新仓库写 `README.md`：环境要求（Node 22.23.1 / pnpm / JDK17 / Gradle 8.12 / AGP 8.8 / SDK35 / NDK 27.1）、三端启动命令、端口约定（后端 8010：API+WS；agent 系统 8000 无关）、部署说明（Docker compose 推到 `47.108.205.102`）、`.env` 模板说明（提供 example，密钥不进库）。
2. 更新 CoAgent `README.md`：项目结构章节移除已迁目录，注明"面试助手项目已迁至 F:\interview-assistant"。
3. 可选：检索 `agent_app/prompts/`、`product-description` 中残留的面试助手专属描述，确认 agent 团队重新上岗时不带旧项目包袱（记忆已清，prompts 属系统定义，可留可改）。

---

## 四、需要拍板的决策点

| # | 决策 | 推荐 | 说明 |
|---|------|------|------|
| 1 | **新目录位置** | `F:\interview-assistant\`（与 CoAgent 平级） | 也可放 CoAgent 内部，但不"独立" |
| 2 | **是否独立 git 仓库** | 是，新仓库不含历史 | 旧历史留在 CoAgent 可查；带历史迁移复杂度高 |
| 3 | **构建产物去留** | 全部丢弃重装 | release/（556M 安装包）如想保留成品安装包可手动复制，不入库 |
| 4 | **产品/备考文档归属** | 全部跟随迁入新 `docs/` | 若想给 CoAgent 留全案档案可另存副本 |
| 5 | **be/data 用户数据** | `tokens.json` 随迁（1KB） | 测试账号 token，可随迁可删 |
| 6 | **fe-app/audio-capture/.env 副本** | 删除（配置并入 agent_app/.env） | 见附注差异 |

**附注（凭证差异提醒）：** `fe-app/audio-capture/.env` 与 `agent_app/.env` 有两处不一致：`SMTP_USER`（`ai-interview@qq.com` vs `1161547386@qq.com`）与 `TAVILY_API_KEY` 疑似不一致。agent 系统以 `agent_app/.env` 为准，迁移完成后建议人工核对哪个是当前有效邮箱后合并，删除副本。

---

## 五、风险与注意

1. **pnpm node_modules 是符号链接**：桌面端依赖必须在新位置重装，不能 copy。
2. **密钥红线**：`.env` 一律不进新仓库；新仓库 `.gitignore` 复制现约定（`node_modules/`、`.env`、`dist-*`、`release/`、`build/` 等），先写 .gitignore 再 `git add`。
3. **tokens.json 已在 CoAgent 仓库历史中**（测试数据，无真实用户 token），新仓库不带它的话可删除本地文件并让后端重建。
4. **服务器部署**：`47.108.205.102` 上的 docker-compose 部署地址需同步更新（后端已指定该 IP 为 VITE_API_HOST 默认值，迁出后不受影响）。
5. **迁移只动文件不动运行中的服务**：若服务器/本机还有跑着的 agent 进程或 uvicorn，先停再移（避免文件占用）。
6. **不要把 agent 系统的 `.env`（飞书凭证）带到新项目**；新项目后端 .env 是其自己的密钥集（DeepSeek/火山/SMTP/DB 四组）。
