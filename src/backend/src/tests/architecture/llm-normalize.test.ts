import { parseLLMJsonText } from '../../llm/normalize';

describe('Architecture Smoke - llm normalize', () => {
  it('parses JSON content wrapped in code fence', () => {
    const parsed = parseLLMJsonText(`
\`\`\`json
{
  "riskLevel": "L1",
  "confidence": 0.88,
  "reasoning": "建议先随访观察。",
  "citations": ["分诊建议"],
  "actions": ["一周后复评"]
}
\`\`\`
`);

    expect(parsed).not.toBeNull();
    expect(parsed?.riskLevel).toBe('L1');
    expect(parsed?.confidence).toBe(0.88);
  });

  it('normalizes lowercase risk level and string confidence', () => {
    const parsed = parseLLMJsonText(
      '{"riskLevel":"l2","confidence":"0.67","reasoning":"需加强监测。","citations":[],"actions":[]}',
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.riskLevel).toBe('L2');
    expect(parsed?.confidence).toBe(0.67);
  });

  it('returns null when risk level is invalid', () => {
    const parsed = parseLLMJsonText(
      '{"riskLevel":"HIGH","confidence":0.5,"reasoning":"x","citations":[],"actions":[]}',
    );
    expect(parsed?.riskLevel).toBe('L3');
  });

  it('parses alias fields and list-like strings', () => {
    const parsed = parseLLMJsonText(
      JSON.stringify({
        risk: '2',
        confidenceScore: '85%',
        rationale: 'needs close follow-up',
        references: 'guideline-a; guideline-b',
        recommendations: 'repeat BP in 3 days\\nseek offline care if worsened',
      }),
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.riskLevel).toBe('L2');
    expect(parsed?.confidence).toBe(0.85);
    expect(parsed?.citations).toEqual(['guideline-a', 'guideline-b']);
    expect(parsed?.actions).toEqual([
      'repeat BP in 3 days',
      'seek offline care if worsened',
    ]);
  });

  it('returns null when risk token is unrecognized', () => {
    const parsed = parseLLMJsonText(
      '{"risk":"uncertain","confidence":0.5,"reasoning":"x"}',
    );
    expect(parsed).toBeNull();
  });

  it('parses nested payload and Chinese risk aliases', () => {
    const parsed = parseLLMJsonText(
      JSON.stringify({
        output: {
          risk_level: '高风险',
          confidence: '85/100',
          analysis: '建议尽快线下就诊复核。',
          citations: [{ title: 'WHO guideline' }, { url: 'https://example.com' }],
          actions: [{ text: '24小时内复诊' }, { name: '监测血压' }],
        },
      }),
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.riskLevel).toBe('L3');
    expect(parsed?.confidence).toBe(0.85);
    expect(parsed?.citations).toEqual(['WHO guideline', 'https://example.com']);
    expect(parsed?.actions).toEqual(['24小时内复诊', '监测血压']);
  });

  it('parses loose key-value text when strict JSON is unavailable', () => {
    const parsed = parseLLMJsonText(
      [
        '风险等级: 高风险',
        '置信度: 85/100',
        '分析: 建议尽快线下复诊并监测血压变化。',
        '证据: WHO 指南，NICE 高血压管理建议',
        '建议: 24小时内复诊；记录家庭血压',
      ].join('\n'),
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.riskLevel).toBe('L3');
    expect(parsed?.confidence).toBe(0.85);
    expect(parsed?.citations).toEqual(['WHO 指南', 'NICE 高血压管理建议']);
    expect(parsed?.actions).toEqual(['24小时内复诊', '记录家庭血压']);
  });
});
