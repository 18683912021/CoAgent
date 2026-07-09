"""TaskRunner 单元测试"""
import pytest
from pathlib import Path
from task_runner import TaskRunner


class TestStaticMethods:
    """纯函数测试——不需要任何外部依赖。"""

    def test_claimed_done_true(self):
        assert TaskRunner.claimed_done("已完成登录页面，包含3个文件") is True
        assert TaskRunner.claimed_done("写好了API接口，done") is True
        assert TaskRunner.claimed_done("created auth.py and models.py") is True

    def test_claimed_done_false(self):
        assert TaskRunner.claimed_done("还需要确认一下接口格式") is False
        assert TaskRunner.claimed_done("这个部分暂时不明确") is False
        assert TaskRunner.claimed_done("") is False

    def test_is_empty_result_true(self):
        assert TaskRunner.is_empty_result("此部分未明确，请基于项目概述自行判断") is True
        assert TaskRunner.is_empty_result("工作区是空的") is True
        assert TaskRunner.is_empty_result("我无法完成这个任务") is True
        assert TaskRunner.is_empty_result("") is True

    def test_is_empty_result_false(self):
        assert TaskRunner.is_empty_result("已生成3个文件：auth.py, models.py, main.py") is False
        assert TaskRunner.is_empty_result("前端组件已完成，包含 Login.tsx") is False

    def test_snapshot_workspace_exists(self):
        """快照方法可以正常执行（不抛异常）。"""
        snap = TaskRunner.snapshot_workspace("fe")
        assert isinstance(snap, set)

    def test_verify_output_consistent(self):
        """同一快照前后对比应无变化。"""
        snap = TaskRunner.snapshot_workspace("fe")
        has_new, files, _ = TaskRunner.verify_output("fe", snap)
        assert has_new is False
        assert files == []


class TestCodeValidation:
    """代码编译检查测试——直接操作实际 workspace 目录。"""

    WS = Path(__file__).parent.parent / "workspace"

    @pytest.fixture(autouse=True)
    def setup(self):
        (self.WS / "be").mkdir(parents=True, exist_ok=True)
        (self.WS / "fe").mkdir(parents=True, exist_ok=True)

    def test_python_valid(self):
        (self.WS / "be" / "_test_valid.py").write_text("def foo():\n    return 42\n", encoding="utf-8")
        result = TaskRunner.validate_python_code("be", ["_test_valid.py"])
        assert result == ""

    def test_python_syntax_error(self):
        (self.WS / "be" / "_test_broken.py").write_text("def foo():\nreturn 42\n", encoding="utf-8")
        result = TaskRunner.validate_python_code("be", ["_test_broken.py"])
        assert result != ""  # 有错误就返回非空
        assert "_test_broken.py" in result

    def test_python_no_py_files(self):
        result = TaskRunner.validate_python_code("be", ["models.ts", "data.json"])
        assert result == ""

    def test_frontend_valid(self):
        (self.WS / "fe" / "_TestApp.tsx").write_text(
            "import React from 'react';\n"
            "export default function App() {\n"
            "  return <div>Hello</div>;\n"
            "}\n", encoding="utf-8")
        result = TaskRunner.validate_frontend_code("fe", ["_TestApp.tsx"])
        assert result == ""

    def test_frontend_missing_export(self):
        (self.WS / "fe" / "_TestNoExport.tsx").write_text(
            "import React from 'react';\n"
            "function helper() { return null; }\n", encoding="utf-8")
        result = TaskRunner.validate_frontend_code("fe", ["_TestNoExport.tsx"])
        assert result != ""  # 有问题就返回非空

    def test_frontend_bracket_mismatch(self):
        (self.WS / "fe" / "_TestBad.tsx").write_text(
            "export function Bad() {\n"
            "  return (<div>\n"
            "}\n", encoding="utf-8")
        result = TaskRunner.validate_frontend_code("fe", ["_TestBad.tsx"])
        assert result != ""

    def test_code_check_be(self):
        result = TaskRunner.code_check("be", [])
        assert result == ""

    def test_code_check_fe(self):
        result = TaskRunner.code_check("fe", [])
        assert result == ""


class TestValidateOutput:
    """产出验证集成测试。"""

    def test_validate_timeout(self):
        runner = TaskRunner()
        result = {"success": False, "result": "", "error": "timeout", "timed_out": True}
        text, valid = runner.validate_output("fe", result, set())
        assert valid is False
        assert "超时" in text

    def test_validate_empty_result(self):
        runner = TaskRunner()
        result = {"success": True, "result": "此部分未明确", "timed_out": False}
        text, valid = runner.validate_output("fe", result, set())
        assert valid is False

    def test_validate_success_no_snapshot(self):
        runner = TaskRunner()
        result = {"success": True, "result": "代码已生成", "timed_out": False}
        text, valid = runner.validate_output("fe", result, set())
        assert valid is True
