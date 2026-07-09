"""代码自检工具 —— 写前验证 + 写后检查 + 跨文件分析"""

import ast
import re
from pathlib import Path

WORKSPACE_ROOT = Path(__file__).parent.parent / "workspace"

CHECK_TOOL_SPEC = {
    "name": "check_code",
    "description": (
        "全面检查代码文件。写代码前验证引用路径是否存在，写完后检查语法/安全/规范。"
        "支持 Python、TypeScript、JavaScript、JSX。"
        "检查项：语法错误、括号匹配、引用路径、硬编码密钥、SQL注入、eval使用、"
        "React key缺失、useEffect依赖、mutable默认参数、bare except、console残留等。"
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "要检查的文件路径（相对于工作区根目录 workspace/）"},
            "content": {"type": "string", "description": "要写入的内容（可选，不传则读磁盘已有文件）"},
            "project_dir": {"type": "string", "description": "项目目录（如 fe/rn-app-shell），用于跨文件引用检查"},
        },
        "required": ["path"],
    },
}


def check_code(path: str, content: str = "", project_dir: str = "") -> str:
    """检查代码文件，返回问题列表或"✅ 全部通过"。"""
    filepath = WORKSPACE_ROOT / path
    code = content if content else (filepath.read_text(encoding="utf-8") if filepath.exists() else "")
    if not code:
        return "⚠️ 文件为空或不存在"

    issues: list[str] = []
    ext = Path(path).suffix
    project_root = WORKSPACE_ROOT / project_dir if project_dir else filepath.parent

    # ═══════════════════════════════════════════
    # 第一层：语法与结构（所有语言）
    # ═══════════════════════════════════════════

    if ext == ".py":
        _check_python(code, issues)
    elif ext in (".ts", ".tsx", ".js", ".jsx"):
        _check_typescript(code, ext, issues)

    # ═══════════════════════════════════════════
    # 第二层：引用路径验证
    # ═══════════════════════════════════════════
    _check_refs(path, code, issues)

    # ═══════════════════════════════════════════
    # 第三层：跨文件分析
    # ═══════════════════════════════════════════
    if project_dir:
        _check_cross_file(path, code, project_root, issues)

    # ═══════════════════════════════════════════
    # 第四层：安全与规范（所有语言通用）
    # ═══════════════════════════════════════════
    _check_security(code, ext, issues)
    _check_quality(code, ext, issues)

    if not issues:
        return "✅ 全部通过"
    return "\n".join(issues)


# ═══════════════════════ Python ═══════════════════════

def _check_python(code: str, issues: list) -> None:
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        issues.append(f"❌ 语法错误 第{e.lineno}行: {e.msg}")
        return  # 语法错误后跳过后续检查

    # 收集所有定义
    defined_names = set()
    imported_names = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            defined_names.add(node.name)
            # mutable 默认参数
            for default in node.args.defaults:
                if isinstance(default, (ast.List, ast.Dict, ast.Set)):
                    issues.append(f"⚠️ 函数 '{node.name}' 使用可变默认参数（如 [] 或 {{}}），会导致状态污染")
            # 函数行数
            end = node.end_lineno or node.lineno
            length = end - node.lineno
            if length > 100:
                issues.append(f"💡 函数 '{node.name}' 过长（{length}行），建议拆分")
        elif isinstance(node, ast.ClassDef):
            defined_names.add(node.name)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                imported_names[alias.asname or alias.name] = alias.name
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                imported_names[alias.asname or alias.name] = alias.name

    # bare except
    for node in ast.walk(tree):
        if isinstance(node, ast.ExceptHandler) and node.type is None:
            issues.append(f"⚠️ 第{node.lineno}行: bare except（未指定异常类型），可能吞掉 KeyboardInterrupt")

    # 危险函数
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            func_name = _get_call_name(node)
            if func_name in ("eval", "exec"):
                issues.append(f"❌ 第{node.lineno}行: 使用了 {func_name}()，存在代码注入风险")
            elif func_name == "input" and "python2" not in code.lower():
                pass  # Python3 input 安全
            # SQL 注入
            if func_name in (".execute", ".executemany", ".raw"):
                for arg in node.args:
                    if isinstance(arg, ast.BinOp) or (isinstance(arg, ast.JoinedStr) and not _is_parameterized(arg)):
                        issues.append(f"❌ 第{node.lineno}行: SQL 查询可能使用字符串拼接，存在注入风险")


