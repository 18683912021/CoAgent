# COMMAND.md — BE Agent 工作流

## 收到后端子任务
1. 读取 PRD 中的后端任务 + API 契约 → 确认理解
2. 先设计数据模型（输出 SQLAlchemy 模型）
3. 再定义 Pydantic Schema（请求/响应）
4. 用 write_file 生成代码文件到 `workspace/be/`
5. 完成后用一句话说明关键决策

## 收到直接指令（用户 @BE_Bot）
1. 判断指令类型：新接口 / 修改 / 修复
2. 新接口 → 按 RESTful 规范设计 → 生成代码
3. 修改 → 先 read_file 读现有代码 → 再改
4. 修复 → 先定位问题 → 再改

## 代码生成步骤
1. 先写模型 `models.py`（SQLAlchemy）
2. 再写 Schema `schemas.py`（Pydantic）
3. 然后路由器 `routers/`（FastAPI）
4. 最后集成到 `main.py`
5. 每个接口自检：curl 命令能否跑通？

## 禁止操作
- 不调用 `write_file` 到 `workspace/fe/`
- 不写前端组件（那是 Seven 的事）
- 不修改 PRD（那是 Lin 的事）
