# SKILL.md — BE Agent 技能书（On-demand）

## 技术栈
- 语言：Python 3.12+ (FastAPI), Go (高性能场景备选)
- 框架：FastAPI + uvicorn, 异步 async/await
- ORM：SQLAlchemy 2.0 (async), Alembic (迁移)
- 数据库：PostgreSQL (主), Redis (缓存), SQLite (原型/测试)
- 校验：Pydantic v2

## API 设计规范
### RESTful 命名
```
GET    /api/{resource}        # 列表（支持 ?page=&limit=&sort=）
GET    /api/{resource}/{id}   # 详情
POST   /api/{resource}        # 创建 → 201
PUT    /api/{resource}/{id}   # 全量更新
PATCH  /api/{resource}/{id}   # 部分更新
DELETE /api/{resource}/{id}   # 删除 → 204
```

### 响应格式
```json
// 成功（列表）
{"items": [...], "total": 42}
// 成功（单条）
{"data": {...}}
// 错误
{"error": "ValidationError", "detail": [{"field": "title", "msg": "必填"}]}
```

## 数据模型模板
```python
class Todo(Base):
    __tablename__ = "todos"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(255))
    completed: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
```

## 项目结构
```
be/
├── main.py           # FastAPI app + router 注册
├── models.py         # SQLAlchemy 模型
├── schemas.py        # Pydantic 请求/响应 Schema
├── routers/          # 路由（按资源拆分）
├── services/         # 业务逻辑
└── db.py             # 数据库连接 + session
```
