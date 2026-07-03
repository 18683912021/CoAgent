# SKILL.md — BE Agent 技能书（On-demand）

## 技术选型速查

### 项目类型 → 推荐栈

| 项目类型 | 语言/框架 | 数据库 | 缓存 | 消息队列 |
|---------|----------|--------|------|---------|
| RESTful API（通用） | Python FastAPI | PostgreSQL | Redis | — |
| 高并发 API | Go + Gin/Fiber | PostgreSQL + Redis | Redis | Kafka |
| 企业级后台 | Java Spring Boot 3 | MySQL 8 + Redis | Redis | RocketMQ |
| Admin 后台 | Python Django | PostgreSQL | Redis | — |
| 实时应用(IM/协作) | Node.js + Nest.js | PostgreSQL + MongoDB | Redis | Redis Streams |
| 数据分析平台 | Python FastAPI | ClickHouse + PostgreSQL | — | Kafka |
| 微服务体系 | Go + gRPC or Spring Cloud | 每服务独立 DB | Redis Cluster | Kafka/RocketMQ |
| Serverless | Python + AWS Lambda | DynamoDB / RDS | ElastiCache | SQS |
| BFF 层 | Node.js + Nest.js | — | Redis | — |
| IoT/时序 | Go + Gin | TimescaleDB + Redis | Redis | MQTT/Kafka |

### 数据库选择矩阵

| 需求 | 选择 |
|------|------|
| 通用业务，需要事务+JOIN | PostgreSQL |
| 存量 MySQL 系统兼容 | MySQL 8 |
| 文档/非结构化数据 | MongoDB |
| 全文搜索 | PostgreSQL GIN 索引 or Elasticsearch |
| 时序数据/IoT | TimescaleDB |
| OLAP 分析 | ClickHouse |
| 图关系 | Neo4j |
| 水平扩展 MySQL | TiDB |
| 原型/测试 | SQLite |

### 缓存策略

| 模式 | 流程 | 适用场景 |
|------|------|---------|
| Cache-Aside | 查缓存→miss→查DB→写缓存 | 读多写少（默认） |
| Read-Through | 缓存层自动查 DB | 缓存与 DB 强一致 |
| Write-Through | 先写缓存→同步写 DB | 数据一致性要求高 |
| Write-Behind | 先写缓存→异步写 DB | 写密集型，允许延迟 |

## API 设计规范

### RESTful 完整规范
```
GET    /api/{resource}           # 列表（?page=&limit=&sort=&order=&search=）
GET    /api/{resource}/{id}      # 详情
POST   /api/{resource}           # 创建 → 201 Created + Location header
PUT    /api/{resource}/{id}      # 全量更新
PATCH  /api/{resource}/{id}      # 部分更新
DELETE /api/{resource}/{id}      # 删除 → 204 No Content
POST   /api/{resource}/batch-delete  # 批量删除 → {"ids": [...]}
```

### 查询参数规范
```
?page=1&limit=20              # 分页（默认 page=1, limit=20, max=100）
&sort=created_at              # 排序字段
&order=desc                   # asc/desc
&search=keyword               # 全文搜索
&field=value                  # 精确过滤
&field__gte=value             # 大于等于
&field__lte=value             # 小于等于
&field__in=val1,val2          # 包含
```

### 统一响应格式
```json
// 列表
{
  "items": [...],
  "total": 42,
  "page": 1,
  "limit": 20
}
// 单条
{
  "data": {...}
}
// 错误
{
  "error": "ValidationError",
  "detail": [
    {"field": "email", "msg": "邮箱格式不正确"},
    {"field": "age", "msg": "年龄必须大于 0"}
  ],
  "code": 422
}
// 服务器错误（生产环境不暴露详情）
{
  "error": "InternalError",
  "message": "服务器内部错误，请联系管理员",
  "request_id": "req_abc123"
}
```

## 代码模板

