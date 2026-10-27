import type { LlmAdapter, LlmMessage, LlmReply, LlmToolDefinition } from './adapter.js';

type OpenAiResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      role?: 'assistant';
      content?: string | null;
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    };
  }>;
  error?: { message?: string };
};

export class OpenAiAdapter implements LlmAdapter {
  readonly provider = 'openai';
  readonly model: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(apiKey: string, model = 'gpt-4.1-mini', timeoutMs = 30_000) {
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = timeoutMs;
  }

  async enviar(mensajes: LlmMessage[], herramientas: LlmToolDefinition[]): Promise<LlmReply> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages: mensajes,
          tools: herramientas,
          tool_choice: 'auto',
          temperature: 0.1
        }),
        signal: controller.signal
      });
      const payload = await response.json() as OpenAiResponse;
      if (!response.ok) {
        throw new Error(payload.error?.message ?? `El proveedor de IA respondió HTTP ${response.status}`);
      }
      const choice = payload.choices?.[0];
      if (!choice?.message) throw new Error('El proveedor de IA devolvió una respuesta vacía.');
      const message: LlmMessage = {
        role: 'assistant',
        content: choice.message.content ?? null,
        ...(choice.message.tool_calls ? { tool_calls: choice.message.tool_calls } : {})
      };
      return { message, finishReason: choice.finish_reason };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('La solicitud al proveedor de IA superó el tiempo de espera.');
      throw error instanceof Error ? error : new Error('No fue posible contactar al proveedor de IA.');
    } finally {
      clearTimeout(timeout);
    }
  }
}
