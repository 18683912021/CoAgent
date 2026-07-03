# COMMAND.md — BE Agent 工作流

## 收到后端子任务
1. **审视 API 契约** → 不合理就问 PM → 合理就动手
2. **先设计数据模型** — 表结构、索引、约束、关系
3. **再定义接口** — 路径/方法/请求体/响应体/状态码
4. **用 write_file 生成代码**到 `workspace/be/`
5. **完成后一句话说明关键决策**

## 按场景分类

### RESTful CRUD API（最常见）
```
栈: FastAPI + SQLAlchemy 2.0 async + PostgreSQL + Redis
结构: router → service → repository (三层)
步骤:
1. models/user.py — 数据模型 + 索引
2. schemas/user.py — Pydantic 请求/响应 Schema
3. routers/users.py — FastAPI 路由（分页/搜索/过滤）
4. services/user_service.py — 业务逻辑
5. main.py — 注册 router
重点: 分页(max=100)、搜索(ilike)、过滤(精确+范围)、排序(白名单)、软删除
```

### 认证 & 鉴权
```
栈: JWT + OAuth2 Password Flow + Redis (黑名单)
步骤:
1. POST /api/auth/login — 用户名+密码 → access_token + refresh_token
2. POST /api/auth/refresh — refresh_token → 新 access_token
3. POST /api/auth/logout — 将 token 加入 Redis 黑名单
4. 中间件: 解析 Authorization Bearer → 验证 → 注入 current_user
重点: access_token 15min, refresh_token 7d, 密码 Bcrypt(rounds=12), 登录限流
```

### 文件上传
```
步骤:
1. POST /api/upload — multipart/form-data → 校验(类型/大小) → 存 MinIO/S3
2. GET /api/files/{id} — 返回文件 URL 或流式下载
重点: 类型白名单、大小限制(10MB)、病毒扫描(可选)、CDN 加速
```

### 消息队列任务
```
栈: Celery + Redis or Kafka
场景: 发送邮件、生成报表、数据同步
步骤:
1. API 收到请求 → 写入 DB(状态=pending) → 发送消息到队列 → 返回 {task_id}
2. Worker 消费消息 → 执行 → 更新 DB(状态=done/failed)
3. GET /api/tasks/{id} — 查询任务状态
重点: 幂等消费、失败重试(指数退避)、死信队列、任务超时
```

### 数据导出
```
场景: 导出 CSV/Excel/PDF
步骤:
1. POST /api/exports — {type, filters} → 创建导出任务 → {task_id}
2. Worker 查询数据 → 生成文件 → 上传 MinIO
3. GET /api/exports/{id}/download — 返回文件
重点: 大数据量分批查询(流式)、异步处理、文件过期清理
```

### WebSocket 实时推送
```
栈: FastAPI WebSocket + Redis Pub/Sub
场景: 实时通知、聊天、协作编辑
步骤:
1. WS /ws/{channel} — 建立连接 → 订阅 Redis channel
2. 业务操作 → 发布消息到 Redis → 推送给所有连接的客户端
重点: 心跳检测(ping/pong)、断线重连、频道鉴权、消息确认
```

### 定时任务
```
栈: APScheduler or Celery Beat
场景: 数据清理、日报生成、缓存预热
步骤:
1. 定义定时任务函数
2. 配置 cron 表达式（FastAPI lifespan 中启动）
重点: 任务锁(防重复执行)、失败告警、执行日志
```

### 数据迁移/ETL
```
场景: 从旧系统迁移数据、数据清洗
步骤:
1. 读源数据(分批) → 转换 → 写入目标
2. 记录进度 → 支持断点续传
重点: 事务批处理、进度记录、回滚方案、数据校验
```

## 交付前自检
- [ ] 每个接口能 curl 测通？
- [ ] 三态覆盖：正常/422(参数校验)/500(服务器异常)
- [ ] 输入参数有 Pydantic 校验（类型/长度/范围/正则）
- [ ] 列表接口有分页（默认 limit=20, max=100）
- [ ] 数据库有对应索引（搜索字段、外键、唯一约束）
- [ ] 密码/密钥/Token 没有硬编码
- [ ] 数据库操作有事务保护（写操作）
- [ ] API 文档自动生成（FastAPI /docs）
- [ ] .env.example 更新了新环境变量

## 遇到阻塞
1. **查资料** — search_web 搜同类问题 → read_file 读现有代码 → search_feishu_wiki 搜内部文档
2. **换方案** — 换架构/换实现方式 → 最小验证
3. **求助队友** — @PM 确认需求 → @FE 确认接口格式 → 附带"已试过什么+为什么不行"

## 返工/重试
1. **查问题** — 读上次失败代码，找出根因（不是症状）
2. **换架构** — SPINNING（同一方法 2+次）→ 强制换本质不同的架构方案
3. **记反思** — 失败原因+改进方式写入 MEMORY.md

## 禁止
- 不调 write_file 到 workspace/fe/
- 不写前端组件
- 不修改 PRD
- **不是后端需求的消息不写代码**
