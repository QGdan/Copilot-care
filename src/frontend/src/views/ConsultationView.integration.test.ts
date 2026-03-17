import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConsultationView from './ConsultationView.vue';

const {
  loadEchartsInitMock,
  orchestrateTriageStreamMock,
  createJsPdfInstanceMock,
  html2canvasMock,
  createObjectURLMock,
  revokeObjectURLMock,
} = vi.hoisted(() => ({
  loadEchartsInitMock: vi.fn(),
  orchestrateTriageStreamMock: vi.fn(),
  createJsPdfInstanceMock: vi.fn(),
  html2canvasMock: vi.fn(),
  createObjectURLMock: vi.fn(() => 'blob:mock-report'),
  revokeObjectURLMock: vi.fn(),
}));

vi.mock('../composables/useEchartsRuntime', () => ({
  loadEchartsInit: loadEchartsInitMock,
}));

vi.mock('../services/triageApi', () => ({
  orchestrateTriageStream: orchestrateTriageStreamMock,
}));

vi.mock('jspdf', () => ({
  jsPDF: function JsPDFMock(...args: unknown[]) {
    return createJsPdfInstanceMock(...args);
  },
}));

vi.mock('html2canvas', () => ({
  default: html2canvasMock,
}));

const StubPatientDataSelector = defineComponent({
  name: 'PatientDataSelector',
  emits: ['patient-selected', 'insights-loaded', 'patient-loaded'],
  template: '<div data-testid="patient-selector"></div>',
});

const StubWorkflowStateMachine = defineComponent({
  name: 'WorkflowStateMachine',
  template: '<div data-testid="workflow-state-machine"></div>',
});

const StubComplexityRoutingTree = defineComponent({
  name: 'ComplexityRoutingTree',
  template: '<div data-testid="complexity-routing-tree"></div>',
});

const StubReasoningTraceTimeline = defineComponent({
  name: 'ReasoningTraceTimeline',
  template: '<div data-testid="reasoning-trace-timeline"></div>',
});

const StubDemoModePanel = defineComponent({
  name: 'DemoModePanel',
  template: '<div data-testid="demo-mode-panel"></div>',
});

const StubCoordinatorTaskBoard = defineComponent({
  name: 'CoordinatorTaskBoard',
  template: '<div data-testid="coordinator-task-board"></div>',
});

const StubThinkingGraph = defineComponent({
  name: 'ThinkingGraph',
  template: '<div data-testid="thinking-graph"></div>',
});

const StubConsultationReasoningCockpitCard = defineComponent({
  name: 'ConsultationReasoningCockpitCard',
  template: '<div data-testid="reasoning-cockpit"></div>',
});

const StubConsultationResultPanel = defineComponent({
  name: 'ConsultationResultPanel',
  props: {
    canExportReport: { type: Boolean, required: true },
    exportingReport: { type: Boolean, required: true },
    reportExportError: { type: String, required: true },
    reportExportSuccess: { type: String, required: true },
    blockingReason: { type: Object, required: false, default: null },
    isSafetyBlocked: { type: Boolean, required: true },
    safetyBlockNote: { type: String, required: true },
  },
  emits: ['export'],
  template: `
    <div data-testid="consultation-result-panel">
      <button
        data-testid="export-report-btn"
        :disabled="!canExportReport || exportingReport"
        @click="$emit('export')"
      >
        导出报告
      </button>
      <p v-if="reportExportError">{{ reportExportError }}</p>
      <p v-else-if="reportExportSuccess">{{ reportExportSuccess }}</p>
      <p v-if="isSafetyBlocked">{{ safetyBlockNote }}</p>
    </div>
  `,
});

function createChartMock() {
  return {
    setOption: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  };
}

interface MockPdfDocument {
  internal: {
    pageSize: {
      getWidth: () => number;
      getHeight: () => number;
    };
  };
  addPage: () => void;
  addImage: (
    imageData: string,
    format: string,
    x: number,
    y: number,
    width: number,
    height: number,
    alias?: string,
    compression?: string,
  ) => void;
  getNumberOfPages: () => number;
  setPage: (page: number) => void;
  setFontSize: (size: number) => void;
  setTextColor: (r: number, g: number, b: number) => void;
  text: (
    text: string,
    x: number,
    y: number,
    options?: { align?: 'left' | 'center' | 'right' | 'justify' },
  ) => void;
  save: (fileName: string) => void;
}

function createMockCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function createMockPdfDocument(): MockPdfDocument {
  let pageCount = 1;

  return {
    internal: {
      pageSize: {
        getWidth: () => 595,
        getHeight: () => 842,
      },
    },
    addPage: vi.fn(() => {
      pageCount += 1;
    }),
    addImage: vi.fn(),
    getNumberOfPages: vi.fn(() => pageCount),
    setPage: vi.fn(),
    setFontSize: vi.fn(),
    setTextColor: vi.fn(),
    text: vi.fn(),
    save: vi.fn(),
  };
}

function mountConsultationView() {
  return mount(ConsultationView, {
    global: {
      stubs: {
        PatientDataSelector: StubPatientDataSelector,
        WorkflowStateMachine: StubWorkflowStateMachine,
        ComplexityRoutingTree: StubComplexityRoutingTree,
        ReasoningTraceTimeline: StubReasoningTraceTimeline,
        DemoModePanel: StubDemoModePanel,
        CoordinatorTaskBoard: StubCoordinatorTaskBoard,
        ThinkingGraph: StubThinkingGraph,
        ConsultationReasoningCockpitCard: StubConsultationReasoningCockpitCard,
        ConsultationResultPanel: StubConsultationResultPanel,
      },
    },
  });
}

function getSubmitButton(wrapper: ReturnType<typeof mountConsultationView>) {
  const submitButton = wrapper
    .findAll('button')
    .find((button) => button.text().includes('提交会诊'));
  if (!submitButton) {
    throw new Error('submit button not found');
  }
  return submitButton;
}

async function submitWithSymptom(
  wrapper: ReturnType<typeof mountConsultationView>,
  symptomText: string = '胸闷伴头晕，近期血压波动',
): Promise<void> {
  const symptomInput = wrapper.find('textarea');
  await symptomInput.setValue(symptomText);
  await getSubmitButton(wrapper).trigger('click');
  await flushPromises();
}

async function waitForAssertion(
  assertion: () => void,
  maxAttempts: number = 12,
): Promise<void> {
  for (let index = 0; index < maxAttempts; index += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      if (index === maxAttempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      await flushPromises();
    }
  }
}

function createOutputFinalResult() {
  return {
    sessionId: 'session-smoke',
    status: 'OUTPUT' as const,
    rounds: [],
    routing: {
      complexityScore: 3.4,
      routeMode: 'LIGHT_DEBATE' as const,
      department: 'cardiology' as const,
      collaborationMode: 'SINGLE_SPECIALTY_PANEL' as const,
      reasons: ['复杂度中等'],
    },
    triageResult: {
      patientId: 'demo-smoke',
      triageLevel: 'routine' as const,
      destination: 'cardiology clinic',
      followupDays: 7,
      educationAdvice: ['复查血压'],
    },
    explainableReport: {
      conclusion: '建议一周内门诊复查',
      evidence: ['血压波动'],
      basis: ['既往病史'],
      actions: ['复查'],
    },
    finalConsensus: undefined,
    workflowTrace: [],
    dissentIndexHistory: [],
    notes: ['smoke'],
    auditTrail: [],
  };
}

