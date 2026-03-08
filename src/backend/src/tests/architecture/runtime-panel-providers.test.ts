import { createRuntime } from '../../bootstrap/createRuntime';

describe('Architecture Smoke - panel providers', () => {
  it('supports provider:model fan-out and keeps distinct model bindings', () => {
    const runtime = createRuntime({
      COPILOT_CARE_CARDIO_PANEL_PROVIDERS:
        'dashscope:qwen-plus,dashscope:qwen-max,dashscope:qwen-plus',
      COPILOT_CARE_GP_PANEL_PROVIDERS: 'gemini:gemini-2.5-flash',
      COPILOT_CARE_METABOLIC_PANEL_PROVIDERS: 'dashscope:qwen-plus',
      DASHSCOPE_API_KEY: 'dashscope-key',
      GEMINI_API_KEY: 'gemini-key',
    });

    const cardiology = runtime.architecture.routing.panelProviders.cardiology;
    expect(cardiology).toEqual([
      {
        provider: 'dashscope',
        model: 'qwen-plus',
        llmEnabled: true,
      },
      {
        provider: 'dashscope',
        model: 'qwen-max',
        llmEnabled: true,
      },
    ]);

    const generalPractice =
      runtime.architecture.routing.panelProviders.generalPractice;
    expect(generalPractice).toEqual([
      {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        llmEnabled: true,
      },
    ]);
  });
});
