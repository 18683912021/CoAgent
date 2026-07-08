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

## Python / FastAPI 编码规范

> P8 后端必须写出让 mypy/pyright 满意的代码，接口设计让前端开箱即用。

### 禁止项（红线）

| 禁止 | 原因 | 正确做法 |
|------|------|----------|
| 字符串拼接 SQL | SQL 注入漏洞 | SQLAlchemy ORM 或参数化查询 |
| async 函数内同步阻塞调用 | 阻塞事件循环，拖垮整个服务 | `time.sleep()` → `asyncio.sleep()`，requests → httpx，pymysql → asyncpg |
| 裸 `except:` / `except Exception: pass` | 吞掉异常，问题不可见 | 捕获具体异常类型，至少 `logger.exception()` |
| 硬编码密钥/密码 | 泄露到 git 历史 | 环境变量 `os.environ["KEY"]` 或 `pydantic-settings` |
| `# type: ignore` / `# noqa` | 隐藏真实问题 | 修复类型错误本身 |

### async/await 铁律

```python
# ❌ async 函数内用同步 pymysql
async def get_users():
    conn = pymysql.connect(...)          # 阻塞！
    return conn.execute("SELECT ...")

# ✅ SQLAlchemy 2.0 async
async def get_users(db: AsyncSession):
    result = await db.execute(select(User).where(User.is_active == True))
    return result.scalars().all()

# ❌ async 函数内 requests.get
async def call_external():
    resp = requests.get("https://api.example.com")   # 阻塞！

# ✅ httpx AsyncClient
async def call_external():
    async with httpx.AsyncClient() as client:
        resp = await client.get("https://api.example.com")
    return resp.json()
```

### SQLAlchemy Session 管理

```python
# ✅ FastAPI Depends 自动管理生命周期
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session

@router.get("/users")
async def list_users(db: Annotated[AsyncSession, Depends(get_db)]):
    ...
# ✅ 事务保护的写操作
async def create_user(db: AsyncSession, data: UserCreate):
    async with db.begin():                    # 自动 commit/rollback
        user = User(**data.model_dump())
        db.add(user)
        await db.flush()                     # 获取 DB 生成的 id
    return user

# ❌ 共享 session 跨请求
# ❌ 手动 session.commit() 后不处理 rollback
# ❌ lazy load 在 async session 已关闭后触发（用 selectinload 预加载）
```

### Pydantic v2 最佳实践

```python
# ✅ 用 Annotated + Field 描述字段
from typing import Annotated
from pydantic import BaseModel, Field, EmailStr, field_validator

class UserCreate(BaseModel):
    username: Annotated[str, Field(min_length=2, max_length=50, examples=["john_doe"])]
    email: EmailStr
    age: Annotated[int, Field(ge=0, le=150)]
    role: Annotated[str, Field(default="user", pattern=r"^(user|admin|moderator)$")]

    @field_validator("username")
    @classmethod
    def username_no_special(cls, v: str) -> str:
        if not v.replace("_", "").replace("-", "").isalnum():
            raise ValueError("用户名只能包含字母、数字、下划线和连字符")
        return v.strip()

# ✅ 用 model_config 全局配置
class BaseSchema(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,    # 允许从 ORM model 构建
        str_strip_whitespace=True,
        use_enum_values=True,
    )

# ❌ 不用 from_attributes，手动写 dict 转 model
# ❌ 不用 field_validator，散落在 service 层校验
# ❌ 多个 schema 间大量重复字段（用继承/Mixin 减少重复）
```

### 依赖注入规范

```python
# ✅ 类型清晰、可测试的依赖注入
from typing import Annotated
from fastapi import Depends

async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    ...

@router.get("/me")
async def me(current_user: Annotated[User, Depends(get_current_user)]):
    return current_user

# ❌ 在 router 内部手动解析 token、手动查 DB
# ❌ Depends 链超过 3 层（难追踪，考虑合并中间依赖）
```

### 错误处理规范

```python
# ✅ 统一异常 handler，不在每个路由 try/catch
from fastapi import Request
from fastapi.responses import JSONResponse

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail, "code": exc.status_code},
    )

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    request_id = str(uuid.uuid4())
    logger.exception(f"[{request_id}] Unhandled exception: {request.url}")
    return JSONResponse(
        status_code=500,
        content={"error": "InternalError", "request_id": request_id},
    )

# ✅ 业务层抛具体异常，不返回模糊的 500
class DuplicateUserError(HTTPException):
    def __init__(self, field: str, value: str):
        super().__init__(status_code=409, detail=f"{field} '{value}' 已存在")

# ❌ 每个路由手动 return JSONResponse(status_code=500, ...)
# ❌ 生产环境 exc.detail 直接返回给客户端（可能泄露内部信息）
```

### 日志规范

```python
import logging
logger = logging.getLogger(__name__)

# ✅ 结构化日志
logger.info("user_created", extra={"user_id": user.id, "by": operator_id})
logger.error("payment_failed", extra={"order_id": oid, "reason": str(e)})

# ❌ 无差别 print()
# ❌ logger.info(f"创建了用户 {user}")  —— 不结构化，不好检索
# ❌ 敏感信息进入日志：logger.info(f"密码: {password}")
```

### 性能检查清单
- [ ] 列表查询没有 `SELECT *` 全字段（指定需要的列）
- [ ] 大表统计没有 `COUNT(*)` 每次都扫全表（考虑缓存或估算）
- [ ] 批量操作没有循环单条 INSERT（用 `bulk_insert_mappings` 或 `executemany`）
- [ ] 热点数据有缓存（Redis Cache-Aside），且设置了 TTL
- [ ] 耗时操作（发邮件/生成报表/导出）走消息队列异步处理

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
