import os, sys
sys.stdout.reconfigure(encoding='utf-8')
from dotenv import load_dotenv
from anthropic import Anthropic

load_dotenv()

client = Anthropic(
    base_url=os.environ["ANTHROPIC_BASE_URL"],
    api_key=os.environ["ANTHROPIC_API_KEY"],
)

def show(r):
    """展示响应内容，处理 ThinkingBlock + TextBlock + ToolUseBlock"""
    for block in r.content:
        t = block.type
        if t == "text":
            print(f"  [text] {block.text[:150]}")
        elif t == "tool_use":
            print(f"  [tool_use] {block.name}({block.input})")
        elif t == "thinking":
            print(f"  [thinking] {str(block.thinking)[:80]}...")
        else:
            print(f"  [{t}]")

def test(model, title):
    print(f"\n=== {title} ({model}) ===")

    # 连通
    r = client.messages.create(
        model=model, max_tokens=500,
        messages=[{"role": "user", "content": "say hello in one word"}]
    )
    print("[connect]", end="")
    show(r)

    # tool_use
    r = client.messages.create(
        model=model, max_tokens=500,
        tools=[{
            "name": "get_weather",
            "description": "Get weather for a city",
            "input_schema": {
                "type": "object",
                "properties": {"city": {"type": "string"}},
                "required": ["city"]
            }
        }],
        messages=[{"role": "user", "content": "What is the weather in Beijing?"}]
    )
    print("[tool_use]", end="")
    show(r)

test("deepseek-v4-flash", "v4-flash")
test("deepseek-v4-pro", "v4-pro")

print("\ndone")
