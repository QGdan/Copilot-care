import type {
  EvidenceItem,
  MetricRecord,
  MilestoneProgress,
  RiskTrigger,
  ReviewItem,
} from './model';

export interface GovernanceSnapshot {
  metrics: MetricRecord[];
  milestones: MilestoneProgress[];
  riskTriggers: RiskTrigger[];
  lastUpdated: string;
}

export function createMockReviewQueue(): ReviewItem[] {
  const now = Date.now();
  return [
    {
      id: 'R-001',
      patientId: 'patient-001',
      status: 'pending',
      triageLevel: '紧急',
      createdAt: new Date(now - 12 * 60 * 1000).toISOString(),
      summary: '血压趋势持续波动，需要人工复核后才能放行。',
    },
    {
      id: 'R-002',
      patientId: 'patient-002',
      status: 'reviewing',
      triageLevel: '常规',
      createdAt: new Date(now - 60 * 60 * 1000).toISOString(),
      summary: '代谢随访病例需要确认证据完整性后再输出。',
    },
    {
      id: 'R-003',
      patientId: 'patient-003',
      status: 'approved',
      triageLevel: '复诊',
      createdAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
      summary: '低风险复诊包已通过审核，审计链路完整。',
    },
  ];
}

export function buildEvidenceBundle(item: ReviewItem): EvidenceItem[] {
  return [
    {
      id: `${item.id}-E1`,
      type: 'observation',
      title: '生命体征趋势窗口',
      description: '采集阶段与路由阶段记录的血压及症状变化轨迹。',
      timestamp: item.createdAt,
      confidence: 0.92,
    },
    {
      id: `${item.id}-E2`,
      type: 'guideline',
      title: '指南匹配结果',
      description: '决策路径满足治理策略中的风险分层与随访规则。',
      source: 'CoPilot Care 治理规则包',
      confidence: 0.87,
    },
    {
      id: `${item.id}-E3`,
      type: 'audit',
      title: '流程审计检查点',
      description: '阶段流转、输入校验和结果契约检查已关联到当前病例。',
      timestamp: new Date().toISOString(),
      confidence: 0.95,
    },
  ];
}

export function createMockGovernanceSnapshot(): GovernanceSnapshot {
  const metrics: MetricRecord[] = [
    {
      milestoneId: 'M10',
      metricName: '工作区 Typecheck 一致性',
      targetValue: 1,
      actualValue: 1,
      deviation: 0,
      status: 'completed',
      correctiveAction: '保持发版前必须执行 typecheck 的质量检查规则。',
    },
    {
      milestoneId: 'M11',
      metricName: '导入边界守卫通过率',
      targetValue: 1,
      actualValue: 1,
      deviation: 0,
      status: 'completed',
      correctiveAction: '将 guard:imports 保持在每日校验流程中。',
    },
    {
      milestoneId: 'M12',
      metricName: '发布综合检查采用率',
      targetValue: 1,
      actualValue: 1,
      deviation: 0,
      status: 'completed',
      correctiveAction: '每个候选版本统一执行 release:checklist。',
    },
  ];

  const milestones: MilestoneProgress[] = [
    {
      id: 'M10',
      title: '工程可靠性',
      completed: 3,
      total: 3,
      status: 'done',
    },
    {
      id: 'M11',
      title: '架构约束治理',
      completed: 3,
      total: 3,
      status: 'done',
    },
    {
      id: 'M12',
      title: '发布工作流就绪度',
      completed: 2,
      total: 2,
      status: 'done',
    },
  ];

  const riskTriggers: RiskTrigger[] = [
    {
      id: 'RTM-010',
      type: 'threshold_breach',
      severity: 'low',
      message: '当前无活跃告警，此条仅用于验证触发器面板与确认流程。',
      timestamp: new Date().toISOString(),
      acknowledged: true,
    },
  ];

  return {
    metrics,
    milestones,
    riskTriggers,
    lastUpdated: new Date().toISOString(),
  };
}
