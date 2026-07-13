"""终端命令执行工具 —— 带安全沙箱、超时、白名单、环境预检、端口冲突检测
支持 Windows / macOS / Linux 三平台
"""

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

WORKSPACE_ROOT = Path(__file__).parent.parent / "workspace"

# ── 平台检测 ───────────────────────────────────────────
_IS_WINDOWS = sys.platform == "win32" or os.name == "nt"
_IS_MACOS = sys.platform == "darwin"
_IS_LINUX = sys.platform.startswith("linux")

# 高危命令黑名单（禁止执行，三平台全覆盖）
_BLOCKED_COMMANDS = [
    "rm -rf /", "rm -rf ~", "rm -rf .",          # Unix 毁灭操作
    "mkfs", "dd if=", "shutdown", "reboot", "halt",
    "chmod 777 /", "> /dev/sda", "format",
    "del /f /s", "rd /s /q C:",                   # Windows 毁灭操作
    ":(){ :|:& };:",                               # fork bomb
]

# 白名单前缀（三平台通用命令 + 各平台特有命令）
_ALLOWED_PREFIXES = [
    # Node.js 生态（跨平台）
    "npm ", "npx ", "yarn ", "pnpm ",
    # Python 生态（跨平台）
    "pip ", "pip3 ", "python ", "python3 ",
    # 版本控制（跨平台）
    "git ",
    # Node 运行时（跨平台）
    "node ",
    # Expo / React Native（跨平台）
    "expo ", "eas ",
    # Python 服务启动（跨平台）
    "uvicorn ", "gunicorn ", "flask ", "fastapi ",
    "python -m ", "python3 -m ",
    # TypeScript / Lint（跨平台）
    "tsc ", "npx tsc ", "eslint ", "prettier ",
    # 基础文件操作（跨平台）
    "mkdir ", "touch ", "cp ", "mv ", "rm ", "rmdir ",
    # 查看（跨平台）
    "ls ", "dir ", "tree ", "cat ",
    # 目录导航（跨平台）
    "cd ", "pwd",
    # 网络请求（跨平台）
    "curl ", "wget ",
    # Docker（跨平台）
    "docker ", "docker-compose ",
    # 网络诊断（跨平台）
    "netstat ", "ss ", "lsof ",
    # 环境检查
    "where ", "which ", "command ",
    # 进程管理
    "tasklist ", "taskkill ",      # Windows
    "ps ", "kill ", "killall ",    # Unix/macOS
    "pgrep ", "pkill ",            # Unix/macOS
    # macOS 特有
    "brew ", "xcodebuild ", "xcrun ",
    # 权限
    "chmod ", "chown ",
    # 文本处理
    "grep ", "find ", "head ", "tail ", "sort ", "wc ",
    "echo ", "printf ",
]

# ── 环境预检 ───────────────────────────────────────────

def _docker_install_hint() -> str:
    if _IS_MACOS:
        return "Docker 未安装。macOS 请安装 Docker Desktop：https://docs.docker.com/desktop/setup/mac-install/ 或 brew install --cask docker"
    if _IS_WINDOWS:
        return "Docker 未安装。Windows 请安装 Docker Desktop：https://docs.docker.com/desktop/setup/install/windows-install/"
    return "Docker 未安装。Linux 请参考：https://docs.docker.com/engine/install/"

# 常见二进制 → 安装提示（平台感知）
_MISSING_BINARY_HINTS = {
    "docker": _docker_install_hint,  # 函数，延迟求值
    "docker-compose": "docker-compose 未安装（Docker Desktop 自带，或 pip install docker-compose）",
    "expo": "Expo CLI 未安装。运行: npm install -g expo-cli",
    "eas": "EAS CLI 未安装。运行: npm install -g eas-cli",
    "npx": "npx 未找到。请确认 Node.js 已正确安装",
    "yarn": "yarn 未安装。运行: npm install -g yarn",
    "adb": "adb 未找到。请安装 Android SDK Platform-Tools",
    "brew": "Homebrew 未安装。macOS 请安装：https://brew.sh",
    "xcodebuild": "Xcode 命令行工具未安装。运行: xcode-select --install",
}