describe('ConsultationView integration smoke', () => {
  beforeEach(() => {
    const initChart = vi.fn(() => createChartMock());
    loadEchartsInitMock.mockReset();
    loadEchartsInitMock.mockResolvedValue(initChart);
    orchestrateTriageStreamMock.mockReset();
    createJsPdfInstanceMock.mockReset();
    createJsPdfInstanceMock.mockReturnValue(createMockPdfDocument());
    html2canvasMock.mockReset();
    html2canvasMock.mockResolvedValue(createMockCanvas(1000, 3000));
    createObjectURLMock.mockClear();
    revokeObjectURLMock.mockClear();

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectURLMock,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeObjectURLMock,
    });

    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      const gradient = { addColorStop: vi.fn() };
      return {
        canvas: document.createElement('canvas'),
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({
          data: new Uint8ClampedArray([
            0, 0, 0, 255,
            0, 0, 0, 255,
            0, 0, 0, 255,
            255, 255, 255, 255,
          ]),
        })),
        measureText: vi.fn((text: string) => ({ width: text.length * 7 })),
        fillText: vi.fn(),
        strokeText: vi.fn(),
        beginPath: vi.fn(),
        closePath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        arc: vi.fn(),
        rect: vi.fn(),
        clip: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        setTransform: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        scale: vi.fn(),
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
        createLinearGradient: vi.fn(() => gradient),
        createRadialGradient: vi.fn(() => gradient),
        setLineDash: vi.fn(),
      } as unknown as CanvasRenderingContext2D;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,fake',
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows validation message and does not call stream when symptom is empty', async () => {
    const wrapper = mountConsultationView();

    await getSubmitButton(wrapper).trigger('click');
    await flushPromises();

    expect(orchestrateTriageStreamMock).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('请先输入当前症状或需求描述。');
  });

  it('submits consultation and reaches completion status without runtime crash', async () => {
    orchestrateTriageStreamMock.mockImplementationOnce(async (_payload, options) => {
      options.onEvent({
        type: 'stage_update',
        timestamp: new Date().toISOString(),
        stage: 'ROUTING',
        status: 'done',
        message: '分流完成',
      });
      options.onEvent({
        type: 'final_result',
        timestamp: new Date().toISOString(),
        result: createOutputFinalResult(),
      });
    });

    const wrapper = mountConsultationView();
    await submitWithSymptom(wrapper);

    expect(orchestrateTriageStreamMock).toHaveBeenCalledTimes(1);

    const payload = orchestrateTriageStreamMock.mock.calls[0]?.[0] as {
      symptomText?: string;
      profile?: { chiefComplaint?: string };
    };
    expect(payload.symptomText).toBe('胸闷伴头晕，近期血压波动');
    expect(payload.profile?.chiefComplaint).toBe('胸闷伴头晕，近期血压波动');
    expect(wrapper.text()).toContain('会诊完成');
  });

  it('uses selected patient context when building triage request payload', async () => {
    orchestrateTriageStreamMock.mockImplementationOnce(async (_payload, options) => {
      options.onEvent({
        type: 'final_result',
        timestamp: new Date().toISOString(),
        result: createOutputFinalResult(),
      });
    });

    const wrapper = mountConsultationView();
    const selector = wrapper.getComponent(StubPatientDataSelector);
    selector.vm.$emit('patient-selected', 'patient-777');
    selector.vm.$emit('patient-loaded', {
      patientId: 'patient-777',
      patientData: {
        patientId: 'patient-777',
        age: 61,
        sex: 'female',
        chiefComplaint: 'headache and dizziness',
        chronicDiseases: ['Hypertension'],
        medicationHistory: ['amlodipine'],
      },
    });
    await flushPromises();

    await getSubmitButton(wrapper).trigger('click');
    await flushPromises();

    expect(orchestrateTriageStreamMock).toHaveBeenCalledTimes(1);
    const payload = orchestrateTriageStreamMock.mock.calls[0]?.[0] as {
      symptomText?: string;
      profile?: {
        patientId?: string;
        age?: number;
        sex?: string;
        chiefComplaint?: string;
      };
    };
    expect(payload.profile?.patientId).toBe('patient-777');
    expect(payload.profile?.age).toBe(61);
    expect(payload.profile?.sex).toBe('female');
    expect(payload.profile?.chiefComplaint).toBe('headache and dizziness');
    expect(payload.symptomText).toBe('headache and dizziness');
  });

  it('normalizes selected patient age from string payload before triage submit', async () => {
    orchestrateTriageStreamMock.mockImplementationOnce(async (_payload, options) => {
      options.onEvent({
        type: 'final_result',
        timestamp: new Date().toISOString(),
        result: createOutputFinalResult(),
      });
    });

    const wrapper = mountConsultationView();
    const selector = wrapper.getComponent(StubPatientDataSelector);
    selector.vm.$emit('patient-selected', 'patient-5566');
    selector.vm.$emit('patient-loaded', {
      patientId: 'patient-5566',
      patientData: {
        patientId: 'patient-5566',
        age: '56',
        sex: 'male',
        chiefComplaint: 'dizziness and fatigue',
      },
    });
    await flushPromises();

    await getSubmitButton(wrapper).trigger('click');
    await flushPromises();

    expect(orchestrateTriageStreamMock).toHaveBeenCalledTimes(1);
    const payload = orchestrateTriageStreamMock.mock.calls[0]?.[0] as {
      profile?: {
        patientId?: string;
        age?: number;
        sex?: string;
        chiefComplaint?: string;
      };
    };
    expect(payload.profile?.patientId).toBe('patient-5566');
    expect(payload.profile?.age).toBe(56);
    expect(payload.profile?.sex).toBe('male');
    expect(payload.profile?.chiefComplaint).toBe('dizziness and fatigue');
  });

  it('exports consultation report as pdf when exporter succeeds', async () => {
    orchestrateTriageStreamMock.mockImplementationOnce(async (_payload, options) => {
      options.onEvent({
        type: 'final_result',
        timestamp: new Date().toISOString(),
        result: createOutputFinalResult(),
      });
    });

    const wrapper = mountConsultationView();
    await submitWithSymptom(wrapper);

    await wrapper.get('[data-testid="export-report-btn"]').trigger('click');
    await waitForAssertion(() => {
      expect(wrapper.text()).toContain('报告导出成功（PDF）。');
    });
  });

  it('shows fallback success message when exporter returns txt outcome', async () => {
    html2canvasMock.mockRejectedValueOnce(new Error('canvas failed'));
    orchestrateTriageStreamMock.mockImplementationOnce(async (_payload, options) => {
      options.onEvent({
        type: 'final_result',
        timestamp: new Date().toISOString(),
        result: createOutputFinalResult(),
      });
    });

    const wrapper = mountConsultationView();
    await submitWithSymptom(wrapper);

    await wrapper.get('[data-testid="export-report-btn"]').trigger('click');
    await waitForAssertion(() => {
      expect(wrapper.text()).toContain('PDF导出失败，已自动导出文本报告（UTF-8）。');
    });
  });

  it('switches reasoning integration hint from rule to model snapshot source', async () => {
    orchestrateTriageStreamMock.mockImplementationOnce(async (_payload, options) => {
      options.onEvent({
        type: 'stage_update',
        timestamp: new Date().toISOString(),
        stage: 'START',
        status: 'running',
        message: '已启动会诊',
      });
      options.onEvent({
        type: 'orchestration_snapshot',
        timestamp: new Date().toISOString(),
        snapshot: {
          coordinator: '总Agent',
          phase: 'analysis',
          summary: '规则编排分析中',
          tasks: [],
          graph: { nodes: [], edges: [] },
          generatedAt: new Date().toISOString(),
          source: 'rule',
        },
      });
      options.onEvent({
        type: 'orchestration_snapshot',
        timestamp: new Date().toISOString(),
        snapshot: {
          coordinator: '总Agent',
          phase: 'execution',
          summary: '模型编排执行中',
          tasks: [],
          graph: { nodes: [], edges: [] },
          generatedAt: new Date().toISOString(),
          source: 'model',
        },
      });
      options.onEvent({
        type: 'final_result',
        timestamp: new Date().toISOString(),
        result: createOutputFinalResult(),
      });
    });

    const wrapper = mountConsultationView();
    await submitWithSymptom(wrapper);

    const viewModel = wrapper.vm as unknown as {
      reasoningIntegrationText: string;
    };
    expect(viewModel.reasoningIntegrationText).toBe(
      'AI 实时编排已接入，展示动态推理图谱。',
    );
    expect(wrapper.text()).toContain('AI 实时编排已接入，展示动态推理图谱。');
  });

  it('enters red-flag escalation branch and keeps stage transitions consistent', async () => {
    orchestrateTriageStreamMock.mockImplementationOnce(async (_payload, options) => {
      options.onEvent({
        type: 'stage_update',
        timestamp: new Date().toISOString(),
        stage: 'ROUTING',
        status: 'done',
        message: '已完成路由判定',
      });
      options.onEvent({
        type: 'stage_update',
        timestamp: new Date().toISOString(),
        stage: 'DEBATE',
        status: 'done',
        message: '完成多模型复核',
      });
      options.onEvent({
        type: 'stage_update',
        timestamp: new Date().toISOString(),
        stage: 'ESCALATION',
        status: 'done',
        message: '安全审校触发，阻断线上建议',
      });
      options.onEvent({
        type: 'final_result',
        timestamp: new Date().toISOString(),
        result: {
          ...createOutputFinalResult(),
          status: 'ESCALATE_TO_OFFLINE',
          routing: {
            complexityScore: 8.8,
            routeMode: 'ESCALATE_TO_OFFLINE',
            department: 'multiDisciplinary',
            collaborationMode: 'OFFLINE_ESCALATION',
            reasons: ['红旗风险信号'],
          },
          notes: ['安全审校触发：阻断线上建议，建议立即线下上转。'],
        },
      });
    });

    const wrapper = mountConsultationView();
    await submitWithSymptom(wrapper, '胸痛伴出汗，症状进行性加重');

    const viewModel = wrapper.vm as unknown as {
      stageRuntime: Record<string, { status: string }>;
    };
    expect(viewModel.stageRuntime.ROUTING.status).toBe('done');
    expect(viewModel.stageRuntime.DEBATE.status).toBe('done');
    expect(viewModel.stageRuntime.ESCALATION.status).toBe('done');
    expect(wrapper.text()).toContain('建议线下上转');
    expect(wrapper.text()).toContain('安全审校触发：阻断线上建议，建议立即线下上转。');
  });
});
