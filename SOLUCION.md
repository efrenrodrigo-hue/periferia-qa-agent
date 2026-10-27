# SOLUCION — Reto 01: Agente de registro como proveedor

## 1. Problema en una frase
Reducir la transcripción manual de formularios de alta de proveedores usando datos corporativos trazables y controles explícitos para soportes ausentes, vencidos y campos que requieren confirmación.

## 2. Arquitectura propuesta

```text
web/ (chat) → src/server.ts (API + ciclo del agente) → src/llm/adapter.ts
                                                 ↓ OpenAI adapter
                                src/tools/proveedor.ts (Zod + reglas deterministas)
                                      ↓ fixtures (solo lectura) / out (escritura)
```

El backend implementa `POST /api/chat`, `GET /api/sessions/:id` y `GET /api/health`. El adaptador OpenAI usa `OPENAI_API_KEY` únicamente en backend.

- **Comportamiento:** `agent/prompt.md`.
- **Conocimiento del proceso:** `src/knowledge/registro-proveedor.md`.
- **Ejecución determinista:** `src/tools/proveedor.ts`.
- **Fixtures:** se mantienen como fuente de verdad de solicitudes, maestro, glosario y soportes.
- **Resultados:** `out/<caso>/` con formulario, paquete, checklist, borrador y log por caso; además se mantiene `out/log.jsonl` como bitácora global.

El frontend muestra mensajes, resúmenes de llamadas a herramientas y un estado de confirmación humana. La vista de argumentos oculta valores bancarios. El historial de API no devuelve los argumentos completos de llamadas de herramienta.

## 3. Ciclo del agente

La fase determinista se implementa en `demo.ts`: leer solicitud → mapear campos → generar formulario → armar paquete. El ciclo conversacional tiene un máximo configurable de iteraciones por turno y un límite aproximado de tokens por sesión. Las llamadas a herramientas se muestran en la UI. La confirmación se procesa fuera del bucle del modelo y debe recibirse en el mensaje inmediatamente posterior a la pregunta. No se realiza envío externo ni firma.

## 4. Elección del modelo y coste

La demo no usa un modelo de lenguaje, de modo que su coste de inferencia es cero. Se implementó un adaptador para OpenAI Chat Completions, con `gpt-4.1-mini` como valor inicial configurable por `LLM_MODEL`. La clave se almacena exclusivamente en `OPENAI_API_KEY` en el backend. Para una estimación ilustrativa (no una cotización vigente), suponiendo 20.000 tokens de entrada y 4.000 de salida por caso y tarifas hipotéticas de USD 0,40/millón de entrada y USD 1,60/millón de salida, el coste sería aproximadamente USD 0,0144 por caso (USD 0,12–0,17 al mes para 8–12 casos). Antes del despliegue deben sustituirse estos supuestos por los precios publicados por el proveedor y medirse el consumo real con las cuatro solicitudes. La demo determinista tiene coste de inferencia cero.

## 5. Diseño del portal web

Para `pa-logistica-istmo` no se automatiza el portal real. La herramienta genera `valores-portal.md` con los valores disponibles para copiar. En una solución de producción, un humano ingresaría las credenciales y resolvería CAPTCHA/MFA. Las credenciales no se almacenarían en el repositorio, prompt ni logs; el agente no haría clic en “Enviar”. El humano revisaría y confirmaría la acción final.

## 6. Decisiones y trade-offs

1. **Validaciones deterministas para los datos:** se consulta el maestro y el glosario por código. La herramienta de generación vuelve a calcular el mapeo desde los fixtures y no confía en valores suministrados por el modelo, reduciendo el riesgo de inyección de datos inventados.
2. **Bloqueo de paquete por soporte ausente/vencido:** evita presentar como listo para firma un paquete incompleto. Un campo faltante se reporta, pero no bloquea por sí solo, según RN3.
3. **Plantillas generadas desde descriptores:** los fixtures contienen JSON con posiciones/campos, no archivos binarios de plantilla. Por ello se crean nuevos archivos XLSX/PDF; si se entregan plantillas originales, se puede adaptar el generador para rellenarlas preservando su formato.
4. **Portal manual asistido:** no se automatiza el portal por estar fuera de alcance; se entrega un documento de valores copiables.

## 7. Ambigüedad detectada en el enunciado
El ejemplo de conversación del PRD indica que `ec-corp-andina` terminaría con estado `listo_para_firma`, pero ese caso exige `camara_comercio` (vigencia hasta 2026-09-30, ya vencida al ejecutar el reto el 2026-10-27) y `certificado_cumplimiento_tributario`, que no aparece en el índice de soportes. Esto contradice RN3, que establece que cualquier soporte exigido vencido o ausente bloquea ese estado. La implementación sigue la regla de negocio explícita RN3 y devuelve `listo_para_firma: false`; esta discrepancia debe aclararse con el evaluador si se considera necesario.

