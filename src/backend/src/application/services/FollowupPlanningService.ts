import {
  PatientProfile,
  RiskLevel,
  StructuredTriageResult,
  TriageDepartment,
  TriageLevel,
} from '@copilot-care/shared/types';

export interface FollowupPlanningInput {
  patientId: string;
  riskLevel: RiskLevel;
  triageLevel: TriageLevel;
  department: TriageDepartment;
  profile?: PatientProfile;
}

const DEPARTMENT_DESTINATION: Record<TriageDepartment, string> = {
  cardiology: '心血管专科门诊',
  generalPractice: '全科门诊',
  metabolic: '代谢专科门诊',
  multiDisciplinary: '多学科联合门诊',
};

const TRIAGE_FOLLOWUP_DAYS: Record<TriageLevel, number> = {
  emergency: 1,
  urgent: 14,
  routine: 30,
  followup: 90,
};

function normalizeList(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function hasAnyKeyword(values: string[], keywords: string[]): boolean {
  return values.some((value) =>
    keywords.some((keyword) => value.includes(keyword)),
  );
}

function dedupeAdvice(items: string[]): string[] {
  const selected: string[] = [];
  const normalized = new Set<string>();
  for (const item of items.map((text) => text.trim()).filter(Boolean)) {
    const key = item.replace(/[，。；、\s]/g, '');
    if (!key || normalized.has(key)) {
      continue;
    }
    normalized.add(key);
    selected.push(item);
    if (selected.length >= 7) {
      break;
    }
  }
  return selected;
}

function buildTriageCoreAdvice(input: {
  triageLevel: TriageLevel;
  destination: string;
  followupDays: number;
}): string[] {
  if (input.triageLevel === 'emergency') {
    return [
      '立即前往线下急诊绿色通道，避免自行驾车，必要时呼叫 120。',
      '就诊途中保持休息；若出现持续胸痛、呼吸困难、意识改变或肢体无力，立即急救。',
      '携带既往病历、用药清单与近期检测记录，便于急诊快速风险分层。',
    ];
  }

  if (input.triageLevel === 'urgent') {
    return [
      `请在 24 小时内完成线下面诊评估，优先前往${input.destination}。`,
      '未面诊前避免高强度活动与熬夜，记录症状发生时段与诱因。',
      `最晚 ${input.followupDays} 天内完成复评闭环，必要时提前上转。`,
    ];
  }

  if (input.triageLevel === 'routine') {
    return [
      `建议 72 小时内完成首次复评，优先在${input.destination}建立随访档案。`,
      '坚持规律作息、限盐限酒与体重管理，避免症状波动加重。',
      `请在 ${input.followupDays} 天内完成下次随访评估。`,
    ];
  }

  return [
    `建议在 ${input.followupDays} 天内完成计划随访，并持续记录关键体征变化。`,
    '如出现新发红旗症状（胸痛、呼吸困难、神志改变、明显乏力）需提前就医。',
  ];
}

function buildVitalsAdvice(profile: PatientProfile | undefined): string[] {
  if (!profile?.vitals) {
    return [];
  }
  const advice: string[] = [];
  const systolic = profile.vitals.systolicBP;
  const diastolic = profile.vitals.diastolicBP;
  const glucose = profile.vitals.bloodGlucose;

  if (typeof systolic === 'number' || typeof diastolic === 'number') {
    advice.push('家庭血压监测：早晚各 1 次，连续 7 天，记录伴随症状与触发因素。');
  }

  if (
    (typeof systolic === 'number' && systolic >= 180) ||
    (typeof diastolic === 'number' && diastolic >= 120)
  ) {
    advice.push(
      '若复测血压持续 ≥180/120 mmHg，或伴胸痛/神经系统症状，立即急诊。',
    );
  } else if (
    (typeof systolic === 'number' && systolic >= 160) ||
    (typeof diastolic === 'number' && diastolic >= 100)
  ) {
    advice.push('若连续两次复测仍 ≥160/100 mmHg，建议当日专科复评。');
  } else if (
    (typeof systolic === 'number' && systolic >= 140) ||
    (typeof diastolic === 'number' && diastolic >= 90)
  ) {
    advice.push('若连续 3 天平均血压 ≥140/90 mmHg，建议提前复诊调整管理策略。');
  }

  if (typeof glucose === 'number' && glucose >= 11.1) {
    advice.push(
      '若随机血糖 ≥11.1 mmol/L 且伴多饮多尿/乏力加重，24 小时内代谢专科评估。',
    );
  }
  if (typeof glucose === 'number' && glucose <= 3.9) {
    advice.push('如出现低血糖（≤3.9 mmol/L）或出汗心悸，请立即补糖并线下就医。');
  }

  return advice;
}

function buildComorbidityAdvice(profile: PatientProfile | undefined): string[] {
  const tags = normalizeList(profile?.chronicDiseases);
  if (tags.length === 0) {
    return [];
  }

  const advice: string[] = [];
  if (hasAnyKeyword(tags, ['hypertension', '高血压'])) {
    advice.push('核查降压药依从性与漏服情况，禁止自行加减药或停药。');
  }
  if (hasAnyKeyword(tags, ['diabetes', 'prediabetes', '糖尿病', '糖耐量'])) {
    advice.push('建议复评空腹血糖、餐后 2 小时血糖与 HbA1c，评估代谢风险。');
  }
  if (hasAnyKeyword(tags, ['heart', 'coronary', '心脏', '冠心病'])) {
    advice.push('建议结合心电图与肾功能/电解质复查，完善心血管风险分层。');
  }
  return advice;
}

function buildDepartmentAdvice(department: TriageDepartment): string[] {
  if (department === 'cardiology') {
    return ['建议优先在心血管专科门诊完成风险分层与随访计划确认。'];
  }
  if (department === 'metabolic') {
    return ['建议由代谢专科评估血糖目标达成与并发症筛查节奏。'];
  }
  if (department === 'multiDisciplinary') {
    return ['建议多学科联合会诊，明确主要风险驱动因素与处置优先级。'];
  }
  return ['建议由全科门诊统筹慢病管理，必要时按评估结果转专科。'];
}

function buildRiskClosingAdvice(riskLevel: RiskLevel): string {
  if (riskLevel === 'L3') {
    return '风险分层：L3级（高危）；请以急危事件处置优先，线下连续监测。';
  }
  if (riskLevel === 'L2') {
    return '风险分层：L2级（中高危）；需在短期内完成专科复评并闭环追踪。';
  }
  if (riskLevel === 'L1') {
    return '风险分层：L1级（中低危）；按计划随访并监测趋势变化。';
  }
  return '风险分层：L0级（低危）；继续规范随访与健康管理。';
}

function buildEducationAdvice(input: FollowupPlanningInput, destination: string): string[] {
  const followupDays = TRIAGE_FOLLOWUP_DAYS[input.triageLevel];
  const advice = [
    ...buildTriageCoreAdvice({
      triageLevel: input.triageLevel,
      destination,
      followupDays,
    }),
    ...buildVitalsAdvice(input.profile),
    ...buildComorbidityAdvice(input.profile),
    ...buildDepartmentAdvice(input.department),
    buildRiskClosingAdvice(input.riskLevel),
  ];
  return dedupeAdvice(advice);
}

export class FollowupPlanningService {
  public buildPlan(input: FollowupPlanningInput): StructuredTriageResult {
    const followupDays = TRIAGE_FOLLOWUP_DAYS[input.triageLevel];
    const destination =
      input.triageLevel === 'emergency'
        ? '线下急诊绿色通道'
        : DEPARTMENT_DESTINATION[input.department];

    return {
      patientId: input.patientId,
      triageLevel: input.triageLevel,
      destination,
      followupDays,
      educationAdvice: buildEducationAdvice(input, destination),
      tcmAdvice:
        input.riskLevel === 'L0' || input.riskLevel === 'L1'
          ? ['可结合中医体质调理，作为长期健康管理的补充方案。']
          : undefined,
    };
  }
}
