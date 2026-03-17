import { AgentBase } from '../agents/AgentBase';
import {
  AgentOpinion,
  AuditEvent,
  DebateResult,
  DebateRound,
  DissentThresholdBand,
  ErrorCode,
  PatientProfile,
} from '@copilot-care/shared/types';
import { evaluateEmergencySignalSnapshot } from '../domain/rules/AuthoritativeMedicalRuleCatalog';

export interface DebateRuntimeHooks {
  onRoundStarted?: (roundNumber: number) => void;
  onRoundCompleted?: (round: DebateRound) => void;
}

export class DebateEngine {
  private agents: AgentBase[];
  private maxRounds: number = 3;
  private readonly alpha: number = 0.7;
  private readonly beta: number = 0.3;
  private readonly thresholds = {
    consensus: 0.2,
    lightDebate: 0.4,
    deepDebate: 0.7,
  };

  constructor(
    agents: AgentBase[],
    options?: {
      maxRounds?: number;
    },
  ) {
    this.agents = agents;
    if (
      options &&
      typeof options.maxRounds === 'number' &&
      Number.isFinite(options.maxRounds) &&
      options.maxRounds > 0
    ) {
      this.maxRounds = Math.floor(options.maxRounds);
    }
  }

  private getRiskNumeric(level: AgentOpinion['riskLevel']): number {
    const mapping: Record<AgentOpinion['riskLevel'], number> = {
      L0: 0,
      L1: 1,
      L2: 2,
      L3: 3,
    };
    return mapping[level];
  }

