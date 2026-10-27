// Reexporta la misma implementación que utiliza la aplicación web para evitar divergencias.
// Requiere que el módulo se integre dentro del repositorio del reto y que ctx.directory
// apunte a la raíz que contiene fixtures/reto-01/. No depende del servidor HTTP.
export {
  leer_solicitud,
  mapear_campos,
  generar_formulario,
  armar_paquete,
  simular_envio,
  proveedorTools
} from '../../src/tools/proveedor.js';
export type { ToolContext, CampoSolicitado, Mapeo, MapeoCampo, ProveedorToolName } from '../../src/tools/proveedor.js';
