# Despliegue público — Reto 01

## Estado

El proyecto incluye `Dockerfile` y `render.yaml` como configuración de despliegue. **No hay una URL pública todavía**: crearla exige publicar el repositorio y autorizar un servicio de alojamiento con una cuenta controlada por el candidato. No se debe comunicar una URL inventada como si estuviera desplegada.

## Pasos propuestos con Render

1. Publicar el contenido del repositorio en una cuenta de GitHub autorizada por el candidato.
2. En Render, crear un servicio nuevo desde el repositorio y utilizar el Blueprint `render.yaml`.
3. Configurar `OPENAI_API_KEY` como secreto del servicio. No guardarla en el repositorio ni en el frontend.
4. Esperar a que la construcción finalice y comprobar `https://<dominio-asignado>/api/health`.
5. Abrir la URL raíz, probar los cuatro casos y confirmar que las llamadas a herramientas se muestran en el chat.
6. Verificar que una respuesta afirmativa a la pregunta de confirmación solo genera `ENVIO-SIMULADO.md`; no hay envío externo.
7. Añadir la URL real verificada al README y a la entrega para la reclutadora.

## Verificación previa recomendada

```bash
npm install
npm run preflight
npm run typecheck
npm test
npm run demo
```

No publicar hasta que `typecheck`, `test` y `demo` hayan terminado correctamente en un entorno con las dependencias reales.