  private normalize(value: number, min: number, max: number): number {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      return min;
    }
    return Math.min(max, Math.max(min, value));
  }

  private calculateRiskDisagreement(opinions: AgentOpinion[]): number {
    if (opinions.length === 0) {
      return 0;
    }

    const values = opinions.map((opinion) => this.getRiskNumeric(opinion.riskLevel));
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance =
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(variance);

    return this.normalize(stdDev / 1.5, 0, 1);
  }

  private calculateConfidenceDisagreement(opinions: AgentOpinion[]): number {
    if (opinions.length === 0) {
      return 0;
    }

    const values = opinions.map((opinion) =>
      this.normalize(opinion.confidence, 0, 1),
    );
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance =
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(variance);

    return this.normalize(stdDev / 0.35, 0, 1);
  }

  private tokenizeActions(actions: string[]): Set<string> {
    return new Set(
      actions
        .join(' ')
        .toLowerCase()
        .replace(/[，。；:：,./\\\-_\s()（）[\]【】]/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length >= 2),
    );
  }

  private calculateActionDisagreement(opinions: AgentOpinion[]): number {
    if (opinions.length <= 1) {
      return 0;
    }

    const actionSets = opinions.map((opinion) => this.tokenizeActions(opinion.actions));
    let totalDistance = 0;
    let pairCount = 0;

    for (let left = 0; left < actionSets.length; left += 1) {
      for (let right = left + 1; right < actionSets.length; right += 1) {
        const leftSet = actionSets[left];
        const rightSet = actionSets[right];
        const union = new Set([...leftSet, ...rightSet]);
        if (union.size === 0) {
          pairCount += 1;
          continue;
        }
        let intersectionSize = 0;
        for (const token of leftSet) {
          if (rightSet.has(token)) {
            intersectionSize += 1;
          }
        }
        const jaccardSimilarity = intersectionSize / union.size;
        totalDistance += 1 - jaccardSimilarity;
        pairCount += 1;
      }
    }

    if (pairCount === 0) {
      return 0;
    }
    return this.normalize(totalDistance / pairCount, 0, 1);
  }

  private calculateDisagreement(opinions: AgentOpinion[]): {
    risk: number;
    confidence: number;
    action: number;
    score: number;
  } {
    const risk = this.calculateRiskDisagreement(opinions);
    const confidence = this.calculateConfidenceDisagreement(opinions);
    const action = this.calculateActionDisagreement(opinions);
    const score = this.normalize(
      0.75 * risk + 0.15 * confidence + 0.1 * action,
      0,
      1,
    );

    return {
      risk,
      confidence,
      action,
      score,
    };
  }

  private calculateClinicalSignificance(opinions: AgentOpinion[]): number {
    if (opinions.length === 0) {
      return 0;
    }

    const values = opinions.map((opinion) => this.getRiskNumeric(opinion.riskLevel));
    const spread = Math.max(...values) - Math.min(...values);
    const hasL3 = values.some((value) => value >= 3);

    const escalationPattern =
      /(urgent|escalat|offline|referr|emergency|线下|上转|升级|急诊|尽快就医)/i;
    const conservativePattern =
      /(monitor|follow-up|lifestyle|observe|随访|观察|生活方式|复查)/i;

    const escalationVotes = opinions.some((opinion) =>
      opinion.actions.some((action) => escalationPattern.test(action)),
    );
    const conservativeVotes = opinions.some((opinion) =>
      opinion.actions.some((action) => conservativePattern.test(action)),
    );
    const directionConflict = escalationVotes && conservativeVotes;

    let significance = 0;
    if (spread >= 2) {
      significance += 0.5;
    }
    if (directionConflict) {
      significance += 0.3;
    }
    if (hasL3) {
      significance += 0.2;
    }

    return this.normalize(significance, 0, 1);
  }

  private calculateDissent(opinions: AgentOpinion[]): {
    index: number;
    disagreement: number;
    riskDisagreement: number;
    confidenceDisagreement: number;
    actionDisagreement: number;
    clinicalSignificance: number;
  } {
    const disagreementBreakdown = this.calculateDisagreement(opinions);
    const clinicalSignificance = this.calculateClinicalSignificance(opinions);
    const disagreement = disagreementBreakdown.score;
    const index = this.normalize(
      this.alpha * disagreement + this.beta * clinicalSignificance,
      0,
      1,
    );

    return {
      index,
      disagreement,
      riskDisagreement: disagreementBreakdown.risk,
      confidenceDisagreement: disagreementBreakdown.confidence,
      actionDisagreement: disagreementBreakdown.action,
      clinicalSignificance,
    };
  }

  private getBand(dissentIndex: number): DissentThresholdBand {
    if (dissentIndex < this.thresholds.consensus) {
      return 'CONSENSUS';
    }
    if (dissentIndex < this.thresholds.lightDebate) {
      return 'LIGHT_DEBATE';
    }
    if (dissentIndex < this.thresholds.deepDebate) {
      return 'DEEP_DEBATE';
    }
    return 'ESCALATE';
  }

  private createAuditEvent(
    sessionId: string,
    phase: AuditEvent['phase'],
    eventType: AuditEvent['eventType'],
    details: string,
    provenance: AuditEvent['provenance'] = [],
  ): AuditEvent {
    return {
      eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      timestamp: new Date().toISOString(),
      phase,
      eventType,
      details,
      provenance,
    };
  }

  private selectConsensus(opinions: AgentOpinion[]): AgentOpinion | undefined {
    if (opinions.length === 0) {
      return undefined;
    }

    const scored = opinions.map((opinion) => {
      const guidelineFit = opinion.citations.length > 0 ? 1 : 0.5;
      const confidenceScore = this.normalize(opinion.confidence, 0, 1);
      const safetyPriority = this.normalize(
        this.getRiskNumeric(opinion.riskLevel) / 3,
        0,
        1,
      );
      const consensusScore =
        0.5 * guidelineFit + 0.3 * confidenceScore + 0.2 * safetyPriority;
      return { opinion, consensusScore };
    });

    scored.sort((a, b) => b.consensusScore - a.consensusScore);
    return scored[0].opinion;
  }

  private validateInput(profile: PatientProfile): ErrorCode | undefined {
    if (!profile.patientId || !profile.sex || !Number.isFinite(profile.age)) {
      return 'ERR_MISSING_REQUIRED_DATA';
    }
    if (
      !Array.isArray(profile.chronicDiseases) ||
      !Array.isArray(profile.medicationHistory)
    ) {
      return 'ERR_MISSING_REQUIRED_DATA';
    }
    if (
      profile.vitals?.systolicBP !== undefined &&
      profile.vitals?.diastolicBP !== undefined &&
      profile.vitals.systolicBP <= profile.vitals.diastolicBP
    ) {
      return 'ERR_INVALID_VITAL_SIGN';
    }
    return undefined;
  }

  private hasRedFlag(profile: PatientProfile): boolean {
    return evaluateEmergencySignalSnapshot(profile).immediateEmergency;
  }

  private buildInitialResult(
    sessionId: string,
    status: DebateResult['status'],
    errorCode: ErrorCode,
    notes: string,
  ): DebateResult {
    const auditTrail = [
      this.createAuditEvent(
        sessionId,
        'INPUT_VALIDATION',
        'ERROR_RAISED',
        `${errorCode}: ${notes}`,
      ),
    ];

    return {
      sessionId,
      status,
      rounds: [],
      dissentIndexHistory: [],
      errorCode,
      notes: [notes],
      auditTrail,
    };
  }

  public async runSession(
    profile: PatientProfile,
    sessionId: string = `sess_${Date.now()}`,
    hooks?: DebateRuntimeHooks,
  ): Promise<DebateResult> {
    const history: DebateRound[] = [];
    const auditTrail: AuditEvent[] = [];
    const notes: string[] = [];

    const validationError = this.validateInput(profile);
    if (validationError) {
      return this.buildInitialResult(
        sessionId,
        'ERROR',
        validationError,
        'Input validation failed.',
      );
    }

    if (this.hasRedFlag(profile)) {
      return this.buildInitialResult(
        sessionId,
        'ESCALATE_TO_OFFLINE',
        'ERR_ESCALATE_TO_OFFLINE',
        'Emergency red-flag detected; immediate offline escalation required.',
      );
    }

    let context = 'initial assessment';
    const dissentIndexHistory: number[] = [];

    for (let round = 1; round <= this.maxRounds; round++) {
      hooks?.onRoundStarted?.(round);
      auditTrail.push(
        this.createAuditEvent(
          sessionId,
          'RISK_EVALUATION',
          'ROUND_STARTED',
          `Round ${round} started.`,
        ),
      );

      const opinions = await Promise.all(
        this.agents.map((agent) => agent.think(profile, context)),
      );

      const dissent = this.calculateDissent(opinions);
      const band = this.getBand(dissent.index);
      dissentIndexHistory.push(dissent.index);

      auditTrail.push(
        this.createAuditEvent(
          sessionId,
          'DI_CALCULATION',
          'ROUND_COMPLETED',
          `Round ${round}: DI=${dissent.index.toFixed(3)}, disagreement=${dissent.disagreement.toFixed(3)} (risk=${dissent.riskDisagreement.toFixed(3)}, confidence=${dissent.confidenceDisagreement.toFixed(3)}, action=${dissent.actionDisagreement.toFixed(3)}), clinical=${dissent.clinicalSignificance.toFixed(3)}.`,
          [
            {
              referenceType: 'rule',
              referenceId: 'DI_ALPHA_BETA',
              description: `alpha=${this.alpha}, beta=${this.beta}`,
            },
          ],
        ),
      );

      const roundResult: DebateRound = {
        roundNumber: round,
        opinions,
        dissentIndex: dissent.index,
        dissentBand: band,
        moderatorSummary: `Band=${band}, DI=${dissent.index.toFixed(3)}`,
      };
      history.push(roundResult);
      hooks?.onRoundCompleted?.(roundResult);

      auditTrail.push(
        this.createAuditEvent(
          sessionId,
          'ARBITRATION',
          'BAND_SELECTED',
          `Round ${round} arbitration selected band ${band}.`,
          [
            {
              referenceType: 'guideline',
              referenceId: 'DI_THRESHOLDS',
              description:
                '<0.2 consensus, 0.2-0.4 light, 0.4-0.7 deep, >=0.7 escalate',
            },
          ],
        ),
      );

      const lowConfidence = opinions.every((opinion) => opinion.confidence < 0.7);
      if (lowConfidence) {
        notes.push('All opinions are below confidence threshold 0.7.');
        return {
          sessionId,
          status: 'ABSTAIN',
          rounds: history,
          finalConsensus: undefined,
          dissentIndexHistory,
          errorCode: 'ERR_LOW_CONFIDENCE_ABSTAIN',
          notes,
          auditTrail,
        };
      }

      if (band === 'CONSENSUS') {
        const finalConsensus = this.selectConsensus(opinions);
        auditTrail.push(
          this.createAuditEvent(
            sessionId,
            'OUTPUT',
            'FINALIZED',
            `Consensus reached at round ${round}.`,
          ),
        );
        return {
          sessionId,
          status: 'OUTPUT',
          rounds: history,
          finalConsensus,
          dissentIndexHistory,
          notes,
          auditTrail,
        };
      }

      if (band === 'LIGHT_DEBATE' && round >= 2) {
        const finalConsensus = this.selectConsensus(opinions);
        notes.push('Light disagreement converged after one extra round.');
        auditTrail.push(
          this.createAuditEvent(
            sessionId,
            'OUTPUT',
            'FINALIZED',
            `Light-debate convergence completed at round ${round}.`,
          ),
        );
        return {
          sessionId,
          status: 'OUTPUT',
          rounds: history,
          finalConsensus,
          dissentIndexHistory,
          notes,
          auditTrail,
        };
      }

      if (band === 'ESCALATE') {
        notes.push('High disagreement detected; conservative offline escalation.');
        return {
          sessionId,
          status: 'ESCALATE_TO_OFFLINE',
          rounds: history,
          finalConsensus: undefined,
          dissentIndexHistory,
          errorCode: 'ERR_ESCALATE_TO_OFFLINE',
          notes,
          auditTrail,
        };
      }

      context = `previous conflicting opinions: ${JSON.stringify(opinions)}`;
    }

    notes.push('Maximum rounds reached without convergence.');
    auditTrail.push(
      this.createAuditEvent(
        sessionId,
        'ESCALATION',
        'ERROR_RAISED',
        'Maximum rounds reached without consensus.',
      ),
    );

    return {
      sessionId,
      status: 'ABSTAIN',
      rounds: history,
      finalConsensus: undefined,
      dissentIndexHistory,
      errorCode: 'ERR_CONFLICT_UNRESOLVED',
      notes,
      auditTrail,
    };
  }

  public async runDebate(profile: PatientProfile): Promise<DebateRound[]> {
    const result = await this.runSession(profile);
    return result.rounds;
  }
}
