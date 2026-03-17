import { Request, Response, Router } from 'express';
import {
  AuditSubscriptionChannel,
  DebateResult,
  ErrorCode,
  OrchestrationSnapshot,
  ReviewCase,
  ReviewDecision,
  RuleGovernanceSnapshot,
  TriageApiResponse,
  TriageBlockingReason,
  TriageErrorResponse,
  TriageRequest,
  TriageStatus,
  TriageStreamEvent,
  TriageStreamStageStatus,
  WorkflowStage,
  RuleVersionBinding,
  ReviewCaseStatus,
  ReviewDecisionOutcome,
  SiteGovernancePolicy,
} from '@copilot-care/shared/types';
import { RequestValidationError } from '../../application/errors/RequestValidationError';
import { AuthoritativeMedicalSearchPort } from '../../application/ports/AuthoritativeMedicalSearchPort';
import { resolveNextAction } from '../../application/services/FlowControlNextActionService';
import { buildValidationErrorGovernanceSnapshot } from '../../application/services/RuleGovernanceService';
import { RunTriageSessionUseCase } from '../../application/usecases/RunTriageSessionUseCase';
import { listAuthoritativeMedicalSources } from '../../domain/knowledge/AuthoritativeMedicalKnowledgeCatalog';
import {
  AUTHORITATIVE_GUIDELINE_REFERENCES,
  AUTHORITATIVE_RULE_CATALOG_VERSION,
  LAYERED_RULE_DESCRIPTORS,
  RED_FLAG_SYNONYM_SET_VERSION,
} from '../../domain/rules/AuthoritativeMedicalRuleCatalog';
import {
  CoordinatorSnapshotContext,
  CoordinatorSnapshotService,
} from '../../infrastructure/orchestration/CoordinatorSnapshotService';
import { GovernanceRuntimeTelemetry } from '../../infrastructure/governance/GovernanceRuntimeTelemetry';
import { GovernanceReviewQueueService } from '../../infrastructure/governance/GovernanceReviewQueueService';
import { SiteGovernancePolicyService } from '../../infrastructure/governance/SiteGovernancePolicyService';
import { resolveBackendExposurePolicy } from '../../config/runtimePolicy';

interface RuntimeArchitectureView {
  experts: Record<
    string,
    {
      provider: string;
      source: string;
      llmEnabled: boolean;
      envKey: string;
    }
  >;
  routing?: {
    policyVersion: string;
    strictDiagnosisMode?: boolean;
    fallbackCitationMarker?: string;
    complexityThresholds: {
      fastConsensusMax: number;
      lightDebateMax: number;
      deepDebateMin: number;
    };
    panelProviders: Record<
      string,
      Array<{
        provider: string;
        model?: string;
        llmEnabled: boolean;
      }>
    >;
  };
}

interface SnapshotStageState {
  status: TriageStreamStageStatus;
  message: string;
}

type SnapshotStageRuntime = Record<WorkflowStage, SnapshotStageState>;

const MODEL_SNAPSHOT_MIN_INTERVAL_MS = 8000;
const MODEL_SNAPSHOT_TICK_MS = 10000;
const MEDICAL_SEARCH_QUERY_MAX_LENGTH = 240;
const MEDICAL_SEARCH_SOURCE_LIST_MAX = 8;
const TRIAGE_PROTECTED_ROUTE_PREFIXES = [
  '/orchestrate_triage',
  '/governance',
  '/architecture',
  '/patients',
] as const;
const REVIEW_CASE_STATUSES: ReadonlySet<ReviewCaseStatus> = new Set([
  'pending',
  'reviewing',
  'approved',
  'rejected',
]);
const REVIEW_DECISION_OUTCOMES: ReadonlySet<ReviewDecisionOutcome> = new Set([
  'approve',
  'reject',
  'request_changes',
]);
const AUDIT_SUBSCRIPTION_CHANNELS: ReadonlySet<AuditSubscriptionChannel> = new Set(
  ['webhook', 'email', 'dashboard'],
);
const SITE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function normalizeBlockingActions(actions: string[]): string[] {
  return [...new Set(actions.map((item) => item.trim()).filter((item) => item.length > 0))];
}

function buildDefaultBlockingReason(
  errorCode: ErrorCode,
  message: string,
  requiredFields?: string[],
  nextAction?: string,
): TriageBlockingReason {
  const resolvedNextAction = nextAction ?? resolveNextAction({ errorCode, requiredFields });
  switch (errorCode) {
  case 'ERR_MISSING_REQUIRED_DATA':
  case 'ERR_INVALID_VITAL_SIGN':
    return {
      code: 'VALIDATION_BLOCKED',
      title: '输入校验未通过',
      summary: message,
      triggerStage: 'INFO_GATHER',
      severity: 'warning',
      actions: normalizeBlockingActions([
        requiredFields && requiredFields.length > 0
          ? `补充必要字段：${requiredFields.join('、')}`
          : '补充必要信息后重新提交会诊。',
        resolvedNextAction,
      ]),
      detail: `errorCode=${errorCode}`,
    };
  case 'ERR_GUIDELINE_EVIDENCE_MISSING':
    return {
      code: 'EVIDENCE_INTEGRITY_GATE_BLOCKED',
      title: '证据完整性门禁阻断自动输出',
      summary: message,
      triggerStage: 'REVIEW',
      severity: 'high',
      actions: normalizeBlockingActions([
        '进入人工复核队列并补齐权威证据来源（例如 WHO/NICE）。',
        resolvedNextAction,
      ]),
      detail: 'authoritative_evidence_completeness_gate_failed',
    };
  case 'ERR_ESCALATE_TO_OFFLINE':
    return {
      code: 'RED_FLAG_SHORT_CIRCUIT',
      title: '触发高风险短路并线下上转',
      summary: message,
      triggerStage: 'ESCALATION',
      severity: 'critical',
      actions: normalizeBlockingActions([
        resolvedNextAction,
        '通知线下接诊团队并保留审计轨迹。',
      ]),
      detail: 'offline_escalation_required',
    };
  case 'ERR_ADVERSARIAL_PROMPT_DETECTED':
    return {
      code: 'SAFETY_GUARD_BLOCKED',
      title: '安全审校阻断越界指令',
      summary: message,
      triggerStage: 'REVIEW',
      severity: 'critical',
      actions: normalizeBlockingActions([
        resolvedNextAction,
        '安排人工复核后再执行任何处置建议。',
      ]),
      detail: 'adversarial_or_unsafe_output_detected',
    };
  default:
    return {
      code: 'RUNTIME_FAILURE_BLOCKED',
      title: '运行异常导致流程终止',
      summary: message,
      triggerStage: 'REVIEW',
      severity: 'high',
      actions: normalizeBlockingActions([
        resolvedNextAction,
        '请检查后端日志并重试会诊流程。',
      ]),
      detail: `errorCode=${errorCode}`,
    };
  }
}

function buildErrorResponse(
  errorCode: ErrorCode,
  message: string,
  options?: {
    requiredFields?: string[];
    nextAction?: string;
    blockingReason?: TriageBlockingReason;
    auditRef?: string;
    ruleGovernance?: RuleGovernanceSnapshot;
    authoritativeSearch?: TriageErrorResponse['authoritativeSearch'];
  },
): TriageErrorResponse {
  const nextAction =
    options?.nextAction
    ?? resolveNextAction({
      errorCode,
      requiredFields: options?.requiredFields,
    });
  return {
    status: 'ERROR',
    errorCode,
    notes: [message],
    authoritativeSearch: options?.authoritativeSearch,
    requiredFields: options?.requiredFields,
    blockingReason:
      options?.blockingReason
      ?? buildDefaultBlockingReason(
        errorCode,
        message,
        options?.requiredFields,
        nextAction,
      ),
    nextAction,
    auditRef: options?.auditRef,
    ruleGovernance: options?.ruleGovernance,
  };
}

function toApiResponse(result: DebateResult): TriageApiResponse {
  if (result.status === 'ERROR') {
    return buildErrorResponse(
      result.errorCode ?? 'ERR_MISSING_REQUIRED_DATA',
      result.notes.join('；') || 'Request validation failed.',
      {
        requiredFields: result.requiredFields,
        blockingReason: result.blockingReason,
        nextAction: result.nextAction,
        auditRef: result.auditRef,
        ruleGovernance: result.ruleGovernance,
        authoritativeSearch: result.authoritativeSearch,
      },
    );
  }
  return result;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseSourceIdList(value: unknown): string[] {
  const rawValues: unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\s|]+/)
      : [];
  const normalized = rawValues
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toUpperCase())
    .filter((item) => item.length > 0);
  return [...new Set(normalized)];
}