## 7. Supuestos
- Los datos y soportes incluidos son ficticios y son la fuente autorizada para el reto.
- La fecha de vigencia se compara con la fecha local de ejecución en formato ISO `YYYY-MM-DD`.
- Las etiquetas sin correspondencia en el glosario se consideran faltantes, no se resuelven mediante adivinación.
- Para países distintos de Colombia, el NIT colombiano se marca como `requiere_confirmacion` con la nota “identificador extranjero”.

## 9. Cobertura actual

| Historia | Estado | Evidencia / pendiente |
|---|---|---|
| HU-1 Leer solicitud | Hecho en herramientas | Lee JSON de solicitud, plantilla y soportes. |
| HU-2 Mapear campos | Hecho en herramientas | Usa glosario y maestro; no inventa campos. |
| HU-3 Generar formulario | Parcial | Genera XLSX/PDF y Markdown de portal; no se conservan estilos de archivos originales porque no están incluidos. |
| HU-4 Paquete para firma | Hecho en herramientas | Copia soportes disponibles, checklist y borrador; bloquea si hay soporte vencido/ausente. |
| HU-5 Manejo de errores | Parcial | Herramientas devuelven `{ok, data}` o `{ok:false,error}`; falta probar plantillas corruptas con pruebas automatizadas. |
| Ciclo de agente / API | Hecho en prototipo | Adaptador OpenAI, tope de iteraciones y límite aproximado por sesión; falta probar con clave real. |
| Front de chat | Hecho en prototipo | Muestra conversación, llamadas resumidas y confirmación humana; falta prueba de usabilidad. |
| Link público | No hecho | Pendiente publicar el repositorio y configurar alojamiento/secretos. |

## 10. Verificación y estado de ejecución

### Comprobaciones realizadas en el entorno de preparación
- `node scripts/preflight.mjs`: **OK**. Se revisaron los cuatro casos, se parsearon 15 archivos JSON y se comprobaron las referencias de los soportes.
- Transpilación sintáctica de los 7 archivos TypeScript mediante la API de TypeScript disponible en el entorno: **0 diagnósticos sintácticos**. Esto no equivale a una comprobación completa de tipos.
- `npm install --no-audit --no-fund`: no finalizó dentro del tiempo disponible; el entorno no consiguió descargar las dependencias.
- `npm run typecheck`: **no completado** porque no están instaladas las dependencias y tipos (`TS2688: Cannot find type definition file for 'node'`).
- `npm test` y `npm run demo`: pendientes de ejecución con las dependencias reales. No se afirma que hayan pasado.
- Despliegue público: pendiente. El proyecto incluye `Dockerfile`, `render.yaml` y `DEPLOYMENT.md`, pero hace falta publicar el repositorio en una cuenta autorizada, configurar el secreto del proveedor LLM y verificar la URL que asigne el servicio.

Antes de considerar la entrega terminada deben ejecutarse `npm install`, `npm run preflight`, `npm run typecheck`, `npm test` y `npm run demo` en un entorno con acceso al registro npm, e inspeccionarse los artefactos XLSX/PDF generados. La URL pública solo debe añadirse después de probar el servicio desplegado.

## 11. Uso de IA
Se utilizó ChatGPT para analizar el PRD, diseñar la arquitectura inicial y asistir en la generación y revisión del código. La implementación debe ejecutarse y verificarse localmente antes de considerarse terminada; cualquier sugerencia generada se debe revisar contra los requisitos y fixtures.

## 12. Riesgos y mitigaciones
- **Alucinación del modelo:** las herramientas son la única fuente de valores; el agente no debe afirmar datos fuera de sus resultados.
- **Soportes vencidos o ausentes:** checklist determinista y bloqueo del estado `listo_para_firma`.
- **Datos sensibles en logs:** registrar nombres de herramientas, estado y resumen; evitar volcar objetos completos con datos bancarios.
- **Uso no autorizado de la clave LLM:** clave solo en backend, límites de iteraciones/tokens y timeout.
- **Portal web con CAPTCHA/MFA:** mantener intervención humana.
- **Falsos positivos de implementación:** ejecutar `npm run typecheck`, `npm test` y `npm run demo`, inspeccionar los artefactos y verificar la aplicación con una clave de prueba antes del despliegue.
