// Core data contracts for CoPilot Care.

export interface VitalSigns {
  systolicBP?: number;
  diastolicBP?: number;
  heartRate?: number;
  spo2?: number;
  bloodGlucose?: number;
  bloodLipid?: number;
}

export interface HealthSignal {
  timestamp: string;
  source: 'wearable' | 'manual' | 'hospital';
  systolicBP?: number;
  diastolicBP?: number;
  heartRate?: number;
  spo2?: number;
  bloodGlucose?: number;
  bloodLipid?: number;
}

export interface PatientProfile {
  patientId: string;
  name?: string;
  age: number;
  sex: 'male' | 'female' | 'other';
  chiefComplaint?: string;
  symptoms?: string[];
  chronicDiseases: string[];
  medicationHistory: string[];
  allergyHistory?: string[];
  lifestyleTags?: string[];
  vitals?: VitalSigns;
  tcmConstitution?: string;
}

export interface TriageRequest {
  requestId?: string;
  profile: PatientProfile;
  signals?: HealthSignal[];
  symptomText?: string;
  contextVersion?: string;
  consentToken?: string;
  sessionId?: string;
}

export type RiskLevel = 'L0' | 'L1' | 'L2' | 'L3';

export type TriageLevel = 'emergency' | 'urgent' | 'routine' | 'followup';

export type DissentThresholdBand =
  | 'CONSENSUS'
  | 'LIGHT_DEBATE'
  | 'DEEP_DEBATE'
  | 'ESCALATE';

export type ThresholdBand = '一致' | '轻度分歧' | '显著分歧' | '严重分歧';

export interface DissentComputation {
  dissonance: number;
  clinicalSignificance: number;
  dissentIndex: number;
  thresholdBand: ThresholdBand;
}

export interface RiskTrajectoryPoint {
  timestamp: string;
  riskScore: number;
  riskLevel: RiskLevel;
  keyDriver: string;
}

export type ErrorCode =
  | 'ERR_MISSING_REQUIRED_DATA'
  | 'ERR_INVALID_VITAL_SIGN'
  | 'ERR_LOW_CONFIDENCE_ABSTAIN'
  | 'ERR_CONFLICT_UNRESOLVED'
  | 'ERR_ESCALATE_TO_OFFLINE'
  | 'ERR_GUIDELINE_EVIDENCE_MISSING'
  | 'ERR_ADVERSARIAL_PROMPT_DETECTED';

export type TriageBlockingReasonCode =
  | 'VALIDATION_BLOCKED'
  | 'EVIDENCE_INTEGRITY_GATE_BLOCKED'
  | 'RED_FLAG_SHORT_CIRCUIT'
  | 'SAFETY_GUARD_BLOCKED'
  | 'RUNTIME_FAILURE_BLOCKED';

export interface TriageBlockingReason {
  code: TriageBlockingReasonCode;
  title: string;
  summary: string;
  triggerStage: WorkflowStage;
  severity: 'warning' | 'high' | 'critical';
  actions: string[];
  detail?: string;
}

export type TriageStatus =
  | 'OUTPUT'
  | 'ESCALATE_TO_OFFLINE'
  | 'ABSTAIN'
  | 'ERROR';

export type TriageRouteMode =
  | 'FAST_CONSENSUS'
  | 'LIGHT_DEBATE'
  | 'DEEP_DEBATE'
  | 'ESCALATE_TO_OFFLINE';

export type TriageDepartment =
  | 'cardiology'
  | 'generalPractice'
  | 'metabolic'
  | 'multiDisciplinary';

export type TriageCollaborationMode =
  | 'SINGLE_SPECIALTY_PANEL'
  | 'MULTI_DISCIPLINARY_CONSULT'
  | 'OFFLINE_ESCALATION';

export interface TriageRoutingInfo {
  complexityScore: number;
  routeMode: TriageRouteMode;
  department: TriageDepartment;
  collaborationMode: TriageCollaborationMode;
  reasons: string[];
  factorContributions?: RoutingFactorContribution[];
}

export interface RoutingFactorContribution {
  factor: string;
  score: number;
  rationale: string;
}

