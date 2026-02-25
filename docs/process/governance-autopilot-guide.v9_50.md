# Governance Autopilot v9.50 使用说明

## 先理解“门禁”
- 这里的“门禁”就是“自动体检”。
- 目的不是拦你，而是提前发现类型错误、构建失败、文案乱码、性能超预算等问题。

## 入口命令
- `npm run governance:auto:sync`
- `npm run governance:auto:status`
- `npm run governance:auto:next`
- `npm run governance:auto:run`

## 体检命令（更直观）
- `npm run health:quick`：轻体检（类型+文案）
- `npm run health:core`：核心体检（前端测试+构建+性能+文案）
- `npm run health:release`：发版体检（CI 同款）

## 推荐执行
1. `npm run governance:auto:sync`
2. `npm run governance:auto:run -- --retries=2`
3. `npm run governance:auto:status`

## 输出
- 工作流状态: `reports/todos/workflow-state.json`
- 自动化报告: `reports/todos/governance-v950-autopilot.latest.json`

## 失败处理
- 默认遇到首个失败立即停止。
- 若要继续执行后续任务，增加参数 `--continue-on-error`。
