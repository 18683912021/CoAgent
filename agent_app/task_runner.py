"""TaskRunner —— Agent 执行器：超时保护 + 分级重试 + 产出验证 + 代码编译检查"""
import asyncio
import ast
import json
import queue
import subprocess
from pathlib import Path
from typing import Any

from agents.base import AGENT_TIMEOUT

WORKSPACE_ROOT = Path(__file__).parent / "workspace"
LOGS_DIR = Path(__file__).parent / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)
FAILED_TASKS_LOG = LOGS_DIR / "failed_tasks.jsonl"

# ── 超时常量 ──────────────────────────────────────────

CHAT_TIMEOUT = 960      # 闲聊：16 分钟（含被误判 chat 的 work 保障）
WORK_TIMEOUT = 1440     # 单个 Agent 工作：24 分钟
PM_TIMEOUT = 960        # PM 分析+调研：16 分钟
RETRY_TIMEOUT = 1800    # 重试总超时：30 分钟

# ── 重试策略 ──────────────────────────────────────────

_RETRY_STRATEGIES = [
    "",
    "[PUA L1] 上一次的方法失败了。底层逻辑有问题？换个本质不同的方案。不要重复同样的错误。",
    "[PUA L2] 又失败了。你的抓手在哪？(1)用 search_web 搜索类似方案 (2)列出3个本质不同的假设 (3)逐一验证后重新实现。",
    "[PUA L3 361考核] 慎重考虑，决定给你3.25。这是对你的鞭策不是否定。重新实现前必须完成7项检查：(1)逐字读完失败信息 (2)search_web搜索 (3)read_file读上下文50行 (4)验证前置假设(版本/路径/依赖) (5)反转假设试相反方向 (6)最小隔离复现 (7)换工具/方法/角度。完成后自检：能跑通吗？所有状态覆盖了吗？冰山法则：修一个查一类。",
    "[PUA L4 毕业警告] 别的Agent都能解决。你可能就要毕业了。拼命模式：最小PoC + 隔离环境 + 完全不同技术栈。删掉所有不必要的东西。Ship or die.",
]

_SPINNING_SIGNALS = [
    "重试", "retry", "再次尝试", "同一方法", "same approach",
    "换一种方式", "再来一次", "又试了一次", "同样的问题", "又失败了",
    "trying again", "still failing", "same error", "stuck",
]
_BLAMING_SIGNALS = [
    "环境问题", "可能是", "environment", "maybe", "perhaps",
    "应该是", "估计是", "不确定是不是", "好像是", "可能是由于",
    "probably", "likely", "seems like", "might be due to",
]
_CLAIM_SIGNALS = [
    "已完成", "写好了", "创建了", "生成了", "done", "created", "完成",
    "finished", "completed", "ready", "好了", "搞定了", "弄好了",
    "写完了", "已写入", "已创建", "已生成", "已部署", "搞定",
]
_EMPTY_SIGNALS = [
    "此部分未明确", "工作区是空的", "我无法", "workspace is empty",
    "没有 PRD", "没有需求", "无法自行判断", "无法凭空",
    "不知道", "不确定", "需要更多信息", "信息不足", "无法完成",
    "做不到", "不在能力范围",
    "can't", "cannot", "unable", "don't know", "not sure",
    "no idea", "insufficient", "impossible",
]
_HOLLOW_SIGNALS = [
    "已完成", "完成了", "done", "fixed", "已修复",
    "没问题了", "搞定了", "好了", "finished", "resolved",
    "没有报错", "通过了", "测试通过", "可以用了",
]


