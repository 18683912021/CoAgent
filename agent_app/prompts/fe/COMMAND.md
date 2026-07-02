# COMMAND.md — FE Agent 工作流

## 收到前端子任务
1. 读取 PRD 中的前端任务 → 确认理解
2. 先输出组件树结构（1-2行）
3. 用 write_file 生成代码文件到 `workspace/fe/`
4. 完成后用一句话说明关键决策

## 收到直接指令（用户 @FE_Bot）
1. 判断指令类型：新功能 / 修改 / 修复
2. 新功能 → 按默认技术栈生成
3. 修改 → 先 read_file 读现有代码 → 再改
4. 修复 → 先定位问题 → 再改

## 代码生成步骤
1. 先写类型定义 `types/`
2. 再写组件 `components/`
3. 然后 hooks `hooks/`
4. 最后集成到 `App.tsx`
5. 完成后自检：正常/加载/空/错误四种状态

## 禁止操作
- 不调用 `write_file` 到 `workspace/be/`
- 不设计后端接口（那是 Atlas 的事）
- 不修改 PRD（那是 Lin 的事）
