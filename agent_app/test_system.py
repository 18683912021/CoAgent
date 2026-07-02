"""系统集成测试：单Agent → 全链路 Orchestrator"""
import sys
sys.stdout.reconfigure(encoding='utf-8')

print("=" * 60)
print("Test 1: PM Agent 单独运行")
print("=" * 60)
from agents.pm import PMAgent

pm = PMAgent()
result = pm.run("用户需要一个简单的Todo应用，可以添加和删除任务")
print(f"success: {result['success']}")
print(f"result (前500字):\n{result['result'][:500]}")
if result['error']:
    print(f"error: {result['error']}")

print("\n" + "=" * 60)
print("Test 2: FE Agent 单独运行")
print("=" * 60)
from agents.fe import FEAgent

fe = FEAgent()
result = fe.run("生成一个 React Todo 组件，包含 input 输入框和任务列表。只需要一个 App.tsx 文件。")
print(f"success: {result['success']}")
print(f"result (前500字):\n{result['result'][:500]}")
if result['error']:
    print(f"error: {result['error']}")

print("\n" + "=" * 60)
print("Test 3: BE Agent 单独运行")
print("=" * 60)
from agents.be import BEAgent

be = BEAgent()
result = be.run("生成一个 Todo 后端 API，包含 GET /api/todos 和 POST /api/todos 两个接口。只需要一个 main.py 文件。")
print(f"success: {result['success']}")
print(f"result (前500字):\n{result['result'][:500]}")
if result['error']:
    print(f"error: {result['error']}")

print("\n" + "=" * 60)
print("Test 4: Orchestrator 全链路（同步模拟）")
print("=" * 60)
import asyncio
from orchestrator import Orchestrator

async def test_orchestrator():
    orch = Orchestrator()
    # 不经过飞书，直接调用核心逻辑
    result = await orch.handle_command(
        chat_id="test-chat-001",
        user_id="test-user",
        command="创建一个简单的Todo应用：可以添加任务、删除任务、查看任务列表"
    )
    print(f"result (前800字):\n{result[:800]}")

asyncio.run(test_orchestrator())

print("\n" + "=" * 60)
print("All tests completed")