# 需要做启动前检测的命令模式 → (端口提取方式, 服务名)
_SERVER_START_PATTERNS = [
    (r"uvicorn\s+\S+\s+.*?(?:--port\s+(\d+)|:(\d+))?", "uvicorn"),
    (r"python\s+-m\s+uvicorn\s+\S+\s+.*?(?:--port\s+(\d+)|:(\d+))?", "uvicorn"),
    (r"python\s+\S*main\.py", "python server"),
    (r"npm\s+(?:run\s+)?(?:start|dev|serve)", "npm dev server"),
    (r"npx\s+expo\s+(?:start|run)", "expo"),
    (r"expo\s+(?:start|run)", "expo"),
    (r"node\s+\S+\.(?:js|mjs)", "node server"),
    (r"flask\s+run", "flask"),
    (r"gunicorn", "gunicorn"),
    (r"docker\s+(?:compose\s+)?up", "docker"),
]

# "可能重复"的命令模式 → 替换建议
_REDUNDANT_INSTALL_PATTERNS = [
    (r"pip\s+install\s+(\S+)", "pip"),
    (r"npm\s+install(?:\s+(\S+))?", "npm"),
    (r"yarn\s+add\s+(\S+)", "yarn"),
]


def _find_binary(cmd: str) -> str | None:
    """提取命令的第一个词（二进制名）。"""
    first_word = cmd.strip().split()[0] if cmd.strip() else ""
    # 处理 "python -m uvicorn" 这种情况
    if first_word == "python" and "-m" in cmd:
        parts = cmd.strip().split()
        try:
            idx = parts.index("-m")
            return parts[idx + 1] if idx + 1 < len(parts) else "python"
        except ValueError:
            return "python"
    return first_word


def _check_port_in_use(port: int) -> bool:
    """检查端口是否已被占用（Windows / macOS / Linux 兼容）。"""
    try:
        if _IS_WINDOWS:
            result = subprocess.run(
                f'netstat -ano | findstr ":{port} "',
                shell=True, capture_output=True, text=True, timeout=5,
            )
            return "LISTENING" in result.stdout
        elif _IS_MACOS:
            # macOS: lsof 查监听端口
            result = subprocess.run(
                f"lsof -nP -iTCP:{port} -sTCP:LISTEN 2>/dev/null",
                shell=True, capture_output=True, text=True, timeout=5,
            )
            return bool(result.stdout.strip())
        else:
            # Linux: ss 优先，netstat fallback
            result = subprocess.run(
                f"ss -tlnp 2>/dev/null | grep ':{port} ' || netstat -tlnp 2>/dev/null | grep ':{port} ' || lsof -nP -iTCP:{port} -sTCP:LISTEN 2>/dev/null",
                shell=True, capture_output=True, text=True, timeout=5,
            )
            return bool(result.stdout.strip())
    except Exception:
        return False


def _port_check_command(port: int) -> str:
    """返回适合当前平台的端口检查命令。"""
    if _IS_WINDOWS:
        return f'netstat -ano | findstr ":{port}"'
    elif _IS_MACOS:
        return f"lsof -nP -iTCP:{port} -sTCP:LISTEN"
    else:
        return f"ss -tlnp | grep ':{port} '"


def _kill_process_command(port: int) -> str:
    """返回适合当前平台的杀进程命令。"""
    if _IS_WINDOWS:
        return f'taskkill /PID <pid> /F'
    else:
        return f"kill $(lsof -t -i:{port})"


def _get_port_from_command(cmd: str) -> int | None:
    """从命令中提取端口号。"""
    # 匹配 --port NNNN
    m = re.search(r"--port\s+(\d+)", cmd)
    if m:
        return int(m.group(1))
    # 匹配 :NNNN (如 localhost:8000)
    m = re.search(r":(\d{4,5})\b", cmd)
    if m:
        return int(m.group(1))
    # 常见默认端口
    if "uvicorn" in cmd:
        return 8000
    if "flask" in cmd:
        return 5000
    if "expo" in cmd:
        return 8081
    if "npm" in cmd and ("start" in cmd or "dev" in cmd):
        return 3000
    return None


