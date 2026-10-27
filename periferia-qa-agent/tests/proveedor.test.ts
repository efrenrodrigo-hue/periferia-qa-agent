import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { armar_paquete, leer_solicitud, mapear_campos, simular_envio, generar_formulario, type CampoSolicitado, type Mapeo } from '../src/tools/proveedor.js';

type ToolResponse = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };
const root = process.cwd();
const ctx = { directory: root, sessionId: 'test-session' };
function parse(raw: string): ToolResponse { return JSON.parse(raw) as ToolResponse; }
function data(response: ToolResponse): Record<string, unknown> {
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

test('lee los cuatro casos de entrada', async () => {
  for (const caso of ['co-industrias-delta', 'ec-corp-andina', 'hn-agroexport-sula', 'pa-logistica-istmo']) {
    const response = data(parse(await leer_solicitud.execute({ caso }, ctx)));
    assert.equal(response.caso, caso);
    assert.ok(Array.isArray(response.campos));
    assert.ok(Array.isArray(response.soportes));
  }
});

test('marca el identificador tributario extranjero para confirmación', async () => {
  const read = data(parse(await leer_solicitud.execute({ caso: 'ec-corp-andina' }, ctx)));
  const mapped = data(parse(await mapear_campos.execute({ caso: 'ec-corp-andina', campos: read.campos as CampoSolicitado[] }, ctx)));
  const confirmFields = mapped.requiere_confirmacion as Array<{ etiqueta: string; nota?: string }>;
  assert.ok(confirmFields.some((field) => field.etiqueta === 'RUC' && field.nota?.includes('identificador extranjero')));
});

test('un soporte vencido o ausente bloquea listo_para_firma', async () => {
  const read = data(parse(await leer_solicitud.execute({ caso: 'ec-corp-andina' }, ctx)));
  const mapped = data(parse(await mapear_campos.execute({ caso: 'ec-corp-andina', campos: read.campos as CampoSolicitado[] }, ctx)));
  data(parse(await generar_formulario.execute({ caso: 'ec-corp-andina', mapeo: mapped as unknown as Mapeo }, ctx)));
  const pack = data(parse(await armar_paquete.execute({ caso: 'ec-corp-andina' }, ctx)));
  assert.equal(pack.listo_para_firma, false);
  const checklist = pack.checklist as Array<{ tipo: string; estado: string }>;
  assert.ok(checklist.some((item) => item.tipo === 'camara_comercio' && item.estado === 'vencido'));
  assert.ok(checklist.some((item) => item.tipo === 'certificado_cumplimiento_tributario' && item.estado === 'ausente'));
});

test('la simulación de envío exige confirmación explícita', async () => {
  const caso = 'pa-logistica-istmo';
  const out = path.join(root, 'out', caso);
  await fs.mkdir(out, { recursive: true });
  await fs.mkdir(path.join(out, 'paquete'), { recursive: true });
  const denied = parse(await simular_envio.execute({ caso, confirmado: false }, ctx));
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.match(denied.error, /confirmación explícita/);
  const allowed = data(parse(await simular_envio.execute({ caso, confirmado: true }, ctx)));
  assert.equal(typeof allowed.ruta, 'string');
});


test('el generador no confía en valores inventados dentro del mapeo recibido', async () => {
  const caso = 'co-industrias-delta';
  const forged: Mapeo = {
    llenos: [{ etiqueta: 'Razón social', estado: 'lleno', clave_maestra: 'razon_social', valor: 'EMPRESA INVENTADA S.A.', obligatorio: true, hoja: 'Datos Proveedor', celda_etiqueta: 'B3', celda_valor: 'C3' }],
    faltantes: [],
    requiere_confirmacion: []
  };
  const response = data(parse(await generar_formulario.execute({ caso, mapeo: forged }, ctx)));
  assert.equal(response.formato, 'xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(root, 'out', caso, 'formulario.xlsx'));
  assert.equal(workbook.getWorksheet('Datos Proveedor')?.getCell('C3').value, 'Periferia IT Group S.A.S.');
});

test('cada herramienta registra el evento en el log global y en el log del caso', async () => {
  const caso = 'co-industrias-delta';
  data(parse(await leer_solicitud.execute({ caso }, ctx)));
  const globalLog = await fs.readFile(path.join(root, 'out', 'log.jsonl'), 'utf8');
  const caseLog = await fs.readFile(path.join(root, 'out', caso, 'log.jsonl'), 'utf8');
  assert.match(globalLog, /proveedor_leer_solicitud/);
  assert.match(caseLog, /proveedor_leer_solicitud/);
});
