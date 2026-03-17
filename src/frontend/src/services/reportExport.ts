import { jsPDF } from 'jspdf';
import type {
  ExplainableEvidenceCard,
  ExplainableReport,
  PatientProfile,
  StructuredTriageResult,
  TriageRoutingInfo,
} from '@copilot-care/shared/types';
import {
  DEPARTMENT_LABELS,
  formatDestination,
  formatTriageLevel,
  ROUTE_MODE_LABELS,
} from '../constants/triageLabels';

export interface ReportData {
  patientProfile: PatientProfile;
  triageResult: StructuredTriageResult | null;
  routing: TriageRoutingInfo | null;
  explainableReport: ExplainableReport | null;
  conclusion: string;
  actions: string[];
  evidence: string[];
  notes: string[];
}

export interface ReportExportOutcome {
  format: 'pdf' | 'txt';
  fileName: string;
}

const REPORT_FILE_STEM = 'consultation-report';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(value: Date = new Date()): string {
  return value.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatSex(sex: string | undefined): string {
  if (sex === 'male') {
    return '男';
  }
  if (sex === 'female') {
    return '女';
  }
  return '其他';
}

function normalizeString(value: unknown): string {
  return typeof value === 'string'
    ? value.trim()
    : '';
}

function pickFirstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized.length > 0) {
      return normalized;
    }
  }
  return '';
}

function normalizeList(
  primary: readonly unknown[] | undefined,
  fallback: readonly unknown[] = [],
): string[] {
  const candidate = Array.isArray(primary) && primary.length > 0 ? primary : fallback;
  const normalized: string[] = [];
  for (const item of candidate) {
    const text = normalizeString(item);
    if (text.length > 0) {
      normalized.push(text);
    }
  }
  return normalized;
}

function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

function normalizeMedicalExpression(text: string): string {
  if (!text.trim()) {
    return '';
  }

  const dictionary: Array<[RegExp, string]> = [
    [/\bhypertension\b/gi, '高血压'],
    [/\badults?\b/gi, '成人'],
    [/\bdiagnosis\b/gi, '诊断'],
    [/\btreatment\b/gi, '治疗'],
    [/\bprevention\b/gi, '预防'],
    [/\btherapy\b/gi, '治疗'],
    [/\bsystolic\b/gi, '收缩压'],
    [/\bdiastolic\b/gi, '舒张压'],
    [/\bmmhg\b/gi, 'mmHg'],
    [/\btarget\b/gi, '目标'],
    [/\bthreshold\b/gi, '阈值'],
    [/\brecommended?\b/gi, '推荐'],
    [/\bshould\b/gi, '应当'],
    [/\bmonitoring\b/gi, '监测'],
    [/\boutcome\b/gi, '结局'],
    [/\bmortality\b/gi, '死亡率'],
    [/\bincidence\b/gi, '发生率'],
    [/\bblood pressure\b/gi, '血压'],
    [/\blifestyle interventions?\b/gi, '生活方式干预'],
    [/\bmanagement\b/gi, '管理'],
    [/\brisk\b/gi, '风险'],
    [/\bguidelines?\b/gi, '指南'],
    [/\bevidence\b/gi, '证据'],
    [/\bcardiovascular\b/gi, '心血管'],
    [/\bscreening\b/gi, '筛查'],
    [/\bfollow-up\b/gi, '随访'],
  ];

  let normalized = text.trim();
  dictionary.forEach(([pattern, replacement]) => {
    normalized = normalized.replace(pattern, replacement);
  });
  return normalized.replace(/\s+/g, ' ').trim();
}

