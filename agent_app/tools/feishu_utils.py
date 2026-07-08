"""飞书 Bot 公共工具：Token 管理、消息发送、签名验证"""
import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()

# ── Bot 凭证配置 ────────────────────────────────────────

BOTS = {
    "pm": {
        "app_id": os.environ.get("FEISHU_PM_APP_ID", ""),
        "app_secret": os.environ.get("FEISHU_PM_APP_SECRET", ""),
        "name": "AI小吴（产品经理）",
        "short_name": "小吴",
    },
    "fe": {
        "app_id": os.environ.get("FEISHU_FE_APP_ID", ""),
        "app_secret": os.environ.get("FEISHU_FE_APP_SECRET", ""),
        "name": "AI小柯（前端）",
        "short_name": "小柯",
    },
    "be": {
        "app_id": os.environ.get("FEISHU_BE_APP_ID", ""),
        "app_secret": os.environ.get("FEISHU_BE_APP_SECRET", ""),
        "name": "AI酱瓜（后端开发工程师）",
        "short_name": "酱瓜",
    },
}

# 简单的内存 token 缓存
_token_cache: dict[str, tuple[str, float]] = {}  # key → (token, expires_at)


def get_bot_by_app_id(app_id: str) -> dict | None:
    """根据 app_id 查找对应的 Bot 配置"""
    for key, bot in BOTS.items():
        if bot["app_id"] == app_id:
            return {"key": key, **bot}
    return None


async def get_tenant_token(app_id: str, app_secret: str) -> str:
    """获取 tenant_access_token，带缓存"""
    cache_key = app_id
    now = time.time()

    if cache_key in _token_cache:
        token, expires = _token_cache[cache_key]
        if now < expires - 60:  # 提前 60s 刷新
            return token

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
                json={"app_id": app_id, "app_secret": app_secret},
            )
            data = resp.json()
            token = data.get("tenant_access_token", "")
            expire = data.get("expire", 7200)  # 默认 2 小时
            _token_cache[cache_key] = (token, now + expire)
            return token
    except Exception as e:
        print(f"[feishu] 获取 token 失败 ({app_id[:10]}...): {e}")
        return ""


async def send_message(
    app_id: str,
    app_secret: str,
    chat_id: str,
    text: str,
    at_users: list[str] | None = None,
) -> dict:
    """通过飞书 API 发送消息到群聊。

    Args:
        at_users: 要 @ 的用户 ID 列表，支持 open_id/union_id/user_id/app_id

    Returns:
        {"success": bool, "msg": str}
    """
    if not app_id or not app_secret:
        return {"success": False, "msg": f"Bot 凭证未配置 (app_id={app_id[:10]}...)"}

    token = await get_tenant_token(app_id, app_secret)
    if not token:
        return {"success": False, "msg": "获取 tenant_access_token 失败"}

    # 构造消息内容
    # 如果有 at_users，在 text 末尾追加 <at> 标签实现真正的 @mention
    msg_text = text
    if at_users:
        at_tags = " ".join(f'<at user_id="{uid}"></at>' for uid in at_users)
        msg_text = f"{text} {at_tags}"

    content_body = {"text": msg_text}

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://open.feishu.cn/open-apis/im/v1/messages"
                "?receive_id_type=chat_id",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={
                    "receive_id": chat_id,
                    "msg_type": "text",
                    "content": json.dumps(content_body),
                },
            )
            data = resp.json()
            code = data.get("code", -1)
            if code == 0:
                msg_id = data.get("data", {}).get("message_id", "")
                return {"success": True, "message_id": msg_id, "msg": "发送成功"}
            return {"success": False, "message_id": "", "msg": f"飞书 API 返回错误: code={code} msg={data.get('msg', '')}"}
    except Exception as e:
        return {"success": False, "msg": f"发送异常: {e}"}