function normalizeBearerToken(request: Request): string {
  const headerValue = request.header('authorization');
  if (typeof headerValue !== 'string') {
    return '';
  }
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return '';
  }
  return match[1].trim();
}

function isProtectedTriageRoute(pathname: string): boolean {
  return TRIAGE_PROTECTED_ROUTE_PREFIXES.some((prefix) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function parseReviewStatuses(value: unknown): ReviewCaseStatus[] | null {
  const rawValues: string[] = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : typeof value === 'string'
      ? value.split(/[,\s|]+/)
      : [];

  const parsed: ReviewCaseStatus[] = [];
  for (const rawValue of rawValues) {
    const normalized = rawValue.trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    if (!REVIEW_CASE_STATUSES.has(normalized as ReviewCaseStatus)) {
      return null;
    }
    parsed.push(normalized as ReviewCaseStatus);
  }
  return [...new Set(parsed)];
}

function normalizeSiteId(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim();
  if (!SITE_ID_PATTERN.test(normalized)) {
    return '';
  }
  return normalized;
}

function normalizeAuditEventTypes(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\s|]+/)
      : [];
  return [...new Set(
    rawValues
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().toUpperCase())
      .filter((item) => item.length > 0),
  )];
}

function normalizeOptionalString(
  value: unknown,
  maxLength: number,
): string | undefined | null {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length > maxLength) {
    return null;
  }
  return normalized;
}

function normalizeSiteThresholds(
  value: unknown,
): SiteGovernancePolicy['thresholds'] | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const rawFast = Number(candidate.fastConsensusMax ?? Number.NaN);
  const rawLight = Number(candidate.lightDebateMax ?? Number.NaN);
  const rawDeep = Number(candidate.deepDebateMin ?? Number.NaN);
  if (!Number.isFinite(rawFast) || !Number.isFinite(rawLight) || !Number.isFinite(rawDeep)) {
    return null;
  }
  const fastConsensusMax = Math.max(0, Math.min(10, Math.floor(rawFast)));
  const lightDebateMax = Math.max(1, Math.min(12, Math.floor(rawLight)));
  const deepDebateMin = Math.max(2, Math.min(15, Math.floor(rawDeep)));
  if (!(fastConsensusMax <= lightDebateMax && lightDebateMax < deepDebateMin)) {
    return null;
  }
  return {
    fastConsensusMax,
    lightDebateMax,
    deepDebateMin,
  };
}

function normalizeRuleVersionBinding(
  value: unknown,
): RuleVersionBinding | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const scope = candidate.scope === 'site_override' ? 'site_override' : 'global';
  const catalogVersion = normalizeOptionalString(candidate.catalogVersion, 80);
  if (catalogVersion === null || !catalogVersion) {
    return null;
  }
  const synonymSetVersion = normalizeOptionalString(
    candidate.synonymSetVersion,
    80,
  );
  if (synonymSetVersion === null) {
    return null;
  }
  const routingPolicyVersion = normalizeOptionalString(
    candidate.routingPolicyVersion,
    80,
  );
  if (routingPolicyVersion === null) {
    return null;
  }
  const boundBy = normalizeOptionalString(candidate.boundBy, 80);
  if (boundBy === null) {
    return null;
  }
  return {
    scope,
    catalogVersion,
    synonymSetVersion,
    routingPolicyVersion,
    boundAt: nowIso(),
    boundBy,
  };
}

type RuntimeSessionSummary =
  ReturnType<GovernanceRuntimeTelemetry['getSnapshot']>['recentSessions'][number];

type PatientCaseSource = 'runtime' | 'review_queue' | 'merged';

interface PatientCaseRecordView {
  caseId: string;
  requestId?: string;
  sessionId?: string;
  patientId: string;
  status: TriageStatus | 'ERROR';
  reviewStatus?: ReviewCaseStatus;
  summary: string;
  triageLevel?: string;
  destination?: string;
  department: string;
  routeMode?: string;
  complexityScore?: number;
  durationMs?: number;
  errorCode?: ErrorCode;
  startedAt: string;
  endedAt?: string;
  updatedAt: string;
  source: PatientCaseSource;
  decision?: ReviewDecision;
}

