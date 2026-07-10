"""BaseAgent 纯函数测试"""
import json
import tempfile
from pathlib import Path

import pytest

from agents.base import BaseAgent


class DummyAgent(BaseAgent):
    """无 LLM 调用的测试 Agent。"""

    def __init__(self, memory_path: str, clean: bool = False):
        if clean:
            Path(memory_path).parent.mkdir(parents=True, exist_ok=True)
            Path(memory_path).write_text('{"messages":[],"facts":[]}', encoding="utf-8")
        super().__init__(
            name="test",
            system_prompt="You are a test agent.",
            memory_file=memory_path,
            tools=[],
        )

    def _execute_tool(self, name, args):
        return "tool_ok"

    def _summarize_messages(self, entries: list[str]) -> str:
        """测试用：返回确定性摘要，不调真实 LLM。"""
        return f"摘要了 {len(entries)} 条消息"


class TestFactExtraction:
    """事实提取测试。"""

    @pytest.fixture
    def agent(self):
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            path = f.name
        agent = DummyAgent(path, clean=True)
        yield agent
        Path(path).unlink(missing_ok=True)

    def test_extract_decision(self, agent):
        agent._extract_facts_from("决定用 PostgreSQL 作为数据库")
        assert any("PostgreSQL" in f for f in agent._facts)

    def test_extract_preference(self, agent):
        agent._extract_facts_from("我偏好深色主题")
        assert any("深色主题" in f for f in agent._facts)

    def test_extract_requirement(self, agent):
        agent._extract_facts_from("需要支持手机端响应式布局")
        assert any("响应式" in f for f in agent._facts)

    def test_deduplicate(self, agent):
        agent._extract_facts_from("用 React + TypeScript")
        agent._extract_facts_from("用 React + TypeScript")
        count = sum(1 for f in agent._facts if "React" in f)
        assert count == 1  # 去重

    def test_ignore_short(self, agent):
        agent._extract_facts_from("嗯")
        agent._extract_facts_from("好")
        assert len(agent._facts) == 0  # 太短不提取

    def test_facts_limit(self, agent):
        for i in range(20):
            agent._extract_facts_from(f"需要功能 {i}")
        assert len(agent._facts) <= 15


class TestMemoryCompaction:
    """上下文压缩测试。"""

    @pytest.fixture
    def agent(self):
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            path = f.name
        agent = DummyAgent(path, clean=True)
        yield agent
        Path(path).unlink(missing_ok=True)

    def test_compact_triggers_at_31(self, agent):
        """超过 30 条应触发压缩。"""
        for i in range(31):
            agent._add_to_memory("user" if i % 2 == 0 else "assistant", f"消息 {i}")
        # 压缩后：1条摘要 + 剩余 16 条
        assert len(agent._memory) <= 17  # 1 compacted + up to 16 remaining

    def test_compact_preserves_summary(self, agent):
        """压缩应生成 LLM 摘要条目。"""
        for i in range(31):
            agent._add_to_memory("user" if i % 2 == 0 else "assistant", f"消息 {i}")
        assert len(agent._memory) <= 17
        compacts = [m for m in agent._memory
                    if m["role"] == "system" and "上下文压缩" in str(m.get("content", ""))]
        assert len(compacts) >= 1

    def test_no_compact_below_limit(self, agent):
        """30 条以内不触发压缩。"""
        for i in range(15):
            agent._add_to_memory("user" if i % 2 == 0 else "assistant", f"消息 {i}")
        has_compacted = any(
            "[上下文压缩]" in str(m.get("content", ""))
            for m in agent._memory
        )
        assert not has_compacted


class TestFactsPreamble:
    """记忆注入测试。"""

    @pytest.fixture(autouse=True)
    def clean_shared(self):
        """每个测试前清空共享记忆。"""
        from agents.base import SHARED_MEMORY_FILE
        SHARED_MEMORY_FILE.parent.mkdir(parents=True, exist_ok=True)
        SHARED_MEMORY_FILE.write_text(
            '{"facts":[],"decisions":[],"updated_at":""}',
            encoding="utf-8",
        )

    @pytest.fixture
    def agent(self):
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            path = f.name
        agent = DummyAgent(path, clean=True)
        yield agent
        Path(path).unlink(missing_ok=True)

    def test_empty_preamble(self, agent):
        result = agent._build_facts_preamble()
        assert result == ""

    def test_preamble_with_facts(self, agent):
        agent._facts = ["用户偏好深色主题", "项目用 React + TypeScript"]
        result = agent._build_facts_preamble()
        assert "个人记忆" in result
        assert "深色主题" in result
        assert "React" in result

    def test_shared_preamble(self, agent):
        agent._shared_ctx = {
            "facts": ["团队决定用 JWT 认证"],
            "decisions": ["2026-07-03: 选定 PostgreSQL"],
        }
        result = agent._build_facts_preamble()
        assert "团队共享记忆" in result
        assert "JWT" in result
        assert "PostgreSQL" in result