function splitCandidateSentences(text: string): string[] {
  const normalized = text
    .replace(/\s+/g, ' ')
    .replace(/[;；]+/g, '。')
    .trim();
  if (!normalized) {
    return [];
  }

  const candidates = normalized
    .split(/[。.!?]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return candidates.length > 0 ? candidates : [normalized];
}

function scoreMedicalSentence(sentence: string): number {
  let score = 0;
  if (/\d/.test(sentence)) {
    score += 3;
  }
  if (
    /(mmhg|mg\/dl|%|风险|建议|应当|推荐|阈值|目标|收缩压|舒张压|血压|高血压|指南|证据)/i
      .test(sentence)
  ) {
    score += 3;
  }
  if (sentence.length >= 16 && sentence.length <= 140) {
    score += 2;
  }
  return score;
}

function extractEvidenceKeyPoint(card: ExplainableEvidenceCard): string {
  const primaryText = normalizeMedicalExpression(card.summary || '');
  const fallbackText = normalizeMedicalExpression(card.title || '');
  const combinedText = primaryText || fallbackText;

  if (!combinedText) {
    return '暂无可用证据正文，建议补充权威来源后再进行临床判断。';
  }

  const candidates = splitCandidateSentences(combinedText);
  if (candidates.length === 0) {
    return combinedText;
  }

  const ranked = candidates
    .map((sentence, index) => ({
      sentence,
      index,
      score: scoreMedicalSentence(sentence),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected = ranked
    .slice(0, 2)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.sentence);

  const keyPoint = selected.join('；').trim();
  if (keyPoint.length > 0) {
    return keyPoint;
  }

  return combinedText;
}

function resolveSourceNameToChinese(card: ExplainableEvidenceCard): string {
  const rawSource = card.sourceName || card.sourceId || '';
  const sourceText = `${card.sourceId ?? ''} ${card.sourceName ?? ''} ${card.url ?? ''}`
    .toUpperCase();

  if (!sourceText.trim()) {
    return '权威医学数据库';
  }
  if (sourceText.includes('WHO')) {
    return '世界卫生组织(WHO)';
  }
  if (sourceText.includes('NICE')) {
    return '英国国家卫生与临床优化研究所(NICE)';
  }
  if (sourceText.includes('CDC')) {
    return '美国疾病控制与预防中心(CDC)';
  }
  if (sourceText.includes('NIH')) {
    return '美国国立卫生研究院(NIH)';
  }
  if (sourceText.includes('NHC') || sourceText.includes('国家卫健')) {
    return '国家卫生健康委员会';
  }
  if (sourceText.includes('PUBMED')) {
    return 'PubMed 文献数据库';
  }
  if (sourceText.includes('COCHRANE')) {
    return 'Cochrane 系统评价数据库';
  }
  if (sourceText.includes('JAMA')) {
    return 'JAMA 医学期刊';
  }
  if (sourceText.includes('LANCET')) {
    return '柳叶刀医学期刊';
  }
  if (sourceText.includes('NEJM')) {
    return '新英格兰医学期刊';
  }
  if (sourceText.includes('BMJ')) {
    return '英国医学杂志(BMJ)';
  }
  return rawSource || '权威医学数据库';
}

function buildChineseEvidenceTitle(card: ExplainableEvidenceCard): string {
  const normalizedTitle = normalizeMedicalExpression(card.title || '');
  if (normalizedTitle && hasChinese(normalizedTitle)) {
    return normalizedTitle;
  }
  return `来自${resolveSourceNameToChinese(card)}的医学证据`;
}

function buildChineseEvidenceSummary(card: ExplainableEvidenceCard): string {
  const keyPoint = extractEvidenceKeyPoint(card);
  if (keyPoint && hasChinese(keyPoint)) {
    return keyPoint;
  }
  return normalizeMedicalExpression(keyPoint);
}

function formatEvidenceCardLine(card: ExplainableEvidenceCard): string {
  const title = buildChineseEvidenceTitle(card);
  const source = resolveSourceNameToChinese(card);
  const summary = buildChineseEvidenceSummary(card);
  const published = card.publishedOn ? `，${card.publishedOn}` : '';
  const link = card.url ? `；原文链接：${card.url}` : '';
  return `《${title}》（来源：${source}${published}）：${summary}${link}`;
}

function resolveReadableEvidence(report: ExplainableReport | null): string[] {
  const cards = report?.evidenceCards ?? [];
  if (!Array.isArray(cards) || cards.length === 0) {
    return [];
  }
  return cards
    .map((card) => formatEvidenceCardLine(card))
    .filter((item) => item.trim().length > 0);
}

function renderList(items: string[]): string {
  if (items.length === 0) {
    return '<li>无</li>';
  }

  return items
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('');
}

function buildReportHtml(data: ReportData): string {
  const patientId = pickFirstNonEmpty(data.patientProfile.patientId) || 'demo';
  const chiefComplaint = pickFirstNonEmpty(data.patientProfile.chiefComplaint) || '无';
  const chronicDiseases = normalizeList(data.patientProfile.chronicDiseases);
  const medicationHistory = normalizeList(data.patientProfile.medicationHistory);
  const systolicBP = data.patientProfile.vitals?.systolicBP;
  const diastolicBP = data.patientProfile.vitals?.diastolicBP;

  const patientInfo: string[] = [
    `患者 ID：${patientId}`,
    `年龄：${data.patientProfile.age ?? '未知'} 岁`,
    `性别：${formatSex(data.patientProfile.sex)}`,
    `主诉：${chiefComplaint}`,
  ];

  if (typeof systolicBP === 'number' || typeof diastolicBP === 'number') {
    const systolicText = typeof systolicBP === 'number' ? String(systolicBP) : '--';
    const diastolicText = typeof diastolicBP === 'number' ? String(diastolicBP) : '--';
    patientInfo.push(
      `血压：${systolicText}/${diastolicText} mmHg`,
    );
  }

  if (chronicDiseases.length > 0) {
    patientInfo.push(
      `慢病史：${chronicDiseases.join('、')}`,
    );
  }

  if (medicationHistory.length > 0) {
    patientInfo.push(
      `用药史：${medicationHistory.join('、')}`,
    );
  }

  const conclusion = pickFirstNonEmpty(data.conclusion, data.explainableReport?.conclusion) || '无';
  const actions = normalizeList(data.actions, data.explainableReport?.actions ?? []);
  const reportEvidence = resolveReadableEvidence(data.explainableReport);
  const evidence = normalizeList(
    reportEvidence.length > 0 ? reportEvidence : data.evidence,
    data.explainableReport?.basis ?? [],
  );
  const notes = normalizeList(data.notes).slice(0, 5);

  const triageLevel = data.triageResult?.triageLevel
    ? formatTriageLevel(data.triageResult.triageLevel)
    : '待定';
  const destination = data.triageResult?.destination
    ? formatDestination(data.triageResult.destination)
    : '待定';

  return `
<div style="
  width: 750px;
  color: #1f2937;
  font-family: 'Noto Sans SC', 'Source Han Sans SC', 'Microsoft YaHei', 'PingFang SC', sans-serif;
  line-height: 1.55;
  font-size: 14px;
  background: #ffffff;
  padding: 16px;
  border: 1px solid #d7e3ef;
  border-radius: 12px;
">
  <div style="border: 1px solid #cfe0ee; border-radius: 10px; padding: 12px; background: linear-gradient(120deg, #eef7ff 0%, #f6fafc 100%); margin-bottom: 14px;">
    <h1 style="margin: 0; font-size: 24px; color: #0f3e4b;">CoPilot Care 会诊报告</h1>
    <p style="margin: 6px 0 0; color: #64748b; font-size: 12px;">生成时间：${escapeHtml(formatDateTime())}</p>
  </div>

  <section style="margin-bottom: 12px; border: 1px solid #d8e4ef; border-radius: 8px; padding: 10px;">
    <h2 style="margin: 0 0 8px; font-size: 16px; color: #0f3e4b;">患者信息</h2>
    <ul style="margin: 0; padding-left: 20px;">
      ${patientInfo.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
    </ul>
  </section>

  ${
    data.routing
      ? `<section style="margin-bottom: 12px; border: 1px solid #d8e4ef; border-radius: 8px; padding: 10px;">
    <h2 style="margin: 0 0 8px; font-size: 16px; color: #0f3e4b;">分诊决策</h2>
    <ul style="margin: 0; padding-left: 20px;">
      <li>分诊科室：${escapeHtml(DEPARTMENT_LABELS[data.routing.department] || data.routing.department)}</li>
      <li>处理模式：${escapeHtml(ROUTE_MODE_LABELS[data.routing.routeMode] || data.routing.routeMode)}</li>
      <li>复杂度评分：${escapeHtml(String(data.routing.complexityScore ?? '无'))}</li>
    </ul>
  </section>`
      : ''
  }

  ${
    data.triageResult
      ? `<section style="margin-bottom: 12px; border: 1px solid #d8e4ef; border-radius: 8px; padding: 10px;">
    <h2 style="margin: 0 0 8px; font-size: 16px; color: #0f3e4b;">分诊结果</h2>
    <ul style="margin: 0; padding-left: 20px;">
      <li>分诊等级：${escapeHtml(triageLevel)}</li>
      <li>建议去向：${escapeHtml(destination)}</li>
    </ul>
  </section>`
      : ''
  }

  <section style="margin-bottom: 12px; border: 1px solid #d8e4ef; border-radius: 8px; padding: 10px;">
    <h2 style="margin: 0 0 8px; font-size: 16px; color: #0f3e4b;">会诊结论</h2>
    <p style="margin: 0;">${escapeHtml(conclusion)}</p>
  </section>

  <section style="margin-bottom: 12px; border: 1px solid #d8e4ef; border-radius: 8px; padding: 10px;">
    <h2 style="margin: 0 0 8px; font-size: 16px; color: #0f3e4b;">建议措施</h2>
    <ul style="margin: 0; padding-left: 20px;">
      ${renderList(actions)}
    </ul>
  </section>

  <section style="margin-bottom: 12px; border: 1px solid #d8e4ef; border-radius: 8px; padding: 10px;">
    <h2 style="margin: 0 0 8px; font-size: 16px; color: #0f3e4b;">证据依据</h2>
    <ul style="margin: 0; padding-left: 20px;">
      ${renderList(evidence.slice(0, 10))}
    </ul>
  </section>

  ${
    notes.length > 0
      ? `<section style="margin-bottom: 12px; border: 1px solid #d8e4ef; border-radius: 8px; padding: 10px;">
    <h2 style="margin: 0 0 8px; font-size: 16px; color: #0f3e4b;">备注</h2>
    <ul style="margin: 0; padding-left: 20px;">${renderList(notes)}</ul>
  </section>`
      : ''
  }

  <p style="margin: 20px 0 0; font-size: 12px; color: #64748b;">
    本报告由 CoPilot Care 智能辅助系统自动生成，仅供临床参考。
  </p>
</div>
`.trim();
}

function waitForNextRenderFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (
      typeof window === 'undefined'
      || typeof window.requestAnimationFrame !== 'function'
    ) {
      resolve();
      return;
    }

    window.requestAnimationFrame(() => resolve());
  });
}

