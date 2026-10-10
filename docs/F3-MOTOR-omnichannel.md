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

## Incremento 3: cola durable y primera validación Cloud

Se agregaron `inbound_events`, `message_jobs` y `message_outbox`, con claves compuestas por workspace/conexión, deduplicación y acceso exclusivo del servidor. Las sesiones anon/authenticated no pueden leer payloads ni llamar RPC de la cola. Los eventos históricos, ecos y receipts se conservan como ignorados para automatización; su conciliación aún requiere un consumidor específico.

Las RPC guardan el evento antes del ACK que deberá devolver el futuro webhook, encolan sin reemplazar una operación existente, toman un trabajo con `FOR UPDATE SKIP LOCKED` y reservan 90 segundos con un contador de fencing. Recuperación acotada a 100 registros, máximo cinco adquisiciones y 24 horas de antigüedad. Un worker vencido no puede autorizar ni cerrar el intento de otro.

El outbox registra el permiso antes de llamar al proveedor. Caída antes del permiso: se puede recuperar el trabajo. Caída después del permiso: queda `unknown`, aunque el proceso pudiera haber fallado antes de hacer POST; se prefiere conciliación a duplicar el envío. Los rechazos confirmados también quedan terminales en este incremento: backoff, cuotas y reprogramación segura siguen pendientes.

Un trigger incrementa `state_revision` ante cambios de estado, pausa IA o asignación; invalida trabajos IA/automatización pendientes o reservados en esa misma transacción. El worker vuelve a cargar política, identidad y capacidades, y la RPC comprueba revisión/conexión/lease antes del permiso. Se mantiene el orden de bloqueos conversación → trabajo → outbox.

**Límite de la garantía:** el permiso confirmado marca un envío en curso. Una toma humana posterior no puede retirar un POST ya autorizado; el resultado se conserva para conciliación. No se promete exactly-once. Todavía no se conectaron el productor de IA, los webhooks ni un cron permanente a esta cola; WhatsApp continúa por su circuito compatible. Faltan resolución real de contexto/capacidades, reserva por comentario, receipts e inbox.

### Evidencia local

- 1.722 unitarias pasan (15 nuevas en este incremento). Regresión: `test-results/f3-queue-unit-full.log`.
- 33 comprobaciones DB pasan: 14 anteriores + 19 de cola, incluida restauración de snapshot. `test-results/f3-queue-db.log`.
- 15 dirigidas vuelven a pasar después de ordenar los helpers; typecheck y lint dirigido pasan.
- Build de producción local pasa con configuración pública ficticia: `test-results/f3-queue-build.log`. No se modificó UI en este incremento.

### Supabase nuevo

El acceso quedó resuelto mediante **Cuenta de saas whatsapp omni**. Proyecto `bzanbpyzujlogipxvkfn`, PostgreSQL **17.11**, activo. La inspección inicial comprobó cero tablas públicas, usuarios y migraciones. Se aplicaron las **71 migraciones** del repositorio en orden, sin copiar datos de otras cuentas. El historial remoto se alineó con los identificadores originales y se comparó completo con los archivos locales: 71/71 coinciden. No volver a aplicarlas.

Se verificaron en Cloud: permisos de cola, deduplicación, backfill de fixtures, aislamiento entre tenants, lease/fencing, unknown y toma humana. El smoke transaccional hizo rollback de todos sus datos. También hubo dos pruebas de concurrencia con procesos PostgreSQL distintos:

| Prueba | Proceso que mantiene el bloqueo | Competidor | Resultado |
|---|---|---|---|
| Reserva de job | PID 33581, 16:50:59.401–16:51:14.426 UTC | PID 33583, 16:51:03.235–16:51:03.238 UTC | Cero trabajos tomados; no espera al bloqueo |
| Toma humana vs permiso de envío | PID 33604, 16:51:53.494–16:52:08.509 UTC | PID 33606, 16:51:55.628–16:52:08.509 UTC | Espera el commit humano y devuelve `permitted=false` |

Estado final de la segunda prueba: job cancelado, fence 2, revisión 1, cero permisos de envío. Se limpiaron exclusivamente las filas sintéticas creadas para la prueba y los cron temporales se desprogramaron. Recuento final: cero workspaces, usuarios Auth y jobs; solo queda el cron heredado `automation-history-purge`, **inactivo**. No hubo envíos HTTP a proveedores.

Evidencia estructurada: [F3 Supabase](evidencias/F3-SUPABASE-2026-10-10.json). Fuentes reproducibles: `tests/db/cloud-queue-assertions.sql` con el fixture existente dentro de BEGIN/ROLLBACK, y `tests/db/cloud-queue-concurrency.mjs`. No usar `platform-fixture.sql` en Cloud: simula objetos de Supabase solo para PGlite.

