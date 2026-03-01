# 试点部署计划 v1

## 概述

本文档定义 CoPilot Care 系统试点部署的执行计划，基于 `docs/process/pilot-to-production-cutover-checklist.md` 的检查项。

---

## 1. 部署目标

### 1.1 试点范围
- **目标用户**: 内部测试团队 + 限定临床用户
- **部署环境**: 预生产/试点环境
- **预期时长**: 2-4 周

### 1.2 成功标准
- 核心分诊流程稳定运行
- 无 P0/P1 级别缺陷
- 用户反馈收集机制正常
- 监控告警正常触发

---

## 2. 部署前检查清单

### 2.1 代码就绪状态 ✅

| 检查项 | 状态 | 备注 |
|--------|------|------|
| 所有测试通过 | ✅ | 115/115 tests passed |
| 前端构建成功 | ✅ | Vite build completed |
| 后端构建 | ⚠️ | TypeScript 配置问题（不影响运行） |
| ADR 文档完整 | ✅ | 6 个 ADR 已创建 |
| 切换清单已定义 | ✅ | pilot-to-production-cutover-checklist.md |

### 2.2 待完成项

| 检查项 | 优先级 | 负责人 | 预计完成 |
|--------|--------|--------|----------|
| 修复 TypeScript rootDir 配置 | P1 | 开发 | 部署前 |
| 配置生产环境变量 | P0 | 运维 | 部署前 |
| 配置 LLM Provider API 密钥 | P0 | 运维 | 部署前 |
| 设置 SSL 证书 | P0 | 运维 | 部署前 |
| 配置监控告警 | P1 | 运维 | 部署后 24h |

---

## 3. 部署架构

### 3.1 推荐配置

```
┌─────────────────────────────────────────────────────────────┐
│                      负载均衡器 (可选)                        │
│                    https://pilot.copilot-care.local          │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐    ┌──────────┐    ┌──────────┐
        │ Backend  │    │ Backend  │    │ Frontend │
        │ :3001    │    │ :3002    │    │ :80      │
        └──────────┘    └──────────┘    └──────────┘
              │               │
              └───────┬───────┘
                      ▼
              ┌──────────────┐
              │   LLM APIs   │
              │ DeepSeek/    │
              │ Gemini/Kimi  │
              └──────────────┘
```

### 3.2 最低配置

| 组件 | CPU | 内存 | 存储 |
|------|-----|------|------|
| 后端服务 | 2核 | 4GB | 20GB |
| 前端服务 | 1核 | 1GB | 10GB |
| 日志存储 | - | - | 50GB |

---

## 4. 部署步骤

### 4.1 环境准备

```bash
# 1. 克隆代码
git clone <repo-url>
cd copilot-care

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 文件，配置：
# - COPILOT_CARE_LLM_PROVIDER=auto
# - DEEPSEEK_API_KEY=xxx
# - GEMINI_API_KEY=xxx
# - KIMI_API_KEY=xxx
```

### 4.2 构建部署

```bash
# 构建前端
npm run build --workspace=@copilot-care/frontend

# 构建后端（如需修复 TypeScript 配置）
# npm run build --workspace=@copilot-care/backend

# 启动后端服务
npm run start --workspace=@copilot-care/backend

# 启动前端服务（使用 nginx 或静态服务器）
# 将 src/frontend/dist 目录部署到 web 服务器
```

### 4.3 健康检查

```bash
# 检查后端健康状态
curl http://localhost:3001/health
# 预期输出: {"status":"ok"}

# 检查专家配置
curl http://localhost:3001/architecture/experts
# 预期输出: 专家配置 JSON

# 检查规则治理目录与版本
curl http://localhost:3001/governance/rules/catalog
curl http://localhost:3001/governance/rules/version

# 检查 FHIR 最小互操作闭环（SMART scope 头）
curl -X POST http://localhost:3001/interop/fhir/triage-bundle \
  -H "content-type: application/json" \
  -H "x-smart-scope: user/Patient.read user/Observation.read user/Provenance.read" \
  -d "{\"requestId\":\"pilot-interop-smoke-001\",\"consentToken\":\"consent_local_demo\",\"profile\":{\"patientId\":\"pilot-interop-smoke-001\",\"age\":54,\"sex\":\"female\",\"symptoms\":[\"dizziness\"],\"chronicDiseases\":[\"Hypertension\"],\"medicationHistory\":[\"amlodipine\"],\"vitals\":{\"systolicBP\":146,\"diastolicBP\":92}}}"
```

---

## 5. 监控配置

### 5.1 关键指标

| 指标 | 阈值 | 告警级别 |
|------|------|----------|
| 响应时间 P95 | > 10s | Warning |
| 错误率 | > 5% | Critical |
| 内存使用 | > 80% | Warning |
| LLM 调用失败率 | > 10% | Warning |

### 5.2 日志配置

```bash
# 日志级别
LOG_LEVEL=info

# 日志输出
# - 控制台: 开发/调试
# - 文件: 生产环境
# - ELK/Loki: 集中式日志（推荐）
```

---

## 6. 回滚计划

### 6.1 回滚触发条件
- P0 级别缺陷无法在 1 小时内修复
- 数据安全问题
- 服务不可用超过 15 分钟

### 6.2 回滚步骤

```bash
# 1. 停止服务
pm2 stop copilot-care-backend

# 2. 切换到上一版本
git checkout <previous-tag>

# 3. 重新安装和启动
npm install
npm run start --workspace=@copilot-care/backend

# 4. 验证健康状态
curl http://localhost:3001/health
```

---

## 7. 试点验收

### 7.1 验收标准

| 功能 | 验收标准 | 状态 |
|------|----------|------|
| 分诊流程 | 端到端流程正常完成 | ⏳ |
| 流式响应 | 实时输出正常显示 | ⏳ |
| 错误处理 | 返回正确错误码和消息 | ⏳ |
| 专家系统 | 四专家正常工作 | ⏳ |
| 监控告警 | 关键指标正常采集 | ⏳ |

### 7.2 签署

| 角色 | 姓名 | 签署日期 | 状态 |
|------|------|----------|------|
| 技术负责人 | | | ⏳ |
| 运维负责人 | | | ⏳ |
| 产品负责人 | | | ⏳ |

---

## 8. 下一步行动

1. **立即**: 修复 TypeScript 配置问题
2. **部署前**: 配置生产环境变量和 API 密钥
3. **部署后**: 验证健康检查和监控
4. **试点期间**: 收集用户反馈，监控性能指标

---

## 版本历史

| 版本 | 日期 | 变更说明 |
|------|------|----------|
| v1 | 2026-02-22 | 初始版本 |
