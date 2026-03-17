import { mount } from '@vue/test-utils';
import type {
  ExplainableReport,
  RuleGovernanceSnapshot,
  TriageBlockingReason,
} from '@copilot-care/shared/types';
import { describe, expect, it } from 'vitest';
import ConsultationResultPanel from './ConsultationResultPanel.vue';

function createRuleGovernance(
  overrides?: Partial<RuleGovernanceSnapshot>,
): RuleGovernanceSnapshot {
  return {
    catalogVersion: '2026.03-r1',
    synonymSetVersion: '2026.03-r1',
    matchedRuleIds: ['RULE-1', 'RULE-2'],
    guidelineRefs: ['NICE_NG136_2026'],
    layerDecisions: [
      {
        layer: 'FLOW_CONTROL',
        status: 'pass',
        summary: 'ok',
      },
    ],
    evidenceTraceId: 'audit_test',
    ...overrides,
  };
}

function createExplainableReport(
  overrides?: Partial<ExplainableReport>,
): ExplainableReport {
  return {
    conclusion: 'test conclusion',
    evidence: [],
    basis: [],
    actions: [],
    evidenceCards: [
      {
        id: 'ev-1',
        category: 'authoritative_web',
        title: 'WHO hypertension evidence',
        summary: 'Lifestyle interventions and blood pressure management.',
        sourceId: 'WHO',
        sourceName: 'World Health Organization',
        publishedOn: '2025-11-20',
        retrievedAt: '2026-03-03T12:00:00.000Z',
        url: 'https://www.who.int/news-room/fact-sheets/detail/hypertension',
        supportsRuleIds: ['RULE-1'],
      },
    ],
    ...overrides,
  };
}

function mountPanel(overrides?: {
  ruleGovernance?: RuleGovernanceSnapshot | null;
  explainableReport?: ExplainableReport | null;
  blockingReason?: TriageBlockingReason | null;
}) {
  return mount(ConsultationResultPanel, {
    props: {
      routeInfo: null,
      triageResult: null,
      ruleGovernance: overrides?.ruleGovernance ?? null,
      explainableReport: overrides?.explainableReport ?? null,
      finalConsensus: null,
      resultNotes: [],
      blockingReason: overrides?.blockingReason ?? null,
      isSafetyBlocked: false,
      safetyBlockNote: '',
      canExportReport: true,
      exportingReport: false,
      reportExportError: '',
      reportExportSuccess: '',
    },
  });
}