def _preflight_check(command: str, cwd: str = "") -> list[str]:
    """预检：返回警告/提示列表。空列表表示无问题。"""
    warnings: list[str] = []

    # ── 1. 二进制存在性检查 ──
    binary = _find_binary(command)
    if binary and binary in _MISSING_BINARY_HINTS:
        if shutil.which(binary) is None:
            hint = _MISSING_BINARY_HINTS[binary]
            if callable(hint):
                hint = hint()
            warnings.append(f"⚠️ **环境缺失**: {hint}")

    # ── 2. docker / docker-compose 检查 ──
    if command.strip().startswith("docker") or "docker" in command.split()[:2]:
        if shutil.which("docker") is None:
            warnings.append(
                "❌ **Docker 不可用**: 此电脑未安装 Docker。"
                "请勿尝试 docker 相关命令，改用直接启动方式（如 uvicorn / npm run dev）。"
            )

    # ── 3. 端口冲突检查（服务启动命令）──
    # 排除：pip list、grep、findstr 等查看命令中包含的服务名
    cmd_for_check = command.lower()
    is_lookup = any(kw in cmd_for_check for kw in ["pip list", "pip show", "grep ", "findstr ", "which ", "where "])
    if not is_lookup:
        for pattern, service_name in _SERVER_START_PATTERNS:
            if re.search(pattern, command):
                port = _get_port_from_command(command)
                if port and _check_port_in_use(port):
                    port_cmd = _port_check_command(port)
                    kill_cmd = _kill_process_command(port)
                    warnings.append(
                        f"⚠️ **端口 {port} 已被占用**（{service_name}）。"
                        f"检查已有进程: `{port_cmd}`，"
                        f"如果旧进程无用: `{kill_cmd}`。"
                        f"如果已有同服务在运行，直接复用，不要重启。"
                    )
                break

    # ── 4. 重复安装检查（pip install / npm install）──
    for pattern, tool in _REDUNDANT_INSTALL_PATTERNS:
        m = re.search(pattern, command)
        if m:
            pkg = m.group(1) if m.lastindex and m.group(1) else "所有依赖"
            warnings.append(
                f"💡 安装命令 `{tool} install` 执行前请确认 `{pkg}` 是否已安装。"
                f"如果已安装则无需重复执行，用 `{tool} list | grep` 验证。"
            )
            break

    # ── 5. 长时间运行的命令提示（后台服务）──
    if any(kw in command for kw in ["uvicorn", "runserver", "npm run dev", "expo start", "flask run"]):
        if _IS_MACOS:
            warnings.append(
                "⏳ 这是一个长时间运行的服务命令，会阻塞直到手动停止。"
                "请确认是否需要后台运行，或先检查服务是否已启动。"
            )
        else:
            warnings.append(
                "⏳ 这是一个长时间运行的服务命令，会阻塞直到手动停止。"
                "请确认是否需要后台运行，或先检查服务是否已启动。"
            )

    return warnings

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

    # ── 服务启动拦截（红线，在工具层直接拒绝）──
    _SERVER_BLOCK_KEYWORDS = [
        "uvicorn", "gunicorn", "flask run", "fastapi run",
        "npm run dev", "npm start", "npm run start",
        "expo start", "expo run", "npx expo start",
        "yarn dev", "yarn start", "pnpm dev", "pnpm start",
        "docker compose up", "docker-compose up", "docker run",
        "python -m http.server", "python3 -m http.server",
        "npx serve", "npx http-server",
    ]
    for kw in _SERVER_BLOCK_KEYWORDS:
        if kw in cmd_lower:
            return (
                f"[execute] 🚫 **禁止执行服务启动命令**\n"
                f"  命令: {command[:120]}\n"
                f"  原因: Agent 不允许自行启动服务。服务启停由操作人（boss）执行。\n"
                f"  你应该: ① 检查环境是否就绪 ② 确认端口是否空闲 ③ 把启动命令告诉 boss，让 boss 来操作。"
            )

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

    # ── 环境预检 ──
    preflight_warnings = _preflight_check(command, cwd)
    preflight_prefix = ""
    if preflight_warnings:
        preflight_prefix = "━━━ ⚠️ 环境预检 ━━━\n" + "\n".join(preflight_warnings) + "\n━━━━━━━━━━━━━━━━\n\n"

    # ── 执行 ──
    try:
        result = subprocess.run(
            command,
            shell=True,
            cwd=str(work_dir),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=600,
            env={
                **os.environ,
                "CI": "true",
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

        return preflight_prefix + output

    except subprocess.TimeoutExpired:
        return preflight_prefix + f"[execute] 命令超时（600s）: {command[:80]}"
    except Exception as e:
        return preflight_prefix + f"[execute] 执行失败: {e}"