El asesor de seguridad no devolvió ERROR; conserva WARN heredados por extensiones en public y tres helpers SECURITY DEFINER accesibles a anon/authenticated. Los helpers autenticados participan de RLS; no se revocan a ciegas. INFO de tablas servidor sin políticas es intencional, con grants de clientes revocados en la cola. Revisar antes del lanzamiento: [extensiones](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public), [helpers anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) y [helpers autenticados](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

Referencias técnicas consultadas: [bloqueos PostgreSQL 17](https://www.postgresql.org/docs/17/explicit-locking.html), [pg_cron](https://github.com/citusdata/pg_cron) y [cambios de PostgreSQL 17.11 en Supabase](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes). No se requirió migrar cifrados legacy en esta base inicialmente vacía.

## Incremento 4: Supabase Auth e inbox real

La app local quedó conectada a `bzanbpyzujlogipxvkfn`. Se reutilizaron la clave publicable y la clave secreta existentes del proyecto, sin crear/rotar claves. `.env.local` y `.env.qa.local` están ignorados por Git; no pegar su contenido en chat. El nombre heredado `SUPABASE_SERVICE_ROLE_KEY` contiene la clave secreta moderna, solo servidor. No se configuraron proveedores, LLM ni Resend.

Se creó un usuario Auth sintético y su perfil de super admin; luego, desde el navegador, se inició sesión y se creó **Laboratorio F3 · prueba** mediante el panel de agencia. Esto generó membresía, prompts, agentes y datos del negocio por el flujo real. No es el administrador definitivo de Yani ni una cuenta de cliente.

El listado usa `read_inbox_page`, SECURITY INVOKER, con la sesión del usuario y RLS en todos los joins. Retorna hasta 51 filas: 50 visibles y una señal de siguiente página. Cursor por actividad e ID, filtros de canal/cuenta/estado y búsqueda literal de nombre/teléfono/email aplicados en SQL antes del límite. Un lateral join toma solo el último mensaje de cada conversación; ya no depende del límite global de mensajes de PostgREST. Un error de carga se muestra como error con reintento, no como una bandeja vacía.

La UI identifica canal y cuenta, conserva filtros al abrir el hilo y al volver en móvil, muestra carga durante la navegación y permite recorrer páginas. Las conexiones preparadas/revocadas permanecen visibles para consultar historial; figurar en el filtro no habilita envíos. Se conserva el bloqueo SQL de nuevos transportes y la ruta WA compatible.

La migración `20261010170516_omnichannel_inbox_read.sql` se ensayó en PGlite y se aplicó a Cloud: **72 migraciones** en total. No volver a aplicarla. No modifica filas históricas ni concede lectura de jobs/outbox al navegador.

### Verificación del incremento

- **1.725 unitarias** y **40 comprobaciones DB** pasan. Siete comprobaciones del nuevo archivo DB cubren 1.200 mensajes, cursor entre 55 conversaciones con fechas empatadas/nulas, filtros, miembros/viewer/ajeno, desactivación de membresía y rechazo anónimo.
- Typecheck y lint dirigido pasan. Build de producción local aprobado con configuración API ficticia. **20/20 E2E** públicos/diseño pasan; esa suite usa credenciales ficticias y no sustituye el recorrido autenticado.
- GoTrue real + navegador: login, creación de workspace, filtros Instagram vacío/WhatsApp/cuenta, búsqueda vacía y recuperación, apertura de hilo y regreso conservando filtros a 390px, sin overflow horizontal.
- Realtime real: un mensaje sintético insertado en Cloud apareció en el hilo sin recargar.
- Desde la UI: handoff y toma humana. La conversación quedó `human_active`, `ai_enabled=false`, `state_revision=2`, asignada al operador; el job de IA pendiente quedó `cancelled/conversation_changed`. Cero permisos de envío y cero llamadas a proveedores.
- REST con sesiones GoTrue independientes: el miembro obtiene sus dos previews; un usuario ajeno obtiene cero filas; anon no ejecuta la RPC y authenticated no lee message_jobs. Usuario ajeno temporal cerrado/eliminado al terminar.
- Captura móvil: `test-results/f3-inbox-browser/mobile-list.png`. El ledger local `test-results/f3-inbox-fixture.json` permite reutilizar los IDs sin duplicar fixtures. Si falta y hay datos, el smoke falla para exigir conciliación.

Se mantienen **un usuario QA, un workspace, dos conexiones sintéticas en connecting, dos contactos/conversaciones, tres mensajes y un job cancelado**, para revisión local. No hay credenciales de WhatsApp/Meta/Brevo en esas conexiones. No usarlos como datos de cliente ni como capacidades verificadas. Purga heredada sigue inactiva.

El asesor conserva los avisos heredados y ahora también informa [protección contra contraseñas filtradas desactivada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Cero ERROR; no se cambió el plan ni se habilitó facturación. La configuración de Auth y los avisos heredados siguen en la revisión previa al lanzamiento.

Fuentes consultadas: [claves de Supabase](https://supabase.com/docs/guides/getting-started/api-keys) y [creación de usuarios por servidor](https://supabase.com/docs/reference/javascript/auth-admin-createuser). Evidencia consolidada: [F3 inbox](evidencias/F3-INBOX-2026-10-10.json).

## Estado de las tareas

| Tarea | Estado |
|---|---|
| F3-T1.1 contratos/adaptador/política | Base local implementada y probada; validación por cuenta externa pendiente |
| F3-T1.2 resolución/dispatch | Ruta WA integrada y protegida; resolución de identidades/cuentas de los nuevos transportes pendiente |
| F3-T1.3 buffer/agente independiente de settings WA | Runtime extraído y herramientas limitadas por canal; rutinas de transportes nuevos pendientes de su pipeline durable |
| F3-T2.1 eventos/jobs/outbox y lease/fencing | SQL y worker implementados; pruebas local/Cloud y concurrencia pasan; productores/cron de aplicación, cuotas y backoff pendientes |
| F3-T2.2 invalidación durable y revalidación inmediata | Trigger y permiso transaccional probados en Cloud; integración con generación real y contexto de canales pendiente |
| F3-T2.3 receipts/unknown/conciliación | Unknown durable sin reenvío probado; consumidores de ecos/receipts y conciliación pendientes |
| F3-T3.1 inbox/composer omnicanal | Lectura, filtros y navegación con Supabase real probados; composer con política por canal pendiente |
| F3-T3.2 pruebas integrales | SQL/GoTrue/RLS/navegador/Realtime/toma humana pasan; cuentas y envíos de proveedores pendientes |

## Próximo paso y límites

Integrar contexto confiable de identidad/capacidades, productores y worker al pipeline y composer, con reserva por comentario y conciliación antes de habilitar transportes nuevos. La app local y el usuario QA ya funcionan; resta definir el acceso administrador definitivo de Yani antes de uso operativo.

La base Cloud ya está inicializada; la app todavía no está desplegada ni enviando mensajes nuevos. No se usaron bases anteriores. Sin compras, push o merge. F1/F2/F3 continúan sin aceptación integral.

## Auto-Blindaje

- El teléfono es un atributo del contacto, no el selector de canal. Cada resolución debe comprobar canal y workspace antes de enviar.
- Un código de rate limit dentro de HTTP 5xx/408 no convierte una respuesta ambigua en un rechazo seguro. El estado y el texto mostrado deben indicar incertidumbre; nunca sugerir retry automático por ese código aislado.
- Soporte de un método no equivale a permiso concedido o integración probada. El pipeline nuevo exige evidencia por cuenta y continúa deshabilitado hasta validar la integración.
- Filtrar herramientas solo en el prompt es insuficiente: el registry debe repetir la comprobación antes de ejecutar, incluso para herramientas dinámicas. Un canal nuevo no hereda herramientas WA por omisión.
- Dos llamadas simultáneas al conector MCP se ejecutaron en serie y no demostraron concurrencia. Se reemplazaron por workers SQL temporales y se comprobaron PIDs/tiempos solapados; no confundir paralelismo del cliente con transacciones concurrentes.
- No cancelar un outbox `sending` por toma humana ni devolverlo a pending: el proveedor puede haber aceptado. Conservar el resultado o unknown para conciliación.

- La limpieza de Playwright borraba todo test-results, incluidos ledgers y capturas manuales. outputDir ahora apunta a test-results/playwright; logs/ledgers Cloud quedan fuera. Se recuperaron los IDs por consultas al workspace exacto, sin crear filas duplicadas.
- El cierre por defecto de Supabase Auth revoca todas las sesiones del usuario. El smoke usa signOut con scope local para no cerrar la sesión independiente del navegador.

- La primera carga autenticada detectó un mismatch SSR por leer Notification.permission en el inicializador de useState. Se reemplazó por useSyncExternalStore con snapshot de servidor estable. Recarga real sin errores/avisos nuevos y botón de permiso visible después de hidratar; no se solicitó permiso automáticamente. Regresión unitaria de SSR incluida.
