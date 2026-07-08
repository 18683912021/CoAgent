"""代码文件读写工具——在隔离工作区内操作"""
import os
import time
import shutil
from pathlib import Path

# 工作区根目录
WORKSPACE_ROOT = Path(__file__).parent.parent / "workspace"

# 自动备份目录（对标 Claude Code 的 ~/.claude/file-history/）
BACKUP_DIR = Path(__file__).parent.parent / ".backup"
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

EDIT_FILE_TOOL_SPEC = {
    "name": "edit_file",
    "description": (
        "精确编辑文件：查找 old_string 并替换为 new_string。"
        "只改目标片段，不动文件其他部分。"
        "要求 old_string 必须在文件中精确匹配且唯一——匹配不到或匹配到多处都会报错。"
        "适合修 bug、改一行配置、调整函数签名等小范围修改。"
        "如果要改的地方超过文件 50% 或跨多个不连续区域，请用 write_file 重写整个文件。"
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "相对于工作目录的文件路径"},
            "old_string": {"type": "string", "description": "文件中需要被替换的原始文本（必须精确匹配，包括缩进和空格）"},
            "new_string": {"type": "string", "description": "替换后的新文本"},
        },
        "required": ["path", "old_string", "new_string"],
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
    """解析路径。绝对路径直接使用，相对路径基于 workspace 解析。"""
    p = Path(rel_path)
    if p.is_absolute():
        return p.resolve()

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

    return (base / rel_path).resolve()


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
        # 防止 Agent 误传空路径或目录路径
        if target.is_dir():
            return f"[write_file] 路径是目录不是文件: {rel_path} → 请指定具体文件名，如 '{rel_path}/tasks.md'"
        # 如果覆盖已有文件，先备份
        overwrite_warning = ""
        if target.exists():
            BACKUP_DIR.mkdir(parents=True, exist_ok=True)
            backup_path = BACKUP_DIR / target.name
            # 加时间戳防重名覆盖
            if backup_path.exists():
                backup_path = BACKUP_DIR / f"{target.stem}_{int(time.time())}{target.suffix}"
            shutil.copy2(target, backup_path)
            overwrite_warning = f" [已备份旧版本到 {backup_path}]"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        action = "覆盖" if overwrite_warning else "写入"
        return f"[write_file] {action}成功: {rel_path} ({len(content)} 字符){overwrite_warning}"
    except PermissionError as e:
        return f"[write_file] 权限错误: {e}"
    except Exception as e:
        return f"[write_file] 写入失败: {e}"


def edit_file(workspace: str, rel_path: str, old_string: str, new_string: str) -> str:
    """精确编辑文件：查找并替换指定文本片段。

    防幻觉设计（对标 Claude Code Edit 工具）：
    - old_string 必须在文件中存在 → 不存在报错
    - old_string 必须唯一 → 匹配到多处报错（防止意外批量替换）
    - 新旧必须不同 → 相同报错
    """
    try:
        target = _resolve(workspace, rel_path)
        if not target.exists():
            return f"[edit_file] 文件不存在: {rel_path}"
        if target.is_dir():
            return f"[edit_file] 路径是目录不是文件: {rel_path}"

        content = target.read_text(encoding="utf-8")

        # 检查 old_string 是否存在
        count = content.count(old_string)
        if count == 0:
            # 尝试给出有用的提示：显示文件中与 old_string 最相似的片段
            lines = content.split("\n")
            hint = ""
            for i, line in enumerate(lines):
                if any(w in line for w in old_string.split() if len(w) > 3):
                    hint = f" 提示：第 {i+1} 行包含相似内容 → {line.strip()[:80]}"
                    break
            return (
                f"[edit_file] 未找到匹配文本。old_string 在文件中不存在。\n"
                f"  文件: {rel_path}\n"
                f"  请用 read_file 重新读取文件内容，确保 old_string 逐字符精确匹配（包括缩进和空格）。\n"
                f"{hint}"
            )
        if count > 1:
            return (
                f"[edit_file] old_string 匹配到 {count} 处，不唯一，拒绝替换。\n"
                f"  文件: {rel_path}\n"
                f"  请缩小 old_string 范围，加入更多上下文使其唯一。"
            )

        if old_string == new_string:
            return f"[edit_file] old_string 和 new_string 完全相同，无需替换: {rel_path}"

        # 替换前备份
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        backup_path = BACKUP_DIR / f"{target.stem}_{int(time.time())}{target.suffix}"
        shutil.copy2(target, backup_path)

        # 执行替换
        new_content = content.replace(old_string, new_string, 1)
        target.write_text(new_content, encoding="utf-8")

        # 生成简洁的 diff 提示
        old_preview = old_string[:60].replace("\n", "\\n")
        new_preview = new_string[:60].replace("\n", "\\n")
        if len(old_string) > 60:
            old_preview += "..."
        if len(new_string) > 60:
            new_preview += "..."

        return (
            f"[edit_file] 替换成功: {rel_path}\n"
            f"  -{old_preview}\n"
            f"  +{new_preview}"
        )
    except PermissionError as e:
        return f"[edit_file] 权限错误: {e}"
    except Exception as e:
        return f"[edit_file] 编辑失败: {e}"


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
