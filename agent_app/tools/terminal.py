"""终端命令执行工具 —— 带安全沙箱、超时、白名单"""

import subprocess
import os
from pathlib import Path

WORKSPACE_ROOT = Path(__file__).parent.parent / "workspace"

# 高危命令黑名单（禁止执行）
_BLOCKED_COMMANDS = [
    "rm -rf /", "mkfs", "dd if=", "shutdown", "reboot", "halt",
    "chmod 777 /", "> /dev/sda", "format", "del /f /s",
    ":(){ :|:& };:",  # fork bomb
]

# 白名单前缀（只允许在这些目录下执行）
_ALLOWED_PREFIXES = [
    "npm ", "npx ", "yarn ", "pnpm ",      # Node.js
    "pip ", "python ", "python3 ",          # Python
    "git ",                                  # Git
    "node ",                                 # Node runtime
    "expo ", "eas ",                         # Expo
    "tsc ", "npx tsc ",                      # TypeScript
    "eslint ", "prettier ",                  # Lint/Format
    "mkdir ", "touch ", "cp ", "mv ",        # 基础文件操作
    "ls ", "dir ", "tree ", "cat ",          # 查看
    "cd ", "pwd",                            # 目录导航
    "curl ", "wget ",                        # 网络请求
]

EXECUTE_TOOL_SPEC = {
    "name": "execute",
    "description": "在 Agent 的工作区内执行终端命令。用于安装依赖、运行测试、构建项目、初始化工程等。"
                   "支持的命令：npm/npx/pip/git/node/expo/tsc/mkdir/cp/mv/ls/cat/curl 等。"
                   "禁止 rm -rf、格式化、关机等高危操作。超时 600 秒（10 分钟），输出截断 3000 字。",
    "input_schema": {
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "要执行的命令"},
            "cwd": {
                "type": "string",
                "description": "工作目录（相对于工作区根目录）。例如 'fe/rn-app-shell' 表示在 workspace/fe/rn-app-shell 下执行",
            },
        },
        "required": ["command"],
    },
}


def execute(command: str, cwd: str = "") -> str:
    """执行终端命令，带安全检查和超时。

    Args:
        command: 要执行的命令
        cwd: 相对于 WORKSPACE_ROOT 的工作目录。例如 cwd="fe/rn-app-shell"

    Returns:
        命令的输出（stdout + stderr），截断到 3000 字。
    """
    # ── 安全检查 ──
    cmd_lower = command.lower().strip()

    # 黑名单检查
    for blocked in _BLOCKED_COMMANDS:
        if blocked.lower() in cmd_lower:
            return f"[execute] 拒绝执行——命令包含禁止操作: {blocked}"

    # 白名单检查（至少匹配一个前缀）
    allowed = False
    for prefix in _ALLOWED_PREFIXES:
        if cmd_lower.startswith(prefix) or cmd_lower == prefix.rstrip():
            allowed = True
            break
    if not allowed:
        return (
            f"[execute] 不支持的命令: {command[:60]}...\n"
            f"允许的命令前缀: {', '.join(_ALLOWED_PREFIXES[:10])} 等"
        )

    # ── 路径解析 ──
    work_dir = WORKSPACE_ROOT
    if cwd:
        target = (WORKSPACE_ROOT / cwd).resolve()
        # 防止逃逸
        if str(target).startswith(str(WORKSPACE_ROOT.resolve())):
            work_dir = target
        else:
            return f"[execute] 工作目录越界: {cwd}"

    work_dir.mkdir(parents=True, exist_ok=True)

    # ── 执行 ──
    try:
        result = subprocess.run(
            command,
            shell=True,
            cwd=str(work_dir),
            capture_output=True,
            text=True,
            timeout=600,
            env={
                **os.environ,
                "CI": "true",
                "HOME": str(work_dir),
            },
        )

        output = result.stdout.strip()
        if result.stderr.strip():
            if output:
                output += "\n"
            output += result.stderr.strip()

        if not output:
            output = f"(命令执行完毕，返回码: {result.returncode})"

        if len(output) > 3000:
            output = output[:3000] + f"\n\n...(输出截断，共 {len(output)} 字符)"

        return output

    except subprocess.TimeoutExpired:
        return f"[execute] 命令超时（600s）: {command[:80]}"
    except Exception as e:
        return f"[execute] 执行失败: {e}"
