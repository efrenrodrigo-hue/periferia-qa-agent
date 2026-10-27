---
name: registro-proveedor
description: Conocimiento del proceso para leer solicitudes de registro, mapear campos contra el maestro, comprobar soportes y preparar el paquete para revisión humana.
---

# Conocimiento del proceso: registro de proveedor

## Reglas de operación
- La fuente de los datos corporativos es `fixtures/reto-01/repositorio/maestro.json`.
- Los sinónimos de etiquetas se resuelven con `fixtures/reto-01/glosario-campos.json`.
- Los documentos y sus vigencias se consultan exclusivamente en `fixtures/reto-01/repositorio/soportes/index.json`.
- Nunca inventar valores ni declarar vigente un soporte sin comprobar su `vigencia_hasta`.
- El identificador tributario por país es CO=NIT, EC=RUC, PE=RUC, PA=RUC y HN=RTN. El maestro solo contiene el NIT colombiano; para países distintos de CO se puede proponer ese dato únicamente marcado `requiere_confirmacion` con la nota `identificador extranjero`.
- Los datos bancarios solo se incluyen cuando la plantilla solicita explícitamente un campo bancario. Nunca se incluyen en el borrador del correo.
- Un soporte exigido ausente o vencido bloquea `listo_para_firma`. Un campo de formulario faltante se reporta, pero no bloquea por sí solo ese estado.
- No se firma ni se envía el paquete. La simulación de envío requiere confirmación humana explícita y solo crea `ENVIO-SIMULADO.md`.
- El portal web real no se automatiza; se produce una lista de valores copiables.
