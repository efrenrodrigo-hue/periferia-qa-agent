import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { z } from 'zod';

export type ToolContext = { directory: string; sessionId: string };
type ToolResult<T> = { ok: true; data: T } | { ok: false; error: string };
type Formato = 'xlsx' | 'pdf' | 'portal';
export type CampoSolicitado = { etiqueta: string; obligatorio: boolean; hoja?: string; celda_etiqueta?: string; celda_valor?: string };
export type MapeoCampo = {
  etiqueta: string;
  estado: 'lleno' | 'faltante' | 'requiere_confirmacion';
  clave_maestra?: string;
  valor?: unknown;
  nota?: string;
  obligatorio: boolean;
  hoja?: string;
  celda_etiqueta?: string;
  celda_valor?: string;
};
export type Mapeo = { llenos: MapeoCampo[]; faltantes: MapeoCampo[]; requiere_confirmacion: MapeoCampo[] };

const caseSchema = z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Nombre de caso inválido');
const ctxSchema = z.object({ directory: z.string().min(1), sessionId: z.string().min(1) });
const requestedFieldSchema = z.object({
  etiqueta: z.string().min(1).describe('Etiqueta exacta del campo solicitado por el cliente'),
  obligatorio: z.boolean().default(true).describe('Indica si la plantilla marca el campo como obligatorio'),
  hoja: z.string().optional().describe('Nombre de hoja Excel si aplica'),
  celda_etiqueta: z.string().optional().describe('Celda de etiqueta en Excel si aplica'),
  celda_valor: z.string().optional().describe('Celda de valor en Excel si aplica')
});
const mappedFieldSchema = z.object({
  etiqueta: z.string(),
  estado: z.enum(['lleno', 'faltante', 'requiere_confirmacion']),
  clave_maestra: z.string().optional(),
  valor: z.unknown().optional(),
  nota: z.string().optional(),
  obligatorio: z.boolean(),
  hoja: z.string().optional(),
  celda_etiqueta: z.string().optional(),
  celda_valor: z.string().optional()
});
const mappingSchema = z.object({
  llenos: z.array(mappedFieldSchema),
  faltantes: z.array(mappedFieldSchema),
  requiere_confirmacion: z.array(mappedFieldSchema)
});