def _get_call_name(node: ast.Call) -> str:
    if isinstance(node.func, ast.Name):
        return node.func.id
    if isinstance(node.func, ast.Attribute):
        return f".{node.func.attr}"
    return ""


def _is_parameterized(node) -> bool:
    """简单判断 SQL 是否用了参数化查询。"""
    # 检查是否有 %s 或 ? 占位符配合 tuple 参数
    return False  # AST 级别精确判断太复杂，保守标记


# ═══════════════════════ TypeScript/JS ═══════════════════════

def _check_typescript(code: str, ext: str, issues: list) -> None:
    # 括号匹配
    if code.count("{") != code.count("}"):
        issues.append(f"❌ 花括号不匹配 ({{{code.count('{')}}} vs {{{code.count('}')}}})")
    if code.count("(") != code.count(")"):
        issues.append(f"❌ 圆括号不匹配 (({code.count('(')} vs ){code.count(')')})")
    if code.count("[") != code.count("]"):
        issues.append(f"❌ 方括号不匹配 ([{code.count('[')} vs ]{code.count(']')})")

    # React/JSX 专项
    if ext in (".tsx", ".jsx"):
        # map 没有 key
        if ".map(" in code and "key=" not in code and "key={" not in code:
            if re.search(r'\.map\s*\(\s*\(', code):  # 确认是 JSX map
                issues.append("⚠️ .map() 渲染列表缺少 key 属性，可能导致渲染错乱")

        # useEffect 缺依赖数组
        use_effects = re.findall(r'useEffect\s*\(\s*\(\)\s*=>\s*\{[^}]*\}\s*\)', code, re.DOTALL)
        if use_effects:
            issues.append(f"⚠️ {len(use_effects)} 处 useEffect 可能缺少依赖数组")

        # <img> 缺 alt
        imgs = re.findall(r'<img\s[^>]*/?>', code)
        for img in imgs:
            if 'alt=' not in img:
                issues.append("⚠️ <img> 缺少 alt 属性，不利于无障碍访问")
                break

    # console.log 残留
    if "console.log" in code or "console.debug" in code:
        count = code.count("console.log") + code.count("console.debug")
        issues.append(f"💡 {count} 处 console.log/debug（生产环境建议移除）")

    # 硬编码颜色值
    hex_colors = re.findall(r'#[0-9a-fA-F]{6}', code)
    if hex_colors and ext in (".tsx", ".jsx"):
        issues.append(f"💡 {len(hex_colors)} 处硬编码颜色值，建议使用 Design Token")

    # any 类型
    if ext == ".tsx" or ext == ".ts":
        any_count = len(re.findall(r'\bany\b', code))
        if any_count > 3:
            issues.append(f"⚠️ {any_count} 处使用了 any 类型，建议替换为具体类型")


# ═══════════════════════ 引用路径 ═══════════════════════

def _check_refs(file_path: str, code: str, issues: list) -> None:
    """检查代码中引用的相对路径是否指向存在的文件。"""
    file_dir = Path(file_path).parent

    patterns = [
        (r"from\s+['\"](\.[^'\"]+)['\"]", "py"),       # Python: from .xxx import
        (r"import\s+['\"](\.[^'\"]+)['\"]", "py"),      # Python: import .xxx
        (r"from\s+['\"](\.[^'\"]+)['\"]", "ts"),        # TS: from './xxx'
        (r"require\(['\"](\.[^'\"]+)['\"]\)", "js"),    # JS: require('./xxx')
    ]

    for pattern, lang in patterns:
        for match in re.finditer(pattern, code):
            ref = match.group(1)
            resolved = (WORKSPACE_ROOT / file_dir / ref).resolve()
            if not _path_exists(resolved, lang):
                issues.append(f"⚠️ 引用路径不存在: {ref} (在 {file_path} 中)")