function waitForFontsReady(timeoutMs: number = 2000): Promise<void> {
  const fontFaceSet = (document as Document & {
    fonts?: { ready: Promise<unknown> };
  }).fonts;

  if (!fontFaceSet?.ready) {
    return Promise.resolve();
  }

  return Promise.race([
    fontFaceSet.ready.then(() => undefined),
    new Promise<void>((resolve) => {
      setTimeout(() => resolve(), timeoutMs);
    }),
  ]);
}

function getReportDateTag(value: Date = new Date()): string {
  return value.toISOString().slice(0, 10);
}

function buildPdfFileName(): string {
  return `${REPORT_FILE_STEM}-${getReportDateTag()}.pdf`;
}

function buildTextFileName(): string {
  return `${REPORT_FILE_STEM}-${getReportDateTag()}.txt`;
}

function createHiddenRenderContainer(html: string): HTMLDivElement {
  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  container.style.position = 'fixed';
  container.style.left = '-10000px';
  container.style.top = '0';
  container.style.pointerEvents = 'none';
  container.style.width = '750px';
  container.style.maxWidth = '750px';
  container.style.background = '#ffffff';
  container.style.opacity = '1';
  container.innerHTML = html;
  return container;
}

function assertRenderableCanvas(canvas: HTMLCanvasElement): void {
  if (canvas.width <= 0 || canvas.height <= 0) {
    throw new Error('报告渲染失败：生成画布尺寸异常。');
  }

  const probe = document.createElement('canvas');
  probe.width = 32;
  probe.height = 32;

  const probeContext = probe.getContext('2d');
  if (!probeContext) {
    return;
  }

  probeContext.drawImage(canvas, 0, 0, probe.width, probe.height);
  const pixels = probeContext.getImageData(0, 0, probe.width, probe.height).data;
  let nonWhiteCount = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const alpha = pixels[index + 3];
    const notWhite =
      alpha > 0
      && (red < 245 || green < 245 || blue < 245);

    if (notWhite) {
      nonWhiteCount += 1;
      if (nonWhiteCount >= 3) {
        return;
      }
    }
  }

  throw new Error('报告渲染结果为空白。');
}