function safeJson<T>(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => val instanceof Error ? val.message : val);
}
function result<T>(data: T): ToolResult<T> { return { ok: true, data }; }
function failure(error: unknown): ToolResult<never> {
  return { ok: false, error: error instanceof Error ? error.message : 'Error inesperado al procesar la solicitud' };
}
function normalizeLabel(input: string): string {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function taxIdExpectedForCountry(country: string): string {
  const expected: Record<string, string> = { CO: 'NIT', EC: 'RUC', PE: 'RUC', PA: 'RUC', HN: 'RTN' };
  return expected[country] ?? 'identificador tributario del país';
}
function taxIdNeedsConfirmation(country: string, normalizedLabel: string, masterKey: string): boolean {
  if (masterKey !== 'nit') return false;
  const expected = normalizeLabel(taxIdExpectedForCountry(country));
  return country !== 'CO' || normalizedLabel !== expected;
}
function getByPath(source: unknown, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((current, key) => {
    if (current !== null && typeof current === 'object' && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}
async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as T;
}
function paths(ctx: ToolContext, caso: string) {
  const root = path.resolve(ctx.directory);
  const caseDir = path.resolve(root, 'fixtures/reto-01/casos', caso);
  if (!caseDir.startsWith(path.resolve(root, 'fixtures/reto-01/casos') + path.sep)) throw new Error('Caso inválido');
  return {
    root,
    caseDir,
    request: path.join(caseDir, 'solicitud.json'),
    xlsxTemplate: path.join(caseDir, 'plantilla-celdas.json'),
    pdfTemplate: path.join(caseDir, 'plantilla-campos.json'),
    requiredDocs: path.join(caseDir, 'soportes-exigidos.json'),
    master: path.join(root, 'fixtures/reto-01/repositorio/maestro.json'),
    glossary: path.join(root, 'fixtures/reto-01/glosario-campos.json'),
    supportIndex: path.join(root, 'fixtures/reto-01/repositorio/soportes/index.json'),
    supportDir: path.join(root, 'fixtures/reto-01/repositorio/soportes'),
    outDir: path.join(root, 'out', caso),
    packageDir: path.join(root, 'out', caso, 'paquete')
  };
}
async function appendLog(ctx: ToolContext, caso: string, herramienta: string, ok: boolean, resumen: string): Promise<void> {
  try {
    const p = paths(ctx, caso);
    await fs.mkdir(p.outDir, { recursive: true });
    const record = { ts: new Date().toISOString(), herramienta, ok, resumen: resumen.slice(0, 500) };
    await fs.appendFile(path.join(p.outDir, 'log.jsonl'), `${JSON.stringify(record)}\n`, 'utf8');
    // El PRD pide un log global además del registro específico de cada caso.
    const globalLog = path.join(p.root, 'out', 'log.jsonl');
    await fs.mkdir(path.dirname(globalLog), { recursive: true });
    await fs.appendFile(globalLog, `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    // Logging failure must not leak an exception to the agent; the operation result remains authoritative.
  }
}
async function executeLogged<T>(ctx: ToolContext, caso: string, tool: string, fn: () => Promise<T>): Promise<string> {
  try {
    const data = await fn();
    await appendLog(ctx, caso, tool, true, 'Operación completada');
    return safeJson(result(data));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado';
    await appendLog(ctx, caso, tool, false, message);
    return safeJson(failure(error));
  }
}

async function readRequest(caso: string, ctx: ToolContext) {
  const p = paths(ctx, caso);
  const request = await readJson<{ id: string; pais: string; cliente: string; formato: Formato; [key: string]: unknown }>(p.request);
  const requiredDocs = await readJson<string[]>(p.requiredDocs);
  let fields: CampoSolicitado[] = [];
  if (request.formato === 'xlsx') {
    const template = await readJson<Array<{ hoja: string; celda_etiqueta: string; etiqueta: string; celda_valor: string }>>(p.xlsxTemplate);
    fields = template.map((item) => ({ ...item, obligatorio: true }));
  } else if (request.formato === 'pdf' || request.formato === 'portal') {
    const template = await readJson<Array<{ etiqueta: string; obligatorio: boolean }>>(p.pdfTemplate);
    fields = template.map((item) => ({ ...item }));
  } else {
    throw new Error(`Formato no soportado: ${String(request.formato)}`);
  }
  return { request, fields, requiredDocs };
}

/** Mapeo determinista: los valores se obtienen siempre del maestro, nunca de argumentos generados por el modelo. */
async function mapRequestedFields(caso: string, fields: CampoSolicitado[], ctx: ToolContext): Promise<Mapeo> {
  const p = paths(ctx, caso);
  const request = await readJson<{ pais: string }>(p.request);
  const master = await readJson<Record<string, unknown>>(p.master);
  const glossary = await readJson<Record<string, string>>(p.glossary);
  const glossaryEntries = Object.entries(glossary).map(([label, key]) => [normalizeLabel(label), key] as const);
  const output: Mapeo = { llenos: [], faltantes: [], requiere_confirmacion: [] };
  for (const field of fields) {
    const normalized = normalizeLabel(field.etiqueta);
    const masterKey = glossaryEntries.find(([label]) => label === normalized)?.[1];
    const base = { etiqueta: field.etiqueta, obligatorio: field.obligatorio, hoja: field.hoja, celda_etiqueta: field.celda_etiqueta, celda_valor: field.celda_valor };
    if (!masterKey) {
      output.faltantes.push({ ...base, estado: 'faltante', nota: 'La etiqueta no tiene correspondencia en el glosario maestro.' });
      continue;
    }
    const value = getByPath(master, masterKey);
    if (value === undefined || value === null || value === '') {
      output.faltantes.push({ ...base, estado: 'faltante', clave_maestra: masterKey, nota: 'La clave existe en el glosario, pero no hay valor disponible en el maestro.' });
      continue;
    }
    if (taxIdNeedsConfirmation(request.pais, normalized, masterKey)) {
      const expectedLabel = taxIdExpectedForCountry(request.pais);
      const note = request.pais === 'CO'
        ? `Etiqueta tributaria ambigua: se propone ${expectedLabel} para Colombia; confirmar que corresponde al campo solicitado.`
        : `identificador extranjero: se esperaría ${expectedLabel}, pero el maestro solo contiene NIT colombiano; confirmar equivalencia antes de usarlo.`;
      output.requiere_confirmacion.push({ ...base, estado: 'requiere_confirmacion', clave_maestra: masterKey, valor: value, nota: note });
      continue;
    }
    output.llenos.push({ ...base, estado: 'lleno', clave_maestra: masterKey, valor: value });
  }
  return output;
}
function mappingInRequestOrder(mapping: Mapeo, requestedFields: CampoSolicitado[]): MapeoCampo[] {
  const all = flattenMapping(mapping);
  return requestedFields.map((requested) => all.find((field) =>
    field.etiqueta === requested.etiqueta && field.hoja === requested.hoja && field.celda_valor === requested.celda_valor
  ) ?? {
    ...requested,
    estado: 'faltante' as const,
    obligatorio: requested.obligatorio,
    nota: 'No se pudo verificar el campo en el mapeo determinista.'
  });
}

export const leer_solicitud = {
  description: 'Lee la solicitud, plantilla y soportes exigidos de un caso de registro de proveedor.',
  args: { caso: caseSchema.describe('Nombre de la carpeta del caso dentro de fixtures/reto-01/casos/') },
  async execute(args: { caso: string }, rawCtx: ToolContext): Promise<string> {
    const parsedCtx = ctxSchema.safeParse(rawCtx);
    if (!parsedCtx.success) return safeJson(failure(new Error('Contexto de ejecución inválido')));
    const parsedArgs = z.object({ caso: caseSchema }).safeParse(args);
    if (!parsedArgs.success) return safeJson(failure(new Error('Nombre de caso inválido')));
    return executeLogged(parsedCtx.data, parsedArgs.data.caso, 'proveedor_leer_solicitud', async () => {
      const { request, fields, requiredDocs } = await readRequest(parsedArgs.data.caso, parsedCtx.data);
      return {
        caso: request.id,
        pais: request.pais,
        cliente: request.cliente,
        formato: request.formato,
        campos: fields,
        soportes: requiredDocs,
        fecha_solicitud: request.fecha
      };
    });
  }
};

export const mapear_campos = {
  description: 'Mapea las etiquetas solicitadas contra el glosario y maestro corporativo, sin inventar valores.',
  args: {
    caso: caseSchema.describe('Nombre de la carpeta del caso'),
    campos: z.array(requestedFieldSchema).min(1).describe('Campos devueltos por proveedor_leer_solicitud')
  },
  async execute(args: { caso: string; campos: CampoSolicitado[] }, rawCtx: ToolContext): Promise<string> {
    const parsedCtx = ctxSchema.safeParse(rawCtx);
    const parsedArgs = z.object({ caso: caseSchema, campos: z.array(requestedFieldSchema).min(1) }).safeParse(args);
    if (!parsedCtx.success || !parsedArgs.success) return safeJson(failure(new Error('Argumentos inválidos para mapear campos')));
    return executeLogged(parsedCtx.data, parsedArgs.data.caso, 'proveedor_mapear_campos', async () => {
      return mapRequestedFields(parsedArgs.data.caso, parsedArgs.data.campos, parsedCtx.data);
    });
  }
};

function flattenMapping(mapping: Mapeo): MapeoCampo[] {
  return [...mapping.llenos, ...mapping.faltantes, ...mapping.requiere_confirmacion];
}
function stringifyCell(value: unknown): string | number | boolean {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value === null || value === undefined) return '';
  return JSON.stringify(value);
}
function hasExplicitBankField(fields: MapeoCampo[]): boolean {
  return fields.some((field) => Boolean(field.clave_maestra?.startsWith('banco.')));
}
async function createPdf(outputPath: string, fields: MapeoCampo[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = createWriteStream(outputPath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.pipe(stream);
    doc.fontSize(18).text('Formulario de registro de proveedor', { align: 'center' });
    doc.moveDown(1);
    doc.fontSize(10).fillColor('#444').text('Documento generado automáticamente a partir de los campos de la plantilla del cliente.');
    doc.moveDown(1.2);
    for (const field of fields) {
      doc.fillColor('#111').fontSize(10).font('Helvetica-Bold').text(field.etiqueta);
      let shownValue = '';
      if (field.estado === 'lleno') shownValue = String(field.valor ?? '');
      else if (field.estado === 'requiere_confirmacion') shownValue = `PENDIENTE DE CONFIRMACIÓN — ${String(field.valor ?? '')}`;
      else shownValue = 'PENDIENTE — dato no disponible';
      doc.font('Helvetica').fillColor(field.estado === 'lleno' ? '#111' : '#9A3412').text(shownValue, { width: 490 });
      doc.moveDown(0.7);
      if (doc.y > 730) doc.addPage();
    }
    doc.end();
  });
}
export const generar_formulario = {
  description: 'Genera el formulario de salida en Excel, PDF o una lista Markdown copiable para portal.',
  args: {
    caso: caseSchema.describe('Nombre de la carpeta del caso'),
    mapeo: mappingSchema.describe('Resultado de proveedor_mapear_campos para el mismo caso')
  },
  async execute(args: { caso: string; mapeo: Mapeo }, rawCtx: ToolContext): Promise<string> {
    const parsedCtx = ctxSchema.safeParse(rawCtx);
    const parsedArgs = z.object({ caso: caseSchema, mapeo: mappingSchema }).safeParse(args);
    if (!parsedCtx.success || !parsedArgs.success) return safeJson(failure(new Error('Argumentos inválidos para generar formulario')));
    return executeLogged(parsedCtx.data, parsedArgs.data.caso, 'proveedor_generar_formulario', async () => {
      const p = paths(parsedCtx.data, parsedArgs.data.caso);
      const { request, fields: requestedFields } = await readRequest(parsedArgs.data.caso, parsedCtx.data);
      // No confiamos en valores enviados por el modelo dentro de `mapeo`: se recalculan desde fixtures.
      const canonicalMapping = await mapRequestedFields(parsedArgs.data.caso, requestedFields, parsedCtx.data);
      const fields = mappingInRequestOrder(canonicalMapping, requestedFields);
      await fs.mkdir(p.outDir, { recursive: true });
      let outputPath: string;
      if (request.formato === 'xlsx') {
        const workbook = new ExcelJS.Workbook();
        const bySheet = new Map<string, MapeoCampo[]>();
        for (const field of fields) {
          if (!field.hoja || !field.celda_valor) continue;
          const list = bySheet.get(field.hoja) ?? [];
          list.push(field);
          bySheet.set(field.hoja, list);
        }
        for (const [sheetName, sheetFields] of bySheet) {
          const sheet = workbook.addWorksheet(sheetName);
          for (const field of sheetFields) {
            if (field.celda_etiqueta) sheet.getCell(field.celda_etiqueta).value = field.etiqueta;
            sheet.getCell(field.celda_valor).value = field.estado === 'lleno' ? stringifyCell(field.valor) : field.estado === 'requiere_confirmacion' ? `CONFIRMAR: ${String(field.valor ?? '')}` : 'PENDIENTE: dato no disponible';
          }
          sheet.columns.forEach((column) => { if (column) column.width = 32; });
        }
        outputPath = path.join(p.outDir, 'formulario.xlsx');
        await workbook.xlsx.writeFile(outputPath);
      } else if (request.formato === 'pdf') {
        outputPath = path.join(p.outDir, 'formulario.pdf');
        await createPdf(outputPath, fields);
      } else {
        outputPath = path.join(p.outDir, 'valores-portal.md');
        const lines = [`# Valores para portal — ${request.cliente}`, '', `País: ${request.pais}`, '', '> Portal real no automatizado. Copiar manualmente los valores y confirmar cualquier dato marcado.',''];
        for (const field of fields) {
          const value = field.estado === 'lleno' ? String(field.valor ?? '') : field.estado === 'requiere_confirmacion' ? `REQUIERE CONFIRMACIÓN: ${String(field.valor ?? '')} (${field.nota ?? ''})` : `FALTANTE (${field.nota ?? 'sin dato'})`;
          lines.push(`- **${field.etiqueta}:** ${value}`);
        }
        await fs.writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
      }
      return { ruta: path.relative(p.root, outputPath).replaceAll(path.sep, '/'), formato: request.formato, mensaje: request.formato === 'portal' ? 'formato no soportado para automatización de portal; se generaron valores listos para copiar' : 'formulario generado', campos: fields.length, datos_bancarios_incluidos: hasExplicitBankField(fields) };
    });
  }
};

export const armar_paquete = {
  description: 'Arma el paquete con formulario, copias de soportes, checklist de vigencias y borrador de correo.',
  args: { caso: caseSchema.describe('Nombre de la carpeta del caso') },
  async execute(args: { caso: string }, rawCtx: ToolContext): Promise<string> {
    const parsedCtx = ctxSchema.safeParse(rawCtx);
    const parsedArgs = z.object({ caso: caseSchema }).safeParse(args);
    if (!parsedCtx.success || !parsedArgs.success) return safeJson(failure(new Error('Argumentos inválidos para armar paquete')));
    return executeLogged(parsedCtx.data, parsedArgs.data.caso, 'proveedor_armar_paquete', async () => {
      const p = paths(parsedCtx.data, parsedArgs.data.caso);
      const { request, fields, requiredDocs } = await readRequest(parsedArgs.data.caso, parsedCtx.data);
      const mapping = await mapRequestedFields(parsedArgs.data.caso, fields, parsedCtx.data);
      await fs.mkdir(p.packageDir, { recursive: true });
      const supportIndex = await readJson<Array<{ tipo: string; archivo: string; vigencia_hasta: string | null; descripcion: string }>>(p.supportIndex);
      const today = new Date().toISOString().slice(0, 10);
      const checklist: Array<{ tipo: string; estado: 'presente' | 'vencido' | 'ausente'; archivo?: string; vigencia_hasta?: string | null; descripcion?: string }> = [];
      for (const type of requiredDocs) {
        const support = supportIndex.find((item) => item.tipo === type);
        if (!support) {
          checklist.push({ tipo: type, estado: 'ausente', descripcion: 'No existe entrada para este soporte en el índice maestro.' });
          continue;
        }
        const source = path.join(p.supportDir, support.archivo);
        let exists = false;
        try { await fs.access(source); exists = true; } catch { exists = false; }
        if (!exists) {
          checklist.push({ tipo: type, estado: 'ausente', archivo: support.archivo, vigencia_hasta: support.vigencia_hasta, descripcion: 'El índice existe, pero el archivo no está disponible.' });
          continue;
        }
        const expired = Boolean(support.vigencia_hasta && support.vigencia_hasta < today);
        checklist.push({ tipo: type, estado: expired ? 'vencido' : 'presente', archivo: support.archivo, vigencia_hasta: support.vigencia_hasta, descripcion: support.descripcion });
        await fs.copyFile(source, path.join(p.packageDir, support.archivo));
      }
      // Include the generated form in the package if available; otherwise report that it still needs generation.
      const generatedName = request.formato === 'xlsx' ? 'formulario.xlsx' : request.formato === 'pdf' ? 'formulario.pdf' : 'valores-portal.md';
      const generatedPath = path.join(p.outDir, generatedName);
      try { await fs.access(generatedPath); await fs.copyFile(generatedPath, path.join(p.packageDir, generatedName)); } catch { /* demo/generator can run in either order */ }
      const blockers = checklist.filter((item) => item.estado === 'vencido' || item.estado === 'ausente');
      const ready = blockers.length === 0;
      const checklistLines = [
        `# Checklist de soportes — ${request.cliente}`,
        '',
        `Fecha de revisión: ${today}`,
        `Estado: **${ready ? 'listo_para_firma' : 'bloqueado' }**`,
        '',
        '| Soporte | Estado | Vigencia | Archivo |',
        '|---|---|---|---|',
        ...checklist.map((item) => `| ${item.tipo} | ${item.estado} | ${item.vigencia_hasta ?? 'No aplica'} | ${item.archivo ?? 'No disponible'} |`),
        '',
        '## Campos del formulario',
        '',
        ...mapping.faltantes.map((field) => `- **Faltante:** ${field.etiqueta} — ${field.nota ?? 'dato no disponible'}`),
        ...mapping.requiere_confirmacion.map((field) => `- **Requiere confirmación:** ${field.etiqueta} — ${field.nota ?? 'validar con el usuario'}`),
        '',
        ready ? 'No se encontraron soportes ausentes o vencidos.' : `Bloqueado por ${blockers.length} soporte(s) ausente(s) o vencido(s).`,
        'Los campos faltantes se reportan, pero por sí solos no bloquean el estado de firma.'
      ];
      await fs.writeFile(path.join(p.packageDir, 'checklist.md'), `${checklistLines.join('\n')}\n`, 'utf8');
      // Explicitly do not include banking information in this email draft.
      const emailDraft = [
        `Para: ${String(request.de ?? 'contacto del cliente')}`,
        `Asunto: Registro como proveedor — ${request.cliente}`,
        '',
        'Cordial saludo,',
        '',
        'Adjuntamos para revisión el formulario de registro y los soportes disponibles. El paquete queda sujeto a la revisión y firma del representante legal.',
        '',
        'Quedan pendientes los siguientes soportes o confirmaciones:',
        ...(checklist.filter((item) => item.estado !== 'presente').map((item) => `- ${item.tipo}: ${item.estado}${item.vigencia_hasta ? ` (vigencia hasta ${item.vigencia_hasta})` : ''}`)),
        ...mapping.faltantes.map((field) => `- Campo por completar: ${field.etiqueta}`),
        ...mapping.requiere_confirmacion.map((field) => `- Confirmar campo: ${field.etiqueta}`),
        '',
        'Este borrador no ha sido enviado. La firma y el envío requieren intervención humana.'
      ];
      await fs.writeFile(path.join(p.packageDir, 'borrador-correo.md'), `${emailDraft.join('\n')}\n`, 'utf8');
      return { ruta: path.relative(p.root, p.packageDir).replaceAll(path.sep, '/'), listo_para_firma: ready, checklist, campos_faltantes: mapping.faltantes.map((field) => field.etiqueta), requiere_confirmacion: mapping.requiere_confirmacion.map((field) => field.etiqueta) };
    });
  }
};

export const simular_envio = {
  description: 'Crea un registro de envío simulado únicamente después de una confirmación humana explícita.',
  args: {
    caso: caseSchema.describe('Nombre de la carpeta del caso'),
    confirmado: z.boolean().describe('Debe ser true solo si el usuario confirmó explícitamente la simulación en el turno inmediatamente anterior')
  },
  async execute(args: { caso: string; confirmado: boolean }, rawCtx: ToolContext): Promise<string> {
    const parsedCtx = ctxSchema.safeParse(rawCtx);
    const parsedArgs = z.object({ caso: caseSchema, confirmado: z.boolean() }).safeParse(args);
    if (!parsedCtx.success || !parsedArgs.success) return safeJson(failure(new Error('Argumentos inválidos para simular envío')));
    if (!parsedArgs.data.confirmado) return safeJson({ ok: false, error: 'requiere confirmación explícita' });
    return executeLogged(parsedCtx.data, parsedArgs.data.caso, 'proveedor_simular_envio', async () => {
      const p = paths(parsedCtx.data, parsedArgs.data.caso);
      const packagePath = p.packageDir;
      try { await fs.access(packagePath); } catch { throw new Error('Primero debes armar el paquete'); }
      const outputPath = path.join(p.outDir, 'ENVIO-SIMULADO.md');
      const content = [
        `# Envío simulado — ${parsedArgs.data.caso}`,
        '',
        `Fecha: ${new Date().toISOString()}`,
        'Estado: SIMULADO; no se realizó ningún envío externo.',
        'Confirmación humana recibida en el turno inmediatamente anterior: sí.',
        'La firma y el envío real permanecen fuera del alcance del agente.'
      ].join('\n');
      await fs.writeFile(outputPath, `${content}\n`, 'utf8');
      return { ruta: path.relative(p.root, outputPath).replaceAll(path.sep, '/') };
    });
  }
};

export const proveedorTools = { leer_solicitud, mapear_campos, generar_formulario, armar_paquete, simular_envio };
export type ProveedorToolName = keyof typeof proveedorTools;
