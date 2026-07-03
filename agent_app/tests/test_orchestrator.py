"""Orchestrator 纯函数单元测试"""
import pytest

# 在不初始化 LLM 的情况下导入 Orchestrator 的测试函数
from orchestrator import Orchestrator


@pytest.fixture
def orch():
    """创建 Orchestrator 实例用于测试纯函数。"""
    # 注意：__init__ 会创建 Agent 实例（需要 API key），
    # 但纯函数测试不需要 LLM 调用
    try:
        o = Orchestrator()
    except Exception:
        pytest.skip("需要 API key 才能初始化 Orchestrator")
    return o


class TestIntentClassification:
    """意图预分类测试。"""

    @pytest.fixture
    def orch_light(self):
        """轻量 Orchestrator——只测 _classify_intent 不创建 Agent。"""
        o = Orchestrator.__new__(Orchestrator)
        return o

    def test_chat_greeting(self, orch_light):
        assert orch_light._classify_intent("你好") == "chat"
        assert orch_light._classify_intent("在吗") == "chat"

    def test_chat_short(self, orch_light):
        """少于 6 字的消息默认闲聊。"""
        assert orch_light._classify_intent("嗨") == "chat"
        assert orch_light._classify_intent("嗯") == "chat"

    def test_work_develop(self, orch_light):
        assert orch_light._classify_intent("帮我做一个登录页面") == "work"
        assert orch_light._classify_intent("写个用户注册接口") == "work"

    def test_work_design(self, orch_light):
        assert orch_light._classify_intent("设计一个订单系统") == "work"
        assert orch_light._classify_intent("重构用户模块") == "work"

    def test_work_fix(self, orch_light):
        assert orch_light._classify_intent("改一下按钮颜色") == "work"
        assert orch_light._classify_intent("修复登录页bug") == "work"

    def test_work_create(self, orch_light):
        assert orch_light._classify_intent("create a todo app") == "work"
        assert orch_light._classify_intent("build user auth") == "work"


class TestHandoffDetection:
    """跨 Agent 委派检测测试。"""

    @pytest.fixture
    def orch_light(self):
        o = Orchestrator.__new__(Orchestrator)
        return o

    def test_fe_to_be(self, orch_light):
        text = "登录页写好了。@酱瓜 需要加个 /api/avatar 接口返回用户头像"
        handoffs = orch_light._detect_handoff(text, "fe")
        assert len(handoffs) == 1
        assert handoffs[0]["target"] == "be"
        assert "avatar" in handoffs[0]["command"]

    def test_be_to_fe(self, orch_light):
        text = "接口改好了 @小柯 你那边适配一下响应格式"
        handoffs = orch_light._detect_handoff(text, "be")
        assert len(handoffs) == 1
        assert handoffs[0]["target"] == "fe"

    def test_fe_to_pm(self, orch_light):
        text = "@小吴 PRD 里没写删除任务的确认弹窗，补充一下"
        handoffs = orch_light._detect_handoff(text, "fe")
        assert len(handoffs) == 1
        assert handoffs[0]["target"] == "pm"

    def test_no_self_handoff(self, orch_light):
        """不能委派给自己。"""
        text = "@小柯 你看看这个组件"  # FE 提到自己
        handoffs = orch_light._detect_handoff(text, "fe")
        assert len(handoffs) == 0

    def test_casual_mention_no_action(self, orch_light):
        """只有 @名字 但没有行动词 → 不是委派。"""
        text = "这个方案小柯和酱瓜都觉得可以"  # 没有 @ 符号
        handoffs = orch_light._detect_handoff(text, "pm")
        assert len(handoffs) == 0

    def test_at_without_action(self, orch_light):
        """有 @名字 但只是打招呼 → 不是委派。"""
        text = "我在呢 @小吴 早上好"
        handoffs = orch_light._detect_handoff(text, "fe")
        assert len(handoffs) == 0  # "早上好" 不在行动词列表中

    def test_multiple_handoffs(self, orch_light):
        text = "代码写好了。@酱瓜 加个接口 @小吴 更新一下PRD"
        handoffs = orch_light._detect_handoff(text, "fe")
        assert len(handoffs) == 2
        targets = {h["target"] for h in handoffs}
        assert targets == {"be", "pm"}


class TestSocialContext:
    """群呼上下文构建测试。"""

    @pytest.fixture
    def orch_light(self):
        o = Orchestrator.__new__(Orchestrator)
        return o

    def test_no_others(self, orch_light):
        result = orch_light._build_social_context("你好", [])
        assert result == "你好"  # 无群呼，原文返回

    def test_with_others(self, orch_light):
        result = orch_light._build_social_context("早上好", ["小柯", "酱瓜"])
        assert "群呼上下文" in result
        assert "小柯" in result
        assert "酱瓜" in result
        assert "只代表你自己" in result
        assert "早上好" in result


class TestSectionExtraction:
    """PRD 段落提取测试。"""

    @pytest.fixture
    def orch_light(self):
        o = Orchestrator.__new__(Orchestrator)
        return o

    def test_extract_api_section(self, orch_light, sample_prd):
        result = orch_light._extract_section(sample_prd, ["API", "接口契约"])
        assert "GET /api/todos" in result
        assert "POST /api/todos" in result

    def test_extract_frontend_section(self, orch_light, sample_prd):
        result = orch_light._extract_section(sample_prd, ["前端任务", "前端"])
        assert "任务列表组件" in result
        assert "添加任务输入框" in result

    def test_extract_missing_section(self, orch_light, sample_prd):
        result = orch_light._extract_section(sample_prd, ["部署方案"])
        assert "此部分未明确" in result

    def test_filter_and_split(self, orch_light, sample_prd):
        fe_task, be_task = orch_light._filter_and_split(sample_prd)
        assert "开工前必读" in fe_task
        assert "前端任务" in fe_task
        assert "后端任务" in be_task
        assert "API 接口契约" in be_task
