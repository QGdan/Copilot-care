import {
  createClinicalExpertLLMClients,
  createClinicalLLMClient,
  resolveClinicalExpertProviderAssignments,
} from '../../llm/createClinicalLLMClient';

describe('Architecture Smoke - LLM factory', () => {
  it('returns null when provider is not configured', () => {
    const client = createClinicalLLMClient({});
    expect(client).toBeNull();
  });

  it('returns null when OpenAI provider is selected without API key', () => {
    const client = createClinicalLLMClient({
      COPILOT_CARE_LLM_PROVIDER: 'openai',
    });
    expect(client).toBeNull();
  });

  it('creates OpenAI client when provider and key are provided', () => {
    const client = createClinicalLLMClient({
      COPILOT_CARE_LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'test-key',
      COPILOT_CARE_LLM_MODEL: 'gpt-5-mini',
    });
    expect(client).not.toBeNull();
    expect(typeof client?.generateOpinion).toBe('function');
  });

  it('creates DeepSeek client when provider and key are provided', () => {
    const client = createClinicalLLMClient({
      COPILOT_CARE_LLM_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'test-key',
      DEEPSEEK_LLM_MODEL: 'deepseek-chat',
    });
    expect(client).not.toBeNull();
    expect(typeof client?.generateOpinion).toBe('function');
  });

  it('creates deepseek-gemini fallback client when both keys exist', () => {
    const client = createClinicalLLMClient({
      COPILOT_CARE_LLM_PROVIDER: 'deepseek_gemini',
      DEEPSEEK_API_KEY: 'deepseek-key',
      GEMINI_API_KEY: 'gemini-key',
    });
    expect(client).not.toBeNull();
    expect(typeof client?.generateOpinion).toBe('function');
  });

  it('creates Kimi client when provider and key are provided', () => {
    const client = createClinicalLLMClient({
      COPILOT_CARE_LLM_PROVIDER: 'kimi',
      KIMI_API_KEY: 'kimi-key',
      KIMI_LLM_MODEL: 'moonshot-v1-8k',
    });
    expect(client).not.toBeNull();
    expect(typeof client?.generateOpinion).toBe('function');
  });

  it('creates DashScope client when provider and key are provided', () => {
    const client = createClinicalLLMClient({
      COPILOT_CARE_LLM_PROVIDER: 'dashscope',
      DASHSCOPE_API_KEY: 'dashscope-key',
      DASHSCOPE_LLM_MODEL: 'qwen-plus',
    });
    expect(client).not.toBeNull();
    expect(typeof client?.generateOpinion).toBe('function');
  });

  it('creates separated expert clients by role provider settings', () => {
    const clients = createClinicalExpertLLMClients({
      COPILOT_CARE_CARDIO_PROVIDER: 'deepseek',
      COPILOT_CARE_GP_PROVIDER: 'gemini',
      COPILOT_CARE_METABOLIC_PROVIDER: 'kimi',
      COPILOT_CARE_SAFETY_PROVIDER: 'kimi',
      DEEPSEEK_API_KEY: 'deepseek-key',
      GEMINI_API_KEY: 'gemini-key',
      KIMI_API_KEY: 'kimi-key',
    });

    expect(clients.cardiology).not.toBeNull();
    expect(clients.generalPractice).not.toBeNull();
    expect(clients.metabolic).not.toBeNull();
    expect(clients.safety).not.toBeNull();
  });

  it('respects configured auto-chain order when provider is auto', () => {
    const client = createClinicalLLMClient({
      COPILOT_CARE_LLM_PROVIDER: 'auto',
      COPILOT_CARE_LLM_AUTO_CHAIN: 'dashscope,kimi',
      DASHSCOPE_API_KEY: 'dashscope-key',
      KIMI_API_KEY: 'kimi-key',
    });
    expect(client).not.toBeNull();
    expect(typeof client?.generateOpinion).toBe('function');
  });

  it('returns null when auto-chain is pinned to unavailable providers only', () => {
    const client = createClinicalLLMClient({
      COPILOT_CARE_LLM_PROVIDER: 'auto',
      COPILOT_CARE_LLM_AUTO_CHAIN: 'openai',
      DASHSCOPE_API_KEY: 'dashscope-key',
    });
    expect(client).toBeNull();
  });

  it('falls back to defaults when expert provider value is invalid', () => {
    const assignments = resolveClinicalExpertProviderAssignments({
      COPILOT_CARE_CARDIO_PROVIDER: 'invalid_provider',
    });

    expect(assignments.cardiology.provider).toBe('deepseek');
    expect(assignments.cardiology.source).toBe('invalid_fallback');
    expect(assignments.generalPractice.provider).toBe('gemini');
    expect(assignments.generalPractice.source).toBe('default');
  });
});