export type GovernanceRuleLayer =
  | 'BASIC_SAFETY'
  | 'FLOW_CONTROL'
  | 'INTELLIGENT_COLLABORATION'
  | 'OPERATIONS';

export type GovernanceLayerDecisionStatus =
  | 'pass'
  | 'warn'
  | 'fail'
  | 'escalated'
  | 'blocked';

export interface GovernanceLayerDecision {
  layer: GovernanceRuleLayer;
  status: GovernanceLayerDecisionStatus;
  summary: string;
  matchedRuleIds?: string[];
}

export interface RuleGovernanceSnapshot {
  catalogVersion: string;
  synonymSetVersion?: string;
  matchedRuleIds: string[];
  guidelineRefs: string[];
  layerDecisions: GovernanceLayerDecision[];
  evidenceTraceId: string;
}

export type ReviewCaseStatus =
  | 'pending'
  | 'reviewing'
  | 'approved'
  | 'rejected';

export type ReviewDecisionOutcome =
  | 'approve'
  | 'reject'
  | 'request_changes';

export interface ReviewDecision {
  decision: ReviewDecisionOutcome;
  reviewerId?: string;
  note?: string;
  decidedAt: string;
}

export interface ReviewCase {
  caseId: string;
  requestId?: string;
  sessionId?: string;
  patientId: string;
  triggerOutcome: TriageStatus;
  errorCode?: ErrorCode;
  summary: string;
  nextAction?: string;
  triageLevel?: TriageLevel;
  destination?: string;
  auditRef?: string;
  status: ReviewCaseStatus;
  createdAt: string;
  updatedAt: string;
  decision?: ReviewDecision;
}

export interface CaseTimelineEvent {
  eventId: string;
  caseId: string;
  kind: 'created' | 'status_changed' | 'decision_recorded';
  actor: string;
  detail: string;
  timestamp: string;
}

export interface CaseTimeline {
  caseId: string;
  patientId: string;
  events: CaseTimelineEvent[];
}

export interface RuleVersionBinding {
  scope: 'global' | 'site_override';
  catalogVersion: string;
  synonymSetVersion?: string;
  routingPolicyVersion?: string;
  boundAt: string;
  boundBy?: string;
}

export type AuditSubscriptionChannel =
  | 'webhook'
  | 'email'
  | 'dashboard';

