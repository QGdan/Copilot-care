import { describe, expect, it } from 'vitest';
import { parseMedicalSourceBreakdownMessage } from './medicalSourceBreakdown';

describe('parseMedicalSourceBreakdownMessage', () => {
  it('parses source breakdown and strategy from reasoning message', () => {
    const parsed = parseMedicalSourceBreakdownMessage(
      '权威医学来源分布：NICEx1，WHOx1，PUBMEDx1（策略：authority-multisource-v2.1）。',
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.strategyVersion).toBe('authority-multisource-v2.1');
    expect(parsed?.items).toEqual([
      { sourceId: 'NICE', count: 1 },
      { sourceId: 'WHO', count: 1 },
      { sourceId: 'PUBMED', count: 1 },
    ]);
  });

  it('supports english comma and optional spaces around x', () => {
    const parsed = parseMedicalSourceBreakdownMessage(
      '权威医学来源分布：NICE x 2, CDC_USx1（策略：authority-multisource-v2.1）',
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.items).toEqual([
      { sourceId: 'NICE', count: 2 },
      { sourceId: 'CDC_US', count: 1 },
    ]);
  });

  it('returns null for non-breakdown reasoning text', () => {
    const parsed = parseMedicalSourceBreakdownMessage(
      '权威医学联网检索命中 3 条（来源：NICE,WHO,PUBMED）。',
    );

    expect(parsed).toBeNull();
  });

  it('ignores malformed tokens and keeps valid source items', () => {
    const parsed = parseMedicalSourceBreakdownMessage(
      '权威医学来源分布：NICEy1，WHOx0，PUBMEDx1（策略：authority-multisource-v2.1）。',
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.items).toEqual([{ sourceId: 'PUBMED', count: 1 }]);
  });
});
