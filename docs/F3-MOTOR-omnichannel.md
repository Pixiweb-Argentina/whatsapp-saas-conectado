# F3 — Motor de canales e inbox unificado

Actualizado: 2026-10-10. Build Manual. Rama `codex/omnichannel-f3-inbox`, creada desde `2fea741` de F2. Se reutiliza el worktree `C:/Users/Yani Acevedo/.codex/worktrees/omnichannel-f1/app-whatsapp-saas-conectado`. F1/F2 conservan pendientes externos; no se declaran aceptadas.

## Incremento 1: transporte y política

Implementado localmente:

- Contratos Zod de acciones, petición y resultado; interfaz `ChannelAdapter`. Distingue soporte de código (`implementedActions`) de permisos verificados por cuenta. La normalización inbound de F1 permanece separada y no se conectó a webhooks nuevos.
- Adaptador WhatsApp sobre los clientes existentes YCloud/Kapso. Conserva destinatario, contenido, idioma y componentes de plantillas, wamid y el ID de YCloud. Un modo con credenciales de desarrollo no ejecuta transporte ni declara aceptación.
- El dispatch existente usa el adaptador para texto y plantillas. Sigue insertando la fila `queued` antes de llamar al proveedor. La resolución de destinatario se extrajo a un servicio con filtros por workspace y comprobación explícita de `channel=whatsapp`: Instagram/Messenger/Web nunca usan el teléfono del contacto como fallback.
- Resultado `accepted`, `rejected` o `unknown`. Un timeout, HTTP 5xx/408 o respuesta sin identificadores queda como `unknown`, sin retry automático. Se conserva el enum legado de mensajes: el resultado vive en `meta.send_outcome` y el ID de operación en los fallos; los errores ambiguos muestran la advertencia existente. Detalles remotos siguen fuera de `messages.meta` y de las respuestas públicas.
- Una aceptación remota sigue siendo éxito aunque falle guardar el estado: queda la fila previa y se registra el evento de conciliación existente. Los rechazos por límite conservan el contrato de reintento de WhatsApp. Ningún adaptador agrega un bucle de reenvíos.
- Política pura para el pipeline nuevo: verifica tenant/cuenta/identidad, destinatario y acción, conexión lista, capacidad verificada, estado/revisión, pausa IA, opt-out e interacción habilitante. Devuelve motivo en español, evidencia y vencimiento. No acepta bypass de admin. Mantiene aparte el comportamiento legado WA de ventana nula y override existente.
- Comentario público no habilita DM normal; private reply necesita elegibilidad y reserva de esa misma operación antes del POST. Human Agent requiere actor humano y capacidad verificada. Web exige sesión de visitante. La aprobación de plantilla se vincula a su nombre.

Los vencimientos de política se reciben de evidencia validada en servidor; esta etapa no inventa ventanas ni afirma haber verificado endpoints/permisos Meta. Cargar esa evidencia real y aplicarla con transacciones/leases forma parte del siguiente trabajo. Las pruebas de revisión/reserva son de la función pura, no pruebas de concurrencia ni de cancelación durable.

## Evidencia

- Suite completa: 1.696 pruebas unitarias aprobadas (1.666 previas + 30 nuevas). Log local ignorado: `test-results/f3-unit.log`.
- Después de reforzar pausa IA y el mensaje de error ambiguo: 27 pruebas de política/adaptador vuelven a pasar. Log: `test-results/f3-policy-adapter.log`.
- Typecheck, eslint de los archivos modificados y build de producción local pasan. Build con URL/key públicas ficticias; log ignorado `test-results/f3-build.log`.
- La suite de dispatch usa proveedores y base simulados, con dos tenants/proveedores; comprueba inserción antes del envío, rechazo de canal distinto, enlace de contacto ajeno, opt-out, plantillas y persistencia fallida después de aceptación.
- No se modificaron SQL, pantallas ni dependencias. Las 14 pruebas DB y 20 E2E previas corresponden a F1/F2; no se presentan como validación Cloud de este incremento.