async def edit_message(app_id: str, app_secret: str, message_id: str, text: str) -> dict:
    """原地编辑 Bot 已发送的消息。用于进度消息更新，避免刷屏。

    Args:
        message_id: 要编辑的消息 ID（必须是本 Bot 发送的 text 消息）
        text: 新文本内容

    Returns:
        {"success": bool, "msg": str, "message_id": str}
        编辑失败时 message_id 为空字符串。
    """
    if not app_id or not app_secret:
        return {"success": False, "message_id": "", "msg": "Bot 凭证未配置"}
    if not message_id:
        return {"success": False, "message_id": "", "msg": "message_id 为空"}

    token = await get_tenant_token(app_id, app_secret)
    if not token:
        return {"success": False, "message_id": "", "msg": "获取 token 失败"}

    content_body = {"text": text}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.put(
                f"https://open.feishu.cn/open-apis/im/v1/messages/{message_id}",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={
                    "content": json.dumps(content_body),
                    "msg_type": "text",
                },
            )
            data = resp.json()
            code = data.get("code", -1)
            if code == 0:
                return {"success": True, "message_id": message_id, "msg": "ok"}
            return {"success": False, "message_id": "", "msg": f"code={code} {data.get('msg', '')}"}
    except Exception as e:
        return {"success": False, "message_id": "", "msg": f"异常: {e}"}


async def add_reaction(app_id: str, app_secret: str, message_id: str, emoji_type: str = "OK") -> dict:
    """给消息添加表情回应（用于模拟"正在输入"状态）。

    Args:
        message_id: 飞书消息 ID
        emoji_type: 表情类型，默认 OK（👌）

    Returns:
        {"success": bool, "reaction_id": str, "msg": str}
    """
    if not app_id or not app_secret:
        return {"success": False, "reaction_id": "", "msg": "Bot 凭证未配置"}
    if not message_id:
        return {"success": False, "reaction_id": "", "msg": "message_id 为空"}

    token = await get_tenant_token(app_id, app_secret)
    if not token:
        return {"success": False, "reaction_id": "", "msg": "获取 token 失败"}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"https://open.feishu.cn/open-apis/im/v1/messages/{message_id}/reactions",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={"reaction_type": {"emoji_type": emoji_type}},
            )
            data = resp.json()
            code = data.get("code", -1)
            if code == 0:
                reaction_id = data.get("data", {}).get("reaction_id", "")
                return {"success": True, "reaction_id": reaction_id, "msg": "ok"}
            return {"success": False, "reaction_id": "", "msg": f"code={code} {data.get('msg', '')}"}
    except Exception as e:
        return {"success": False, "reaction_id": "", "msg": f"异常: {e}"}


