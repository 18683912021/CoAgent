"""系统集成测试（多 Bot 模式）"""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import asyncio

print("=" * 60)
print("Test 1: PM Agent → FE/BE 全链路（无飞书，直接调用）")
print("=" * 60)
from orchestrator import Orchestrator

async def test():
    orch = Orchestrator()
    await orch.handle_command(
        bot_key="pm",
        chat_id="test-chat",
        user_id="test-user",
        command="创建一个简单的Todo应用：可以添加任务、删除任务、查看任务列表"
    )
    print("OK: PM全链路完成")

asyncio.run(test())

print("\n" + "=" * 60)
print("Test 2: FE Bot 直接 @")
print("=" * 60)
async def test_fe():
    orch = Orchestrator()
    await orch.handle_command(
        bot_key="fe",
        chat_id="test-chat",
        user_id="test-user",
        command="生成一个 React 计数器组件 Counter.tsx"
    )
    print("OK: FE直接调用完成")

asyncio.run(test_fe())

print("\n" + "=" * 60)
print("Test 3: BE Bot 直接 @")
print("=" * 60)
async def test_be():
    orch = Orchestrator()
    await orch.handle_command(
        bot_key="be",
        chat_id="test-chat",
        user_id="test-user",
        command="生成一个健康检查接口 GET /health"
    )
    print("OK: BE直接调用完成")

asyncio.run(test_be())

print("\nAll tests done")