class TestSharedMemory:
    """共享记忆测试。"""

    @pytest.fixture(autouse=True)
    def clean_shared_memory(self):
        """每个测试前清空共享记忆。"""
        from agents.base import SHARED_MEMORY_FILE
        SHARED_MEMORY_FILE.parent.mkdir(parents=True, exist_ok=True)
        SHARED_MEMORY_FILE.write_text(
            '{"facts":[],"decisions":[],"updated_at":""}',
            encoding="utf-8",
        )
        yield
        # 测试后也清空
        SHARED_MEMORY_FILE.write_text(
            '{"facts":[],"decisions":[],"updated_at":""}',
            encoding="utf-8",
        )

    @pytest.fixture
    def agent(self):
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            path = f.name
        agent = DummyAgent(path, clean=True)
        yield agent
        Path(path).unlink(missing_ok=True)

    def test_add_shared_fact(self, agent):
        agent._add_shared_fact("项目用 React + TypeScript + Tailwind")
        assert len(agent._shared_ctx["facts"]) == 1

    def test_add_shared_fact_dedup(self, agent):
        agent._add_shared_fact("项目用 React")
        agent._add_shared_fact("项目用 React")
        assert len(agent._shared_ctx["facts"]) == 1

    def test_shared_fact_limit(self, agent):
        for i in range(35):
            agent._add_shared_fact(f"fact {i}")
        assert len(agent._shared_ctx["facts"]) <= 30


class TestMemoryPersistence:
    """记忆持久化兼容性测试。"""

    def test_load_old_format(self):
        """旧格式（数组）应向后兼容。"""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as f:
            json.dump([
                {"role": "user", "content": "hello"},
                {"role": "assistant", "content": "hi"},
            ], f, ensure_ascii=False)
            path = f.name

        # 不 clean——用文件里已有的数据
        agent = DummyAgent(path, clean=False)
        assert len(agent._memory) == 2
        Path(path).unlink(missing_ok=True)

    def test_load_new_format(self):
        """新格式（{messages, facts}）应正确加载。"""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as f:
            json.dump({
                "messages": [{"role": "user", "content": "hello"}],
                "facts": ["用户偏好深色主题"],
            }, f, ensure_ascii=False)
            path = f.name

        agent = DummyAgent(path, clean=False)
        assert len(agent._memory) == 1
        assert len(agent._facts) == 1
        Path(path).unlink(missing_ok=True)


class TestPromptCache:
    """Prompt Cache 结构测试。"""

    @pytest.fixture
    def agent(self):
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            path = f.name
        agent = DummyAgent(path, clean=True)
        yield agent
        Path(path).unlink(missing_ok=True)

    def test_build_system_blocks_has_cache_control(self, agent):
        """system blocks 最后一个应有 cache_control 断点。"""
        blocks = agent._build_system_blocks()
        assert len(blocks) >= 1
        assert blocks[-1].get("cache_control") == {"type": "ephemeral"}

    def test_build_system_blocks_no_cache_when_disabled(self, agent):
        """关闭 Prompt Cache 时不应有 cache_control。"""
        agent.ENABLE_PROMPT_CACHE = False
        blocks = agent._build_system_blocks()
        assert "cache_control" not in blocks[-1]

    def test_system_prompt_is_static(self, agent):
        """system prompt 在多次调用后不变（缓存友好的前提）。"""
        blocks1 = agent._build_system_blocks()
        blocks2 = agent._build_system_blocks()
        assert blocks1 == blocks2

    def test_system_prompt_not_contain_mode_reminder(self, agent):
        """system prompt 不应包含动态的 mode_reminder。"""
        blocks = agent._build_system_blocks()
        system_text = "".join(b["text"] for b in blocks if b["type"] == "text")
        assert "Chat Budget" not in system_text
        assert "Read 模式" not in system_text
        assert "Plan 模式" not in system_text


