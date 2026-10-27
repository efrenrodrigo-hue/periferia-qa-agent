import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LlmMessage, LlmToolDefinition } from './llm/adapter.js';
import { OpenAiAdapter } from './llm/openai.js';
import { armar_paquete, generar_formulario, leer_solicitud, mapear_campos, simular_envio, type CampoSolicitado, type Mapeo } from './tools/proveedor.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const webRoot = path.join(root, 'web');
const port = Number(process.env.PORT ?? '3000');
const maxIterations = Math.max(1, Number(process.env.MAX_AGENT_ITERATIONS ?? '25'));
const maxSessionTokens = Math.max(1000, Number(process.env.MAX_SESSION_TOKENS ?? '20000'));
const apiKey = process.env.OPENAI_API_KEY?.trim() ?? '';
const model = process.env.LLM_MODEL?.trim() || 'gpt-4.1-mini';
const llm = apiKey ? new OpenAiAdapter(apiKey, model) : null;

type ToolCallView = { name: string; arguments: unknown; ok: boolean; resultSummary: string };
type Session = { messages: LlmMessage[]; toolCalls: ToolCallView[]; pendingConfirmation: boolean; pendingCase?: string; approximateTokens: number };
const sessions = new Map<string, Session>();

const fieldJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    etiqueta: { type: 'string', description: 'Etiqueta exacta del campo solicitado por el cliente' },
    obligatorio: { type: 'boolean', description: 'Indica si el campo es obligatorio' },
    hoja: { type: 'string' }, celda_etiqueta: { type: 'string' }, celda_valor: { type: 'string' }
  },
  required: ['etiqueta', 'obligatorio'], additionalProperties: false
};
const mappedFieldJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    etiqueta: { type: 'string' }, estado: { type: 'string', enum: ['lleno', 'faltante', 'requiere_confirmacion'] },
    clave_maestra: { type: 'string' }, valor: {}, nota: { type: 'string' }, obligatorio: { type: 'boolean' },
    hoja: { type: 'string' }, celda_etiqueta: { type: 'string' }, celda_valor: { type: 'string' }
  },
  required: ['etiqueta', 'estado', 'obligatorio'], additionalProperties: false
};
const mappingJsonSchema: Record<string, unknown> = {
  type: 'object', properties: {
    llenos: { type: 'array', items: mappedFieldJsonSchema },
    faltantes: { type: 'array', items: mappedFieldJsonSchema },
    requiere_confirmacion: { type: 'array', items: mappedFieldJsonSchema }
  }, required: ['llenos', 'faltantes', 'requiere_confirmacion'], additionalProperties: false
};
const toolDefinitions: LlmToolDefinition[] = [
  { type: 'function', function: { name: 'proveedor_leer_solicitud', description: leer_solicitud.description, parameters: { type: 'object', properties: { caso: { type: 'string', description: 'Carpeta del caso en fixtures/reto-01/casos/' } }, required: ['caso'], additionalProperties: false } } },
  { type: 'function', function: { name: 'proveedor_mapear_campos', description: mapear_campos.description, parameters: { type: 'object', properties: { caso: { type: 'string' }, campos: { type: 'array', items: fieldJsonSchema } }, required: ['caso', 'campos'], additionalProperties: false } } },
  { type: 'function', function: { name: 'proveedor_generar_formulario', description: generar_formulario.description, parameters: { type: 'object', properties: { caso: { type: 'string' }, mapeo: mappingJsonSchema }, required: ['caso', 'mapeo'], additionalProperties: false } } },
  { type: 'function', function: { name: 'proveedor_armar_paquete', description: armar_paquete.description, parameters: { type: 'object', properties: { caso: { type: 'string' } }, required: ['caso'], additionalProperties: false } } },
  { type: 'function', function: { name: 'proveedor_simular_envio', description: simular_envio.description, parameters: { type: 'object', properties: { caso: { type: 'string' }, confirmado: { type: 'boolean' } }, required: ['caso', 'confirmado'], additionalProperties: false } } }
];