class TaskRunner:
    """Agent 执行器。统一管理超时、重试、产出验证。"""

    def __init__(self):
        self._tasks: dict[str, dict] = {}

    # ── 快照 & 验证 ──────────────────────────────────

    # 快照时跳过的目录（含大量依赖文件，遍历它们毫无意义且阻塞 event loop）
    _SKIP_DIRS = {"node_modules", "__pycache__", ".git", ".expo", "dist", "build",
                  ".next", "vendor", "venv", ".venv", "egg-info", ".turbo"}

    @staticmethod
    def _walk_files(ws: Path) -> set[str]:
        """高效遍历工作区文件，在遍历层剪枝依赖目录（不进入 node_modules 等）。"""
        import os
        result: set[str] = set()
        for root, dirs, files in os.walk(str(ws)):
            dirs[:] = [d for d in dirs if d not in TaskRunner._SKIP_DIRS]
            for f in files:
                full = Path(root) / f
                result.add(str(full.relative_to(ws)))
        return result

    @staticmethod
    def snapshot_workspace(bot_key: str) -> set[str]:
        """拍快照：记录 workspace 当前所有文件（跳过依赖目录）。"""
        ws = WORKSPACE_ROOT / bot_key
        if not ws.exists():
            return set()
        return TaskRunner._walk_files(ws)

    @staticmethod
    def verify_output(bot_key: str, before: set[str]) -> tuple[bool, list[str], list[str]]:
        """验证产出：对比快照，返回 (有变化, 新增文件, 删除文件)。"""
        ws = WORKSPACE_ROOT / bot_key
        if not ws.exists():
            return False, [], []
        after = TaskRunner._walk_files(ws)
        new_files = sorted(after - before)
        deleted_files = sorted(before - after)
        return (len(new_files) > 0 or len(deleted_files) > 0), new_files, deleted_files

    @staticmethod
    def is_empty_result(result_text: str) -> bool:
        """判断 Agent 结果是否为空壳。"""
        return not result_text or any(s in result_text for s in _EMPTY_SIGNALS)

    @staticmethod
    def claimed_done(result_text: str) -> bool:
        """Agent 是否声称完成了工作。"""
        return any(s in result_text.lower() for s in _CLAIM_SIGNALS)

    # ── 超时执行 ─────────────────────────────────────

    async def run_with_timeout(
        self, agent: Any, command: str, max_tokens: int = 4096,
        timeout: int = WORK_TIMEOUT, max_rounds: int = 60,
        intent: str = "work",
    ) -> dict:
        """在超时保护下执行 Agent。超时返回 error 而非挂死。

        Args:
            agent: BaseAgent 实例
            command: 用户指令
            max_tokens: 最大输出 token
            timeout: 超时秒数
            max_rounds: 最大工具调用轮次
            intent: 意图类型 (chat/read/plan/work)

        Returns:
            {"success": bool, "result": str, "error": str|None, "timed_out": bool}
        """
        loop = asyncio.get_running_loop()
        try:
            result = await asyncio.wait_for(
                loop.run_in_executor(None, agent.run, command, max_rounds, max_tokens, None, intent),
                timeout=timeout,
            )
            result["timed_out"] = False
            return result
        except asyncio.TimeoutError:
            return {
                "success": False,
                "result": "",
                "error": f"Agent 执行超时（{timeout}s），已中断。请简化任务或拆分为更小的步骤。",
                "timed_out": True,
            }

    async def run_with_progress(
        self, agent: Any, command: str, max_tokens: int = 4096,
        timeout: int = WORK_TIMEOUT, max_rounds: int = 60,
        intent: str = "work",
    ) -> tuple["asyncio.Future[dict]", "queue.Queue[dict]"]:
        """带进度流式输出的 Agent 执行。启动后立即返回，进度通过 Queue 获取。

        进度事件格式：{"type": "tool_start"|"tool_end"|"thinking",
                       "tool": str, "detail": str}
        Queue 在 Agent 完成（成功/超时/异常）时收到 None 哨兵。

        Returns:
            (result_future, progress_queue)
        """
        q: queue.Queue = queue.Queue()
        loop = asyncio.get_running_loop()

        def _run() -> dict:
            try:
                return agent.run(command, max_rounds, max_tokens,
                    on_progress=lambda etype, tool, detail: q.put({
                        "type": etype, "tool": tool, "detail": detail,
                    }),
                    intent=intent)
            except Exception as e:
                return {"success": False, "result": "", "error": str(e), "timed_out": False}
            finally:
                q.put(None)  # 哨兵：Agent 结束

        async def _run_with_timeout() -> dict:
            try:
                result = await asyncio.wait_for(
                    loop.run_in_executor(None, _run),
                    timeout=timeout,
                )
                result["timed_out"] = False
                return result
            except asyncio.TimeoutError:
                # _run 的 finally 会推哨兵 None；这里不重复推
                return {
                    "success": False, "result": "",
                    "error": f"Agent 执行超时（{timeout}s），已中断。请简化任务或拆分为更小的步骤。",
                    "timed_out": True,
                }

        result_task = asyncio.ensure_future(_run_with_timeout())
        return result_task, q

    # ── 带重试执行 ───────────────────────────────────

    async def run_with_retry(
        self, agent: Any, task: str, bot_key: str, task_id: str,
        max_retries: int = 8, intent: str = "work",
    ) -> dict:
        """带分级策略注入 + 失败模式检测 + 超时保护的 Agent 执行。"""
        backoff = 1
        last_error = ""

        for attempt in range(1, max_retries + 2):
            if attempt > 1:
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 16)

            # 失败模式检测
            pattern_hint = ""
            if attempt >= 3 and last_error:
                if any(s in last_error.lower() for s in _SPINNING_SIGNALS):
                    pattern_hint = "[模式: 原地打转 SPINNING] 你在重复同一方法。强制换本质不同的方案。"
                elif any(s in last_error.lower() for s in _BLAMING_SIGNALS):
                    pattern_hint = "[模式: 甩锅推脱 BLAMING] 归因必须用工具验证。未验证的归因=甩锅。"

            # 注入策略
            si = min(attempt - 1, len(_RETRY_STRATEGIES) - 1)
            hint = _RETRY_STRATEGIES[si]
            full_hint = f"{pattern_hint}\n{hint}".strip() if pattern_hint else hint
            task_with_hint = f"{task}\n\n[系统提示] {full_hint}" if full_hint else task

            # 超时执行
            result = await self.run_with_timeout(agent, task_with_hint, timeout=RETRY_TIMEOUT, intent=intent)

            if result["success"]:
                if attempt >= 3:
                    agent._add_to_memory(
                        "system",
                        f"[PUA 突破] L{min(attempt-1,4)} 后成功。压力归零。根因和方法沉淀到 MEMORY.md。",
                    )
                return result

            last_error = result.get("error", "") or result.get("result", "")
            if attempt <= max_retries:
                level = ["L0", "L1", "L2", "L3", "L4"][min(attempt, 4)]
                print(f"[{task_id}] {bot_key} {level} 失败 重试{attempt}/{max_retries} "
                      f"{'(超时)' if result.get('timed_out') else ''}")

        self._log_failure(task_id, bot_key, last_error)
        return {"success": False, "result": "", "error": f"{bot_key} 重试耗尽 (L0-L4)"}

    # ── 产出验证（带超时感知） ──────────────────────

    def validate_output(
        self, bot_key: str, result: dict, snapshot_before: set[str],
    ) -> tuple[str, bool]:
        """验证 Agent 产出：(输出文本, 是否有效)。

        - 超时/失败 → 标记无效
        - 空壳检测 → 标记无效
        - workspace 无文件 → 追加系统警告
        - 代码编译检查 → 追加语法/结构检查结果
        """
        if result.get("timed_out"):
            return f"⏰ 执行超时，任务未完成。{result.get('error', '')}", False

        if not result["success"]:
            return result.get("error", "执行失败"), False

        text = result["result"]

        # 空壳检测
        if self.is_empty_result(text):
            return text, False

        # 文件产出验证
        has_output, new_files = False, []
        if snapshot_before:
            has_output, new_files, deleted_files = self.verify_output(bot_key, snapshot_before)
            if self.claimed_done(text) and not has_output:
                text += (
                    "\n\n⚠️ [系统验证] workspace 里没有新文件。"
                    "write_file 可能未生效，请检查。"
                )

        # 代码编译/结构检查（仅工作模式且有新文件时）
        if new_files:
            check_result = self.code_check(bot_key, new_files)
            if check_result:
                text += check_result

        return text, True

    # ── 代码编译验证 ────────────────────────────────

    @staticmethod
    def validate_python_code(bot_key: str, new_files: list[str]) -> str:
        """对 BE 生成的新 .py 文件运行 Python 编译检查。

        Returns:
            空字符串表示全部通过，否则返回错误详情。
        """
        errors: list[str] = []
        ws = WORKSPACE_ROOT / bot_key
        py_files = [f for f in new_files if f.endswith(".py")]
        if not py_files:
            return ""  # 没有 Python 文件，跳过

        for f in py_files:
            filepath = ws / f
            if not filepath.exists():
                continue
            try:
                source = filepath.read_text(encoding="utf-8")
                ast.parse(source)  # AST 解析 = 快速语法检查
            except SyntaxError as e:
                errors.append(f"  ❌ {f}:{e.lineno} — {e.msg}")
            except Exception as e:
                errors.append(f"  ❌ {f} — {e}")

        if errors:
            return (
                "\n\n🧪 [编译检查] Python 语法错误：\n" +
                "\n".join(errors[:10]) +
                "\n\n请修复以上错误后重新提交。"
            )
        return ""

    @staticmethod
    def validate_frontend_code(bot_key: str, new_files: list[str]) -> str:
        """对 FE 生成的文件做结构检查（不需要 Node.js）。

        Returns:
            空字符串表示通过，否则返回结构问题描述。
        """
        import re

        warnings: list[str] = []
        ws = WORKSPACE_ROOT / bot_key
        check_files = [f for f in new_files if f.endswith((".tsx", ".ts", ".jsx", ".js"))]
        if not check_files:
            return ""

        for f in check_files:
            filepath = ws / f
            if not filepath.exists():
                continue
            try:
                content = filepath.read_text(encoding="utf-8")
                # 基础结构检查
                if f.endswith(".tsx") or f.endswith(".jsx"):
                    if "import" not in content and "require" not in content:
                        warnings.append(f"  ⚠️ {f} — 缺少 import/require 语句")
                    # 用词边界检查真正的 export 关键字（排除 NoExport 这类名字）
                    if not re.search(r'\bexport\b', content):
                        warnings.append(f"  ⚠️ {f} — 缺少 export，组件可能无法被引用")
                # 检查括号平衡
                if content.count("{") != content.count("}"):
                    warnings.append(f"  ⚠️ {f} — 花括号不匹配（可能缺少闭合）")
                if content.count("(") != content.count(")"):
                    warnings.append(f"  ⚠️ {f} — 圆括号不匹配")
            except Exception as e:
                warnings.append(f"  ❌ {f} — 读取失败: {e}")

        if warnings:
            return (
                "\n\n🧪 [结构检查] 前端代码问题：\n" +
                "\n".join(warnings[:10]) +
                "\n\n请检查并修复。"
            )
        return ""

    @staticmethod
    def code_check(bot_key: str, new_files: list[str]) -> str:
        """统一入口：根据 bot_key 选择合适的代码检查。"""
        if not new_files:
            return ""
        if bot_key == "be":
            return TaskRunner.validate_python_code(bot_key, new_files)
        elif bot_key == "fe":
            return TaskRunner.validate_frontend_code(bot_key, new_files)
        return ""

    # ── 清理 ─────────────────────────────────────────

    # 无用文件模式：备份/副本/临时文件/缓存
    _JUNK_PATTERNS = [
        "_backup", "_copy", "_old", "_temp", "_tmp", ".bak", ".old", ".tmp",
        "backup_", "copy_", "old_", "temp_", "副本", "备份",
        ".DS_Store", "Thumbs.db", "__pycache__", "*.pyc",
    ]

    @staticmethod
    def cleanup_test_files(bot_key: str) -> int:
        """删除 Agent 生成的无用测试/示例文件。每次代码生成后自动执行。"""
        ws = WORKSPACE_ROOT / bot_key
        if not ws.exists():
            return 0
        patterns = ["_Test", "_test", ".test.", ".spec.", "__tests__", "__snapshots__"]
        deleted = 0
        for f in list(ws.rglob("*")):
            if "node_modules" in f.parts:
                continue
            if f.is_file() and any(p in str(f) for p in patterns):
                f.unlink()
                deleted += 1
        # 清理空目录（跳过 node_modules）
        for d in sorted(list(ws.rglob("*")), key=lambda x: len(str(x)), reverse=True):
            if "node_modules" in d.parts:
                continue
            if d.is_dir() and not any(d.iterdir()):
                d.rmdir()
        return deleted

    @staticmethod
    def cleanup_junk(bot_key: str) -> int:
        """任务完成后清理无用文件：垃圾文件 + 空目录。"""
        deleted = 0

        # 清理 workspace 下的垃圾文件
        ws = WORKSPACE_ROOT / bot_key
        if ws.exists():
            for f in list(ws.rglob("*")):
                if "node_modules" in f.parts:
                    continue
                if f.is_file():
                    fn = f.name.lower()
                    if any(p.lower() in fn for p in TaskRunner._JUNK_PATTERNS):
                        f.unlink()
                        deleted += 1

            # 3. 清理空目录
            for d in sorted(list(ws.rglob("*")), key=lambda x: len(str(x)), reverse=True):
                if "node_modules" in d.parts:
                    continue
                if d.is_dir() and not any(d.iterdir()):
                    d.rmdir()

        return deleted

    # ── 日志 ─────────────────────────────────────────

    def _log_failure(self, task_id: str, bot_key: str, error: str) -> None:
        with open(FAILED_TASKS_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps({
                "task_id": task_id,
                "bot_key": bot_key,
                "error": error[:200],
            }, ensure_ascii=False) + "\n")