async function renderReportCanvas(container: HTMLElement): Promise<HTMLCanvasElement> {
  await waitForNextRenderFrame();
  await waitForFontsReady();
  const { default: html2canvas } = await import('html2canvas');
  const captureWidth = Math.max(
    container.scrollWidth,
    container.clientWidth,
    container.offsetWidth,
    750,
  );
  const captureHeight = Math.max(
    container.scrollHeight,
    container.clientHeight,
    container.offsetHeight,
    1120,
  );

  return html2canvas(container, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    width: captureWidth,
    height: captureHeight,
    windowWidth: captureWidth,
    windowHeight: captureHeight,
    scrollX: 0,
    scrollY: 0,
  });
}

function createCanvasSlice(
  source: HTMLCanvasElement,
  sourceY: number,
  sliceHeightPx: number,
): HTMLCanvasElement {
  const slice = document.createElement('canvas');
  slice.width = source.width;
  slice.height = sliceHeightPx;

  const context = slice.getContext('2d');
  if (!context) {
    throw new Error('报告渲染失败：无法创建分页画布。');
  }

  context.drawImage(
    source,
    0,
    sourceY,
    source.width,
    sliceHeightPx,
    0,
    0,
    source.width,
    sliceHeightPx,
  );
  return slice;
}

function renderCanvasIntoPdf(
  doc: jsPDF,
  canvas: HTMLCanvasElement,
  margin: number,
): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;
  const pxPerPt = canvas.width / contentWidth;
  const sliceHeightPx = Math.max(1, Math.floor(contentHeight * pxPerPt));

  let sourceY = 0;
  let pageIndex = 0;
  while (sourceY < canvas.height) {
    const currentSliceHeightPx = Math.min(sliceHeightPx, canvas.height - sourceY);
    const slice = createCanvasSlice(canvas, sourceY, currentSliceHeightPx);
    const renderedHeightPt = currentSliceHeightPx / pxPerPt;
    const sliceData = slice.toDataURL('image/png');

    if (pageIndex > 0) {
      doc.addPage();
    }
    doc.addImage(
      sliceData,
      'PNG',
      margin,
      margin,
      contentWidth,
      renderedHeightPt,
      undefined,
      'FAST',
    );
    sourceY += currentSliceHeightPx;
    pageIndex += 1;
  }
}