function newSession(): Session {
  return { messages: [], toolCalls: [], pendingConfirmation: false, approximateTokens: 0 };
}
function getSession(sessionId: string): Session {
  const existing = sessions.get(sessionId);
  if (existing) return existing;
  const created = newSession();
  sessions.set(sessionId, created);
  return created;
}
function safeJsonParse(input: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(input);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* handled below */ }
  throw new Error('Los argumentos de la herramienta no son JSON válido.');
}
function parseToolResult(raw: string): { ok: boolean; data?: unknown; error?: string } {
  try {
    const value = JSON.parse(raw) as { ok?: boolean; data?: unknown; error?: string };
    return { ok: value.ok === true, data: value.data, error: value.error };
  } catch { return { ok: false, error: 'La herramienta devolvió una respuesta no válida.' }; }
}
function summaryForTool(name: string, parsed: ReturnType<typeof parseToolResult>): string {
  if (!parsed.ok) return parsed.error ?? 'La herramienta falló.';
  const data = parsed.data;
  if (!data || typeof data !== 'object') return 'Operación completada.';
  const value = data as Record<string, unknown>;
  if (name.endsWith('leer_solicitud')) return `Solicitud leída: ${String(value.cliente)}, país ${String(value.pais)}, formato ${String(value.formato)}.`;
  if (name.endsWith('mapear_campos')) return `Llenos: ${Array.isArray(value.llenos) ? value.llenos.length : 0}; faltantes: ${Array.isArray(value.faltantes) ? value.faltantes.length : 0}; requieren confirmación: ${Array.isArray(value.requiere_confirmacion) ? value.requiere_confirmacion.length : 0}.`;
  if (name.endsWith('generar_formulario')) return value.formato === 'portal' ? `Formato no soportado para automatización de portal; valores copiables preparados en ${String(value.ruta ?? 'ruta no disponible')}.` : `Formulario generado: ${String(value.ruta ?? 'ruta no disponible')}.`;
  if (name.endsWith('armar_paquete')) return `Paquete: ${String(value.ruta ?? 'ruta no disponible')}; listo_para_firma=${String(value.listo_para_firma)}.`;
  if (name.endsWith('simular_envio')) return `Registro de envío simulado creado: ${String(value.ruta ?? 'ruta no disponible')}.`;
  return 'Operación completada.';
}
function sanitizeArgumentsForUi(value: unknown, parentLabel = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeArgumentsForUi(item, parentLabel));
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const label = typeof record.etiqueta === 'string' ? record.etiqueta.toLowerCase() : parentLabel;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (key === 'valor' && /cuenta|swift|banco/.test(label)) output[key] = '[DATO BANCARIO OCULTO EN VISTA DE HERRAMIENTAS]';
    else output[key] = sanitizeArgumentsForUi(item, label);
  }
  return output;
}
function affirmative(text: string): boolean {
  const normalized = text.trim().toLocaleLowerCase('es-CO');
  if (/^(no|no confirmo|cancelar|rechazo|no lo hagas)\b/.test(normalized)) return false;
  return /^(si|sí|confirmo|confirmar|confirmado|confirmada|de acuerdo|adelante|procede|envia|envía|hazlo|acepto)\b/.test(normalized);
}
function sessionContext(sessionId: string) { return { directory: root, sessionId }; }