async def delete_reaction(app_id: str, app_secret: str, message_id: str, reaction_id: str) -> dict:
    """删除消息的表情回应。

    Returns:
        {"success": bool, "msg": str}
    """
    if not reaction_id:
        return {"success": False, "msg": "reaction_id 为空"}

    token = await get_tenant_token(app_id, app_secret)
    if not token:
        return {"success": False, "msg": "获取 token 失败"}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.delete(
                f"https://open.feishu.cn/open-apis/im/v1/messages/{message_id}/reactions/{reaction_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            data = resp.json()
            code = data.get("code", -1)
            if code == 0:
                return {"success": True, "msg": "ok"}
            return {"success": False, "msg": f"code={code} {data.get('msg', '')}"}
    except Exception as e:
        return {"success": False, "msg": f"异常: {e}"}


async def download_file(app_id: str, app_secret: str, message_id: str, file_key: str) -> dict:
    """下载飞书消息中的文件/图片内容。

    Args:
        message_id: 包含该文件的消息 ID
        file_key: 消息中的 file_key 或 image_key

    Returns:
        {"success": bool, "content": str, "file_name": str, "msg": str}
    """
    token = await get_tenant_token(app_id, app_secret)
    if not token:
        return {"success": False, "content": "", "file_name": "", "msg": "获取 token 失败"}

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"https://open.feishu.cn/open-apis/im/v1/messages/{message_id}/resources/{file_key}?type=file",
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code == 200:
                content_type = resp.headers.get("content-type", "")
                disposition = resp.headers.get("content-disposition", "")
                file_name = ""
                if "filename=" in disposition:
                    file_name = disposition.split("filename=")[-1].strip('"')
                if "text" in content_type or "json" in content_type or "xml" in content_type:
                    return {"success": True, "content": resp.text[:5000], "file_name": file_name, "msg": "ok"}
                else:
                    return {"success": True, "content": f"[二进制文件，大小: {len(resp.content)} 字节]", "file_name": file_name, "msg": "ok"}
            data = resp.json()
            return {"success": False, "content": "", "file_name": "", "msg": f"下载失败: {data}"}
    except Exception as e:
        return {"success": False, "content": "", "file_name": "", "msg": f"下载异常: {e}"}


async def get_user_info(app_id: str, app_secret: str, user_id: str) -> dict:
    """获取飞书用户的基本信息（姓名、头像等）。

    用于将 _user_xxx 或 ou_xxx 的内部 ID 解析为人类可读的显示名。

    Returns:
        {"success": bool, "name": str, "avatar": str, "msg": str}
    """
    token = await get_tenant_token(app_id, app_secret)
    if not token:
        return {"success": False, "name": "", "avatar": "", "msg": "获取 token 失败"}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"https://open.feishu.cn/open-apis/contact/v3/users/{user_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            data = resp.json()
            code = data.get("code", -1)
            if code == 0:
                user = data.get("data", {}).get("user", {})
                return {
                    "success": True,
                    "name": user.get("name", ""),
                    "avatar": user.get("avatar", {}).get("avatar_240", ""),
                    "msg": "ok",
                }
            return {"success": False, "name": "", "avatar": "", "msg": f"code={code} {data.get('msg', '')}"}
    except Exception as e:
        return {"success": False, "name": "", "avatar": "", "msg": f"异常: {e}"}


async def get_chat_members(app_id: str, app_secret: str, chat_id: str) -> dict:
    """获取飞书群聊成员列表。

    Returns:
        {"success": bool, "members": [{"user_id": str, "name": str}], "msg": str}
    """
    token = await get_tenant_token(app_id, app_secret)
    if not token:
        return {"success": False, "members": [], "msg": "获取 token 失败"}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"https://open.feishu.cn/open-apis/im/v1/chats/{chat_id}/members?page_size=50",
                headers={"Authorization": f"Bearer {token}"},
            )
            data = resp.json()
            code = data.get("code", -1)
            if code == 0:
                items = data.get("data", {}).get("items", [])
                members = [{"user_id": m.get("member_id", ""), "name": m.get("name", "")} for m in items]
                return {"success": True, "members": members, "msg": "ok"}
            return {"success": False, "members": [], "msg": f"code={code} {data.get('msg', '')}"}
    except Exception as e:
        return {"success": False, "members": [], "msg": f"异常: {e}"}


async def get_message(app_id: str, app_secret: str, message_id: str) -> dict:
    """获取指定消息的完整内容。

    Returns:
        {"success": bool, "content": dict, "msg": str}
    """
    token = await get_tenant_token(app_id, app_secret)
    if not token:
        return {"success": False, "content": {}, "msg": "获取 token 失败"}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"https://open.feishu.cn/open-apis/im/v1/messages/{message_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            data = resp.json()
            code = data.get("code", -1)
            if code == 0:
                items = data.get("data", {}).get("items", [])
                return {"success": True, "content": items[0] if items else {}, "msg": "ok"}
            return {"success": False, "content": {}, "msg": f"code={code} {data.get('msg', '')}"}
    except Exception as e:
        return {"success": False, "content": {}, "msg": f"异常: {e}"}


# ── 云文档 ──────────────────────────────────────────

async def get_doc_content(app_id: str, app_secret: str, doc_id: str) -> dict:
    """读取飞书文档的原始文本内容。

    Args:
        doc_id: 文档 ID，从文档 URL 中提取（如 `https://xxx.feishu.cn/docx/ABCD1234` → ABCD1234）

    Returns:
        {"success": bool, "content": str, "title": str, "msg": str}
    """
    token = await get_tenant_token(app_id, app_secret)
    if not token:
        return {"success": False, "content": "", "title": "", "msg": "获取 token 失败"}

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"https://open.feishu.cn/open-apis/docx/v1/documents/{doc_id}/raw_content",
                headers={"Authorization": f"Bearer {token}"},
            )
            data = resp.json()
            code = data.get("code", -1)
            if code == 0:
                d = data.get("data", {})
                return {
                    "success": True,
                    "content": d.get("content", "")[:8000],
                    "title": d.get("title", ""),
                    "msg": "ok",
                }
            return {"success": False, "content": "", "title": "", "msg": f"code={code} {data.get('msg', '')}"}
    except Exception as e:
        return {"success": False, "content": "", "title": "", "msg": f"异常: {e}"}


