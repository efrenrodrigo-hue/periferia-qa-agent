import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const casesRoot = path.join(root, 'fixtures/reto-01/casos');
const expectedCases = [
  'co-industrias-delta',
  'ec-corp-andina',
  'hn-agroexport-sula',
  'pa-logistica-istmo'
];
const requiredShared = [
  'fixtures/reto-01/glosario-campos.json',
  'fixtures/reto-01/repositorio/maestro.json',
  'fixtures/reto-01/repositorio/soportes/index.json',
  'src/tools/proveedor.ts',
  'demo.ts',
  'agent/prompt.md',
  'SOLUCION.md'
];
const errors = [];
let jsonCount = 0;
for (const relative of requiredShared) {
  try { await fs.access(path.join(root, relative)); }
  catch { errors.push(`Falta archivo obligatorio: ${relative}`); }
}
for (const relative of requiredShared.filter((name) => name.endsWith('.json'))) {
  try { JSON.parse(await fs.readFile(path.join(root, relative), 'utf8')); jsonCount += 1; }
  catch (error) { errors.push(`JSON inválido ${relative}: ${error instanceof Error ? error.message : String(error)}`); }
}
for (const caseName of expectedCases) {
  const dir = path.join(casesRoot, caseName);
  const required = ['solicitud.json', 'soportes-exigidos.json'];
  for (const name of required) {
    const file = path.join(dir, name);
    try { JSON.parse(await fs.readFile(file, 'utf8')); jsonCount += 1; }
    catch (error) { errors.push(`Archivo de caso inválido ${caseName}/${name}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const requestPath = path.join(dir, 'solicitud.json');
  try {
    const request = JSON.parse(await fs.readFile(requestPath, 'utf8'));
    const templateName = request.formato === 'xlsx' ? 'plantilla-celdas.json' : 'plantilla-campos.json';
    JSON.parse(await fs.readFile(path.join(dir, templateName), 'utf8'));
    jsonCount += 1;
  } catch (error) {
    errors.push(`Plantilla/solicitud inválida en ${caseName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
const supportIndexPath = path.join(root, 'fixtures/reto-01/repositorio/soportes/index.json');
try {
  const index = JSON.parse(await fs.readFile(supportIndexPath, 'utf8'));
  for (const item of index) {
    if (item.archivo) {
      try { await fs.access(path.join(root, 'fixtures/reto-01/repositorio/soportes', item.archivo)); }
      catch { errors.push(`Soporte referenciado no encontrado: ${item.archivo}`); }
    }
  }
} catch (error) {
  errors.push(`Índice de soportes inválido: ${error instanceof Error ? error.message : String(error)}`);
}
console.log(`Preflight de fixtures: ${expectedCases.length} casos revisados; ${jsonCount} archivos JSON parseados.`);
if (errors.length) {
  console.error(`Fallos: ${errors.length}`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('OK: estructura, JSON y referencias a soportes comprobados.');
  console.log('Nota: este preflight no sustituye npm run typecheck, npm test ni npm run demo.');
}