async function executeTool(name: string, args: Record<string, unknown>, sessionId: string, confirmedThisTurn: boolean): Promise<string> {
  const ctx = sessionContext(sessionId);
  if (name === 'proveedor_leer_solicitud') return leer_solicitud.execute(args as { caso: string }, ctx);
  if (name === 'proveedor_mapear_campos') return mapear_campos.execute(args as { caso: string; campos: CampoSolicitado[] }, ctx);
  if (name === 'proveedor_generar_formulario') return generar_formulario.execute(args as { caso: string; mapeo: Mapeo }, ctx);
  if (name === 'proveedor_armar_paquete') {
    return armar_paquete.execute(args as { caso: string }, ctx);
  }
  if (name === 'proveedor_simular_envio') {
    const permitted = confirmedThisTurn && affirmative(String(args.confirmacionUsuario ?? ''));
    return simular_envio.execute({ caso: String(args.caso ?? ''), confirmado: permitted }, ctx);
  }
  return JSON.stringify({ ok: false, error: `Herramienta no reconocida: ${name}` });
}

async function loadSystemPrompt(): Promise<string> {
  const prompt = await fs.readFile(path.join(root, 'agent/prompt.md'), 'utf8');
  const knowledge = await fs.readFile(path.join(root, 'src/knowledge/registro-proveedor.md'), 'utf8');
  return `${prompt}\n\n## Conocimiento del proceso\n${knowledge}`;
}

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, provider: llm?.provider ?? 'not-configured', model: llm?.model ?? null });
});
app.get('/api/sessions/:id', (req: Request, res: Response) => {
  const session = sessions.get(String(req.params.id));
  if (!session) { res.status(404).json({ error: 'Sesión no encontrada.' }); return; }
  res.json({ messages: session.messages.filter((message) => message.role !== 'system' && message.role !== 'tool').map((message) => ({ role: message.role, content: message.content })), toolCalls: session.toolCalls, needsConfirmation: session.pendingConfirmation });
});
app.post('/api/chat', async (req: Request, res: Response) => {
  const body = req.body as { sessionId?: unknown; message?: unknown };
  const sessionId = typeof body.sessionId === 'string' && body.sessionId.length <= 100 ? body.sessionId : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!sessionId || !message || message.length > 6000) { res.status(400).json({ error: 'Se requiere sessionId y un mensaje de hasta 6000 caracteres.' }); return; }
  const session = getSession(sessionId);
  const previousPending = session.pendingConfirmation;
  const pendingCase = session.pendingCase;
  session.messages.push({ role: 'user', content: message });
  session.approximateTokens += Math.ceil(message.length / 4);
  if (session.approximateTokens > maxSessionTokens) {
    res.status(429).json({ error: 'La sesión alcanzó el límite aproximado de tokens configurado. Inicia una sesión nueva.' });
    return;
  }

  // Human confirmation must be the immediately preceding assistant turn. It is handled outside the model loop.
  if (previousPending) {
    session.pendingConfirmation = false;
    session.pendingCase = undefined;
    if (affirmative(message) && pendingCase) {
      const raw = await simular_envio.execute({ caso: pendingCase, confirmado: true }, sessionContext(sessionId));
      const parsed = parseToolResult(raw);
      const toolView: ToolCallView = { name: 'proveedor_simular_envio', arguments: { caso: pendingCase, confirmado: true }, ok: parsed.ok, resultSummary: summaryForTool('proveedor_simular_envio', parsed) };
      session.toolCalls.push(toolView);
      const reply = parsed.ok
        ? `Se creó el registro de envío simulado en ${String((parsed.data as Record<string, unknown>).ruta)}. No se realizó ningún envío externo ni se firmó ningún documento.`
        : `No pude completar la simulación: ${parsed.error ?? 'error inesperado'}`;
      session.messages.push({ role: 'assistant', content: reply });
      res.json({ reply, toolCalls: [toolView], needsConfirmation: false });
      return;
    }
  }

  if (!llm) {
    const reply = 'El núcleo determinista está preparado, pero el chat con IA todavía no está configurado. Define OPENAI_API_KEY en el archivo .env del backend y reinicia el servidor. Mientras tanto puedes ejecutar npm run demo sin clave de IA.';
    session.messages.push({ role: 'assistant', content: reply });
    res.status(503).json({ reply, toolCalls: [], needsConfirmation: false, error: 'LLM_NOT_CONFIGURED' });
    return;
  }

  try {
    const systemPrompt = await loadSystemPrompt();
    const conversation: LlmMessage[] = [{ role: 'system', content: systemPrompt }, ...session.messages];
    const turnToolCalls: ToolCallView[] = [];
    let replyText = '';
    let iterations = 0;
    let confirmationCase: string | undefined;
    while (iterations < maxIterations) {
      iterations += 1;
      const response = await llm.enviar(conversation, toolDefinitions);
      conversation.push(response.message);
      const toolCalls = response.message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        replyText = response.message.content ?? 'He terminado de procesar la solicitud.';
        break;
      }
      for (const call of toolCalls) {
        let args: Record<string, unknown>;
        try { args = safeJsonParse(call.function.arguments); }
        catch (error) {
          const errorText = error instanceof Error ? error.message : 'Argumentos inválidos.';
          conversation.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: JSON.stringify({ ok: false, error: errorText }) });
          turnToolCalls.push({ name: call.function.name, arguments: '[JSON inválido]', ok: false, resultSummary: errorText });
          continue;
        }
        const isSimulate = call.function.name === 'proveedor_simular_envio';
        const raw = await executeTool(call.function.name, isSimulate ? { ...args, confirmacionUsuario: '' } : args, sessionId, false);
        const parsed = parseToolResult(raw);
        conversation.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: raw });
        session.approximateTokens += Math.ceil(raw.length / 4);
        const view: ToolCallView = {
          name: call.function.name,
          arguments: sanitizeArgumentsForUi(args),
          ok: parsed.ok,
          resultSummary: summaryForTool(call.function.name, parsed)
        };
        turnToolCalls.push(view);
        session.toolCalls.push(view);
        if (call.function.name === 'proveedor_armar_paquete' && parsed.ok) confirmationCase = String(args.caso ?? '');
      }
      if (session.approximateTokens > maxSessionTokens) {
        replyText = 'La sesión alcanzó el límite aproximado de tokens durante las llamadas a herramientas. Inicia una sesión nueva para continuar.';
        break;
      }
    }
    if (!replyText) replyText = 'He alcanzado el límite de iteraciones del agente. Revisa las llamadas a herramientas y lo que queda pendiente antes de continuar.';
    if (confirmationCase) {
      session.pendingConfirmation = true;
      session.pendingCase = confirmationCase;
      if (!(/¿/.test(replyText) && /confirm/i.test(replyText))) replyText += '\n\n¿Confirmas que genere el registro de envío simulado? No se enviará nada al cliente ni se firmará ningún documento.';
    }
    const newMessages = conversation.filter((item) => item.role !== 'system');
    session.messages = newMessages;
    const lastMessage = newMessages[newMessages.length - 1];
    if (!(lastMessage?.role === 'assistant' && lastMessage.content === replyText && !lastMessage.tool_calls?.length)) {
      session.messages.push({ role: 'assistant', content: replyText });
    }
    session.approximateTokens += Math.ceil(replyText.length / 4);
    res.json({ reply: replyText, toolCalls: turnToolCalls, needsConfirmation: session.pendingConfirmation });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Error inesperado del agente.';
    const reply = `No pude completar el turno del agente. ${messageText}`;
    session.messages.push({ role: 'assistant', content: reply });
    res.status(502).json({ reply, toolCalls: [], needsConfirmation: session.pendingConfirmation });
  }
});

app.use(express.static(webRoot));
app.get('*', (_req: Request, res: Response) => res.sendFile(path.join(webRoot, 'index.html')));
app.listen(port, () => {
  console.log(`Periferia QA Agent disponible en http://localhost:${port}`);
  console.log(`Proveedor LLM: ${llm?.provider ?? 'no configurado'}; modelo: ${llm?.model ?? '—'}`);
});
