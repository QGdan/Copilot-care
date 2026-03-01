import { buildRuleGovernanceSnapshot, buildValidationErrorGovernanceSnapshot } from '../../application/services/RuleGovernanceService';

describe('Architecture Smoke - rule governance snapshot service', () => {
  it('builds layered governance snapshot for normal output path', () => {
    const snapshot = buildRuleGovernanceSnapshot({
      sessionId: 'gov-snapshot-001',
      auditRef: 'audit_gov-snapshot-001',
      risk: {
        riskLevel: 'L2',
        triageLevel: 'urgent',
        redFlagTriggered: false,
        evidence: ['stage-2 hypertension detected'],
        guidelineBasis: ['NICE_NG136_2026'],
        matchedRuleIds: ['RULE-FC-STAGE2-HTN'],
      },
      routing: {
        complexityScore: 4,
        routeMode: 'LIGHT_DEBATE',
        department: 'cardiology',
        collaborationMode: 'SINGLE_SPECIALTY_PANEL',
        reasons: ['risk boundary signal'],
        matchedRuleIds: ['RULE-IC-ROUTE-LIGHT'],
      },
      status: 'OUTPUT',
    });

    expect(snapshot.catalogVersion).toBeTruthy();
    expect(snapshot.evidenceTraceId).toBe('audit_gov-snapshot-001');
    expect(snapshot.matchedRuleIds).toEqual(
      expect.arrayContaining([
        'RULE-FC-STAGE2-HTN',
        'RULE-IC-ROUTE-LIGHT',
      ]),
    );
    expect(snapshot.layerDecisions).toHaveLength(4);
    expect(
      snapshot.layerDecisions.some(
        (item) => item.layer === 'FLOW_CONTROL' && item.status === 'pass',
      ),
    ).toBe(true);
  });

  it('builds validation governance snapshot for missing required fields', () => {
    const snapshot = buildValidationErrorGovernanceSnapshot({
      sessionId: 'gov-snapshot-validation-001',
      auditRef: 'audit_gov-snapshot-validation-001',
      errorCode: 'ERR_MISSING_REQUIRED_DATA',
      requiredFields: ['consentToken'],
    });

    expect(snapshot.layerDecisions.some((item) => item.layer === 'FLOW_CONTROL' && item.status === 'fail')).toBe(true);
    expect(snapshot.matchedRuleIds).toContain('RULE-FC-MIS-GATE');
  });
});
