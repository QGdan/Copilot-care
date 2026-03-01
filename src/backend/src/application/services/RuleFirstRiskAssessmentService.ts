import { RequestValidationError } from '../errors/RequestValidationError';
import {
  HealthSignal,
  PatientProfile,
  RiskLevel,
  TriageLevel,
} from '@copilot-care/shared/types';
import {
  buildGuidelineBasis,
  evaluateEmergencySignalSnapshot,
  hasClassicHyperglycemiaSymptoms,
  hasHighRiskComorbidity,
  isRandomGlucoseDiagnostic,
  isStage1HypertensionAccAha,
  isStage1HypertensionNice,
  isStage2Hypertension,
  RULE_IDS,
  resolveLatestBloodGlucose,
  resolveLatestBloodPressure,
} from '../../domain/rules/AuthoritativeMedicalRuleCatalog';

export interface RiskAssessmentSnapshot {
  riskLevel: RiskLevel;
  triageLevel: TriageLevel;
  redFlagTriggered: boolean;
  evidence: string[];
  guidelineBasis: string[];
  matchedRuleIds: string[];
}

function mapRiskToTriageLevel(riskLevel: RiskLevel): TriageLevel {
  if (riskLevel === 'L3') {
    return 'emergency';
  }
  if (riskLevel === 'L2') {
    return 'urgent';
  }
  if (riskLevel === 'L1') {
    return 'routine';
  }
  return 'followup';
}

export class RuleFirstRiskAssessmentService {
  public evaluate(
    profile: PatientProfile,
    signals: HealthSignal[] = [],
  ): RiskAssessmentSnapshot {
    const evidence: string[] = [];
    const matchedRuleIds: string[] = [];
    const guidelineBasis = buildGuidelineBasis();
    const { systolic, diastolic } = resolveLatestBloodPressure(profile, signals);
    const glucose = resolveLatestBloodGlucose(profile, signals);
    const emergencySignals = evaluateEmergencySignalSnapshot(profile, signals);

    if (
      Number.isFinite(systolic) &&
      Number.isFinite(diastolic) &&
      (systolic ?? 0) < (diastolic ?? 0)
    ) {
      throw new RequestValidationError(
        'ERR_INVALID_VITAL_SIGN',
        'Systolic pressure must not be lower than diastolic pressure.',
      );
    }

    const redFlagTriggered = emergencySignals.immediateEmergency;

    if (redFlagTriggered) {
      matchedRuleIds.push(...emergencySignals.matchedRuleIds);
      evidence.push(...emergencySignals.evidence);
      return {
        riskLevel: 'L3',
        triageLevel: 'emergency',
        redFlagTriggered: true,
        evidence,
        guidelineBasis,
        matchedRuleIds: [...new Set(matchedRuleIds)],
      };
    }

    const stage2Hypertension = isStage2Hypertension(systolic, diastolic);
    const stage1Nice = isStage1HypertensionNice(systolic, diastolic);
    const stage1AccAha = isStage1HypertensionAccAha(systolic, diastolic);
    const hasMultiComorbidity = (profile.chronicDiseases ?? []).length >= 2;
    const hasPersistentSymptoms = (profile.symptoms ?? []).length >= 3;
    const highRiskComorbidity = hasHighRiskComorbidity(profile);
    const glucoseDiagnosticSignal =
      isRandomGlucoseDiagnostic(glucose) &&
      hasClassicHyperglycemiaSymptoms(profile);

    if (
      stage2Hypertension ||
      hasMultiComorbidity ||
      glucoseDiagnosticSignal ||
      emergencySignals.urgentSameDaySpecialistReview ||
      (stage1AccAha && highRiskComorbidity)
    ) {
      if (stage2Hypertension) {
        matchedRuleIds.push(RULE_IDS.FLOW_CONTROL_STAGE2_HTN);
        evidence.push(
          `Stage-2 hypertension range detected (SBP=${systolic ?? 'NA'}, DBP=${diastolic ?? 'NA'}).`,
        );
      }
      if (hasMultiComorbidity) {
        evidence.push('Multiple chronic comorbidities detected (>=2).');
      }
      if (stage1AccAha && highRiskComorbidity) {
        matchedRuleIds.push(RULE_IDS.FLOW_CONTROL_STAGE1_HTN_HIGH_RISK);
        evidence.push(
          'ACC/AHA stage-1 blood pressure plus high-risk comorbidity requires tighter control.',
        );
      }
      if (glucoseDiagnosticSignal) {
        matchedRuleIds.push(RULE_IDS.FLOW_CONTROL_RANDOM_GLUCOSE_CLASSIC);
        evidence.push(
          `Random glucose diagnostic signal detected (${glucose ?? 'NA'} mg/dL with classic hyperglycemia symptoms).`,
        );
      }
      if (
        emergencySignals.urgentSameDaySpecialistReview &&
        !emergencySignals.immediateEmergency
      ) {
        matchedRuleIds.push(RULE_IDS.FLOW_CONTROL_SEVERE_HTN_SAME_DAY);
        evidence.push(
          'Severe hypertension without immediate life-threatening symptom still requires same-day specialist review.',
        );
      }
      return {
        riskLevel: 'L2',
        triageLevel: mapRiskToTriageLevel('L2'),
        redFlagTriggered: false,
        evidence,
        guidelineBasis,
        matchedRuleIds: [...new Set(matchedRuleIds)],
      };
    }

    if (stage1Nice || stage1AccAha || hasPersistentSymptoms) {
      if (stage1AccAha) {
        matchedRuleIds.push(RULE_IDS.FLOW_CONTROL_STAGE1_HTN_HIGH_RISK);
      }
      if (stage1Nice || stage1AccAha) {
        evidence.push(
          `Stage-1 hypertension range detected (SBP=${systolic ?? 'NA'}, DBP=${diastolic ?? 'NA'}).`,
        );
      }
      if (hasPersistentSymptoms) {
        evidence.push('Persistent symptom burden detected (>=3 symptoms).');
      }
      return {
        riskLevel: 'L1',
        triageLevel: mapRiskToTriageLevel('L1'),
        redFlagTriggered: false,
        evidence,
        guidelineBasis,
        matchedRuleIds: [...new Set(matchedRuleIds)],
      };
    }

    evidence.push('No high-risk boundary signal detected by current rule set.');
    return {
      riskLevel: 'L0',
      triageLevel: mapRiskToTriageLevel('L0'),
      redFlagTriggered: false,
      evidence,
      guidelineBasis,
      matchedRuleIds: [...new Set(matchedRuleIds)],
    };
  }
}