function parsePositiveLimit(
  value: unknown,
  fallback: number,
  max: number,
): number | null {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = Array.isArray(value) ? value[0] : value;
  const parsed =
    typeof normalized === 'number' ? normalized : Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

function mapRuntimeOutcomeToStatus(
  outcome: RuntimeSessionSummary['outcome'],
): PatientCaseRecordView['status'] | null {
  if (
    outcome === 'OUTPUT'
    || outcome === 'ESCALATE_TO_OFFLINE'
    || outcome === 'ABSTAIN'
    || outcome === 'ERROR'
  ) {
    return outcome;
  }
  return null;
}

function resolveDepartmentLabel(
  destination: string | undefined,
  routeMode: RuntimeSessionSummary['routeMode'] | undefined,
): string {
  if (destination && destination.trim()) {
    return destination.trim();
  }
  if (routeMode === 'FAST_CONSENSUS') {
    return '全科门诊';
  }
  if (routeMode === 'LIGHT_DEBATE' || routeMode === 'DEEP_DEBATE') {
    return '多学科会诊';
  }
  if (routeMode === 'ESCALATE_TO_OFFLINE') {
    return '线下转诊';
  }
  return '综合门诊';
}

function buildRuntimeCaseSummary(session: RuntimeSessionSummary): string {
  if (session.outcome === 'OUTPUT') {
    const triageLevel = formatTriageLevelLabel(session.triageLevel) || '未分级';
    const destination = formatDestinationLabel(session.destination) || '待明确去向';
    return `分诊完成：${triageLevel}，建议去向 ${destination}。`;
  }
  if (session.outcome === 'ESCALATE_TO_OFFLINE') {
    return '系统触发线下转诊，请尽快安排人工复核与上级医院衔接。';
  }
  if (session.outcome === 'ABSTAIN') {
    return '当前证据不足，需补充关键信息后重新会诊。';
  }
  if (session.errorCode) {
    return `会诊执行异常：${session.errorCode}。`;
  }
  return '会诊执行异常，请人工复核。';
}

function toPatientCaseFromRuntimeSession(
  session: RuntimeSessionSummary,
  reviewCase?: ReviewCase,
): PatientCaseRecordView | null {
  const status = mapRuntimeOutcomeToStatus(session.outcome);
  if (!status) {
    return null;
  }

  const destination = reviewCase?.destination ?? session.destination;
  const updatedAt = reviewCase?.updatedAt ?? session.endedAt ?? session.startedAt;
  return {
    caseId: reviewCase?.caseId ?? session.id,
    requestId: reviewCase?.requestId ?? session.requestId,
    sessionId: reviewCase?.sessionId ?? session.id,
    patientId: session.patientId,
    status,
    reviewStatus: reviewCase?.status,
    summary: reviewCase?.summary ?? buildRuntimeCaseSummary(session),
    triageLevel: reviewCase?.triageLevel ?? session.triageLevel,
    destination,
    department: resolveDepartmentLabel(destination, session.routeMode),
    routeMode: session.routeMode,
    complexityScore: session.complexityScore,
    durationMs: session.durationMs,
    errorCode: reviewCase?.errorCode ?? session.errorCode,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    updatedAt,
    source: reviewCase ? 'merged' : 'runtime',
    decision: reviewCase?.decision,
  };
}

function toPatientCaseFromReviewCase(reviewCase: ReviewCase): PatientCaseRecordView {
  return {
    caseId: reviewCase.caseId,
    requestId: reviewCase.requestId,
    sessionId: reviewCase.sessionId,
    patientId: reviewCase.patientId,
    status: reviewCase.triggerOutcome,
    reviewStatus: reviewCase.status,
    summary: reviewCase.summary,
    triageLevel: reviewCase.triageLevel,
    destination: reviewCase.destination,
    department: resolveDepartmentLabel(reviewCase.destination, undefined),
    errorCode: reviewCase.errorCode,
    startedAt: reviewCase.createdAt,
    updatedAt: reviewCase.updatedAt,
    source: 'review_queue',
    decision: reviewCase.decision,
  };
}

function buildPatientCasesView(
  patientId: string,
  runtimeSessions: RuntimeSessionSummary[],
  reviewCases: ReviewCase[],
): PatientCaseRecordView[] {
  const reviewByRequestId = new Map<string, ReviewCase>();
  const reviewBySessionId = new Map<string, ReviewCase>();
  const reviewByCaseId = new Map<string, ReviewCase>();

  for (const reviewCase of reviewCases) {
    if (reviewCase.requestId && !reviewByRequestId.has(reviewCase.requestId)) {
      reviewByRequestId.set(reviewCase.requestId, reviewCase);
    }
    if (reviewCase.sessionId && !reviewBySessionId.has(reviewCase.sessionId)) {
      reviewBySessionId.set(reviewCase.sessionId, reviewCase);
    }
    if (!reviewByCaseId.has(reviewCase.caseId)) {
      reviewByCaseId.set(reviewCase.caseId, reviewCase);
    }
  }

  const usedReviewCaseIds = new Set<string>();
  const mergedCases: PatientCaseRecordView[] = [];

  for (const session of runtimeSessions) {
    if (session.patientId !== patientId || session.outcome === 'RUNNING') {
      continue;
    }
    const matchedReviewCase =
      (session.requestId ? reviewByRequestId.get(session.requestId) : undefined)
      ?? reviewBySessionId.get(session.id)
      ?? reviewByCaseId.get(session.id);

    if (matchedReviewCase) {
      usedReviewCaseIds.add(matchedReviewCase.caseId);
    }

    const mergedCase = toPatientCaseFromRuntimeSession(
      session,
      matchedReviewCase,
    );
    if (mergedCase) {
      mergedCases.push(mergedCase);
    }
  }

  for (const reviewCase of reviewCases) {
    if (reviewCase.patientId !== patientId) {
      continue;
    }
    if (usedReviewCaseIds.has(reviewCase.caseId)) {
      continue;
    }
    mergedCases.push(toPatientCaseFromReviewCase(reviewCase));
  }

  return mergedCases.sort((left, right) => {
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

function writeStreamEvent(
  response: Response,
  event: TriageStreamEvent,
): void {
  if (response.writableEnded || response.destroyed) {
    return;
  }
  response.write(`${JSON.stringify(event)}\n`);
}

function buildClarificationQuestion(requiredFields: string[]): string {
  if (requiredFields.length === 0) {
    return '请补充缺失信息后继续。';
  }
  return `请补充以下信息后继续会诊：${requiredFields.join('、')}。`;
}

function normalizeSummaryTextForCompare(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[，。；、:：,./\\\-_\s()（）[\]【】]/g, '');
}

const SUMMARY_SECTION_PATTERN = /(当前结论[:：]|结论[:：]|分诊[:：]|建议[:：])/g;

function dedupeSummaryLines(lines: string[]): string[] {
  const selected: string[] = [];
  const selectedNorm: string[] = [];

  for (const line of lines.map((item) => item.trim()).filter(Boolean)) {
    const normalized = normalizeSummaryTextForCompare(line);
    if (!normalized) {
      continue;
    }
    const duplicated = selectedNorm.some((existing) =>
      existing === normalized
      || existing.includes(normalized)
      || normalized.includes(existing),
    );
    if (duplicated) {
      continue;
    }
    selected.push(line);
    selectedNorm.push(normalized);
  }
  return selected;
}

function splitSummaryLines(text: string): string[] {
  const normalized = text
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/([\\/]\s*){3,}/g, ' ')
    .trim();
  if (!normalized) {
    return [];
  }

  return normalized
    .replace(SUMMARY_SECTION_PATTERN, '\n$1')
    .replace(/\n+/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function resolveSummarySectionKey(
  line: string,
): 'conclusion' | 'triage' | 'advice' | null {
  if (/^(?:当前)?结论[:：]/.test(line)) {
    return 'conclusion';
  }
  if (/^分诊[:：]/.test(line)) {
    return 'triage';
  }
  if (/^建议[:：]/.test(line)) {
    return 'advice';
  }
  return null;
}

function collapseRepeatedSummaryBlocks(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }
  const lines = splitSummaryLines(trimmed);
  if (lines.length === 0) {
    return '';
  }
  if (lines.length >= 2 && lines.length % 2 === 0) {
    const half = lines.length / 2;
    const firstHalf = lines.slice(0, half);
    const secondHalf = lines.slice(half);
    const same = firstHalf.every(
      (line, index) =>
        normalizeSummaryTextForCompare(line)
        === normalizeSummaryTextForCompare(secondHalf[index] ?? ''),
    );
    if (same) {
      return firstHalf.join('\n');
    }
  }

  const output: string[] = [];
  const sectionLines = new Map<'conclusion' | 'triage' | 'advice', string>();
  for (const line of dedupeSummaryLines(lines)) {
    const sectionKey = resolveSummarySectionKey(line);
    if (!sectionKey) {
      output.push(line);
      continue;
    }

    const existingLine = sectionLines.get(sectionKey);
    if (!existingLine) {
      sectionLines.set(sectionKey, line);
      output.push(line);
      continue;
    }

    const existingNormalized = normalizeSummaryTextForCompare(existingLine);
    const currentNormalized = normalizeSummaryTextForCompare(line);
    if (
      existingNormalized === currentNormalized
      || existingNormalized.includes(currentNormalized)
    ) {
      continue;
    }
    if (
      currentNormalized.includes(existingNormalized)
      || line.length > existingLine.length
    ) {
      const index = output.findIndex((entry) => entry === existingLine);
      if (index >= 0) {
        output[index] = line;
      }
      sectionLines.set(sectionKey, line);
      continue;
    }
  }

  return output.join('\n');
}

function formatTriageLevelLabel(value: string | undefined): string {
  if (!value) {
    return '-';
  }
  if (value === 'emergency') {
    return '急危（L3）';
  }
  if (value === 'urgent') {
    return '紧急（L2）';
  }
  if (value === 'routine') {
    return '常规（L1）';
  }
  if (value === 'followup') {
    return '随访（L0）';
  }
  return value;
}

function formatDestinationLabel(value: string | undefined): string {
  if (!value) {
    return '-';
  }
  const normalized = value.trim();
  if (!normalized) {
    return '-';
  }
  const mapping: Record<string, string> = {
    cardiology_outpatient: '心血管专科门诊',
    gp_clinic: '全科门诊',
    metabolic_outpatient: '代谢专科门诊',
    multidisciplinary_clinic: '多学科联合门诊',
    offline_emergency: '线下急诊绿色通道',
  };
  if (mapping[normalized]) {
    return mapping[normalized];
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

function buildTypewriterSummary(result: DebateResult): string {
  const conclusion = result.explainableReport?.conclusion ?? '';
  const actions = dedupeSummaryLines(result.explainableReport?.actions ?? []);
  const destination = formatDestinationLabel(result.triageResult?.destination);
  const triageLevel = formatTriageLevelLabel(result.triageResult?.triageLevel);
  const normalizedConclusion = normalizeSummaryTextForCompare(conclusion);
  const triageLine = triageLevel || destination
    ? `分诊：${triageLevel || '-'} / 去向：${destination || '-'}`
    : '';
  const shouldAddTriageLine = triageLine
    && !normalizedConclusion.includes(normalizeSummaryTextForCompare(triageLine));
  const actionLine = actions.length > 0 ? `建议：${actions.join('；')}` : '';
  const shouldAddActionLine = actionLine
    && !normalizedConclusion.includes(normalizeSummaryTextForCompare(actionLine));
  const sections = dedupeSummaryLines([
    conclusion ? `结论：${conclusion}` : '',
    shouldAddTriageLine ? triageLine : '',
    shouldAddActionLine ? actionLine : '',
  ]);

  return collapseRepeatedSummaryBlocks(sections.join('\n'));
}

function createInitialSnapshotStageRuntime(): SnapshotStageRuntime {
  return {
    START: { status: 'pending', message: '等待启动' },
    INFO_GATHER: { status: 'pending', message: '等待信息采集' },
    RISK_ASSESS: { status: 'pending', message: '等待风险评估' },
    ROUTING: { status: 'pending', message: '等待复杂度分流' },
    DEBATE: { status: 'pending', message: '等待协同会诊' },
    CONSENSUS: { status: 'pending', message: '等待共识收敛' },
    REVIEW: { status: 'pending', message: '等待安全复核' },
    OUTPUT: { status: 'pending', message: '等待输出结论' },
    ESCALATION: { status: 'pending', message: '按需触发线下上转' },
  };
}

function resolveSnapshotPhase(
  stageRuntime: SnapshotStageRuntime,
  finalized: boolean,
): OrchestrationSnapshot['phase'] {
  if (finalized || stageRuntime.OUTPUT.status === 'done') {
    return 'complete';
  }
  if (
    stageRuntime.REVIEW.status === 'running' ||
    stageRuntime.REVIEW.status === 'done' ||
    stageRuntime.OUTPUT.status === 'running'
  ) {
    return 'synthesis';
  }
  if (
    stageRuntime.DEBATE.status === 'running' ||
    stageRuntime.CONSENSUS.status === 'running'
  ) {
    return 'execution';
  }
  if (
    stageRuntime.RISK_ASSESS.status !== 'pending' ||
    stageRuntime.ROUTING.status !== 'pending'
  ) {
    return 'analysis';
  }
  return 'assignment';
}

function parseRequestBody(body: unknown): TriageRequest {
  if (!body || typeof body !== 'object') {
    throw new RequestValidationError(
      'ERR_MISSING_REQUIRED_DATA',
      'Request body must include profile.',
    );
  }

  const candidate = body as Partial<TriageRequest>;
  if (!candidate.profile) {
    throw new RequestValidationError(
      'ERR_MISSING_REQUIRED_DATA',
      'Request body must include profile.',
    );
  }

  return {
    requestId:
      typeof candidate.requestId === 'string'
        ? candidate.requestId
        : undefined,
    profile: candidate.profile,
    signals: Array.isArray(candidate.signals) ? candidate.signals : undefined,
    symptomText:
      typeof candidate.symptomText === 'string'
        ? candidate.symptomText
        : undefined,
    contextVersion:
      typeof candidate.contextVersion === 'string'
        ? candidate.contextVersion
        : undefined,
    consentToken:
      typeof candidate.consentToken === 'string'
        ? candidate.consentToken
        : undefined,
    sessionId:
      typeof candidate.sessionId === 'string' ? candidate.sessionId : undefined,
  };
}

function toRuntimeStageStatus(
  status: 'done' | 'failed' | 'skipped',
): TriageStreamStageStatus {
  if (status === 'done') {
    return 'done';
  }
  if (status === 'failed') {
    return 'failed';
  }
  return 'skipped';
}

export function createTriageRouter(
  useCase: RunTriageSessionUseCase,
  architecture?: RuntimeArchitectureView,
  coordinatorSnapshotService?: CoordinatorSnapshotService,
  governanceRuntimeTelemetry?: GovernanceRuntimeTelemetry,
  governanceReviewQueueService?: GovernanceReviewQueueService,
  siteGovernancePolicyService?: SiteGovernancePolicyService,
  authoritativeMedicalSearch?: AuthoritativeMedicalSearchPort,
  env: NodeJS.ProcessEnv = process.env,
): Router {
  const router = Router();
  const policy = resolveBackendExposurePolicy(env);

  router.use((request: Request, response: Response, next) => {
    if (!isProtectedTriageRoute(request.path)) {
      next();
      return;
    }

    if (!policy.triageAuthRequired) {
      next();
      return;
    }

    if (!policy.triageApiKey) {
      response.status(503).json({
        error: 'triage_misconfigured',
        message: 'Triage routes are not configured for protected access.',
      });
      return;
    }

    const bearerToken = normalizeBearerToken(request);
    if (bearerToken !== policy.triageApiKey) {
      response.status(401).json({
        error: 'unauthorized',
        message: 'Authorization bearer token required for triage access.',
      });
      return;
    }

    next();
  });

  router.get('/health', (_request: Request, response: Response) => {
    response.status(200).json({ status: 'ok' });
  });

  router.get('/architecture/experts', (_request: Request, response: Response) => {
    response.status(200).json(
      architecture ?? {
        experts: {},
      },
    );
  });

  router.get('/governance/runtime', (_request: Request, response: Response) => {
    response.status(200).json(
      governanceRuntimeTelemetry?.getSnapshot() ?? {
        generatedAt: nowIso(),
        source: 'runtime',
        governanceContext: {
          catalogVersion: AUTHORITATIVE_RULE_CATALOG_VERSION,
          guidelineReferenceCount: AUTHORITATIVE_GUIDELINE_REFERENCES.length,
          evidenceGateCommands: ['npm run gate:metrics', 'npm run gate:all'],
        },
        queueOverview: {
          pending: 0,
          reviewing: 0,
          approved: 0,
          rejected: 0,
        },
        performance: {
          latencyHeat: 0,
          retryPressure: 0,
          consensusConvergence: 100,
          dissentSpread: 0,
          routingComplexity: 0,
        },
        totals: {
          totalSessions: 0,
          successSessions: 0,
          escalatedSessions: 0,
          errorSessions: 0,
          activeSessions: 0,
        },
        recentSessions: [],
        stageRuntime: {
          START: {
            status: 'pending',
            message: 'START waiting',
            active: 0,
            transitions: 0,
            updatedAt: nowIso(),
          },
          INFO_GATHER: {
            status: 'pending',
            message: 'INFO_GATHER waiting',
            active: 0,
            transitions: 0,
            updatedAt: nowIso(),
          },
          RISK_ASSESS: {
            status: 'pending',
            message: 'RISK_ASSESS waiting',
            active: 0,
            transitions: 0,
            updatedAt: nowIso(),
          },
          ROUTING: {
            status: 'pending',
            message: 'ROUTING waiting',
            active: 0,
            transitions: 0,
            updatedAt: nowIso(),
          },
          DEBATE: {
            status: 'pending',
            message: 'DEBATE waiting',
            active: 0,
            transitions: 0,
            updatedAt: nowIso(),
          },
          CONSENSUS: {
            status: 'pending',
            message: 'CONSENSUS waiting',
            active: 0,
            transitions: 0,
            updatedAt: nowIso(),
          },
          REVIEW: {
            status: 'pending',
            message: 'REVIEW waiting',
            active: 0,
            transitions: 0,
            updatedAt: nowIso(),
          },
          OUTPUT: {
            status: 'pending',
            message: 'OUTPUT waiting',
            active: 0,
            transitions: 0,
            updatedAt: nowIso(),
          },
          ESCALATION: {
            status: 'pending',
            message: 'ESCALATION waiting',
            active: 0,
            transitions: 0,
            updatedAt: nowIso(),
          },
        },
        currentStage: 'START',
      },
    );
  });

  router.get('/governance/sites', (request: Request, response: Response) => {
    const limit = parsePositiveLimit(request.query.limit, 50, 200);
    if (limit === null) {
      response.status(400).json({
        error: 'invalid_limit',
        message: 'limit must be a positive integer',
      });
      return;
    }

    const sites = siteGovernancePolicyService?.list({ limit }) ?? [];
    response.status(200).json({
      generatedAt: nowIso(),
      total: sites.length,
      sites,
    });
  });

  router.get('/governance/sites/:id/policy', (request: Request, response: Response) => {
    const siteId = normalizeSiteId(request.params.id);
    if (!siteId) {
      response.status(400).json({
        error: 'invalid_site_id',
        message: 'site id must match [A-Za-z0-9_-], max length 64',
      });
      return;
    }
    if (!siteGovernancePolicyService) {
      response.status(503).json({
        error: 'site_policy_unavailable',
        message: 'site governance policy service is unavailable',
      });
      return;
    }

    const policyView = siteGovernancePolicyService.get(siteId);
    if (!policyView) {
      response.status(404).json({
        error: 'site_policy_not_found',
        message: `site policy not found: ${siteId}`,
      });
      return;
    }

    response.status(200).json({
      generatedAt: nowIso(),
      policy: policyView,
    });
  });

  router.put('/governance/sites/:id/policy', (request: Request, response: Response) => {
    const siteId = normalizeSiteId(request.params.id);
    if (!siteId) {
      response.status(400).json({
        error: 'invalid_site_id',
        message: 'site id must match [A-Za-z0-9_-], max length 64',
      });
      return;
    }
    if (!siteGovernancePolicyService) {
      response.status(503).json({
        error: 'site_policy_unavailable',
        message: 'site governance policy service is unavailable',
      });
      return;
    }

    const body = request.body as {
      displayName?: unknown;
      thresholds?: unknown;
      ruleVersionBinding?: unknown;
      updatedBy?: unknown;
    } | null;

    const displayName = normalizeOptionalString(body?.displayName, 80);
    if (displayName === null) {
      response.status(400).json({
        error: 'invalid_display_name',
        message: 'displayName must be a string with max length 80',
      });
      return;
    }

    const updatedBy = normalizeOptionalString(body?.updatedBy, 80);
    if (updatedBy === null) {
      response.status(400).json({
        error: 'invalid_updated_by',
        message: 'updatedBy must be a string with max length 80',
      });
      return;
    }

    let thresholds: SiteGovernancePolicy['thresholds'] | undefined;
    if (body && Object.prototype.hasOwnProperty.call(body, 'thresholds')) {
      thresholds = normalizeSiteThresholds(body.thresholds) ?? undefined;
      if (!thresholds) {
        response.status(400).json({
          error: 'invalid_thresholds',
          message:
            'thresholds must satisfy fastConsensusMax <= lightDebateMax < deepDebateMin',
        });
        return;
      }
    }

    let ruleVersionBinding: RuleVersionBinding | undefined;
    if (body && Object.prototype.hasOwnProperty.call(body, 'ruleVersionBinding')) {
      ruleVersionBinding = normalizeRuleVersionBinding(body.ruleVersionBinding) ?? undefined;
      if (!ruleVersionBinding) {
        response.status(400).json({
          error: 'invalid_rule_version_binding',
          message: 'ruleVersionBinding.catalogVersion is required',
        });
        return;
      }
    }

    const policyView = siteGovernancePolicyService.upsertPolicy({
      siteId,
      displayName,
      thresholds,
      ruleVersionBinding,
      updatedBy,
    });

    response.status(200).json({
      generatedAt: nowIso(),
      policy: policyView,
    });
  });

  router.get(
    '/governance/sites/:id/audit-subscriptions',
    (request: Request, response: Response) => {
      const siteId = normalizeSiteId(request.params.id);
      if (!siteId) {
        response.status(400).json({
          error: 'invalid_site_id',
          message: 'site id must match [A-Za-z0-9_-], max length 64',
        });
        return;
      }
      if (!siteGovernancePolicyService) {
        response.status(503).json({
          error: 'site_policy_unavailable',
          message: 'site governance policy service is unavailable',
        });
        return;
      }

      const limit = parsePositiveLimit(request.query.limit, 100, 200);
      if (limit === null) {
        response.status(400).json({
          error: 'invalid_limit',
          message: 'limit must be a positive integer',
        });
        return;
      }

      const subscriptions = siteGovernancePolicyService.listAuditSubscriptions({
        siteId,
        limit,
      });
      response.status(200).json({
        generatedAt: nowIso(),
        siteId,
        total: subscriptions.length,
        subscriptions,
      });
    },
  );

  router.post(
    '/governance/sites/:id/audit-subscriptions',
    (request: Request, response: Response) => {
      const siteId = normalizeSiteId(request.params.id);
      if (!siteId) {
        response.status(400).json({
          error: 'invalid_site_id',
          message: 'site id must match [A-Za-z0-9_-], max length 64',
        });
        return;
      }
      if (!siteGovernancePolicyService) {
        response.status(503).json({
          error: 'site_policy_unavailable',
          message: 'site governance policy service is unavailable',
        });
        return;
      }

      const body = request.body as {
        name?: unknown;
        eventTypes?: unknown;
        channel?: unknown;
        endpoint?: unknown;
        secretRef?: unknown;
        enabled?: unknown;
      } | null;
      const name = normalizeOptionalString(body?.name, 120);
      if (name === null || !name) {
        response.status(400).json({
          error: 'invalid_subscription_name',
          message: 'name is required and max length is 120',
        });
        return;
      }

      const eventTypes = normalizeAuditEventTypes(body?.eventTypes);
      if (eventTypes.length === 0 || eventTypes.length > 16) {
        response.status(400).json({
          error: 'invalid_event_types',
          message: 'eventTypes must contain 1-16 unique values',
        });
        return;
      }

      const channel = typeof body?.channel === 'string'
        ? body.channel.trim().toLowerCase()
        : '';
      if (!AUDIT_SUBSCRIPTION_CHANNELS.has(channel as AuditSubscriptionChannel)) {
        response.status(400).json({
          error: 'invalid_channel',
          message: 'channel must be webhook/email/dashboard',
        });
        return;
      }

      const endpoint = normalizeOptionalString(body?.endpoint, 260);
      if (endpoint === null || !endpoint) {
        response.status(400).json({
          error: 'invalid_endpoint',
          message: 'endpoint is required and max length is 260',
        });
        return;
      }

      const secretRef = normalizeOptionalString(body?.secretRef, 120);
      if (secretRef === null) {
        response.status(400).json({
          error: 'invalid_secret_ref',
          message: 'secretRef max length is 120',
        });
        return;
      }

      let enabled = true;
      if (body && Object.prototype.hasOwnProperty.call(body, 'enabled')) {
        if (typeof body.enabled !== 'boolean') {
          response.status(400).json({
            error: 'invalid_enabled',
            message: 'enabled must be a boolean',
          });
          return;
        }
        enabled = body.enabled;
      }

      const subscription = siteGovernancePolicyService.addAuditSubscription({
        siteId,
        name,
        eventTypes,
        channel: channel as AuditSubscriptionChannel,
        endpoint,
        secretRef: secretRef ?? undefined,
        enabled,
      });
      const subscriptions = siteGovernancePolicyService.listAuditSubscriptions({
        siteId,
        limit: 200,
      });

      response.status(201).json({
        generatedAt: nowIso(),
        siteId,
        total: subscriptions.length,
        subscription,
      });
    },
  );

  router.delete(
    '/governance/sites/:id/audit-subscriptions/:subscriptionId',
    (request: Request, response: Response) => {
      const siteId = normalizeSiteId(request.params.id);
      if (!siteId) {
        response.status(400).json({
          error: 'invalid_site_id',
          message: 'site id must match [A-Za-z0-9_-], max length 64',
        });
        return;
      }
      if (!siteGovernancePolicyService) {
        response.status(503).json({
          error: 'site_policy_unavailable',
          message: 'site governance policy service is unavailable',
        });
        return;
      }
      const subscriptionId =
        typeof request.params.subscriptionId === 'string'
          ? request.params.subscriptionId.trim()
          : '';
      if (!subscriptionId) {
        response.status(400).json({
          error: 'invalid_subscription_id',
          message: 'subscription id is required',
        });
        return;
      }

      const removed = siteGovernancePolicyService.removeAuditSubscription(
        siteId,
        subscriptionId,
      );
      if (!removed) {
        response.status(404).json({
          error: 'subscription_not_found',
          message: `subscription not found: ${subscriptionId}`,
        });
        return;
      }

      response.status(200).json({
        generatedAt: nowIso(),
        removed: true,
      });
    },
  );

  router.get('/governance/review-queue', (request: Request, response: Response) => {
    const rawLimit =
      typeof request.query.limit === 'string'
        ? Number(request.query.limit)
        : Number.NaN;
    const limit = Number.isFinite(rawLimit)
      ? Math.min(200, Math.max(1, Math.floor(rawLimit)))
      : 50;
    const statusFilter = parseReviewStatuses(request.query.status);
    if (statusFilter === null) {
      response.status(400).json({
        error: 'invalid_status_filter',
        message: 'status must use pending/reviewing/approved/rejected',
      });
      return;
    }

    const cases = governanceReviewQueueService?.list({
      status: statusFilter.length > 0 ? statusFilter : undefined,
      limit,
    }) ?? [];
    const queueOverview = governanceReviewQueueService?.getQueueOverview() ?? {
      pending: 0,
      reviewing: 0,
      approved: 0,
      rejected: 0,
    };
    response.status(200).json({
      generatedAt: nowIso(),
      total: cases.length,
      queueOverview,
      cases,
    });
  });

  router.post(
    '/governance/review-queue/:id/decision',
    (request: Request, response: Response) => {
      const caseId =
        typeof request.params.id === 'string' ? request.params.id.trim() : '';
      if (!caseId) {
        response.status(400).json({
          error: 'invalid_case_id',
          message: 'case id is required',
        });
        return;
      }

      if (!governanceReviewQueueService) {
        response.status(503).json({
          error: 'review_queue_unavailable',
          message: 'review queue service is unavailable',
        });
        return;
      }

      const body = request.body as {
        decision?: unknown;
        reviewerId?: unknown;
        note?: unknown;
      } | null;
      const decision =
        typeof body?.decision === 'string'
          ? body.decision.trim().toLowerCase()
          : '';
      if (!REVIEW_DECISION_OUTCOMES.has(decision as ReviewDecisionOutcome)) {
        response.status(400).json({
          error: 'invalid_decision',
          message: 'decision must use approve/reject/request_changes',
        });
        return;
      }

      const updated = governanceReviewQueueService.decide(caseId, {
        decision: decision as ReviewDecisionOutcome,
        reviewerId:
          typeof body?.reviewerId === 'string'
            ? body.reviewerId
            : undefined,
        note: typeof body?.note === 'string' ? body.note : undefined,
      });
      if (!updated) {
        response.status(404).json({
          error: 'review_case_not_found',
          message: `review case not found: ${caseId}`,
        });
        return;
      }

      response.status(200).json({
        generatedAt: nowIso(),
        case: updated,
      });
    },
  );

  router.get('/patients/:id/cases', (request: Request, response: Response) => {
    const patientId =
      typeof request.params.id === 'string' ? request.params.id.trim() : '';
    if (!patientId) {
      response.status(400).json({
        error: 'invalid_patient_id',
        message: 'patient id is required',
      });
      return;
    }

    const limit = parsePositiveLimit(request.query.limit, 50, 200);
    if (limit === null) {
      response.status(400).json({
        error: 'invalid_limit',
        message: 'limit must be a positive integer',
      });
      return;
    }

    const runtimeSessions =
      governanceRuntimeTelemetry?.getSnapshot().recentSessions ?? [];
    const reviewCases = governanceReviewQueueService?.list({
      patientId,
      limit: 200,
    }) ?? [];
    const allCases = buildPatientCasesView(patientId, runtimeSessions, reviewCases);
    const cases = allCases.slice(0, limit);

    response.status(200).json({
      generatedAt: nowIso(),
      patientId,
      total: allCases.length,
      returned: cases.length,
      cases,
    });
  });

  router.get('/governance/rules/catalog', (_request: Request, response: Response) => {
    response.status(200).json({
      catalogVersion: AUTHORITATIVE_RULE_CATALOG_VERSION,
      synonymSetVersion: RED_FLAG_SYNONYM_SET_VERSION,
      layers: LAYERED_RULE_DESCRIPTORS,
      guidelineReferences: AUTHORITATIVE_GUIDELINE_REFERENCES,
      generatedAt: nowIso(),
    });
  });

  router.get('/governance/rules/version', (_request: Request, response: Response) => {
    response.status(200).json({
      catalogVersion: AUTHORITATIVE_RULE_CATALOG_VERSION,
      synonymSetVersion: RED_FLAG_SYNONYM_SET_VERSION,
      guidelineCount: AUTHORITATIVE_GUIDELINE_REFERENCES.length,
      generatedAt: nowIso(),
    });
  });

  router.get('/governance/medical-sources', (_request: Request, response: Response) => {
    const sources =
      authoritativeMedicalSearch?.getSources() ?? listAuthoritativeMedicalSources();
    response.status(200).json({
      enabled: authoritativeMedicalSearch?.isEnabled() ?? false,
      strictWhitelist: true,
      sources,
      generatedAt: nowIso(),
    });
  });

  router.get('/governance/medical-search/runtime', (_request: Request, response: Response) => {
    const runtime = authoritativeMedicalSearch?.getRuntimeStats?.();
    response.status(200).json({
      enabled: authoritativeMedicalSearch?.isEnabled() ?? false,
      strictWhitelist: true,
      runtime:
        runtime ?? {
          generatedAt: nowIso(),
          searches: 0,
          cacheHits: 0,
          cacheMisses: 0,
          fallbackAppliedCount: 0,
          providerStats: [],
          recentSearches: [],
        },
      generatedAt: nowIso(),
    });
  });

  router.get('/governance/medical-search/logs', (request: Request, response: Response) => {
    const rawLimit =
      typeof request.query.limit === 'string'
        ? Number(request.query.limit)
        : Number.NaN;
    const limit = Number.isFinite(rawLimit)
      ? Math.min(100, Math.max(1, Math.floor(rawLimit)))
      : 20;
    const runtime = authoritativeMedicalSearch?.getRuntimeStats?.();
    const recentSearches = runtime?.recentSearches ?? [];
    response.status(200).json({
      enabled: authoritativeMedicalSearch?.isEnabled() ?? false,
      strictWhitelist: true,
      total: recentSearches.length,
      logs: recentSearches.slice(0, limit),
      generatedAt: nowIso(),
    });
  });

  router.post('/governance/medical-search', async (request: Request, response: Response) => {
    const body = request.body as {
      query?: unknown;
      limit?: unknown;
      sourceFilter?: unknown;
      requiredSources?: unknown;
    } | null;
    const query = typeof body?.query === 'string' ? body.query.trim() : '';
    const rawLimit =
      typeof body?.limit === 'number'
        ? body.limit
        : Number(body?.limit ?? Number.NaN);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(20, Math.max(1, Math.floor(rawLimit)))
      : 8;
    const sourceFilter = parseSourceIdList(body?.sourceFilter);
    const requiredSources = parseSourceIdList(body?.requiredSources);

    if (
      sourceFilter.length > MEDICAL_SEARCH_SOURCE_LIST_MAX
      || requiredSources.length > MEDICAL_SEARCH_SOURCE_LIST_MAX
    ) {
      response.status(400).json({
        error: 'invalid_source_constraints',
        message:
          `sourceFilter/requiredSources cannot exceed ${MEDICAL_SEARCH_SOURCE_LIST_MAX} items`,
      });
      return;
    }

    const availableSources =
      authoritativeMedicalSearch?.getSources() ?? listAuthoritativeMedicalSources();
    const availableSourceIds = new Set(availableSources.map((item) => item.id));
    const invalidSourceFilter = sourceFilter.filter(
      (sourceId) => !availableSourceIds.has(sourceId),
    );
    const invalidRequiredSources = requiredSources.filter(
      (sourceId) => !availableSourceIds.has(sourceId),
    );

    if (invalidSourceFilter.length > 0 || invalidRequiredSources.length > 0) {
      response.status(400).json({
        error: 'invalid_sources',
        message: 'sourceFilter/requiredSources contains unknown source ids',
        invalidSourceFilter,
        invalidRequiredSources,
        availableSources: availableSources.map((item) => item.id),
      });
      return;
    }

    if (sourceFilter.length > 0) {
      const missingRequiredSources = requiredSources.filter(
        (sourceId) => !sourceFilter.includes(sourceId),
      );
      if (missingRequiredSources.length > 0) {
        response.status(400).json({
          error: 'invalid_source_constraints',
          message: 'requiredSources must be a subset of sourceFilter',
          missingRequiredSources,
        });
        return;
      }
    }

    if (query.length < 2) {
      response.status(400).json({
        error: 'invalid_query',
        message: 'query must contain at least 2 characters',
      });
      return;
    }

    if (query.length > MEDICAL_SEARCH_QUERY_MAX_LENGTH) {
      response.status(400).json({
        error: 'invalid_query',
        message: `query length must be <= ${MEDICAL_SEARCH_QUERY_MAX_LENGTH}`,
      });
      return;
    }

    if (!authoritativeMedicalSearch || !authoritativeMedicalSearch.isEnabled()) {
      response.status(503).json({
        error: 'medical_search_disabled',
        message: 'authoritative medical search is disabled',
        strictWhitelist: true,
        sources:
          authoritativeMedicalSearch?.getSources() ?? listAuthoritativeMedicalSources(),
      });
      return;
    }

    try {
      const result = await authoritativeMedicalSearch.search({
        query,
        limit,
        sourceFilter: sourceFilter.length > 0 ? sourceFilter : undefined,
        requiredSources: requiredSources.length > 0 ? requiredSources : undefined,
      });
      response.status(200).json({
        ...result,
        policy: {
          strictWhitelist: true,
          allowedSources: authoritativeMedicalSearch.getSources(),
          sourceFilter,
          requiredSources,
        },
      });
    } catch {
      response.status(502).json({
        error: 'medical_search_unavailable',
        message: 'authoritative medical search failed',
      });
    }
  });

  router.post(
    '/orchestrate_triage',
    async (request: Request, response: Response<TriageApiResponse>) => {
      let telemetryTrackingId: string | null = null;
      let inputForReviewQueue: TriageRequest | null = null;
      try {
        const input = parseRequestBody(request.body);
        inputForReviewQueue = input;
        telemetryTrackingId =
          governanceRuntimeTelemetry?.startSession(input) ?? null;
        const result = await useCase.execute(input);
        const payload = toApiResponse(result);
        if (inputForReviewQueue) {
          governanceReviewQueueService?.recordFromTriage({
            request: inputForReviewQueue,
            response: payload,
          });
        }

        if (telemetryTrackingId && governanceRuntimeTelemetry) {
          for (const trace of result.workflowTrace ?? []) {
            governanceRuntimeTelemetry.recordStageTransition(
              telemetryTrackingId,
              trace.stage,
              toRuntimeStageStatus(trace.status),
              trace.detail,
            );
          }
          governanceRuntimeTelemetry.completeSession(
            telemetryTrackingId,
            payload,
            Date.now(),
          );
          telemetryTrackingId = null;
        }

        if (payload.status === 'ERROR') {
          response.status(400).json(payload);
          return;
        }

        response.status(200).json(payload);
      } catch (error) {
        if (telemetryTrackingId && governanceRuntimeTelemetry) {
          const telemetryErrorCode =
            error instanceof RequestValidationError
              ? error.errorCode
              : 'ERR_CONFLICT_UNRESOLVED';
          governanceRuntimeTelemetry.failSession(
            telemetryTrackingId,
            telemetryErrorCode,
            Date.now(),
          );
          telemetryTrackingId = null;
        }

        if (error instanceof RequestValidationError) {
          const fallbackSessionId = `validation-${Date.now()}`;
          const auditRef = `audit_${fallbackSessionId}`;
          const payload = buildErrorResponse(error.errorCode, error.message, {
            requiredFields: ['profile'],
            auditRef,
            ruleGovernance: buildValidationErrorGovernanceSnapshot({
              sessionId: fallbackSessionId,
              auditRef,
              errorCode: error.errorCode,
            }),
          });
          if (inputForReviewQueue) {
            governanceReviewQueueService?.recordFromTriage({
              request: inputForReviewQueue,
              response: payload,
            });
          }
          response
            .status(400)
            .json(payload);
          return;
        }

        const fallbackSessionId = `runtime-${Date.now()}`;
        const auditRef = `audit_${fallbackSessionId}`;
        const payload = buildErrorResponse(
          'ERR_CONFLICT_UNRESOLVED',
          'Unexpected runtime error. See backend logs.',
          {
            auditRef,
            ruleGovernance: buildValidationErrorGovernanceSnapshot({
              sessionId: fallbackSessionId,
              auditRef,
              errorCode: 'ERR_CONFLICT_UNRESOLVED',
            }),
          },
        );
        if (inputForReviewQueue) {
          governanceReviewQueueService?.recordFromTriage({
            request: inputForReviewQueue,
            response: payload,
          });
        }
        response.status(500).json(payload);
      }
    },
  );

  router.post(
    '/orchestrate_triage/stream',
    async (request: Request, response: Response) => {
      response.status(200);
      response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      response.setHeader('Cache-Control', 'no-cache, no-transform');
      response.setHeader('Connection', 'keep-alive');
      response.setHeader('X-Accel-Buffering', 'no');
      response.flushHeaders();

      const streamStartedAt = Date.now();
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let modelSnapshotTimer: ReturnType<typeof setInterval> | null = null;
      const emittedStageEvents = new Set<string>();
      const emittedReasoningMessages = new Set<string>();
      const stageLabels: Record<WorkflowStage, string> = {
        START: '启动',
        INFO_GATHER: '信息采集',
        RISK_ASSESS: '风险评估',
        ROUTING: '复杂度分流',
        DEBATE: '协同会诊',
        CONSENSUS: '共识收敛',
        REVIEW: '安全复核',
        OUTPUT: '输出结论',
        ESCALATION: '线下上转',
      };
      let activeStage: WorkflowStage = 'INFO_GATHER';
      let inputForSnapshot: TriageRequest | null = null;
      const stageRuntime = createInitialSnapshotStageRuntime();
      const reasoningHistory: string[] = [];
      let latestRouteInfo: DebateResult['routing'];
      let latestFinalStatus = '';
      let lastSnapshotEmitAt = 0;
      let lastModelSnapshotAt = 0;
      let modelSnapshotInFlight = false;
      let snapshotRuntimeRevision = 0;
      let telemetryTrackingId: string | null = null;
      let telemetryCompleted = false;

      const completeTelemetry = (payload: TriageApiResponse): void => {
        if (
          !governanceRuntimeTelemetry
          || !telemetryTrackingId
          || telemetryCompleted
        ) {
          return;
        }

        governanceRuntimeTelemetry.completeSession(
          telemetryTrackingId,
          payload,
          Date.now(),
        );
        telemetryCompleted = true;
      };

      const failTelemetry = (errorCode: ErrorCode): void => {
        if (
          !governanceRuntimeTelemetry
          || !telemetryTrackingId
          || telemetryCompleted
        ) {
          return;
        }

        governanceRuntimeTelemetry.failSession(
          telemetryTrackingId,
          errorCode,
          Date.now(),
        );
        telemetryCompleted = true;
      };

      const buildSnapshotContext = (): CoordinatorSnapshotContext | null => {
        if (!inputForSnapshot) {
          return null;
        }
        const mcpInsights = reasoningHistory
          .filter((item) => /MCP/.test(item))
          .slice(-6);
        return {
          profile: inputForSnapshot.profile,
          symptomText:
            inputForSnapshot.symptomText || inputForSnapshot.profile.chiefComplaint,
          stageRuntime,
          reasoning: reasoningHistory.slice(-60),
          routeInfo: latestRouteInfo,
          finalStatus: latestFinalStatus || undefined,
          mcpInsights,
        };
      };

      const writeSnapshot = (snapshot: OrchestrationSnapshot): void => {
        writeStreamEvent(response, {
          type: 'orchestration_snapshot',
          timestamp: nowIso(),
          snapshot,
        });
      };

      const emitRuleSnapshot = (
        finalized: boolean,
        force: boolean = false,
      ): void => {
        if (!coordinatorSnapshotService) {
          return;
        }
        if (!force && Date.now() - lastSnapshotEmitAt < 500) {
          return;
        }
        const context = buildSnapshotContext();
        if (!context) {
          return;
        }
        const phase = resolveSnapshotPhase(stageRuntime, finalized);
        const snapshot = coordinatorSnapshotService.createRuleSnapshot(
          context,
          phase,
        );
        writeSnapshot(snapshot);
        lastSnapshotEmitAt = Date.now();
      };

      const maybeEmitModelSnapshot = async (
        finalized: boolean,
        force: boolean = false,
      ): Promise<void> => {
        if (!coordinatorSnapshotService) {
          return;
        }
        if (modelSnapshotInFlight) {
          if (force) {
            emitRuleSnapshot(finalized, true);
          }
          return;
        }
        const now = Date.now();
        if (!force && now - lastModelSnapshotAt < MODEL_SNAPSHOT_MIN_INTERVAL_MS) {
          return;
        }
        const context = buildSnapshotContext();
        if (!context) {
          return;
        }
        const snapshotRevisionAtStart = snapshotRuntimeRevision;
        modelSnapshotInFlight = true;
        try {
          const phase = resolveSnapshotPhase(stageRuntime, finalized);
          const snapshot = await coordinatorSnapshotService.createModelSnapshot(
            context,
            phase,
          );
          if (!force && snapshotRevisionAtStart !== snapshotRuntimeRevision) {
            return;
          }
          if (snapshot) {
            writeSnapshot(snapshot);
            lastSnapshotEmitAt = Date.now();
            lastModelSnapshotAt = Date.now();
            return;
          }
          emitRuleSnapshot(finalized, true);
        } finally {
          modelSnapshotInFlight = false;
        }
      };

      const emitStageUpdate = (
        stage: WorkflowStage,
        status: TriageStreamStageStatus,
        message: string,
      ): void => {
        const key = `${String(stage)}|${String(status)}|${message}`;
        if (emittedStageEvents.has(key)) {
          return;
        }
        emittedStageEvents.add(key);
        stageRuntime[stage] = {
          status,
          message,
        };
        if (governanceRuntimeTelemetry && telemetryTrackingId) {
          governanceRuntimeTelemetry.recordStageTransition(
            telemetryTrackingId,
            stage,
            status,
            message,
          );
        }
        snapshotRuntimeRevision += 1;
        if (status === 'running') {
          activeStage = stage;
        }
        writeStreamEvent(response, {
          type: 'stage_update',
          timestamp: nowIso(),
          stage,
          status,
          message,
        });
        emitRuleSnapshot(false);
        if (
          status !== 'pending' &&
          ['RISK_ASSESS', 'ROUTING', 'DEBATE', 'CONSENSUS', 'REVIEW', 'OUTPUT'].includes(stage)
        ) {
          void maybeEmitModelSnapshot(false);
        }
      };

      const emitReasoningStep = (message: string): void => {
        if (!message.trim()) {
          return;
        }
        if (emittedReasoningMessages.has(message)) {
          return;
        }
        emittedReasoningMessages.add(message);
        reasoningHistory.push(message);
        if (reasoningHistory.length > 160) {
          reasoningHistory.shift();
        }
        writeStreamEvent(response, {
          type: 'reasoning_step',
          timestamp: nowIso(),
          message,
        });
      };

      try {
        const input = parseRequestBody(request.body);
        inputForSnapshot = input;
        telemetryTrackingId =
          governanceRuntimeTelemetry?.startSession(input) ?? null;

        emitStageUpdate('START', 'running', '会诊流程启动');
        emitStageUpdate('INFO_GATHER', 'running', '正在校验授权并收集最小信息集');
        emitReasoningStep('总Agent：已完成任务拆分，信息采集子任务开始执行。');
        emitStageUpdate('RISK_ASSESS', 'pending', '等待信息采集完成后执行风险评估');
        emitStageUpdate('ROUTING', 'pending', '等待风险评估结果后执行复杂度分流');
        emitStageUpdate('DEBATE', 'pending', '等待分流完成后启动专家协同');
        emitStageUpdate('CONSENSUS', 'pending', '等待专家协同后进入共识收敛');
        emitStageUpdate('REVIEW', 'pending', '等待共识形成后执行安全复核');
        emitStageUpdate('OUTPUT', 'pending', '等待复核通过后输出可解释建议');
        emitStageUpdate('ESCALATION', 'pending', '命中红旗时触发线下上转');
        emitRuleSnapshot(false, true);

        heartbeatTimer = setInterval(() => {
          if (response.writableEnded || response.destroyed) {
            if (heartbeatTimer) {
              clearInterval(heartbeatTimer);
              heartbeatTimer = null;
            }
            return;
          }
          const elapsedSec = Math.max(
            1,
            Math.floor((Date.now() - streamStartedAt) / 1000),
          );
          writeStreamEvent(response, {
            type: 'heartbeat',
            timestamp: nowIso(),
            message: `会诊进行中（${elapsedSec}s）：${stageLabels[activeStage]}`,
          });
        }, 1200);

        modelSnapshotTimer = setInterval(() => {
          if (response.writableEnded || response.destroyed) {
            if (modelSnapshotTimer) {
              clearInterval(modelSnapshotTimer);
              modelSnapshotTimer = null;
            }
            return;
          }
          void maybeEmitModelSnapshot(false);
        }, MODEL_SNAPSHOT_TICK_MS);

        const result = await useCase.execute(input, {
          onWorkflowStage: (stage) => {
            emitStageUpdate(stage.stage, stage.status, stage.detail);
          },
          onReasoningStep: (message) => {
            emitReasoningStep(message);
          },
        });
        latestRouteInfo = result.routing;
        latestFinalStatus = result.status;
        const payload = toApiResponse(result);

        if (Array.isArray(result.workflowTrace)) {
          for (const trace of result.workflowTrace) {
            emitStageUpdate(trace.stage, trace.status, trace.detail);
          }
        }

        if (result.routing?.reasons?.length) {
          for (const reason of result.routing.reasons) {
            emitReasoningStep(reason);
          }
        }

        if (result.rounds.length > 0) {
          for (const round of result.rounds) {
            emitReasoningStep(
              `第${round.roundNumber}轮：分歧指数=${round.dissentIndex.toFixed(3)}，分歧带=${round.dissentBand}`,
            );
          }
        }

        if (payload.status === 'ERROR') {
          if (inputForSnapshot) {
            governanceReviewQueueService?.recordFromTriage({
              request: inputForSnapshot,
              response: payload,
            });
          }
          if (stageRuntime.REVIEW.status === 'pending') {
            emitStageUpdate('REVIEW', 'blocked', '流程提前终止，未进入安全复核');
          }
          if (stageRuntime.OUTPUT.status === 'pending') {
            emitStageUpdate('OUTPUT', 'failed', '流程提前终止，未生成输出结论');
          }
          await maybeEmitModelSnapshot(true, true);
          writeStreamEvent(response, {
            type: 'clarification_request',
            timestamp: nowIso(),
            requiredFields: payload.requiredFields ?? [],
            question: buildClarificationQuestion(payload.requiredFields ?? []),
            nextAction:
              payload.nextAction
              ?? resolveNextAction({
                errorCode: payload.errorCode,
                requiredFields: payload.requiredFields,
              }),
          });
          writeStreamEvent(response, {
            type: 'error',
            timestamp: nowIso(),
            errorCode: payload.errorCode ?? 'ERR_MISSING_REQUIRED_DATA',
            message: payload.notes.join('；') || '请求失败',
            requiredFields: payload.requiredFields,
            blockingReason: payload.blockingReason,
            nextAction:
              payload.nextAction
              ?? resolveNextAction({
                errorCode: payload.errorCode,
                requiredFields: payload.requiredFields,
              }),
          });
          writeStreamEvent(response, {
            type: 'final_result',
            timestamp: nowIso(),
            result: payload,
          });
          completeTelemetry(payload);
          response.end();
          return;
        }

        if (inputForSnapshot) {
          governanceReviewQueueService?.recordFromTriage({
            request: inputForSnapshot,
            response: payload,
          });
        }
        await maybeEmitModelSnapshot(true, true);
        const summaryText = buildTypewriterSummary(result);
        for (const token of summaryText) {
          writeStreamEvent(response, {
            type: 'token',
            timestamp: nowIso(),
            token,
          });
        }

        writeStreamEvent(response, {
          type: 'final_result',
          timestamp: nowIso(),
          result: payload,
        });
        completeTelemetry(payload);
        response.end();
      } catch (error) {
        const validationError =
          error instanceof RequestValidationError ? error : undefined;
        const fallbackSessionId =
          inputForSnapshot?.requestId
          || inputForSnapshot?.sessionId
          || `stream-runtime-${Date.now()}`;
        const auditRef = `audit_${fallbackSessionId}`;
        const errorPayload = buildErrorResponse(
          validationError?.errorCode ?? 'ERR_CONFLICT_UNRESOLVED',
          validationError?.message ?? 'Unexpected runtime error. See backend logs.',
          {
            requiredFields: validationError ? ['profile'] : undefined,
            auditRef,
            ruleGovernance: buildValidationErrorGovernanceSnapshot({
              sessionId: fallbackSessionId,
              auditRef,
              errorCode:
                validationError?.errorCode ?? 'ERR_CONFLICT_UNRESOLVED',
            }),
          },
        );
        latestFinalStatus = 'ERROR';
        if (stageRuntime.REVIEW.status === 'pending') {
          emitStageUpdate('REVIEW', 'blocked', '流程异常终止，未进入安全复核');
        }
        if (stageRuntime.OUTPUT.status === 'pending') {
          emitStageUpdate('OUTPUT', 'failed', '流程异常终止，未生成输出结论');
        }
        emitRuleSnapshot(true, true);
        writeStreamEvent(response, {
          type: 'error',
          timestamp: nowIso(),
          errorCode: errorPayload.errorCode,
          message: errorPayload.notes.join('；'),
          requiredFields: errorPayload.requiredFields,
          blockingReason: errorPayload.blockingReason,
          nextAction: errorPayload.nextAction,
        });
        writeStreamEvent(response, {
          type: 'final_result',
          timestamp: nowIso(),
          result: errorPayload,
        });
        if (inputForSnapshot) {
          governanceReviewQueueService?.recordFromTriage({
            request: inputForSnapshot,
            response: errorPayload,
          });
        }
        failTelemetry(errorPayload.errorCode);
        response.end();
      } finally {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (modelSnapshotTimer) {
          clearInterval(modelSnapshotTimer);
          modelSnapshotTimer = null;
        }
      }
    },
  );

  return router;
}