async def get_bitable_records(
    app_id: str, app_secret: str, app_token: str, table_id: str, page_size: int = 50
) -> dict:
    """读取飞书多维表格（Bitable）的数据记录。

    Args:
        app_token: 多维表格的 app_token（从 URL 提取）
        table_id: 数据表 ID
        page_size: 每页记录数，最大 100

    Returns:
        {"success": bool, "records": list, "msg": str}
    """
    token = await get_tenant_token(app_id, app_secret)
    if not token:
        return {"success": False, "records": [], "msg": "获取 token 失败"}

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records"
                f"?page_size={min(page_size, 100)}",
                headers={"Authorization": f"Bearer {token}"},
            )
            data = resp.json()
            code = data.get("code", -1)
            if code == 0:
                items = data.get("data", {}).get("items", [])
                records = []
                for item in items:
                    fields = item.get("fields", {})
                    records.append({"record_id": item.get("record_id", ""), "fields": fields})
                return {"success": True, "records": records, "msg": "ok"}
            return {"success": False, "records": [], "msg": f"code={code} {data.get('msg', '')}"}
    except Exception as e:
        return {"success": False, "records": [], "msg": f"异常: {e}"}


async def search_wiki(app_id: str, app_secret: str, query: str, space_id: str = "") -> dict:
    """搜索飞书知识库（Wiki）。

    Args:
        query: 搜索关键词
        space_id: 可选，限定知识库空间 ID

    Returns:
        {"success": bool, "results": [{"title":, "url":, "snippet":}], "msg": str}
    """
    token = await get_tenant_token(app_id, app_secret)
    if not token:
        return {"success": False, "results": [], "msg": "获取 token 失败"}

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            params = {"query": query}
            if space_id:
                params["space_id"] = space_id
            resp = await client.get(
                "https://open.feishu.cn/open-apis/wiki/v2/search",
                headers={"Authorization": f"Bearer {token}"},
                params=params,
            )
            data = resp.json()
            code = data.get("code", -1)
            if code == 0:
                items = data.get("data", {}).get("items", [])
                results = []
                for item in items[:10]:
                    results.append({
                        "title": item.get("title", ""),
                        "url": item.get("url", ""),
                        "snippet": item.get("body", "")[:200],
                    })
                return {"success": True, "results": results, "msg": "ok"}
            return {"success": False, "results": [], "msg": f"code={code} {data.get('msg', '')}"}
    except Exception as e:
        return {"success": False, "results": [], "msg": f"异常: {e}"}


async def get_wiki_node_content(app_id: str, app_secret: str, node_token: str) -> dict:
    """读取飞书知识库（Wiki）节点的完整内容。

    Args:
        node_token: Wiki 节点 token，从 URL 提取（如 https://xxx.feishu.cn/wiki/ABCD1234 → ABCD1234）

    Returns:
        {"success": bool, "title": str, "content": str, "msg": str}
    """
    token = await get_tenant_token(app_id, app_secret)
    if not token:
        return {"success": False, "title": "", "content": "", "msg": "获取 token 失败"}

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # 第一步：获取节点信息
            resp = await client.get(
                f"https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token={node_token}",
                headers={"Authorization": f"Bearer {token}"},
            )
            data = resp.json()
            code = data.get("code", -1)
            if code != 0:
                return {"success": False, "title": "", "content": "", "msg": f"获取节点失败: {data.get('msg', '')}"}

            node = data.get("data", {}).get("node", {})
            title = node.get("title", "")
            obj_type = node.get("obj_type", "")
            obj_token = node.get("obj_token", "")
            space_id = node.get("space_id", "")

            # 第二步：根据节点类型读取内容
            if obj_type == "docx" or obj_type == "doc":
                # 文档类型 → 用 docx API
                doc_result = await get_doc_content(app_id, app_secret, obj_token)
                if doc_result["success"]:
                    return {"success": True, "title": title, "content": doc_result["content"], "msg": "ok"}
                return {"success": False, "title": title, "content": "", "msg": f"读取文档内容失败: {doc_result['msg']}"}

            elif obj_type == "bitable":
                return {"success": True, "title": title, "content": f"[多维表格] app_token={obj_token}，请用 read_feishu_bitable 读取具体数据表", "msg": "ok"}

            else:
                # 文件夹或其他类型
                return {"success": True, "title": title, "content": f"[{obj_type} 类型节点] token={obj_token}", "msg": "ok"}

    except Exception as e:
        return {"success": False, "title": "", "content": "", "msg": f"异常: {e}"}