def _path_exists(path: Path, lang: str) -> bool:
    if path.exists():
        return True
    extensions = {
        "py": [".py", "/__init__.py"],
        "ts": [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"],
        "js": [".js", ".jsx", ".ts", ".tsx", "/index.js", "/index.ts"],
    }
    for ext in extensions.get(lang, [".py", ".ts", ".tsx", ".js", ".jsx"]):
        if Path(str(path) + ext).exists():
            return True
    return False


# ═══════════════════════ 跨文件 ═══════════════════════

def _check_cross_file(file_path: str, code: str, project_root: Path, issues: list) -> None:
    """检查跨文件引用——A 从 B import 的东西 B 是否真的导出了。"""
    imported = re.findall(r"from\s+['\"](\.[^'\"]+)['\"]\s+import\s+(.+)", code)
    file_dir = Path(file_path).parent

    for ref_path, import_str in imported:
        resolved = (WORKSPACE_ROOT / file_dir / ref_path).resolve()
        # 找到实际的目标文件
        target = None
        for ext in ["", ".py", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/__init__.py"]:
            candidate = Path(str(resolved) + ("" if ref_path.endswith(ext.replace("/", "")) else ext))
            if candidate.exists():
                target = candidate
                break
        if not target:
            continue

        target_code = target.read_text(encoding="utf-8")
        wanted = [x.strip() for x in import_str.replace("{", "").replace("}", "").split(",")]

        for name in wanted:
            if not name:
                continue
            # 检查目标文件是否导出了这个名称
            export_patterns = [
                rf"\bexport\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+{re.escape(name)}\b",
                rf"\bexport\s*\{{\s*[^}}]*\b{re.escape(name)}\b",
                rf"\bexport\s+default\s+{re.escape(name)}\b",
                rf"\bdef\s+{re.escape(name)}\b",  # Python
                rf"\bclass\s+{re.escape(name)}\b",  # Python
            ]
            found = any(re.search(p, target_code) for p in export_patterns)
            if not found and name != "*":
                issues.append(f"⚠️ '{name}' 未在 {ref_path} 中找到对应导出")


# ═══════════════════════ 安全 ═══════════════════════

def _check_security(code: str, ext: str, issues: list) -> None:
    # 硬编码密钥
    secret_patterns = [
        (r'(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)\s*=\s*["\'][^\'"]+["\']', "密钥"),
        (r'(?:apiKey|secret|token|password|privateKey)\s*:\s*["\'][^\'"]+["\']', "密钥"),
    ]
    for pattern, label in secret_patterns:
        matches = re.findall(pattern, code, re.IGNORECASE)
        if matches:
            issues.append(f"❌ {len(matches)} 处硬编码{label}，请使用环境变量")
            break

    # eval / exec
    if re.search(r'\beval\s*\(', code):
        issues.append("❌ 使用了 eval()，存在代码注入风险")
    if re.search(r'\bexec\s*\(', code) and ext == ".py":
        issues.append("❌ 使用了 exec()，存在代码注入风险")

    # SQL 注入模式
    if re.search(r'(?:execute|cursor\.execute)\s*\(\s*["\']\s*SELECT|INSERT|UPDATE|DELETE', code, re.IGNORECASE):
        if re.search(r'f["\']', code) or "+" in code:
            issues.append("❌ SQL 查询可能使用字符串拼接，存在注入风险")

    # 内网地址泄露
    if re.search(r'https?://(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)', code):
        issues.append("⚠️ 代码中包含内网地址，可能泄露内部信息")


# ═══════════════════════ 代码质量 ═══════════════════════

def _check_quality(code: str, ext: str, issues: list) -> None:
    # TODO/FIXME
    todo_count = len(re.findall(r'\bTODO\b', code))
    fixme_count = len(re.findall(r'\bFIXME\b', code))
    total = todo_count + fixme_count
    if total > 5:
        issues.append(f"💡 {total} 处 TODO/FIXME（TODO={todo_count} FIXME={fixme_count}）")

    # 文件大小
    lines = code.count("\n") + 1
    if lines > 500:
        issues.append(f"💡 文件过长（{lines} 行），建议拆分为多个文件")

    # 空 catch / except
    if re.search(r'catch\s*\([^)]*\)\s*\{\s*\}', code):
        issues.append("⚠️ 空的 catch 块，异常被静默吞掉")
    if re.search(r'except\s*(?:Exception)?\s*:\s*\n\s*(?:pass|\.\.\.)\s*$', code, re.MULTILINE):
        issues.append("⚠️ 空的 except 块（pass/...），异常被静默吞掉")

    # 注释掉的代码
    commented_code = re.findall(r'^\s*#\s*(def |class |import |from )|^\s*//\s*(function|const |let |var |import |export )', code, re.MULTILINE)
    if len(commented_code) > 3:
        issues.append(f"💡 {len(commented_code)} 处被注释掉的代码，建议删除而非注释")

    # 重复 import
    if ext == ".py":
        imports = re.findall(r'^(?:import|from)\s+(\S+)', code, re.MULTILINE)
        dups = [x for x in imports if imports.count(x) > 1]
        if dups:
            issues.append(f"⚠️ 重复 import: {', '.join(set(dups))}")
