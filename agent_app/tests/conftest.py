"""pytest 共享 fixtures"""
import json
import sys
import tempfile
from pathlib import Path

import pytest

# 确保项目路径在 sys.path 中
sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.fixture
def temp_workspace():
    """创建临时 workspace 用于测试。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        ws = Path(tmpdir)
        (ws / "fe").mkdir(exist_ok=True)
        (ws / "be").mkdir(exist_ok=True)
        yield ws


@pytest.fixture
def sample_prd():
    """一份典型 PRD 文本。"""
    return """# 项目概述
一个简单的 Todo 应用，支持添加和删除任务。

## 功能需求
- 用户可以看到任务列表
- 用户可以添加新任务
- 用户可以删除任务

## 前端任务
- 任务列表组件
- 添加任务输入框
- 删除按钮

## 后端任务
- GET /api/todos 获取列表
- POST /api/todos 创建任务
- DELETE /api/todos/{id} 删除任务

## API 接口契约
- GET /api/todos → {items: [{id, title, completed}]}
- POST /api/todos ← {title: str} → {item: {id, title, completed}}
- DELETE /api/todos/{id} → {success: bool}
"""


@pytest.fixture
def sample_memory():
    """模拟的记忆数据。"""
    return [
        {"role": "user", "content": "你好"},
        {"role": "assistant", "content": "在的～"},
        {"role": "user", "content": "帮我做个登录页"},
        {"role": "assistant", "content": [{"type": "tool_use", "id": "x", "name": "write_file", "input": {}}]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "x", "content": "写入成功"}]},
        {"role": "assistant", "content": "已完成登录页面。"},
    ]


@pytest.fixture
def empty_workspace_snapshot():
    """空 workspace 快照。"""
    return set()
