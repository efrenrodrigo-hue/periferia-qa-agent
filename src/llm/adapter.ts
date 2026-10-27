export type LlmToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type LlmMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: LlmToolCall[];
  tool_call_id?: string;
  name?: string;
};
export type LlmToolDefinition = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};
export type LlmReply = { message: LlmMessage; finishReason?: string };
export interface LlmAdapter {
  readonly provider: string;
  readonly model: string;
  enviar(mensajes: LlmMessage[], herramientas: LlmToolDefinition[]): Promise<LlmReply>;
}
