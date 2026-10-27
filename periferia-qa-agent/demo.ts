import fs from 'node:fs/promises';
import path from 'node:path';
import { armar_paquete, generar_formulario, leer_solicitud, mapear_campos, type CampoSolicitado, type Mapeo } from './src/tools/proveedor.js';

type JsonToolResponse = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };
function parseToolResponse(raw: string): JsonToolResponse {
  try { return JSON.parse(raw) as JsonToolResponse; }
  catch { return { ok: false, error: 'La herramienta devolvió una respuesta no válida.' }; }
}
function ensureSuccess(response: JsonToolResponse, step: string): Record<string, unknown> {
  if (!response.ok) throw new Error(`${step}: ${response.error}`);
  return response.data;
}

async function main(): Promise<void> {
  const root = process.cwd();
  const fixturesPath = path.join(root, 'fixtures/reto-01/casos');
  const outPath = path.join(root, 'out');
  await fs.rm(outPath, { recursive: true, force: true });
  await fs.mkdir(outPath, { recursive: true });
  const cases = (await fs.readdir(fixturesPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const summaries: Array<Record<string, unknown>> = [];
  const ctx = { directory: root, sessionId: 'demo-deterministic' };

  for (const caso of cases) {
    try {
      const readData = ensureSuccess(parseToolResponse(await leer_solicitud.execute({ caso }, ctx)), 'leer_solicitud');
      const mappingData = ensureSuccess(parseToolResponse(await mapear_campos.execute({ caso, campos: readData.campos as CampoSolicitado[] }, ctx)), 'mapear_campos');
      const formData = ensureSuccess(parseToolResponse(await generar_formulario.execute({ caso, mapeo: mappingData as unknown as Mapeo }, ctx)), 'generar_formulario');
      const packageData = ensureSuccess(parseToolResponse(await armar_paquete.execute({ caso }, ctx)), 'armar_paquete');
      const checklist = Array.isArray(packageData.checklist) ? packageData.checklist as Array<{ tipo: string; estado: string }> : [];
      const summary = {
        caso,
        formato: readData.formato,
        campos_solicitados: Array.isArray(readData.campos) ? readData.campos.length : 0,
        campos_llenos: Array.isArray(mappingData.llenos) ? mappingData.llenos.length : 0,
        campos_faltantes: Array.isArray(mappingData.faltantes) ? mappingData.faltantes.length : 0,
        campos_requieren_confirmacion: Array.isArray(mappingData.requiere_confirmacion) ? mappingData.requiere_confirmacion.length : 0,
        formulario: formData.ruta,
        paquete: packageData.ruta,
        listo_para_firma: packageData.listo_para_firma,
        soportes_vencidos: checklist.filter((item) => item.estado === 'vencido').map((item) => item.tipo),
        soportes_ausentes: checklist.filter((item) => item.estado === 'ausente').map((item) => item.tipo),
        estado: 'OK'
      };
      summaries.push(summary);
      console.log(JSON.stringify(summary, null, 2));
    } catch (error) {
      const summary = { caso, estado: 'ERROR', error: error instanceof Error ? error.message : 'Error inesperado' };
      summaries.push(summary);
      console.error(JSON.stringify(summary, null, 2));
    }
  }
  await fs.writeFile(path.join(outPath, 'demo-summary.json'), `${JSON.stringify(summaries, null, 2)}\n`, 'utf8');
  const failures = summaries.filter((item) => item.estado !== 'OK');
  console.log(`\nResumen: ${summaries.length - failures.length}/${summaries.length} casos procesados correctamente.`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'No fue posible ejecutar la demo.');
  process.exitCode = 1;
});
