import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type {
  TriageApiResponse,
  TriageRequest,
  WorkflowStage,
} from '@copilot-care/shared/types';
import { useConsultationStreamState } from './useConsultationStreamState';
import {
  useConsultationSessionRunner,
  type ConsultationChatMessage,
  type ConsultationInputForm,
  type ConsultationRunnerUiStatus,
} from './useConsultationSessionRunner';

function createInitialStageRuntime() {
  return {
    START: { status: 'pending', message: '等待启动' },
    INFO_GATHER: { status: 'pending', message: '等待采集信息' },
    RISK_ASSESS: { status: 'pending', message: '等待风险评估' },
    ROUTING: { status: 'pending', message: '等待分流决策' },
    DEBATE: { status: 'pending', message: '等待讨论' },
    CONSENSUS: { status: 'pending', message: '等待共识收敛' },
    REVIEW: { status: 'pending', message: '等待审校复核' },
    OUTPUT: { status: 'pending', message: '等待输出' },
    ESCALATION: { status: 'pending', message: '按需触发' },
  };
}

function createDefaultForm(): ConsultationInputForm {
  return {
    symptomText: '头晕伴血压波动',
    age: 56,
    sex: 'male',
    chronicDiseasesText: 'Hypertension',
    medicationHistoryText: 'amlodipine',
    systolicBPText: '148',
    diastolicBPText: '95',
    consentToken: 'consent_local_demo',
  };
}

function createRequestFromForm(form: ConsultationInputForm): TriageRequest {
  return {
    requestId: 'req-test',
    symptomText: form.symptomText,
    contextVersion: 'v4.30',
    consentToken: form.consentToken,
    profile: {
      patientId: 'demo-1',
      age: form.age,
      sex: form.sex,
      chiefComplaint: form.symptomText,
      symptoms: [form.symptomText],
      chronicDiseases: form.chronicDiseasesText ? [form.chronicDiseasesText] : [],
      medicationHistory: form.medicationHistoryText ? [form.medicationHistoryText] : [],
      allergyHistory: [],
      lifestyleTags: [],
    },
  };
}

interface CreateRunnerOptions {
  validateInput?: () => string | null;
  streamRequest?: (
    payload: TriageRequest,
    options: { signal?: AbortSignal; onEvent: (event: any) => void },
  ) => Promise<void>;
  classifyReasoningKind?: (
    message: string,
  ) => 'system' | 'evidence' | 'decision' | 'warning' | 'query';
  createDemoSteps?: (
    items: Array<{ kind: string; text: string; stage?: string }>,
    stageRuntime: Record<string, { status: string; message: string }>,
  ) => Array<{ id: string; title: string; description: string }>;
}

function createRunner(options: CreateRunnerOptions = {}) {
  const form = ref<ConsultationInputForm>(createDefaultForm());
  const status = ref<ConsultationRunnerUiStatus>('IDLE');
  const microStatus = ref('等待输入需求。');
  const showAdvancedInputs = ref(false);
  const messages = ref<ConsultationChatMessage[]>([]);

  const streamState = useConsultationStreamState({
    createInitialStageRuntime,
  });

  const initDemoSteps = vi.fn();

  const runner = useConsultationSessionRunner({
    status,
    microStatus,
    showAdvancedInputs,
    messages,
    streamState,
    validateInput: options.validateInput ?? (() => null),
    buildRequestPayload: () => createRequestFromForm(form.value),
    classifyReasoningKind: options.classifyReasoningKind ?? (() => 'system'),
    formatRequiredField: (field: string) => field,
    stageLabels: {
      START: '启动',
      INFO_GATHER: '信息采集',
      RISK_ASSESS: '风险评估',
      ROUTING: '复杂度分流',
      DEBATE: '协同讨论',
      CONSENSUS: '共识收敛',
      REVIEW: '审校复核',
      OUTPUT: '输出结论',
      ESCALATION: '线下上转',
    },
    statusLabels: {
      IDLE: '待会诊',
      OUTPUT: '会诊完成',
      ESCALATE_TO_OFFLINE: '建议线下上转',
      ABSTAIN: '暂缓结论',
      ERROR: '会诊异常',
    },
    snapshotPhaseLabels: {
      assignment: '任务拆分',
      analysis: '证据分析',
      execution: '协同执行',
      synthesis: '汇总结论',
      complete: '最终汇报',
    },
    createDemoSteps: options.createDemoSteps ?? (() => []),
    initDemoSteps,
    streamRequest: options.streamRequest,
  });

  return {
    status,
    microStatus,
    showAdvancedInputs,
    messages,
    streamState,
    initDemoSteps,
    runner,
  };
}

