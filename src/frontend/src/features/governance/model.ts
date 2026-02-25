export type ReviewStatus = 'pending' | 'reviewing' | 'approved' | 'rejected';

export interface ReviewItem {
  id: string;
  patientId: string;
  status: ReviewStatus;
  triageLevel: string;
  createdAt: string;
  summary: string;
}

export type EvidenceType = 'guideline' | 'rule' | 'audit' | 'observation';

export interface EvidenceItem {
  id: string;
  type: EvidenceType;
  title: string;
  description: string;
  source?: string;
  timestamp?: string;
  confidence?: number;
}

export type MetricStatus = 'completed' | 'on_track' | 'at_risk' | 'breached';

export interface MetricRecord {
  milestoneId: string;
  metricName: string;
  targetValue: number;
  actualValue: number;
  deviation: number;
  status: MetricStatus;
  correctiveAction: string;
}

export type MilestoneStatus = 'done' | 'in_progress' | 'blocked' | 'pending';

export interface MilestoneProgress {
  id: string;
  title: string;
  completed: number;
  total: number;
  status: MilestoneStatus;
}

export type RiskTriggerType =
  | 'threshold_breach'
  | 'repeated_failure'
  | 'constraint_blocked';

export type RiskSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface RiskTrigger {
  id: string;
  type: RiskTriggerType;
  severity: RiskSeverity;
  message: string;
  timestamp: string;
  acknowledged: boolean;
}

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: '待复核',
  reviewing: '复核中',
  approved: '已通过',
  rejected: '已驳回',
};

export const EVIDENCE_TYPE_LABELS: Record<EvidenceType, string> = {
  guideline: '临床指南',
  rule: '规则引擎',
  audit: '审计链路',
  observation: '观察数据',
};

export const METRIC_STATUS_LABELS: Record<MetricStatus, string> = {
  completed: '已完成',
  on_track: '正常',
  at_risk: '有风险',
  breached: '已超阈值',
};

export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  done: '完成',
  in_progress: '进行中',
  blocked: '阻塞',
  pending: '待启动',
};

export const RISK_SEVERITY_LABELS: Record<RiskSeverity, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重',
};

export const GOVERNANCE_COLOR_BY_STATUS: Record<
  MetricStatus | MilestoneStatus | RiskSeverity,
  string
> = {
  completed: '#23916b',
  on_track: '#1c8c88',
  at_risk: '#cf912f',
  breached: '#d15e3f',
  done: '#23916b',
  in_progress: '#1c8c88',
  blocked: '#d15e3f',
  pending: '#70879a',
  low: '#70879a',
  medium: '#cf912f',
  high: '#de7f33',
  critical: '#d15e3f',
};