## Incremento 2: runtime del buffer y herramientas

El buffer obtiene ventana de historial y handoff por presupuesto desde `conversation-runtime`, que conserva los valores/defaults del proveedor WA activo. KB, costos, memoria, Jev y reintentos mantienen el orden probado. El buffer heredado descarta canales no soportados antes de reservar turnos, ejecutar herramientas o generar respuestas; conserva el mensaje entrante y registra `skip_reason=unsupported_channel` en el lote.

Las herramientas declaran canales soportados y capacidades necesarias; omitir esa declaración conserva compatibilidad solo con WA. Hay filtro tanto al preparar herramientas para el modelo como en la ejecución común del registry (incluidas herramientas dinámicas), antes de hooks o efectos externos. La identidad/capacidades del contexto vienen del servidor.

La lectura inicial y la derivación por palabra clave en `decide` ahora se filtran explícitamente por workspace. La conexión/rutina de los nuevos canales sigue pendiente: no se habilita IA multicanal con un token o una declaración de herramienta.

Verificación dirigida: 121 pruebas de buffer, decision engine, runtime y registry pasan; typecheck y lint dirigido pasan. Log ignorado `test-results/f3-runtime.log`.

Regresión completa posterior: **1.707 unitarias pasan**, 0 fallos/omitidas. Son 41 pruebas nuevas sobre las 1.666 de F1/F2. Log ignorado `test-results/f3-unit-final.log`.

Build de producción local posterior también aprobado (`test-results/f3-build-final.log`), con configuración pública ficticia y sin despliegue. No hubo cambios visuales que requirieran repetir las capturas de F2.

## Estado de las tareas

| Tarea | Estado |
|---|---|
| F3-T1.1 contratos/adaptador/política | Base local implementada y probada; validación por cuenta externa pendiente |
| F3-T1.2 resolución/dispatch | Ruta WA integrada y protegida; resolución de identidades/cuentas de los nuevos transportes pendiente |
| F3-T1.3 buffer/agente independiente de settings WA | Runtime extraído y herramientas limitadas por canal; rutinas de transportes nuevos pendientes de su pipeline durable |
| F3-T2.1 eventos/jobs/outbox y lease/fencing | Pendiente |
| F3-T2.2 invalidación durable y revalidación inmediata | Política pura preparada; integración durable pendiente |
| F3-T2.3 receipts/unknown/conciliación | Unknown en transporte WA preparado; ecos/receipts y conciliación durable pendientes |
| F3-T3.1 inbox/composer omnicanal | Pendiente; F2 contiene previews de diseño, no estas conexiones |
| F3-T3.2 pruebas integrales | Regresión local parcial; concurrencia y flujos reales pendientes |

## Próximo paso y límites

Implementar eventos/jobs/outbox con restricciones SQL, leases y revisión de conversación antes de habilitar transportes nuevos. Conectar la política y el runtime a ese pipeline. No usar la política pura como sustituto de una reserva transaccional.

El proyecto nuevo identificado es `bzanbpyzujlogipxvkfn`. La última consulta del conector volvió a devolver falta de permisos; sigue autorizada la cuenta anterior. No se usaron bases anteriores, no se aplicaron migraciones remotas ni se enviaron mensajes reales. Sin compras, push, merge o despliegue.

## Auto-Blindaje

- El teléfono es un atributo del contacto, no el selector de canal. Cada resolución debe comprobar canal y workspace antes de enviar.
- Un código de rate limit dentro de HTTP 5xx/408 no convierte una respuesta ambigua en un rechazo seguro. El estado y el texto mostrado deben indicar incertidumbre; nunca sugerir retry automático por ese código aislado.
- Soporte de un método no equivale a permiso concedido o integración probada. El pipeline nuevo exige evidencia por cuenta y continúa deshabilitado hasta validar la integración.
- Filtrar herramientas solo en el prompt es insuficiente: el registry debe repetir la comprobación antes de ejecutar, incluso para herramientas dinámicas. Un canal nuevo no hereda herramientas WA por omisión.