function downloadTextReport(text: string, fileName: string): void {
  const blob = new Blob([`\uFEFF${text}`], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export async function exportConsultationReport(
  data: ReportData,
): Promise<ReportExportOutcome> {
  const doc = new jsPDF({
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 24;

  const container = createHiddenRenderContainer(buildReportHtml(data));
  document.body.appendChild(container);

  try {
    const canvas = await renderReportCanvas(container);
    assertRenderableCanvas(canvas);
    renderCanvasIntoPdf(doc, canvas, margin);

    const pageCount = doc.getNumberOfPages();
    for (let index = 1; index <= pageCount; index += 1) {
      doc.setPage(index);
      doc.setFontSize(9);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `CoPilot Care - Page ${index} / ${pageCount}`,
        pageWidth / 2,
        pageHeight - 12,
        { align: 'center' },
      );
    }

    const fileName = buildPdfFileName();
    doc.save(fileName);
    return {
      format: 'pdf',
      fileName,
    };
  } catch {
    const fileName = buildTextFileName();
    downloadTextReport(generateReportText(data), fileName);
    return {
      format: 'txt',
      fileName,
    };
  } finally {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}

export function generateReportText(data: ReportData): string {
  const lines: string[] = [];

  const patientId = pickFirstNonEmpty(data.patientProfile.patientId) || 'demo';
  const chiefComplaint = pickFirstNonEmpty(data.patientProfile.chiefComplaint) || '无';
  const chronicDiseases = normalizeList(data.patientProfile.chronicDiseases);
  const medicationHistory = normalizeList(data.patientProfile.medicationHistory);
  const systolicBP = data.patientProfile.vitals?.systolicBP;
  const diastolicBP = data.patientProfile.vitals?.diastolicBP;
  const actions = normalizeList(data.actions, data.explainableReport?.actions ?? []);
  const reportEvidence = resolveReadableEvidence(data.explainableReport);
  const evidence = normalizeList(
    reportEvidence.length > 0 ? reportEvidence : data.evidence,
    data.explainableReport?.basis ?? [],
  );
  const notes = normalizeList(data.notes);
  const conclusion = pickFirstNonEmpty(data.conclusion, data.explainableReport?.conclusion) || '无';

  lines.push('='.repeat(56));
  lines.push('CoPilot Care 会诊报告');
  lines.push(`生成时间：${formatDateTime()}`);
  lines.push('='.repeat(56));

  lines.push('\n【患者信息】');
  lines.push(`患者 ID：${patientId}`);
  lines.push(`年龄：${data.patientProfile.age ?? '未知'} 岁`);
  lines.push(`性别：${formatSex(data.patientProfile.sex)}`);
  lines.push(`主诉：${chiefComplaint}`);
  if (typeof systolicBP === 'number' || typeof diastolicBP === 'number') {
    const systolicText = typeof systolicBP === 'number' ? String(systolicBP) : '--';
    const diastolicText = typeof diastolicBP === 'number' ? String(diastolicBP) : '--';
    lines.push(`血压：${systolicText}/${diastolicText} mmHg`);
  }
  if (chronicDiseases.length > 0) {
    lines.push(`慢病史：${chronicDiseases.join('、')}`);
  }
  if (medicationHistory.length > 0) {
    lines.push(`用药史：${medicationHistory.join('、')}`);
  }

  if (data.routing) {
    lines.push('\n【分诊决策】');
    lines.push(`分诊科室：${DEPARTMENT_LABELS[data.routing.department] || data.routing.department}`);
    lines.push(`处理模式：${ROUTE_MODE_LABELS[data.routing.routeMode] || data.routing.routeMode}`);
    lines.push(`复杂度评分：${data.routing.complexityScore}`);
  }

  if (data.triageResult) {
    lines.push('\n【分诊结果】');
    lines.push(`分诊等级：${formatTriageLevel(data.triageResult.triageLevel || '待定')}`);
    lines.push(`建议去向：${formatDestination(data.triageResult.destination || '待定')}`);
  }

  lines.push('\n【会诊结论】');
  lines.push(conclusion);

  lines.push('\n【建议措施】');
  if (actions.length === 0) {
    lines.push('无');
  } else {
    actions.forEach((action) => lines.push(`- ${action}`));
  }

  lines.push('\n【证据依据】');
  if (evidence.length === 0) {
    lines.push('无');
  } else {
    evidence.slice(0, 10).forEach((item) => lines.push(`- ${item}`));
  }

  if (notes.length > 0) {
    lines.push('\n【备注】');
    notes.slice(0, 5).forEach((note) => lines.push(`- ${note}`));
  }

  lines.push('\n' + '='.repeat(56));
  lines.push('本报告由 CoPilot Care 智能辅助系统自动生成，仅供临床参考。');
  lines.push('='.repeat(56));

  return lines.join('\n');
}