class TestLazyContext:
    """Lazy Context 按意图切换 prompt 测试。"""

    @pytest.fixture
    def agent(self):
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            path = f.name
        agent = DummyAgent(path, clean=True)
        # 模拟 core + full prompt 分离
        agent._core_system_prompt = "CORE: You are a test agent."
        agent._full_system_prompt = "FULL: You are a test agent with full skills."
        yield agent
        Path(path).unlink(missing_ok=True)

    def test_chat_uses_core_prompt(self, agent):
        """chat 意图只用 core prompt（省 token）。"""
        agent._set_intent("chat")
        assert agent._static_system_prompt == "CORE: You are a test agent."

    def test_work_uses_full_prompt(self, agent):
        """work 意图用完整 prompt。"""
        agent._set_intent("work")
        assert agent._static_system_prompt == "FULL: You are a test agent with full skills."

    def test_read_uses_full_prompt(self, agent):
        """read 意图用完整 prompt。"""
        agent._set_intent("read")
        assert agent._static_system_prompt == agent._full_system_prompt

    def test_plan_uses_full_prompt(self, agent):
        """plan 意图用完整 prompt。"""
        agent._set_intent("plan")
        assert agent._static_system_prompt == agent._full_system_prompt

    def test_chat_fallback_when_no_core(self, agent):
        """没有 core prompt 时 chat 也用 full（向后兼容）。"""
        agent._core_system_prompt = agent._full_system_prompt  # 相同的
        agent._set_intent("chat")
        assert agent._static_system_prompt == agent._full_system_prompt


class TestTokenEstimation:
    """Token 估算测试。"""

    @pytest.fixture
    def agent(self):
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            path = f.name
        agent = DummyAgent(path, clean=True)
        yield agent
        Path(path).unlink(missing_ok=True)

    def test_estimate_tokens_positive(self, agent):
        """空记忆也应返回正数（至少 system prompt 的 token）。"""
        est = agent._estimate_tokens()
        assert est > 0

    def test_estimate_grows_with_memory(self, agent):
        """添加消息后估算值应变大。"""
        before = agent._estimate_tokens()
        agent._add_to_memory("user", "这是一条测试消息" * 10)
        after = agent._estimate_tokens()
        assert after > before

    def test_estimate_handles_tool_calls(self, agent):
        """包含 tool_use 的消息应正确估算。"""
        agent._memory.append({
            "role": "assistant",
            "content": [
                {"type": "tool_use", "id": "1", "name": "read_file", "input": {"path": "test.py"}},
                {"type": "tool_use", "id": "2", "name": "write_file", "input": {"path": "out.py"}},
            ],
        })
        est = agent._estimate_tokens()
        assert est > 0  # 不崩溃即可


class TestLLMCompaction:
    """LLM 摘要压缩测试。"""

    @pytest.fixture
    def agent(self):
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            path = f.name
        agent = DummyAgent(path, clean=True)
        yield agent
        Path(path).unlink(missing_ok=True)

    def test_compact_with_llm_returns_none_on_short(self, agent):
        """少于 3 条应返回 None（不调 LLM）。"""
        result = agent._compact_memory_with_llm(["msg1", "msg2"])
        assert result is None

    def test_compact_preserves_old_behavior(self, agent):
        """压缩后记忆长度应 ≤ 17（1 摘要 + 最多 16 条剩余）。"""
        for i in range(31):
            agent._add_to_memory("user" if i % 2 == 0 else "assistant", f"消息 {i}")
        assert len(agent._memory) <= 17

    def test_compact_summary_tagged(self, agent):
        """压缩后的摘要应有 [上下文压缩] 标记。"""
        for i in range(31):
            agent._add_to_memory("user" if i % 2 == 0 else "assistant",
                                f"用户决定用 PostgreSQL 作为数据库，第 {i} 条")
        compacts = [m for m in agent._memory
                    if m["role"] == "system" and "[上下文压缩]" in str(m.get("content", ""))]
        assert len(compacts) >= 1

    def test_ephemeral_prefix_chat(self, agent):
        """chat 模式的 ephemeral prefix 应包含 Chat Budget。"""
        prefix = agent._build_ephemeral_prefix("chat")
        assert "Chat Budget" in prefix
        assert "3句话" in prefix

    def test_ephemeral_prefix_work_is_empty(self, agent):
        """work 模式不需要 mode_reminder（已在 AGENTS.md 中）。"""
        prefix = agent._build_ephemeral_prefix("work")
        assert prefix == ""
