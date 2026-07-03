"""代码文件读写工具——在隔离工作区内操作"""
import os
from pathlib import Path

# 工作区根目录
WORKSPACE_ROOT = Path(__file__).parent.parent / "workspace"

READ_FILE_TOOL_SPEC = {
    "name": "read_file",
    "description": "读取工作区内的文件内容",
    "input_schema": {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "相对于工作目录的文件路径"},
        },
        "required": ["path"],
    },
}

WRITE_FILE_TOOL_SPEC = {
    "name": "write_file",
    "description": "在工作区内创建或覆盖文件。路径相对于工作区根目录，直接写项目名即可（如 rn-app-shell/package.json），不要加 workspace/fe/ 前缀。",
    "input_schema": {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "相对于工作目录的文件路径"},
            "content": {"type": "string", "description": "文件内容"},
        },
        "required": ["path", "content"],
    },
}

LIST_DIR_TOOL_SPEC = {
    "name": "list_dir",
    "description": "列出工作目录下的文件",
    "input_schema": {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "相对于工作目录的路径，默认根目录"},
        },
        "required": [],
    },
}


def _resolve(workspace: str, rel_path: str) -> Path:
    """解析路径并验证在工作区内。workspace 可以是相对名(fe/be)或绝对路径。"""
    ws = Path(workspace)
    if ws.is_absolute():
        base = ws
    else:
        base = (WORKSPACE_ROOT / ws).resolve()

    # ── 防嵌套：如果 Agent 误写了 workspace/fe/xxx，自动去掉冗余前缀 ──
    workspace_name = ws.name if not ws.is_absolute() else ws.parts[-1]
    redundant = f"workspace/{workspace_name}/"
    while redundant in rel_path:
        idx = rel_path.index(redundant)
        rel_path = rel_path[:idx] + rel_path[idx + len(redundant):]

    target = (base / rel_path).resolve()

    # 安全检查：确保路径不逃逸工作区
    if not str(target).startswith(str(base)):
        raise PermissionError(f"禁止访问工作区外的路径: {rel_path}")

    return target


def read_file(workspace: str, rel_path: str) -> str:
    """读取文件"""
    try:
        target = _resolve(workspace, rel_path)
        if not target.exists():
            return f"[read_file] 文件不存在: {rel_path}"
        content = target.read_text(encoding="utf-8")
        if len(content) > 5000:
            content = content[:5000] + f"\n...(截断，共 {len(content)} 字符)"
        return content
    except PermissionError as e:
        return f"[read_file] 权限错误: {e}"
    except Exception as e:
        return f"[read_file] 读取失败: {e}"


def write_file(workspace: str, rel_path: str, content: str) -> str:
    """写入文件"""
    try:
        target = _resolve(workspace, rel_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return f"[write_file] 写入成功: {rel_path} ({len(content)} 字符)"
    except PermissionError as e:
        return f"[write_file] 权限错误: {e}"
    except Exception as e:
        return f"[write_file] 写入失败: {e}"


def list_dir(workspace: str, rel_path: str = ".") -> str:
    """列出目录"""
    try:
        target = _resolve(workspace, rel_path)
        if not target.exists():
            return f"[list_dir] 目录不存在: {rel_path}"
        if not target.is_dir():
            return f"[list_dir] 不是目录: {rel_path}"

        items = []
        for child in sorted(target.iterdir()):
            suffix = "/" if child.is_dir() else ""
            items.append(f"  {child.name}{suffix}")

        return f"目录 {rel_path or '/'} ({len(items)} 项):\n" + "\n".join(items)
    except PermissionError as e:
        return f"[list_dir] 权限错误: {e}"
    except Exception as e:
        return f"[list_dir] 失败: {e}"
