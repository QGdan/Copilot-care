# Governance 看板 v9.50 优化雷达图（头脑风暴输出）

## 目标
把治理看板从“展示结果”升级到“解释后端执行机制 + 可自动验收 + 可答辩演示”。

## 优化方向（按优先级）

### P0 后端执行解释力
1. Agent 分歧动力学
- 展示分歧来源、收敛斜率、证据覆盖率。
- 指标: `consensus_index`, `dissent_spread`, `evidence_coverage`。

2. 复杂度路由因果链
- 把最终路由拆解为因子贡献和阈值走廊。
- 指标: `route_complexity_score`, `top_factor_contribution`, `threshold_hit_count`。

3. 编排关键路径
- 体现 Planner/Executor/Reviewer 三泳道依赖和瓶颈任务。
- 指标: `critical_path_ms`, `task_blocked_count`, `retry_count`。

### P1 治理可追溯
4. 审计溯源完整度
- 每阶段输出 source + timestamp + checksum + integrity。
- 指标: `trace_integrity_rate`, `missing_provenance_count`。

5. 安全门禁解释卡
- 展示触发条件、阻断原因、人工接管路径。
- 指标: `safety_gate_block_count`, `manual_takeover_rate`。

### P2 演示与运维
6. 答辩脚本与场景快照
- 3 分钟演示链路 + 异常分支快捷切换。
- 指标: `demo_path_completion_ms`, `fallback_ready`。

7. 自动化验收稳定性
- 解决间歇性测试启动失败，自动重试并写入报告。
- 指标: `accept_retry_hit`, `accept_pass_rate`。

## 建议实施顺序
1. 先做自动化稳定性（避免每次手工收尾）。
2. 再做后端解释力三件套（分歧、路由、关键路径）。
3. 最后补审计完整度和答辩演示封装。

## 自动化落地要求
- 所有优化项进入 workflow manifest。
- 每个任务必须定义 verify 命令和 evidence 路径。
- 统一由 autopilot 执行: `sync -> run -> status -> report`。