### FastAPI 三层架构模板
```python
# routers/users.py
from fastapi import APIRouter, Depends, Query, HTTPException
from services.user_service import UserService
from schemas.user import UserCreate, UserUpdate, UserOut, UserListOut

router = APIRouter(prefix="/api/users", tags=["users"])

@router.get("", response_model=UserListOut)
async def list_users(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: str = Query(None),
    role: str = Query(None),
    service: UserService = Depends(),
):
    items, total = await service.list_users(page, limit, search, role)
    return {"items": items, "total": total, "page": page, "limit": limit}

@router.post("", response_model=UserOut, status_code=201)
async def create_user(data: UserCreate, service: UserService = Depends()):
    return await service.create_user(data)

@router.get("/{user_id}", response_model=UserOut)
async def get_user(user_id: str, service: UserService = Depends()):
    user = await service.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return user

@router.patch("/{user_id}", response_model=UserOut)
async def update_user(user_id: str, data: UserUpdate, service: UserService = Depends()):
    return await service.update_user(user_id, data)

@router.delete("/{user_id}", status_code=204)
async def delete_user(user_id: str, service: UserService = Depends()):
    await service.delete_user(user_id)
```

```python
# services/user_service.py
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from models.user import User
from schemas.user import UserCreate, UserUpdate

class UserService:
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def list_users(self, page, limit, search, role):
        query = select(User).where(User.deleted_at.is_(None))
        count_query = select(func.count(User.id)).where(User.deleted_at.is_(None))
        if search:
            query = query.where(User.username.ilike(f"%{search}%") | User.email.ilike(f"%{search}%"))
            count_query = count_query.where(...)
        if role:
            query = query.where(User.role == role)
        total = (await self.db.execute(count_query)).scalar()
        items = (await self.db.execute(query.offset((page-1)*limit).limit(limit))).scalars().all()
        return items, total
    
    async def create_user(self, data: UserCreate):
        user = User(**data.model_dump())
        self.db.add(user)
        await self.db.commit()
        await self.db.refresh(user)
        return user
```

### Go + Gin 模板
```go
// handlers/user_handler.go
package handlers

import (
    "net/http"
    "strconv"
    "github.com/gin-gonic/gin"
)

type UserHandler struct {
    service *services.UserService
}

func (h *UserHandler) List(c *gin.Context) {
    page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
    limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
    search := c.Query("search")
    
    items, total, err := h.service.List(c.Request.Context(), page, limit, search)
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "InternalError"})
        return
    }
    c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "limit": limit})
}
```

### 数据库迁移 (Alembic)
```bash
# 创建迁移
alembic revision --autogenerate -m "add users table"
# 执行迁移
alembic upgrade head
# 回滚
alembic downgrade -1
```

### Docker Compose 开发环境
```yaml
version: "3.8"
services:
  api:
    build: .
    ports: ["8000:8000"]
    environment:
      DATABASE_URL: postgresql+asyncpg://user:pass@db:5432/app
      REDIS_URL: redis://redis:6379/0
    depends_on: [db, redis]
    volumes: ["./workspace/be:/app"]
  
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: app
    volumes: ["pgdata:/var/lib/postgresql/data"]
  
  redis:
    image: redis:7-alpine

volumes:
  pgdata:
```

## 数据库设计规范

### 命名规范
- 表名：小写蛇形，复数（`users`, `order_items`）
- 字段名：小写蛇形（`created_at`, `updated_by`）
- 主键：`id`，UUID 或 bigint
- 外键：`{table}_id`（`user_id`, `order_id`）
- 时间戳：`created_at`, `updated_at`, `deleted_at`（软删除）
- 索引：`idx_{table}_{field}`（`idx_users_email`）
- 唯一约束：`uq_{table}_{field}`（`uq_users_username`）

### 模型模板
```python
# models/base.py
import uuid
from datetime import datetime
from sqlalchemy import Column, DateTime, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

class Base(DeclarativeBase): pass

class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(default=None)  # 软删除

class User(TimestampMixin, Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="user", index=True)
    is_active: Mapped[bool] = mapped_column(default=True)
```

## 文件结构
```
workspace/be/{project-name}/
├── main.py              # FastAPI app 入口 + router 注册 + lifespan
├── config.py            # 配置（环境变量/pydantic-settings）
├── db.py                # 数据库引擎 + session 工厂 + Depends
├── models/              # SQLAlchemy 模型
│   ├── __init__.py
│   ├── base.py          # Base + Mixin
│   └── user.py
├── schemas/             # Pydantic 请求/响应 Schema
│   └── user.py
├── routers/             # FastAPI 路由（按资源拆分）
│   └── users.py
├── services/            # 业务逻辑层
│   └── user_service.py
├── repositories/        # 数据访问层（可选，简单项目合并到 service）
├── middleware/           # 中间件（CORS/鉴权/日志/限流）
├── tests/               # 测试
├── migrations/          # Alembic 迁移版本
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── alembic.ini
```