function createSuccessResponse(): Exclude<TriageApiResponse, { status: 'ERROR' }> {
  return {
    sessionId: 'session-1',
    status: 'OUTPUT',
    rounds: [],
    routing: {
      routeMode: 'LIGHT_DEBATE',
      complexityScore: 3,
      department: 'cardiology',
      collaborationMode: 'SINGLE_SPECIALTY_PANEL',
      reasons: ['复杂度中等'],
    },
    triageResult: {
      patientId: 'demo-1',
      triageLevel: 'routine',
      destination: 'cardiology clinic',
      followupDays: 7,
      educationAdvice: ['保持监测'],
    },
    explainableReport: {
      conclusion: '短期内继续观察并复查。',
      evidence: ['血压波动'],
      basis: ['门诊记录'],
      actions: ['一周后复诊'],
    },
    finalConsensus: {
      agentId: 'safety-1',
      agentName: '安全审校Agent',
      role: 'Safety',
      riskLevel: 'L1',
      confidence: 0.92,
      reasoning: '建议复查',
      citations: [],
      actions: ['复查'],
    },
    workflowTrace: [
      {
        stage: 'ROUTING',
        status: 'done',
        detail: '分流完成',
        timestamp: new Date().toISOString(),
      },
    ],
    dissentIndexHistory: [],
    ruleGovernance: {
      catalogVersion: '2026.03-r1',
      synonymSetVersion: '2026.03-r1',
      matchedRuleIds: ['RULE-FC-MIS-GATE', 'RULE-OPS-GOVERNANCE-RELEASE-LINK'],
      guidelineRefs: ['NICE_NG136_2026'],
      layerDecisions: [
        {
          layer: 'FLOW_CONTROL',
          status: 'pass',
          summary: 'Input gate passed.',
          matchedRuleIds: ['RULE-FC-MIS-GATE'],
        },
      ],
      evidenceTraceId: 'audit_session-1',
    },
    notes: ['自动化完成'],
    auditTrail: [],
  };
}

