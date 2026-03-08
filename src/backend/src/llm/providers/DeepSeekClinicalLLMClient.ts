import { postJson } from '../http';
import { parseLLMJsonText } from '../normalize';
import {
  ClinicalLLMClient,
  ClinicalLLMProviderConfig,
  ClinicalLLMRequest,
  ClinicalLLMResponse,
} from '../types';
import {
  buildClinicalSystemPrompt,
  buildClinicalUserPrompt,
} from '../prompts';

interface DeepSeekConfig extends ClinicalLLMProviderConfig {
  apiKey: string;
  baseUrl: string;
}

function extractDeepSeekText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const choices = (payload as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return '';
  }

  const first = choices[0];
  if (!first || typeof first !== 'object') {
    return '';
  }

  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== 'object') {
    return '';
  }

  const content = (message as Record<string, unknown>).content;
  if (typeof content === 'string' && content.trim()) {
    return content;
  }
  if (Array.isArray(content)) {
    const joined = content
      .map((item) => {
        if (typeof item === 'string') {
          return item.trim();
        }
        if (!item || typeof item !== 'object') {
          return '';
        }
        const record = item as Record<string, unknown>;
        const text = record.text;
        return typeof text === 'string' ? text.trim() : '';
      })
      .filter(Boolean)
      .join('\n');
    if (joined) {
      return joined;
    }
  }

  const reasoningContent = (message as Record<string, unknown>).reasoning_content;
  if (typeof reasoningContent === 'string' && reasoningContent.trim()) {
    return reasoningContent;
  }

  return '';
}

export class DeepSeekClinicalLLMClient implements ClinicalLLMClient {
  private readonly config: DeepSeekConfig;

  constructor(config: DeepSeekConfig) {
    this.config = config;
  }

  public async generateOpinion(
    input: ClinicalLLMRequest,
  ): Promise<ClinicalLLMResponse | null> {
    const endpoint = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const payload = await postJson({
      url: endpoint,
      timeoutMs: this.config.timeoutMs,
      maxRetries: this.config.maxRetries,
      retryDelayMs: this.config.retryDelayMs,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: {
        model: this.config.model,
        temperature: 0.1,
        max_tokens: 600,
        response_format: {
          type: 'json_object',
        },
        messages: [
          {
            role: 'system',
            content: buildClinicalSystemPrompt(),
          },
          {
            role: 'user',
            content: buildClinicalUserPrompt(input),
          },
        ],
      },
    });

    return parseLLMJsonText(extractDeepSeekText(payload));
  }
}
