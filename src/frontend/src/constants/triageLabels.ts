export const ROUTE_MODE_LABELS: Record<string, string> = {
  FAST_CONSENSUS: '快速共识',
  LIGHT_DEBATE: '轻度辩论',
  DEEP_DEBATE: '深度辩论',
  ESCALATE_TO_OFFLINE: '线下上转',
};

export const DEPARTMENT_LABELS: Record<string, string> = {
  cardiology: '心血管专科',
  generalPractice: '全科',
  metabolic: '代谢专科',
  multiDisciplinary: '多学科',
};

export const COLLABORATION_LABELS: Record<string, string> = {
  SINGLE_SPECIALTY_PANEL: '同专业多模型协同',
  MULTI_DISCIPLINARY_CONSULT: '多学科协同会诊',
  OFFLINE_ESCALATION: '线下上转',
};

export const TRIAGE_LEVEL_LABELS: Record<string, string> = {
  emergency: '急危（L3）',
  urgent: '紧急（L2）',
  routine: '常规（L1）',
  followup: '随访（L0）',
};

export const TRIAGE_LEVEL_BAND_LABELS: Record<string, string> = {
  emergency: 'L3级',
  urgent: 'L2级',
  routine: 'L1级',
  followup: 'L0级',
};

export const DESTINATION_LABELS: Record<string, string> = {
  cardiology_outpatient: '心血管专科门诊',
  gp_clinic: '全科门诊',
  metabolic_outpatient: '代谢专科门诊',
  multidisciplinary_clinic: '多学科联合门诊',
  offline_emergency: '线下急诊绿色通道',
  cardiology_clinic: '心血管专科门诊',
  metabolic_clinic: '代谢专科门诊',
  general_clinic: '全科门诊',
};

export const ROUTE_MODE_TO_COLLABORATION: Record<string, string> = {
  FAST_CONSENSUS: 'SINGLE_SPECIALTY_PANEL',
  LIGHT_DEBATE: 'SINGLE_SPECIALTY_PANEL',
  DEEP_DEBATE: 'MULTI_DISCIPLINARY_CONSULT',
  ESCALATE_TO_OFFLINE: 'OFFLINE_ESCALATION',
};

export function formatRouteMode(value: string): string {
  return ROUTE_MODE_LABELS[value] ?? value;
}

export function formatDepartment(value: string): string {
  return DEPARTMENT_LABELS[value] ?? value;
}

export function formatCollaboration(value: string): string {
  return COLLABORATION_LABELS[value] ?? value;
}

export function formatTriageLevel(value: string): string {
  return TRIAGE_LEVEL_LABELS[value] ?? value;
}

export function formatTriageBand(value: string): string {
  return TRIAGE_LEVEL_BAND_LABELS[value] ?? value;
}

export function formatDestination(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return value;
  }
  if (DESTINATION_LABELS[normalized]) {
    return DESTINATION_LABELS[normalized];
  }

  const bag = normalized.toLowerCase();
  if (bag.includes('cardiology')) {
    return '心血管专科门诊';
  }
  if (bag.includes('metabolic')) {
    return '代谢专科门诊';
  }
  if (bag.includes('general') || bag.includes('gp')) {
    return '全科门诊';
  }
  if (bag.includes('multidisciplinary')) {
    return '多学科联合门诊';
  }
  if (bag.includes('emergency') || bag.includes('offline')) {
    return '线下急诊绿色通道';
  }
  return normalized;
}

export function formatClinicalGrade(
  triageLevel: string,
  department?: string,
): string {
  const dept = department ? formatDepartment(department) : '';
  const band = formatTriageBand(triageLevel);
  return dept ? `${dept}${band}` : band;
}