describe('ConsultationResultPanel', () => {
  it('renders evidence with tier-A authority badge and clinical summary', () => {
    const wrapper = mountPanel({
      ruleGovernance: createRuleGovernance(),
      explainableReport: createExplainableReport(),
    });

    const evidenceCards = wrapper.find('[data-testid="result-evidence-cards"]');
    expect(evidenceCards.exists()).toBe(true);
    expect(evidenceCards.text()).toContain('高血压');
    expect(evidenceCards.text()).toContain('世界卫生组织(WHO)');

    const authorityBadge = wrapper.find('[data-testid="result-evidence-authority-tier"]');
    expect(authorityBadge.exists()).toBe(true);
    expect(authorityBadge.attributes('data-tier')).toBe('A');

    const clinicalSummary = wrapper.find('[data-testid="result-evidence-clinical-summary"]');
    expect(clinicalSummary.exists()).toBe(true);
    expect(clinicalSummary.text()).toContain('证据要点');

    const consensusBrief = wrapper.find('[data-testid="result-evidence-consensus-brief"]');
    expect(consensusBrief.exists()).toBe(true);
    expect(consensusBrief.text()).toContain('多Agent共识证据');
    expect(consensusBrief.text()).toContain('世界卫生组织(WHO)');
    expect(consensusBrief.text()).not.toContain('该证据围绕');
    expect(consensusBrief.text()).not.toContain('...');
    expect(wrapper.find('[data-testid="result-evidence-link"]').exists()).toBe(false);
  });

  it('classifies unknown source as tier-C and keeps clinical summary visible', () => {
    const wrapper = mountPanel({
      explainableReport: createExplainableReport({
        evidenceCards: [
          {
            id: 'ev-c',
            category: 'authoritative_web',
            title: 'Hypertension in adults: diagnosis and management',
            summary: '',
            sourceId: 'UNKNOWN_SOURCE',
          },
        ],
      }),
    });

    const authorityBadge = wrapper.find('[data-testid="result-evidence-authority-tier"]');
    expect(authorityBadge.attributes('data-tier')).toBe('C');
    expect(wrapper.find('[data-testid="result-evidence-clinical-summary"]').exists()).toBe(
      true,
    );
    expect(wrapper.text()).toContain('高血压');
    expect(wrapper.text()).not.toContain('...');
  });

  it('cleans slash-noise from evidence key points and keeps summary readable', () => {
    const wrapper = mountPanel({
      explainableReport: createExplainableReport({
        evidenceCards: [
          {
            id: 'ev-noise',
            category: 'authoritative_web',
            title: 'Hypertension guidance update',
            summary: '围绕高血压，2017 / / / / / / / 指南 预防 适用提示',
            sourceId: 'PUBMED',
            sourceName: 'PubMed',
          },
        ],
      }),
    });

    const summary = wrapper.find('[data-testid="result-evidence-clinical-summary"]').text();
    expect(summary).toContain('高血压');
    expect(summary).not.toContain('/ / /');
    expect(summary).not.toMatch(/([\\/]\s*){2,}/);
  });

  it('deduplicates near-identical evidence cards and removes repeated labels', () => {
    const wrapper = mountPanel({
      explainableReport: createExplainableReport({
        evidenceCards: [
          {
            id: 'ev-dup-a',
            category: 'authoritative_web',
            title:
              '2025 AHA/ACC/AANP/AAPA/ABC/ACCP guideline for prevention and management of high blood pressure in adults',
            summary:
              '来源：医学文献数据库。证据要点：证据要点：围绕高血压，2025 / / / / / 指南 预防。临床解读：适用于血压异常成人。建议动作：72小时内复测血压。',
            sourceId: 'NIH',
            sourceName: 'National Institutes of Health',
            publishedOn: '2025 Oct',
          },
          {
            id: 'ev-dup-b',
            category: 'authoritative_web',
            title:
              'Guideline synopsis for management of high blood pressure in adults',
            summary:
              '来源：医学文献数据库。证据要点：围绕高血压，指南建议72小时内复测血压并结合症状复评。临床解读：适用于血压异常成人。',
            sourceId: 'NIH',
            sourceName: 'National Institutes of Health',
            publishedOn: '2024',
          },
        ],
      }),
    });

    const items = wrapper.findAll('[data-testid="result-evidence-cards"] li');
    expect(items.length).toBe(1);
    const summary = wrapper.find('[data-testid="result-evidence-clinical-summary"]').text();
    expect(summary).not.toContain('证据要点：证据要点：');
    expect(summary).not.toMatch(/([\\/]\s*){2,}/);
  });

  it('does not expose governance or rule-evidence alignment blocks in UI', () => {
    const wrapper = mountPanel({
      ruleGovernance: createRuleGovernance(),
      explainableReport: createExplainableReport(),
    });

    expect(wrapper.find('[data-testid="result-rule-governance"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="result-rule-evidence-matrix"]').exists()).toBe(
      false,
    );
  });

  it('emits export event when export button is clicked', async () => {
    const wrapper = mountPanel({
      explainableReport: createExplainableReport(),
    });

    await wrapper.find('button.export-btn').trigger('click');
    expect(wrapper.emitted('export')).toBeTruthy();
  });

  it('renders structured blocking reason card when provided', () => {
    const wrapper = mountPanel({
      blockingReason: {
        code: 'EVIDENCE_INTEGRITY_GATE_BLOCKED',
        title: '证据完整性门禁阻断自动输出',
        summary: '高风险场景未达到权威证据完整性要求。',
        triggerStage: 'REVIEW',
        severity: 'high',
        actions: [
          '进入人工复核队列并补齐权威证据来源（例如 WHO/NICE）。',
        ],
        detail: 'test_reason',
      },
    });

    const card = wrapper.find('[data-testid="result-blocking-reason"]');
    expect(card.exists()).toBe(true);
    expect(card.text()).toContain('证据完整性门禁阻断自动输出');
    expect(card.text()).toContain('阶段：安全复核');
    expect(card.text()).toContain('严重度：高');
  });
});
