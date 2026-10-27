# Periferia IT Group — Reto 01: Registro como proveedor

Prototipo de agente para preparar formularios de registro de proveedor a partir de fixtures ficticios. No firma ni realiza envíos reales.

## Requisitos
- Node.js 20 o superior (recomendado: versión LTS vigente).
- npm incluido con Node.js.

## Instalación y ejecución

```bash
npm install
npm run preflight
npm run typecheck
npm test
npm run demo
```

La demo no necesita clave de IA. Procesa los cuatro casos de `fixtures/reto-01/casos/`, genera formularios y paquetes dentro de `out/` y escribe `out/demo-summary.json`. Los logs por herramienta quedan en `out/<caso>/log.jsonl` y en el registro global `out/log.jsonl`.

## Estado actual

**Aviso de verificación:** el código se ha revisado y se ha ejercitado en un arnés temporal con dependencias simuladas porque el entorno de trabajo no pudo descargar los paquetes de npm (error DNS `EAI_AGAIN`). Esa ejecución comprueba parte de la lógica de negocio, pero no sustituye a ejecutar el proyecto con Zod, ExcelJS, PDFKit y Express reales. No afirmar que está listo para producción hasta completar los comandos de verificación.
- [x] Fixtures originales del reto incluidos sin modificación.
- [x] Herramientas tipadas con Zod para leer solicitud, mapear campos, generar formulario, armar paquete y simular envío.
- [x] Excel de salida generado con ExcelJS.
- [x] PDF de salida generado con PDFKit.
- [x] Portal: valores Markdown para copiar; no se automatiza el portal real.
- [x] Checklist de soportes con vencidos/ausentes y bloqueo de `listo_para_firma`.
- [x] Simulación de envío con confirmación explícita.
- [x] Ciclo conversacional con adaptador OpenAI, límite de iteraciones y límite aproximado de tokens por sesión.
- [x] Frontend de chat con historial de turno, llamadas a herramientas y confirmación humana resaltada.
- [x] Preflight de fixtures: 4 casos, 15 archivos JSON y referencias de soportes comprobados.
- [x] Transpilación sintáctica de 7 archivos TypeScript sin diagnósticos sintácticos.
- [ ] Verificación completa con dependencias reales (`npm install`, `npm run typecheck`, `npm test`, `npm run demo`); la instalación agotó el tiempo disponible y `typecheck` informa que falta `@types/node`.
- [ ] Despliegue público y URL de defensa; requiere publicar el repositorio y configurar el servicio de alojamiento.

## Seguridad y límites
- Los datos de los fixtures son ficticios.
- No se ejecuta ninguna acción externa, no se firman documentos y no se automatiza el portal real.
- La simulación de envío solo escribe `ENVIO-SIMULADO.md` y exige `confirmado: true`.
- El secreto del proveedor LLM vive en `OPENAI_API_KEY` como variable de entorno del backend y nunca en el frontend ni en logs.

## Chat local
Copia `.env.example` a `.env`, configura `OPENAI_API_KEY` en el backend y ejecuta `npm run dev`. Abre `http://localhost:3000`. Sin esa clave, `npm run demo` funciona y el servidor arranca, pero el chat con IA muestra un aviso de configuración. No incluyas `.env` en el repositorio.

## Despliegue
Se incluyen `Dockerfile`, `render.yaml` y `DEPLOYMENT.md` para orientar el despliegue desde contenedor. Configura `OPENAI_API_KEY` como secreto del servicio y `PORT=3000`; nunca pongas la clave en el frontend ni en el repositorio. El enlace público sigue pendiente hasta publicar el proyecto y verificar el despliegue.

## Nota sobre plantillas
El reto entrega descriptores JSON de celdas/campos, no los archivos originales de Excel/PDF. Por ello el prototipo crea un libro Excel y un PDF nuevos reproduciendo las etiquetas y posiciones/orden definidos por esos descriptores.

## Módulo reutilizable

La carpeta `modulo/` incluye `agent.md`, una skill de proceso y `tools/proveedor.ts`, que reexporta las mismas herramientas de `src/tools/proveedor.ts` para evitar divergencias. No depende del servidor HTTP, pero debe integrarse dentro del repositorio del proyecto y recibir `ctx.directory` apuntando a la raíz con los fixtures.