# ── 消息增强 ──────────────────────────────────────────

async def reply_message(app_id: str, app_secret: str, message_id: str, text: str) -> dict:
    """以线程回复方式回复指定消息。

    Returns:
        {"success": bool, "msg": str}
    """
    token = await get_tenant_token(app_id, app_secret)
    if not token:
        return {"success": False, "msg": "获取 token 失败"}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"https://open.feishu.cn/open-apis/im/v1/messages/{message_id}/reply",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={
                    "content": json.dumps({"text": text}),
                    "msg_type": "text",
                },
            )
            data = resp.json()
            code = data.get("code", -1)
            if code == 0:
                return {"success": True, "msg": "ok"}
            return {"success": False, "msg": f"code={code} {data.get('msg', '')}"}
    except Exception as e:
        return {"success": False, "msg": f"异常: {e}"}


async def send_file_message(app_id: str, app_secret: str, chat_id: str, file_path: str) -> dict:
    """发送本地文件到飞书群聊（突破 800 字截断限制）。

    先上传文件获取 file_key，再发送文件消息。

    Returns:
        {"success": bool, "msg": str}
    """
    if not Path(file_path).exists():
        return {"success": False, "msg": f"文件不存在: {file_path}"}

    token = await get_tenant_token(app_id, app_secret)
    if not token:
        return {"success": False, "msg": "获取 token 失败"}

    try:
        file_name = Path(file_path).name
        file_size = Path(file_path).stat().st_size
        content = Path(file_path).read_bytes()

        async with httpx.AsyncClient(timeout=30) as client:
            # 第一步：上传文件
            upload_resp = await client.post(
                "https://open.feishu.cn/open-apis/im/v1/files",
                headers={"Authorization": f"Bearer {token}"},
                files={
                    "file": (file_name, content, "application/octet-stream"),
                },
                data={
                    "file_name": file_name,
                    "file_type": "stream",
                },
            )
            upload_data = upload_resp.json()
            if upload_data.get("code", -1) != 0:
                return {"success": False, "msg": f"上传失败: {upload_data}"}

            file_key = upload_data.get("data", {}).get("file_key", "")

            # 第二步：发送文件消息
            content_json = json.dumps({"file_key": file_key})
            send_resp = await client.post(
                "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={
                    "receive_id": chat_id,
                    "msg_type": "file",
                    "content": content_json,
                },
            )
            send_data = send_resp.json()
            if send_data.get("code", -1) == 0:
                return {"success": True, "msg": f"文件已发送: {file_name}"}
            return {"success": False, "msg": f"发送失败: {send_data}"}
    except Exception as e:
        return {"success": False, "msg": f"异常: {e}"}


def verify_signature(headers: dict, body: dict, app_secret: str) -> bool:
    """验证飞书事件签名"""
    try:
        timestamp = headers.get("x-lark-request-timestamp", "")
        nonce = headers.get("x-lark-request-nonce", "")
        signature = headers.get("x-lark-signature", "")

        if not (timestamp and nonce and signature):
            return True  # 无签名头时跳过（测试环境）

        if not app_secret:
            return True  # 无 secret 时跳过

        body_str = json.dumps(body, separators=(",", ":"), ensure_ascii=False)
        sign_str = f"{timestamp}{nonce}{body_str}{app_secret}"
        expected = hashlib.sha256(sign_str.encode()).hexdigest()
        return signature == expected
    except Exception:
        return False
