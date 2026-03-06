import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportConsultationReport, generateReportText } from './reportExport';

const {
  createJsPdfInstanceMock,
  html2canvasMock,
  createObjectURLMock,
  revokeObjectURLMock,
} = vi.hoisted(() => ({
  createJsPdfInstanceMock: vi.fn(),
  html2canvasMock: vi.fn(),
  createObjectURLMock: vi.fn(() => 'blob:mock-report'),
  revokeObjectURLMock: vi.fn(),
}));

vi.mock('jspdf', () => ({
  jsPDF: function JsPDFMock(...args: unknown[]) {
    return createJsPdfInstanceMock(...args);
  },
}));

vi.mock('html2canvas', () => ({
  default: html2canvasMock,
}));

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

function createReportData() {
  return {
    patientProfile: {
      patientId: 'demo-1',
      age: 45,
      sex: 'male' as const,
      chiefComplaint: '头晕',
      chronicDiseases: ['高血压'],
      medicationHistory: ['氨氯地平'],
      allergyHistory: [],
      lifestyleTags: [],
      symptoms: ['头晕'],
    },
    triageResult: {
      patientId: 'demo-1',
      triageLevel: 'urgent' as const,
      destination: '心内科门诊',
      followupDays: 3,
      educationAdvice: ['保持休息'],
    },
    routing: {
      complexityScore: 0.72,
      routeMode: 'LIGHT_DEBATE' as const,
      department: 'cardiology' as const,
      collaborationMode: 'SINGLE_SPECIALTY_PANEL' as const,
      reasons: ['血压波动'],
    },
    explainableReport: {
      conclusion: '建议进一步检查',
      evidence: ['血压偏高'],
      basis: ['收缩压超阈值'],
      actions: ['复测血压'],
    },
    conclusion: '建议进一步检查',
    actions: ['复测血压'],
    evidence: ['收缩压超阈值'],
    notes: ['监测 24 小时'],
  };
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

describe('reportExport', () => {
  beforeEach(() => {
    createJsPdfInstanceMock.mockReset();
    html2canvasMock.mockReset();
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

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      return {
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({
          data: new Uint8ClampedArray([
            0, 0, 0, 255,
            0, 0, 0, 255,
            0, 0, 0, 255,
            255, 255, 255, 255,
          ]),
        })),
      } as unknown as CanvasRenderingContext2D;
    });

    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,fake',
    );

    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders html to canvas and exports multipage pdf', async () => {
    const mockPdf = createMockPdfDocument();
    createJsPdfInstanceMock.mockReturnValue(mockPdf);
    html2canvasMock.mockResolvedValue(createMockCanvas(1000, 3000));

    const beforeChildren = document.body.childElementCount;
    const outcome = await exportConsultationReport(createReportData());
    const afterChildren = document.body.childElementCount;

    expect(outcome.format).toBe('pdf');
    expect(outcome.fileName).toMatch(/^consultation-report-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(afterChildren).toBe(beforeChildren);
    expect(html2canvasMock).toHaveBeenCalledTimes(1);
    expect(mockPdf.addImage).toHaveBeenCalledTimes(3);
    expect(mockPdf.addPage).toHaveBeenCalledTimes(2);
    expect(mockPdf.text).toHaveBeenCalledTimes(3);
    expect(mockPdf.save).toHaveBeenCalledTimes(1);
    expect(createObjectURLMock).not.toHaveBeenCalled();
  });

  it('falls back to utf-8 text export when pdf rendering fails and cleans temporary DOM', async () => {
    const mockPdf = createMockPdfDocument();
    createJsPdfInstanceMock.mockReturnValue(mockPdf);
    html2canvasMock.mockRejectedValue(new Error('canvas failed'));

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const beforeChildren = document.body.childElementCount;
    const outcome = await exportConsultationReport(createReportData());
    const afterChildren = document.body.childElementCount;

    expect(outcome.format).toBe('txt');
    expect(outcome.fileName).toMatch(/^consultation-report-\d{4}-\d{2}-\d{2}\.txt$/);
    expect(afterChildren).toBe(beforeChildren);
    expect(mockPdf.save).not.toHaveBeenCalled();
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('generates readable plain text fallback with key sections', () => {
    const text = generateReportText(createReportData());

    expect(text).toContain('CoPilot Care 会诊报告');
    expect(text).toContain('【会诊结论】');
    expect(text).toContain('建议进一步检查');
    expect(text).toContain('【证据依据】');
  });

  it('uses explainable conclusion when explicit conclusion is blank and supports partial vitals', () => {
    const data = createReportData();
    data.conclusion = '   ';
    data.explainableReport = {
      ...data.explainableReport!,
      conclusion: '建议门诊复查并持续监测',
    };
    data.patientProfile.vitals = {
      systolicBP: 152,
    };

    const text = generateReportText(data);

    expect(text).toContain('【会诊结论】');
    expect(text).toContain('建议门诊复查并持续监测');
    expect(text).toContain('血压：152/-- mmHg');
  });

  it('filters blank and non-string list items from runtime payload', () => {
    const runtimeData = createReportData() as ReportData & {
      actions: unknown[];
      evidence: unknown[];
      notes: unknown[];
    };

    runtimeData.actions = ['  ', '复测血压', 123, null];
    runtimeData.evidence = [' 收缩压超阈值 ', undefined, false];
    runtimeData.notes = ['  ', '需 24 小时监测', { x: 1 }];

    const text = generateReportText(runtimeData as ReportData);

    expect(text).toContain('【建议措施】');
    expect(text).toContain('- 复测血压');
    expect(text).toContain('【证据依据】');
    expect(text).toContain('- 收缩压超阈值');
    expect(text).toContain('【备注】');
    expect(text).toContain('- 需 24 小时监测');
    expect(text).not.toContain('- 123');
    expect(text).not.toContain('[object Object]');
  });

  it('prefers structured evidence cards instead of raw link lines', () => {
    const data = createReportData();
    data.evidence = ['https://example.com/very/long/raw/link'];
    data.explainableReport = {
      ...data.explainableReport!,
      evidenceCards: [
        {
          id: 'card-1',
          category: 'authoritative_web',
          title: 'NICE 高血压指南',
          summary: '建议基于分层风险实施血压管理。',
          sourceId: 'NICE',
          sourceName: 'NICE Guidance',
          publishedOn: '2026-02-03',
          url: 'https://www.nice.org.uk/guidance/ng136',
        },
      ],
    };

    const text = generateReportText(data);

    expect(text).toContain('NICE 高血压指南');
    expect(text).toContain('英国国家卫生与临床优化研究所(NICE)');
    expect(text).toContain('来源：英国国家卫生与临床优化研究所(NICE)');
    expect(text).toContain('https://www.nice.org.uk/guidance/ng136');
    expect(text).not.toContain('https://example.com/very/long/raw/link');
  });

  it('extracts chinese evidence summary from english source text without template fallback', () => {
    const data = createReportData();
    data.explainableReport = {
      ...data.explainableReport!,
      evidenceCards: [
        {
          id: 'card-2',
          category: 'authoritative_web',
          title: 'Hypertension in adults: diagnosis and management',
          summary: 'Lifestyle interventions reduce blood pressure and cardiovascular risk.',
          sourceId: 'WHO',
          sourceName: 'World Health Organization',
        },
      ],
    };

    const text = generateReportText(data);

    expect(text).toContain('高血压');
    expect(text).toContain('生活方式干预');
    expect(text).toContain('世界卫生组织(WHO)');
    expect(text).not.toContain('该证据围绕');
    expect(text).not.toContain('...');
  });
});

