import { DebateResult } from '@copilot-care/shared/types';
import { OrchestratorRunOptions } from '../ports/TriageOrchestratorPort';
import { ConfidenceCalibrator } from '../../domain/governance/calibration/ConfidenceCalibrator';
import { BaselineGuard } from '../../domain/governance/guards/BaselineGuard';
import { RiskAssessmentSnapshot } from './RuleFirstRiskAssessmentService';

export interface GovernanceReviewOutcome {
  debateResult: DebateResult;
  notes: string[];
}

interface GovernanceReviewServiceOptions {
  baselineGuard?: BaselineGuard;
  confidenceCalibrator?: ConfidenceCalibrator;
}

export class GovernanceReviewService {
  private readonly baselineGuard: BaselineGuard;
  private readonly confidenceCalibrator: ConfidenceCalibrator;

  constructor(options: GovernanceReviewServiceOptions = {}) {
    this.baselineGuard = options.baselineGuard ?? new BaselineGuard();
    this.confidenceCalibrator =
      options.confidenceCalibrator ?? new ConfidenceCalibrator();
  }

  public apply(
    result: DebateResult,
    risk: RiskAssessmentSnapshot,
    options?: Pick<OrchestratorRunOptions, 'onReasoningStep'>,
  ): GovernanceReviewOutcome {
    if (!result.finalConsensus) {
      return {
        debateResult: result,
        notes: [],
      };
    }

    const governanceNotes: string[] = [];
    let governedResult: DebateResult = result;

    const calibration = this.confidenceCalibrator.calibrate(
      result.finalConsensus,
    );
    if (calibration.abstain) {
      governedResult = {
        ...result,
        status: 'ABSTAIN',
        errorCode: 'ERR_LOW_CONFIDENCE_ABSTAIN',
        finalConsensus: undefined,
      };
      governanceNotes.push(`[置信度校准] 拒答：${calibration.reason}`);
      options?.onReasoningStep?.(`置信度校准未通过：${calibration.reason}`);
    } else {
      governedResult = {
        ...result,
        finalConsensus: {
          ...result.finalConsensus,
          confidence: calibration.calibratedConfidence,
        },
      };
      governanceNotes.push(`[置信度校准] 通过：${calibration.reason}`);
    }

    if (governedResult.status !== 'OUTPUT' || !governedResult.finalConsensus) {
      return {
        debateResult: governedResult,
        notes: governanceNotes,
      };
    }

    const baselineCheck = this.baselineGuard.check(
      governedResult.finalConsensus,
      risk.riskLevel,
    );
    if (!baselineCheck.conflictFlag) {
      return {
        debateResult: governedResult,
        notes: governanceNotes,
      };
    }

    governanceNotes.push(`[基线守护] 发现冲突：${baselineCheck.conflictReason}`);
    options?.onReasoningStep?.(`基线守护触发：${baselineCheck.conflictReason}`);

    if (baselineCheck.mitigationAction === 'force_rule') {
      governedResult = {
        ...governedResult,
        finalConsensus: {
          ...governedResult.finalConsensus,
          riskLevel: baselineCheck.ruleRiskLevel,
        },
      };
      governanceNotes.push(
        `[基线守护] 已强制执行规则基线：${baselineCheck.ruleRiskLevel}`,
      );
    }

    return {
      debateResult: governedResult,
      notes: governanceNotes,
    };
  }
}
