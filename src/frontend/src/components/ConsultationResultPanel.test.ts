import { mount } from '@vue/test-utils';
import type {
  ExplainableReport,
  RuleGovernanceSnapshot,
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
}) {
  return mount(ConsultationResultPanel, {
    props: {
      routeInfo: null,
      triageResult: null,
      ruleGovernance: overrides?.ruleGovernance ?? null,
      explainableReport: overrides?.explainableReport ?? null,
      finalConsensus: null,
      resultNotes: [],
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
});
