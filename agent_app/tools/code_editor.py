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
    "description": "在工作区内创建或覆盖文件。路径相对于工作区根目录（直接写项目名/文件名即可，如 rn-app-shell/package.json）。",
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

DELETE_FILE_TOOL_SPEC = {
    "name": "delete_file",
    "description": "删除工作区内的文件或空目录。用于清理临时文件、测试文件、不再需要的代码等。非空目录需要先清空里面的文件再删。",
    "input_schema": {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "相对于工作目录的文件或目录路径"},
        },
        "required": ["path"],
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


def _strip_workspace_prefix(workspace: str, rel_path: str) -> str:
    """剥离 Agent 误加的 workspace/{fe,be,pm,shared}/ 前缀。

    只有当 workspace base 自身就是 workspace/{name} 目录时才剥离——
    此时 rel_path 中的 workspace/{name}/ 前缀会导致双重嵌套。

    对于 PM（workspace = PROJECT_ROOT），workspace/shared/ 是合法路径，
    不会被误剥离。
    """
    ws = Path(workspace)
    parts = rel_path.replace("\\", "/").split("/")

    # 只有当 workspace base 本身就在 workspace/{name} 下时，才剥离前缀
    if len(parts) >= 2 and parts[0] == "workspace" and parts[1] in ("fe", "be", "pm", "shared"):
        if ws.name == parts[1] and ws.parent.name == "workspace":
            return "/".join(parts[2:])
    return rel_path


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

    return (base / rel_path).resolve()


def _resolve_writable(workspace: str, rel_path: str) -> Path:
    """解析写操作路径：剥离冗余 workspace 前缀 + 校验目标在 workspace 内。"""
    cleaned = _strip_workspace_prefix(workspace, rel_path)
    target = _resolve(workspace, cleaned)

    # 安全检查：写操作的目标路径必须在 workspace 目录内
    ws_path = Path(workspace).resolve()
    try:
        target.relative_to(ws_path)
    except ValueError:
        raise PermissionError(
            f"禁止写入 workspace 外的路径: {rel_path} → {target}\n"
            f"  workspace 根目录: {ws_path}\n"
            f"  请检查路径是否正确。提示：write_file 的 path 相对于工作区根目录，"
            f"不要加 workspace/fe/ 或 workspace/be/ 前缀。"
        )

    return target


def read_file(workspace: str, rel_path: str) -> str:
    """读取文件。当路径未命中时自动尝试常见前缀（workspace/、workspace/be/、workspace/fe/ 等）。

    背景：Agent 的 list_dir 和 read_file 使用了不同的根目录，导致 list_dir 列出
    "poc-audio-capture/" 但 read_file 需要完整的 "workspace/be/poc-audio-capture/"。
    自动回退消除了这个认知负担。
    """
    try:
        target = _resolve(workspace, rel_path)
        if not target.exists():
            # ── 自动回退：尝试常见前缀 ──
            fallback_prefixes = [
                "workspace",
                "workspace/be", "workspace/fe", "workspace/shared", "workspace/pm",
            ]
            found = None
            for prefix in fallback_prefixes:
                # 避免重复拼接（如果路径本身已包含该前缀）
                if rel_path.startswith(prefix + "/") or rel_path == prefix:
                    continue
                candidate = _resolve(workspace, f"{prefix}/{rel_path}")
                if candidate.exists():
                    found = candidate
                    break

            if found:
                target = found
            else:
                # 列出尝试过的路径帮助排查
                tried = [str(_resolve(workspace, rel_path))]
                tried += [str(_resolve(workspace, f"{p}/{rel_path}")) for p in fallback_prefixes[:3]]
                return f"[read_file] 文件不存在: {rel_path}\n  尝试过: {', '.join(tried[:4])}"
        content = target.read_text(encoding="utf-8")
        if len(content) > 25000:
            content = content[:25000] + f"\n...(截断，共 {len(content)} 字符)"
        return content
    except PermissionError as e:
        return f"[read_file] 权限错误: {e}"
    except Exception as e:
        return f"[read_file] 读取失败: {e}"


def write_file(workspace: str, rel_path: str, content: str) -> str:
    """写入文件"""
    try:
        target = _resolve_writable(workspace, rel_path)
        # 防止 Agent 误传空路径或目录路径
        if target.is_dir():
            return f"[write_file] 路径是目录不是文件: {rel_path} → 请指定具体文件名，如 '{rel_path}/tasks.md'"
        action = "覆盖" if target.exists() else "写入"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return f"[write_file] {action}成功: {rel_path} ({len(content)} 字符)"
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
        target = _resolve_writable(workspace, rel_path)
        if not target.exists():
            # ── 自动回退：尝试常见前缀（同 read_file）──
            fallback_prefixes = [
                "workspace",
                "workspace/be", "workspace/fe", "workspace/shared", "workspace/pm",
            ]
            found = None
            for prefix in fallback_prefixes:
                if rel_path.startswith(prefix + "/") or rel_path == prefix:
                    continue
                candidate = _resolve_writable(workspace, f"{prefix}/{rel_path}")
                if candidate.exists():
                    found = candidate
                    break
            if found:
                target = found
            else:
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


def delete_file(workspace: str, rel_path: str) -> str:
    """删除工作区内的文件或空目录。非空目录拒绝删除（安全保护）。
    当路径未命中时自动尝试常见前缀（与 read_file 一致）。"""
    try:
        target = _resolve_writable(workspace, rel_path)
        if not target.exists():
            # ── 自动回退：尝试常见前缀 ──
            fallback_prefixes = [
                "workspace",
                "workspace/be", "workspace/fe", "workspace/shared", "workspace/pm",
            ]
            found = None
            for prefix in fallback_prefixes:
                if rel_path.startswith(prefix + "/") or rel_path == prefix:
                    continue
                candidate = _resolve_writable(workspace, f"{prefix}/{rel_path}")
                if candidate.exists():
                    found = candidate
                    break
            if found:
                target = found
            else:
                return f"[delete_file] 不存在: {rel_path}"
        if target.is_dir():
            if any(target.iterdir()):
                items = list(target.iterdir())[:5]
                names = ", ".join(i.name for i in items)
                return f"[delete_file] 目录非空: {rel_path}（包含 {names} 等），需先清空后再删"
            target.rmdir()
            return f"[delete_file] 已删除空目录: {rel_path}"
        target.unlink()
        return f"[delete_file] 已删除: {rel_path}"
    except PermissionError as e:
        return f"[delete_file] 权限错误: {e}"
    except Exception as e:
        return f"[delete_file] 删除失败: {e}"


def list_dir(workspace: str, rel_path: str = ".") -> str:
    """列出目录。当路径未命中时自动尝试常见前缀。"""
    try:
        target = _resolve_writable(workspace, rel_path)
        if not target.exists():
            # ── 自动回退：尝试常见前缀（与 read_file 一致）──
            fallback_prefixes = [
                "workspace",
                "workspace/be", "workspace/fe", "workspace/shared", "workspace/pm",
            ]
            found = None
            for prefix in fallback_prefixes:
                if rel_path.startswith(prefix + "/") or rel_path == prefix:
                    continue
                candidate = _resolve_writable(workspace, f"{prefix}/{rel_path}")
                if candidate.exists():
                    found = candidate
                    break
            if found:
                target = found
            else:
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