export interface AuditSubscription {
  subscriptionId: string;
  siteId: string;
  name: string;
  eventTypes: string[];
  channel: AuditSubscriptionChannel;
  endpoint: string;
  secretRef?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SiteGovernancePolicy {
  siteId: string;
  displayName: string;
  thresholds: {
    fastConsensusMax: number;
    lightDebateMax: number;
    deepDebateMin: number;
  };
  ruleVersionBinding: RuleVersionBinding;
  auditSubscriptions: AuditSubscription[];
  updatedAt: string;
  updatedBy?: string;
}

export type InteropJobStatus =
  | 'queued'
  | 'running'
  | 'retrying'
  | 'succeeded'
  | 'failed';

export interface InteropRetryPolicy {
  maxRetries: number;
  retryDelayMs: number;
  retryableErrorCodes: string[];
}

export interface InteropJobAttempt {
  attempt: number;
  startedAt: string;
  finishedAt?: string;
  status: 'succeeded' | 'failed';
  errorCode?: string;
  message?: string;
  retriable?: boolean;
}

export interface InteropJobResult {
  generatedAt: string;
  sessionId: string;
  triageStatus: TriageStatus;
  resourceCounts: {
    patient: number;
    observation: number;
    provenance: number;
  };
  bundleIdentifier: string;
}

export interface InteropJob {
  jobId: string;
  requestId?: string;
  patientId: string;
  status: InteropJobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  attempts: number;
  retryPolicy: InteropRetryPolicy;
  nextRetryAt?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  history: InteropJobAttempt[];
  result?: InteropJobResult;
}

export interface StructuredTriageResult {
  patientId: string;
  triageLevel: TriageLevel;
  destination: string;
  followupDays: number;
  educationAdvice: string[];
  tcmAdvice?: string[];
  riskTrajectory?: RiskTrajectoryPoint[];
  dissent?: DissentComputation;
}

export type ExplainableEvidenceCategory =
  | 'authoritative_web'
  | 'guideline_rule'
  | 'model_citation';

export interface ExplainableEvidenceCard {
  id: string;
  category: ExplainableEvidenceCategory;
  title: string;
  summary: string;
  sourceId?: string;
  sourceName?: string;
  publishedOn?: string;
  retrievedAt?: string;
  url?: string;
  supportsRuleIds?: string[];
}

export interface ExplainableReport {
  conclusion: string;
  evidence: string[];
  evidenceCards?: ExplainableEvidenceCard[];
  basis: string[];
  actions: string[];
  counterfactual?: string[];
}

export interface AuthoritativeSearchSourceBreakdownItem {
  sourceId: string;
  count: number;
}

export type AuthoritativeSearchWeakestStage =
  | 'intent_understanding'
  | 'retrieval'
  | 'evidence_selection'
  | 'summarization'
  | 'none';

export interface AuthoritativeSearchQualityDiagnostics {
  intentUnderstandingScore: number;
  retrievalCoverageScore: number;
  evidenceSelectionScore: number;
  summarizationReadabilityScore: number;
  weakestStage: AuthoritativeSearchWeakestStage;
  optimizationHints: string[];
}

export interface AuthoritativeSearchDiagnostics {
  query: string;
  queryVariants: string[];
  strategyVersion: string;
  usedSources: string[];
  sourceBreakdown: AuthoritativeSearchSourceBreakdownItem[];
  realtimeCount: number;
  fallbackCount: number;
  droppedByPolicy: number;
  fallbackReasons?: string[];
  missingRequiredSources?: string[];
  requiredSources?: string[];
  minEvidenceCount?: number;
  decomposedNeeds?: string[];
  professionalRestatement?: string;
  activatedSkills?: string[];
  quality?: AuthoritativeSearchQualityDiagnostics;
}

export type WorkflowStage =
  | 'START'
  | 'INFO_GATHER'
  | 'RISK_ASSESS'
  | 'ROUTING'
  | 'DEBATE'
  | 'CONSENSUS'
  | 'REVIEW'
  | 'OUTPUT'
  | 'ESCALATION';

export interface WorkflowStageTrace {
  stage: WorkflowStage;
  status: 'done' | 'failed' | 'skipped';
  detail: string;
  timestamp: string;
}

export interface ProvenanceRecord {
  referenceType: 'guideline' | 'rule' | 'audit';
  referenceId: string;
  description: string;
}

export interface AuditEvent {
  eventId: string;
  sessionId: string;
  timestamp: string;
  phase:
    | 'INPUT_VALIDATION'
    | 'RISK_EVALUATION'
    | 'DI_CALCULATION'
    | 'ARBITRATION'
    | 'OUTPUT'
    | 'ESCALATION'
    | 'INFO_GATHER'
    | 'RISK_ASSESS'
    | 'DISSENT_CALC'
    | 'DEBATE'
    | 'CONSENSUS'
    | 'REVIEW'
    | 'ROUTING';
  eventType:
    | 'ROUND_STARTED'
    | 'ROUND_COMPLETED'
    | 'BAND_SELECTED'
    | 'ERROR_RAISED'
    | 'FINALIZED'
    | 'STAGE_TRANSITION';
  details: string;
  actor?: string;
  action?: string;
  decisionRef?: string;
  provenance?: ProvenanceRecord[];
}

export interface AgentOpinion {
  agentId: string;
  agentName: string;
  role: 'Specialist' | 'Generalist' | 'Safety' | 'Metabolic' | 'TCM';
  riskLevel: RiskLevel;
  confidence: number;
  reasoning: string;
  citations: string[];
  actions: string[];
}

export interface DebateRound {
  roundNumber: number;
  opinions: AgentOpinion[];
  dissentIndex: number;
  dissentBand: DissentThresholdBand;
  moderatorSummary?: string;
}

export interface DebateSession {
  sessionId: string;
  patientId: string;
  rounds: DebateRound[];
  finalConsensus?: AgentOpinion;
  dissentIndexHistory: number[];
  auditTrail: AuditEvent[];
}

export interface DebateResult {
  sessionId: string;
  requestId?: string;
  auditRef?: string;
  status: TriageStatus;
  rounds: DebateRound[];
  finalConsensus?: AgentOpinion;
  routing?: TriageRoutingInfo;
  triageResult?: StructuredTriageResult;
  explainableReport?: ExplainableReport;
  authoritativeSearch?: AuthoritativeSearchDiagnostics;
  workflowTrace?: WorkflowStageTrace[];
  dissentIndexHistory: number[];
  errorCode?: ErrorCode;
  requiredFields?: string[];
  blockingReason?: TriageBlockingReason;
  nextAction?: string;
  ruleGovernance?: RuleGovernanceSnapshot;
  notes: string[];
  auditTrail: AuditEvent[];
}

export interface TriageErrorResponse {
  status: 'ERROR';
  errorCode: ErrorCode;
  notes: string[];
  authoritativeSearch?: AuthoritativeSearchDiagnostics;
  requiredFields?: string[];
  blockingReason?: TriageBlockingReason;
  nextAction?: string;
  auditRef?: string;
  ruleGovernance?: RuleGovernanceSnapshot;
}

export type TriageApiResponse = DebateResult | TriageErrorResponse;

export type TriageStreamStageStatus =
  | 'pending'
  | 'running'
  | 'blocked'
  | 'done'
  | 'failed'
  | 'skipped';

export type OrchestrationTaskStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'blocked';

export interface OrchestrationTask {
  taskId: string;
  roleId: string;
  roleName: string;
  objective: string;
  status: OrchestrationTaskStatus;
  progress: number;
  latestUpdate?: string;
  parentTaskId?: string;
  subTasks?: OrchestrationTask[];
  provider?: string;
  startTime?: string;
  endTime?: string;
  dependencies?: string[];
}

export type OrchestrationGraphNodeKind =
  | 'input'
  | 'stage'
  | 'decision'
  | 'evidence'
  | 'risk'
  | 'output'
  | 'agent';

export interface OrchestrationGraphNode {
  id: string;
  label: string;
  kind: OrchestrationGraphNodeKind;
  detail?: string;
  color?: string;
  emphasis?: number;
}

export interface OrchestrationGraphEdge {
  source: string;
  target: string;
  label?: string;
  style?: 'solid' | 'dashed';
  weight?: number;
}

export interface OrchestrationGraphSpec {
  nodes: OrchestrationGraphNode[];
  edges: OrchestrationGraphEdge[];
}

export interface OrchestrationSnapshot {
  coordinator: string;
  phase: 'assignment' | 'analysis' | 'execution' | 'synthesis' | 'complete';
  summary: string;
  tasks: OrchestrationTask[];
  graph: OrchestrationGraphSpec;
  generatedAt: string;
  source: 'model' | 'rule';
}

export type ThinkStepKind =
  | 'intent_understanding'
  | 'task_decomposition'
  | 'agent_dispatch'
  | 'parallel_execution'
  | 'result_aggregation'
  | 'decision_synthesis';

export interface ThinkStep {
  stepId: string;
  kind: ThinkStepKind;
  title: string;
  description: string;
  agentName?: string;
  provider?: string;
  status: OrchestrationTaskStatus;
  progress: number;
  timestamp: string;
  inputs?: string[];
  outputs?: string[];
  subSteps?: ThinkStep[];
}

export type TriageStreamEvent =
  | {
      type: 'stage_update';
      timestamp: string;
      stage: WorkflowStage;
      status: TriageStreamStageStatus;
      message: string;
    }
  | {
      type: 'reasoning_step';
      timestamp: string;
      message: string;
    }
  | {
      type: 'orchestration_snapshot';
      timestamp: string;
      snapshot: OrchestrationSnapshot;
    }
  | {
      type: 'clarification_request';
      timestamp: string;
      question: string;
      requiredFields: string[];
      nextAction?: string;
    }
  | {
      type: 'token';
      timestamp: string;
      token: string;
    }
  | {
      type: 'final_result';
      timestamp: string;
      result: TriageApiResponse;
    }
  | {
      type: 'error';
      timestamp: string;
      errorCode: ErrorCode;
      message: string;
      requiredFields?: string[];
      blockingReason?: TriageBlockingReason;
      nextAction?: string;
    }
  | {
      type: 'heartbeat';
      timestamp: string;
      message?: string;
    };