describe('useConsultationSessionRunner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('blocks submit when validation fails', async () => {
    const streamRequest = vi.fn();
    const state = createRunner({
      validateInput: () => '请先补充主诉。',
      streamRequest,
    });

    await state.runner.submitConsultation();

    expect(streamRequest).not.toHaveBeenCalled();
    expect(state.microStatus.value).toBe('请先补充主诉。');
    expect(state.messages.value).toEqual([
      { role: 'system', content: '请先补充主诉。' },
    ]);
    expect(state.runner.loading.value).toBe(false);
  });

  it('consumes stream events and updates runtime on success path', async () => {
    const success = createSuccessResponse();

    const streamRequest = vi.fn(async (_payload, options) => {
      options.onEvent({
        type: 'stage_update',
        timestamp: new Date().toISOString(),
        stage: 'ROUTING' as WorkflowStage,
        status: 'running',
        message: '开始分流',
      });
      options.onEvent({
        type: 'stage_update',
        timestamp: new Date().toISOString(),
        stage: 'ROUTING' as WorkflowStage,
        status: 'done',
        message: '分流完成',
      });
      options.onEvent({
        type: 'reasoning_step',
        timestamp: new Date().toISOString(),
        message: '证据链闭环',
      });
      options.onEvent({
        type: 'token',
        timestamp: new Date().toISOString(),
        token: 'A',
      });
      options.onEvent({
        type: 'token',
        timestamp: new Date().toISOString(),
        token: 'B',
      });
      options.onEvent({
        type: 'final_result',
        timestamp: new Date().toISOString(),
        result: success,
      });
    });

    const createDemoSteps = vi.fn(() => [
      {
        id: 'step-1',
        title: '输出',
        description: '已完成',
      },
    ]);

    const state = createRunner({
      streamRequest,
      createDemoSteps,
    });

    await state.runner.submitConsultation();
    await vi.advanceTimersByTimeAsync(500);

    expect(streamRequest).toHaveBeenCalledTimes(1);
    expect(state.status.value).toBe('OUTPUT');
    expect(state.streamState.routeInfo.value?.department).toBe('cardiology');
    expect(state.streamState.ruleGovernance.value?.catalogVersion).toBe(
      '2026.03-r1',
    );
    expect(state.streamState.stageRuntime.value.ROUTING.status).toBe('done');
    expect(state.runner.typedOutput.value).toContain('AB');
    expect(state.microStatus.value).toContain('会诊完成');
    expect(createDemoSteps).toHaveBeenCalledTimes(1);
    expect(state.initDemoSteps).toHaveBeenCalledTimes(1);
    expect(state.runner.loading.value).toBe(false);
    expect(state.messages.value.some((item) => item.role === 'user')).toBe(true);
    expect(state.messages.value.some((item) => item.role === 'system')).toBe(true);
  });

  it('attaches running stage and evidence kind for authoritative search reasoning step', async () => {
    const success = createSuccessResponse();
    const classifyReasoningKind = vi.fn((message: string) => {
      return message.includes('权威医学联网检索') ? 'evidence' : 'system';
    });

    const streamRequest = vi.fn(async (_payload, streamOptions) => {
      streamOptions.onEvent({
        type: 'stage_update',
        timestamp: new Date().toISOString(),
        stage: 'INFO_GATHER' as WorkflowStage,
        status: 'running',
        message: '信息采集中',
      });
      streamOptions.onEvent({
        type: 'reasoning_step',
        timestamp: new Date().toISOString(),
        message: '权威医学联网检索命中 3 条（来源：PUBMED）。',
      });
      streamOptions.onEvent({
        type: 'final_result',
        timestamp: new Date().toISOString(),
        result: success,
      });
    });

    const state = createRunner({
      streamRequest,
      classifyReasoningKind,
    });

    await state.runner.submitConsultation();
    await vi.advanceTimersByTimeAsync(300);

    const evidenceItem = state.streamState.reasoningItems.value.find(
      (item) => item.text === '权威医学联网检索命中 3 条（来源：PUBMED）。',
    );
    expect(classifyReasoningKind).toHaveBeenCalledWith(
      '权威医学联网检索命中 3 条（来源：PUBMED）。',
    );
    expect(evidenceItem?.kind).toBe('evidence');
    expect(evidenceItem?.stage).toBe('INFO_GATHER');
  });

  it('builds fallback typewriter text when stream emits no token', async () => {
    const success = createSuccessResponse();
    const streamRequest = vi.fn(async (_payload, options) => {
      options.onEvent({
        type: 'final_result',
        timestamp: new Date().toISOString(),
        result: success,
      });
    });

    const state = createRunner({ streamRequest });

    await state.runner.submitConsultation();
    await vi.advanceTimersByTimeAsync(3000);

    expect(state.runner.typedOutput.value).toContain('结论：短期内继续观察并复查。');
    expect(state.runner.typedOutput.value).toContain('分诊：常规（L1）');
  });

  it('shows clarification and error state when stream reports required fields', async () => {
    const streamRequest = vi.fn(async (_payload, options) => {
      options.onEvent({
        type: 'clarification_request',
        timestamp: new Date().toISOString(),
        question: '请补充收缩压',
        requiredFields: ['systolicBP'],
        nextAction: 'Provide missing fields (systolic blood pressure) and resubmit triage.',
      });
      options.onEvent({
        type: 'error',
        timestamp: new Date().toISOString(),
        errorCode: 'ERR_MISSING_REQUIRED_DATA',
        message: '缺少收缩压',
        requiredFields: ['systolicBP'],
        nextAction: 'Provide missing fields (systolic blood pressure) and resubmit triage.',
      });
      options.onEvent({
        type: 'final_result',
        timestamp: new Date().toISOString(),
        result: {
          status: 'ERROR',
          errorCode: 'ERR_MISSING_REQUIRED_DATA',
          notes: ['缺少收缩压'],
          requiredFields: ['systolicBP'],
          nextAction: 'Provide missing fields (systolic blood pressure) and resubmit triage.',
          ruleGovernance: {
            catalogVersion: '2026.03-r1',
            matchedRuleIds: ['RULE-FC-MIS-GATE'],
            guidelineRefs: [],
            layerDecisions: [
              {
                layer: 'FLOW_CONTROL',
                status: 'fail',
                summary: 'Validation blocked.',
              },
            ],
            evidenceTraceId: 'audit_validation',
          },
        },
      });
    });

    const state = createRunner({ streamRequest });

    await state.runner.submitConsultation();
    await vi.advanceTimersByTimeAsync(200);

    expect(state.status.value).toBe('ERROR');
    expect(state.showAdvancedInputs.value).toBe(true);
    expect(state.streamState.requiredFields.value).toContain('systolicBP');
    expect(state.streamState.nextAction.value).toContain('Provide missing fields');
    expect(state.streamState.ruleGovernance.value?.catalogVersion).toBe(
      '2026.03-r1',
    );
    expect(state.streamState.clarificationQuestion.value).toContain('请补充');
    expect(state.streamState.systemError.value).toBe('ERR_MISSING_REQUIRED_DATA');
    expect(state.messages.value[state.messages.value.length - 1]?.content).toContain(
      '会诊未完成',
    );
  });
});
