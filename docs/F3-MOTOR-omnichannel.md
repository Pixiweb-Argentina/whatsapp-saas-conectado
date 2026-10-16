# F3 — Motor de canales e inbox unificado

Actualizado: 2026-10-15. Build Manual. Rama vigente `codex/omnichannel-f3-permissions`, desde `7879941`. Worktree `C:/Users/Yani Acevedo/.codex/worktrees/omnichannel-f1/app-whatsapp-saas-conectado`. Historial por incremento debajo; F3 sigue sin aceptación integral.

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

## Incremento 5: contexto de envío y disponibilidad del composer

Se agregó el lector de contexto de servidor por workspace, conexión, identidad verificada y conversación. El destinatario procede de `contact_identities`; el teléfono editable del contacto no puede sustituirlo. Las supresiones WA se consultan por el destinatario efectivo. Cada consulta conserva el filtro de workspace, valida la respuesta y oculta detalles internos de errores.

Los permisos del pipeline nuevo requieren `channel_connections.capabilities` con `{version:1, grants:[...]}`. Cada grant incluye workspaceId, connectionId, capability, verifiedAt, evidenceRef y validUntil. Una bandera `text:true`, un token o un backfill no constituyen verificación. No se agregaron grants ni verificaciones ficticias a Cloud. La política limita el permiso al vencimiento más temprano entre la interacción y la capacidad.

La evidencia inicial implementada es el mensaje entrante WA **referenciado por eventId**, persistido, no histórico y ligado al mismo destinatario/cuenta/proveedor. La ventana se calcula desde occurredAt, nunca desde el momento de una entrega tardía. Ecos, receipts, comentarios, fechas futuras y eventos ajenos no autorizan. Las otras evidencias (plantilla aprobada, comentario reservado, Human Agent y sesión web) siguen pendientes; no se infieren de un timestamp de conversación.

`createMessagePipeline` une el productor con la política y la cola, y el worker con el lector fresco y el adaptador de la conexión exacta. El adaptador verifica legacy_integration_id, workspace, proveedor, enabled y el identificador de la cuenta antes de descifrar credenciales. No sustituye una integración histórica por la actualmente activa. **Esta composición interna aún no tiene webhook, cron ni buffer conectados y no reemplaza el dispatch WA existente.** Su activación requiere los controles transaccionales y la persistencia de mensajes detallados abajo.

El composer real consulta disponibilidad con la sesión y RLS. Una cuenta en preparación, revocada o con permisos faltantes muestra el motivo y permite actualizar estado o escribir una nota interna. El POST de texto y las server actions de plantillas repiten el control antes de dispatch. Un canal nuevo no presenta plantillas WA. La ruta WA sin connection_id conserva su comportamiento previo; la disponibilidad no elimina sus controles de ventanas, roles, plantillas ni supresión.

### Verificación del incremento 5

- **1.743 unitarias pasan**, 18 nuevas; **97 dirigidas** pasan después del ajuste final de supresión por identidad. Typecheck, lint dirigido y build pasan. Build con claves ficticias, sin usar proveedores. Logs: `test-results/f3-context-*`.
- GoTrue + SDK + API local contra el proyecto nuevo: una llamada directa con capacidades/estado inventados recibe **422 connection_not_ready**, sin insertar mensajes. El contexto rechaza la identidad sintética no verificada. Script reproducible: `tests/cloud/channel-context-smoke.mjs`; resultado: `test-results/f3-context-cloud.json`.
- Navegador autenticado: motivo de bloqueo visible, sin botón de envío; dos notas internas guardadas desde el formulario. Se añadió refresh tras guardar porque una nota persistida no apareció inmediatamente en una sesión con Realtime interrumpido; segunda nota visible sin recargar manualmente. No se afirma que ese fallback pruebe Realtime.
- Desktop y móvil 390px revisados; scrollWidth=390 y sin desborde. Capturas en `test-results/f3-context-browser/desktop.png` y `mobile.png`.
- No cambió el esquema: siguen **72 migraciones**, no repetir. Laboratorio conserva **5 mensajes: 3 entradas sintéticas + 2 notas internas**, cero outbox y cero cron activos. Las dos conexiones siguen connecting, sin credenciales. No se enviaron mensajes a proveedores.
- Los **40 tests DB y 20 E2E públicos/diseño del incremento 4** se conservan como evidencia previa; no se repitieron sin cambios de SQL ni de esas vistas. La UI modificada se verificó en la sesión autenticada real.

Evidencia de este corte: [F3 contexto](evidencias/F3-CONTEXTO-2026-10-10.json).

## Incremento 6: permiso transaccional y mensajes de la cola

El permiso WA de texto revalida en SQL conexión lista/no revocada, integración habilitada y cuenta exacta, identidad verificada, consentimiento/supresión, grant vigente, evento entrante no histórico del destinatario, ventana por fecha de origen y revisión de conversación. La evidencia enviada por el worker debe ser el ID del evento persistido del job y no puede ampliar su vencimiento. Se conserva el orden conversación → job; las filas de contexto usan FOR SHARE NOWAIT. Si hay una modificación concurrente, no se autoriza el POST.

La ausencia de una supresión también debe protegerse: un trigger de contact_opt_outs coordina INSERT/UPDATE/DELETE por workspace y número mediante un advisory lock transaccional. El permiso usa try-lock después de las filas del contexto para evitar esperar por un escritor que ya tiene una fila bloqueada. El límite de la garantía es el commit del permiso: una revocación posterior no puede retractar un POST que ya está en vuelo. No se afirma exactly-once remoto.

Cada permiso inserta un mensaje queued en la misma transacción. Si falla la inserción o la protección heredada de ventana, se revierte el permiso. channel_operation_id vincula el mensaje con el job/outbox y evita filas repetidas; los roles de navegador no pueden fabricar/modificar ese vínculo. accepted conserva wamid separado del ID de YCloud; unknown/rejected son terminales y actualizan el mensaje. La recuperación de una lease de envío vencida deja el mensaje sin confirmar. Se conserva el enum legacy: unknown se representa como failed + meta.send_outcome=unknown, con etiqueta visible «Sin confirmar» y explicación, sin reintento automático. La conciliación de receipts de este pipeline todavía está pendiente.

Los jobs humanos exigen senderUserId de un operador activo del workspace y se vuelve a comprobar su membresía al autorizar. Las automatizaciones llevan una etiqueta propia; borrar un usuario no reclasifica su mensaje como IA. El usuario del parámetro debe proceder de una sesión autenticada cuando se conecte el productor; el servicio interno no autentica peticiones HTTP por sí solo.

Migraciones nuevas aplicadas al proyecto bzanbpyzujlogipxvkfn: `20261010180354_omnichannel_atomic_send_context.sql` y `20261010180525_omnichannel_job_messages.sql`. **74 migraciones** en total; el historial se alineó con las versiones originales. No volver a aplicarlas. La segunda rechaza el upgrade si hubiera jobs sending anteriores sin mensaje: deben conciliarse antes de migrar.

### Evidencia del incremento 6

- **64/64 pruebas DB** locales, incluidas 24 comprobaciones nuevas de contexto, persistencia, atribución, RLS, rollback e incertidumbre. PostgreSQL local simulado por PGlite no reemplaza Cloud.
- Suite completa existente **1.743/1.743**; después se agregó la prueba de atribución humana y pasó el archivo completo **6/6**. Son **1.744 pruebas unitarias distintas validadas**; no se volvió a correr toda la suite tras agregar esa prueba. Typecheck, lint y build de producción pasan con el código final; build usa claves/URL ficticias.
- PostgreSQL 17.11 Cloud: cuatro carreras entre procesos distintos (revocación, retiro de grant, identidad y supresión) devolvieron permitted=false en milisegundos mientras otro proceso retenía el cambio. Cron efímeros sin HTTP, autodesprogramados y retirados al terminar.
- Control Cloud válido: permiso + mensaje persistido + resultado unknown; leído en el inbox real. Otro control con SET ROLE service_role prueba atribución humana, rechazo de evidencia falsa, resultado accepted, separación del ID de YCloud y rechazo de doble finalización, todo dentro de rollback.
- Navegador autenticado desktop y 390px: autor Automatización, etiqueta Sin confirmar y popover explicativo. Capturas en `test-results/f3-atomic-browser/`. Se encontró que el selector de workspace conservaba el detalle anterior; ahora navega a /inbox con carga completa, elimina filtros anteriores y descarta el chat. Verificado volviendo a Laboratorio F3 · prueba, dos conversaciones y panel sin selección.
- Se limpiaron exclusivamente los datos temporales de este incremento: queda un workspace, cinco mensajes QA previos, cero outbox y cero cron activos. No hubo llamadas a proveedores, compras, despliegue, push ni merge. main sigue en 28a1530.
- Asesor de seguridad: cero ERROR, mismos avisos heredados de extensiones/helpers/Auth que el incremento 5. Sin políticas nuevas que abran jobs/outbox al navegador.

Evidencia: [F3 transacción](evidencias/F3-TRANSACCION-2026-10-10.json). Reproducción: `tests/db/message-queue.test.mjs`, `tests/db/cloud-atomic-send.mjs` y `tests/db/cloud-atomic-assertions.sql`. Los probes Cloud exigen el fixture sintético; nunca ejecutar platform-fixture.sql allí. Las 20 E2E públicas/diseño previas se reutilizan, no se repitieron en este incremento.

## Incremento 7: recepción autenticada y worker bajo flags

Los webhooks YCloud/Kapso capturan el evento normalizado después de verificar firma y destino, usando el ID de la integración autenticada para resolver la conexión exacta. La escritura ocurre antes del dedup legacy: un reintento puede recuperar el evento aunque el mensaje anterior ya exista. La RPC conserva el primer envelope y deduplica por workspace/conexión/ID del proveedor. No se guardan URLs temporales ni credenciales del payload. Reacciones, ecos, receipts y timestamps inválidos/futuros no generan evidencia accionable en esta captura.

Captura en paralelo al flujo heredado: no crea identidades verificadas, grants, jobs ni mensajes salientes. Una conexión ausente/ambigua o error de almacenamiento devuelve 500 antes de procesar el mensaje legacy, para permitir reentrega. Eventos no normalizables se omiten en captura sin cambiar su tratamiento legacy. La recepción no prueba permiso para enviar. Los envíos del operador y la generación IA todavía usan el circuito heredado; no hay doble productor.

`GET /api/cron/channel-jobs` exige el helper común CRON_SECRET y toma los tenants únicamente del entorno del servidor. Máximo tres workspaces, un job por workspace/tick, propietarios de lease distintos y margen de 90 segundos antes del límite de ejecución. Informa fallos parciales sin ocultarlos ni reintentar unknown. Un workspace que falla no bloquea el siguiente. No se creó ningún scheduler.

### Flags y activación futura

- `CHANNEL_INGRESS_WORKSPACES`: UUIDs separados por coma, hasta 100; vacío/ausente desactiva captura sin consultas adicionales. Requiere conexión existente vinculada a la integración y mismo identificador de cuenta.
- `CHANNEL_WORKER_WORKSPACES`: lista independiente de hasta tres UUIDs. Vacío/ausente desactiva el worker antes de crear el cliente de servicio. Habilita el consumo de jobs de todo ese workspace, no de una sola conexión. No acepta wildcard ni parámetros HTTP para ampliar el scope.
- Una lista mal formada falla cerrada con código genérico; no habilita parcialmente los UUIDs válidos. Las listas viven solo en servidor, nunca NEXT_PUBLIC.
- Ambos flags permanecen ausentes/desactivados en la app local. El smoke los define solamente en su propio proceso para un workspace temporal. No modificar flags productivos sin la validación de identidades/grants, cuentas de prueba y autorización de activación.
- Desactivar el worker impide nuevas ejecuciones; no retira un POST ya autorizado/en curso ni cancela jobs almacenados. Antes de activarlo revisar la cola del workspace. Capturar eventos no instala planificación ni política de retención; ambas siguen pendientes.

### Evidencia del incremento 7

**1.772/1.772 unitarias** (28 nuevas), typecheck, lint dirigido y build de producción pasan. Pruebas de firmas calculadas sobre payloads sintéticos en ambos handlers; scope resuelto por integración, reentregas previas al dedup, fallos de almacenamiento, destino incorrecto y flags desactivados. Cloud: capture con service role guarda una sola fila tras dos llamadas, conserva occurredAt, rechaza otra integración y no genera identidades/mensajes/jobs/outbox. Worker autenticado recupera/consulta una cola vacía sin transporte. El fixture temporal fue retirado; no se tocaron las conversaciones QA. Sin migraciones nuevas: siguen 74.

Smoke HTTP sobre Next local: sin autorización devuelve 401; autorizado devuelve enabled=false y processed=0. No cambia la UI; se reutiliza la revisión visual anterior. Reporte verificable y resultados finales: [F3 recepción](evidencias/F3-INGRESS-2026-10-10.json). Reproducción Cloud: `node --env-file=.env.local --import ./scripts/register-alias-hook.mjs tests/db/cloud-ingress-smoke.mjs`; aborta si el proyecto no es bzanbpyzujlogipxvkfn o el fixture ya existe. Bloquea cualquier acceso de red fuera de ese Supabase y limpia solo su workspace sintético.

## Incremento 8: envío humano del inbox a la cola

El composer crea un UUID por intento y lo conserva cuando no puede confirmar la respuesta HTTP. La API autentica sesión y rol; solo toma workspace/conversación/operador del contexto servidor. La función service-only `enqueue_human_channel_text` vuelve a comprobar membresía activa, resuelve destinatario y evidencia, verifica permisos/ventana/supresión y realiza toma humana + enqueue dentro de una transacción. Si una validación o escritura falla, se revierte todo. Pausa IA, asigna al operador y cancela jobs no humanos pendientes mediante el trigger existente. Un envío ya autorizado/en curso no puede retirarse.

Repetir UUID, texto, conversación y operador devuelve el mismo job y su estado actual, incluso si posteriormente venció la evidencia o se retiró el permiso. No vuelve a tomar la conversación ni a enviar. Cambiar texto/conversación/operador con ese UUID da conflicto. La auditoría state_change se escribe en la misma transacción, una sola vez por transición. El permiso final del worker sigue revalidando contexto y membresía antes del POST.

Flag nuevo: `CHANNEL_HUMAN_WORKSPACES`, independiente y desactivado por defecto. Encolar exige además el workspace en `CHANNEL_WORKER_WORKSPACES`. La prueba encendió ambos solo en el proceso local y exclusivamente para el fixture temporal, sin invocar el worker ni programar cron. El composer recibe su modo del servidor. Un intento fijado a queue no cae a legacy si se apaga el flag; un composer legacy tampoco cambia silenciosamente a queue. Los IDs adicionales enviados por un cliente no eligen tenant, destinatario, actor o evidencia.

En el camino nuevo la intervención humana pausa siempre la IA. La preferencia legacy sleepOnManualMessage sigue aplicándose únicamente al camino anterior. La respuesta 202 confirma cola, no entrega: el composer muestra un aviso explícito y refresca el hilo. El mensaje persistente aparece al obtener permiso de envío (incremento 6); una vista permanente de jobs todavía pendientes/cancelados antes del permiso sigue pendiente. El UUID del composer dura mientras está montado; no se promete recuperación de borrador después de recargar la página.

Migraciones aplicadas: `20261010185104_omnichannel_human_enqueue.sql` y `20261010185348_omnichannel_human_enqueue_audit.sql`; total **76**. Los archivos locales toman la versión devuelta por el historial remoto, sin reescribir migraciones ya aplicadas ni ejecutar las anteriores de nuevo.

### Verificación del incremento 8

- **1.782 unitarias** y **72 DB locales** pasan, con diez y ocho comprobaciones nuevas respectivamente. Typecheck y lint dirigido pasan. Build y evidencia final en [F3 humano](evidencias/F3-HUMANO-2026-10-10.json).
- Cloud PostgreSQL real como service_role: enqueue, dedup, toma humana, cancelación de IA y auditoría atómica pasan en rollback. No se llamó al transporte.
- Sesión QA real contra API Next: 202 en reentregas sin jobs duplicados, 409 al cambiar texto, 422 en un intento nuevo sin grant; el intento ya registrado sigue consultable. IDs forjados en body no afectan el scope. 401 sin sesión; la RPC directa desde el cliente autenticado devuelve 42501.
- Navegador autenticado: el botón envía a la cola, vacía el borrador al confirmar y muestra aviso de entrega aún no confirmada. La conversación pasa a Humano. Se encontró y corrigió un estado local obsoleto del interruptor de IA al refrescar; la key ahora incluye id y ai_enabled. Captura en `test-results/f3-human-browser/takeover-fixed.png`.
- Fixture temporal retirado; se restauró el workspace habitual en navegador. Queda el laboratorio anterior con cinco mensajes, cero outbox y cero cron activos. Ningún proveedor recibió mensajes. Asesor: cero ERROR, mismos 10 WARN y 11 INFO heredados; las RPCs nuevas solo tienen EXECUTE para service_role.

Reproducción: `tests/db/cloud-human-enqueue.mjs` prepara/asserta/limpia SQL; `tests/cloud/human-enqueue-smoke.mjs` requiere el intento sintético previo y flags del servidor. No ejecutar contra otra cuenta ni recrear fixture si ya existe. [Funciones de base de datos, documentación consultada](https://supabase.com/docs/guides/database/functions).

## Incremento 9 — cola persistente del inbox

La RPC pública SECURITY INVOKER delega a una función privada con proyección mínima y comprobación explícita de auth.uid + membresía activa + workspace/conversación exactos. Los jobs siguen con RLS y sin SELECT para navegador. Sólo devuelve UUID de operación, actor, texto, fecha y estado anterior al permiso; no devuelve destinatario, request, errores técnicos ni credenciales. Incluye miembros viewer para la lectura, sin permisos de escritura.

La consulta retorna los 51 más recientes; UI muestra 50 en orden cronológico y aviso de límite. Pending/leased/cancelled/dead_letter tienen estados visibles y no se presentan como entrega. Operaciones con mensaje persistente se excluyen en SQL; además se filtra por channel_operation_id de los mensajes Realtime para evitar duplicación mientras llega el refresh. Cada diez segundos se refresca si hay pendientes y la pestaña está visible; al no haberlos se detiene. Nuevos pendientes de otro operador requieren abrir/actualizar el hilo si no había pendientes visibles; no se concedió Realtime a jobs. La cola falla con aviso genérico ante errores; no se interpreta como vacía ni se ofrece reenviar.

- 1.785 unitarias y 75 DB locales pasan, con tres nuevas en cada suite. Typecheck, lint dirigido y build con claves de compilación ficticias pasan.
- Supabase real/GoTrue: proyección, anon denegado, SELECT jobs denegado, scope cruzado vacío y membresía inactiva vacía.
- Desktop/móvil: recarga conserva un pendiente, el job pasa a mensaje Sin confirmar sin duplicado y el botón refresca. No desborde horizontal a 390×844; sin errores/warnings del navegador. Fecha de cola con zona Argentina y formato 24h explícitos para mantener SSR/hidratación estables.
- Migración 20261010191128_omnichannel_queue_read.sql aplicada, total 77; no repetir. Asesor: cero ERROR, mismos 10 WARN y 11 INFO heredados. La función privilegiada nueva no está en esquema expuesto. [Remediación de funciones públicas heredadas](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
- Fixture sintético temporal retirado, workspace habitual restaurado. Permanecen cinco mensajes QA, cero outbox y cero cron activos. No hubo POST a proveedores, compras, push, merge o deploy; flags apagados.

Reproducción en el proyecto nuevo exclusivamente: tests/db/cloud-queue-read.mjs expone setup/transición SQL/addPending/cleanup. tests/cloud/queue-read-smoke.mjs requiere setup y las credenciales QA ignoradas; cierra sólo su sesión local. La transición SQL simula resultado unknown sin llamar a transporte: no acredita integración del proveedor. Capturas en test-results/f3-queue-browser. [Evidencia](evidencias/F3-COLA-2026-10-10.json).

## Incremento 10 — preparación transaccional de respuestas IA

Se preparó un contrato de servicio; no se modificó processNextBatch ni se invocó ningún modelo. La preparación privada fija modo y contexto bajo el lock de la conversación y el batch. Un batch nuevo de cola queda aislado de entradas adicionales. El evento debe estar vinculado por wamid a una entrada del propio batch, con cuenta/identidad/grant y ventana verificables; eventos históricos, reacciones y eventos ajenos al batch no sirven. Intentos legacy con checkpoint/retry no migran de modo. El registro privado conserva la revisión incluso cuando meta se modifica.

Enqueue fija el texto y usa batch_id como UUID de operación, con clave ai-batch:UUID. Recupera un job previo antes de revalidar contexto: unknown permanece unknown, sin otra operación/permiso. Cambiar texto con el mismo batch falla. Si cambia control, identidad, grant, supresión, ventana o estado del batch, conserva el texto sin crear job. Una toma humana y resume no autoriza el resultado de una generación anterior. No se cierra el batch aquí; el buffer todavía debe coordinar su checkpoint y handoff.

- Migración 20261010194247_omnichannel_ai_reply_preparation.sql aplicada una vez, total 78 y nombres locales idénticos. Tabla privada con RLS, sin acceso anon/authenticated; RPCs SECURITY INVOKER sólo service_role.
- Servicio TS valida scope/texto/proyección, no recibe destinatario/revisión/evidencia del consumidor y redacta errores internos. CHANNEL_AI_WORKSPACES limitado a tres workspaces; enqueue requiere también ingress y worker. Modo queue persistido no se convierte a legacy al apagar flags.
- 1.793 unitarias y 83 DB completas; después de separar el módulo de pruebas DB, 62/62 dirigidas. Typecheck/lint pasan. No hay cambios visuales ni conexión ejecutable al modelo/buffer: build y navegador previos del incremento 9 se conservan como evidencia anterior y no se declaran repetidos.
- GoTrue/RPC real: servicio, aislamiento, acceso público denegado, modo fijo, bloqueo tras toma/resume, checkpoint de texto, dedup/conflicto y cero outbox. Fixtures setup/cleanup en tests/db/cloud-ai-reply.mjs y smoke en tests/cloud/ai-reply-smoke.mjs; no llaman a modelo/transporte.
- Asesor: cero ERROR y mismos diez WARN. Doce INFO: el nuevo es RLS sin políticas de la tabla privada service-only, intencional. No añadir permisos públicos para ocultarlo.
- Fixture 993 eliminado con guarda de slug/id; cero preparaciones, un workspace QA con cinco mensajes previos, cero outbox/cron. Sin compras, push, merge, deploy o envíos. [Evidencia](evidencias/F3-IA-PREPARACION-2026-10-10.json).

El próximo paso conecta prepare antes de decide/Jev/modelo/tools, recupera reply/state y evita fallback. El handoff heredado puede enviar ACK y cancelar un job pendiente; Setter puede despachar templates; herramientas n8n pueden tener efectos externos. Hay que cubrir estos caminos antes de activar la cola IA. El contrato todavía no prueba generación integral ni proveedores reales.

## Incremento 11 — productor IA conectado al buffer

El buffer fija modo/contexto antes de consolidar, decidir, ejecutar Jev o llamar al modelo. Recupera primero un job existente o el texto privado. Queue nunca cae al despacho/error/handoff legacy, incluso si la preparación falla o cambian los flags. Un job pending/unknown recuperado cierra el batch sin regenerar, encolar de nuevo ni confundir el cierre con entrega.

El checkpoint privado guarda el texto generado antes de metadata. Sólo private.ai_reply_preparations.reply se usa para reintentar: pending_reply del batch no es autoridad. Un texto de metadata sin checkpoint, una escritura anterior incierta o una generación agotada derivan a revisión humana interna. RPCs invoker service-only, scope exacto y conflictos de texto rechazados.

Handoff cambia estado + auditoría + nota interna en una transacción y respeta la revisión fijada; una toma humana y posterior resume no se sobrescriben. Un job pending/leased/sending debe resolverse antes del handoff; el batch espera 30 segundos sin cancelarlo ni enviar ACK. Una transición terminal se ejecuta una sola vez. Jev persiste intención antes de etapa/derivación; keyword, presupuesto y suppressReply también respetan el resultado pendiente.

Piloto queue limitado a texto, con herramientas del modelo vacías y guarda previa a cualquier ejecución inesperada. No ejecuta n8n, Setter ni autoetiquetado/resumen posterior, porque esos efectos todavía carecen de contrato durable. El recorrido WA legacy conserva sus herramientas y efectos, cubiertos por regresión. No habilitar flags o transportes por esta integración.

### Verificación del incremento 11

- **1.814 unitarias y 87 DB locales**, typecheck, lint dirigido y build de producción pasan. Generación nueva con modelo simulado; se prueban checkpoint/cola sin dispatch, recuperación, aislamiento de errores, intentos de herramienta y handoff pendiente/Jev tras fallo.
- API Next real, HMAC y Supabase nuevo: ocho controles pasan. Recupera el job privado con flags apagados, cierra el batch, mantiene un único pendiente y cero outbox; reentrega no reprocesa. Handoff mientras pending devuelve settled=false.
- SQL Cloud simula permiso/unknown sin transporte, luego handoff: settled=true, changed=true, una auditoría y una nota interna. Repetir devuelve changed=false. No acredita entrega ni proveedor real.
- Migración 20261010203241_omnichannel_ai_handoff.sql aplicada una vez, total **79**, nombres locales/historial iguales. Asesor: cero ERROR, diez WARN y doce INFO heredados; sin hallazgos nuevos.
- Fixture 994 retirado con guarda de slug/id; cero preparaciones, un workspace QA y cinco mensajes previos, cero outbox y cero cron activos. Flags apagados. Sin compras/envíos/push/merge/deploy. UI no cambió, navegador previo no se declara repetido.

Reproducción: tests/db/cloud-ai-buffer.mjs contiene setup/settle/cleanup sintéticos; tests/cloud/ai-buffer-smoke.mjs llama al endpoint local con secreto ignorado. Sólo el proyecto nuevo bzanbpyzujlogipxvkfn, reconciliar fixture antes de repetir. [Evidencia](evidencias/F3-IA-BUFFER-2026-10-10.json).

## Incremento 12 — comprobantes firmados y conciliación durable

Recepción YCloud/Kapso después de verificar la firma, bajo CHANNEL_INGRESS_WORKSPACES. Conexión, integración, workspace y cuenta física exactos; Kapso también comprueba phone_number_id antes del camino legacy. Sólo cloud_api participa en comprobantes: Business App/history/other_app quedan fuera de este consumidor. Zod descarta eventos sin timestamp válido, del futuro, sin IDs o de otra cuenta. Se guardan estado, IDs, destinatario opcional y fecha; ningún cuerpo, URL, token ni detalle remoto de error.

private.channel_delivery_receipts tiene RLS sin políticas públicas, dedup por cuenta/evento y RPCs SECURITY INVOKER sólo service_role. El envío de texto YCloud añade externalId=channel:UUID para poder identificar unknown aun sin respuesta HTTP. Kapso usa wamid conocido; unknown sin ID almacenado ni referencia externa permanece incierto. Nunca correlacionar sólo por teléfono/texto/tiempo, ni tratar externalId como idempotencia remota. Un ID o destinatario contradictorio no altera el job.

La transacción exige un permiso/outbox ya existente con el mismo fence; sólo concilia sending/unknown/accepted. Actualiza una única fila visible y termina job/outbox como accepted, que significa aceptación del transporte, no entrega exitosa. El estado visible puede seguir failed si la entrega falló. Leído/entregado ganan ante callbacks tardíos; una falla contradictoria conserva delivery_conflict. Un worker tardío no puede sobrescribir el resultado. Sin nuevos jobs, mensajes, lotes, grants, ventanas ni IA.

Un callback anterior al resultado persiste pendiente y se vuelve a conciliar antes de recuperar jobs y después de finish, con límite de 50. Un fallo posterior a finish no revierte la aceptación ni autoriza reenvío. El camino legacy de actualización de estados excluye mensajes con channel_operation_id para no degradar una fila que pertenece a la cola. Al apagar ingress no se capturan comprobantes nuevos; los ya persistidos siguen siendo recuperables. No se creó cron ni polling del proveedor.

### Verificación del incremento 12

- **1.825 unitarias y 95 DB completas**, typecheck, lint dirigido y build de producción con claves ficticias pasan. Después de separar funciones del harness: 74 DB dirigidas. Incluye llegada temprana, unknown correlacionado, stale fence, contradicciones, scope/IDs/destinatario, ausencia de permiso y roles anon/authenticated denegados.
- API Next real + HMAC + Supabase nuevo: diez controles pasan. Firma inválida/cuenta Kapso ajena devuelven 401; duplicados devuelven 200 sin nuevas operaciones. YCloud unknown y Kapso accepted quedan read; sent tardío mantiene read. Tres comprobantes planned, dos jobs accepted, dos mensajes read, cero batches.
- Navegador autenticado verifica las dos conversaciones con un único mensaje leído y sin aviso Sin confirmar; cero errores/warnings. Capturas ignoradas: test-results/f3-receipt-browser/ycloud-read.png y kapso-read.png. Workspace habitual restaurado antes de limpiar.
- Migración **20261010205151_omnichannel_delivery_receipts.sql**, total **80**, historial/nombres locales iguales. No repetir. Asesor: cero ERROR, diez WARN heredados y trece INFO; tabla privada nueva deliberadamente sin políticas para el navegador.
- Fixture 995 retirado con guarda; quedan un workspace QA y cinco mensajes previos, cero receipts/preparaciones/outbox/cron activos. Flags apagados; servidor 3100 restaurado sin flags temporales. No hubo transporte, modelo, compra, push, merge o deploy.

Reproducción: tests/db/cloud-delivery-receipts.mjs exporta setup/cleanup; tests/cloud/delivery-receipt-smoke.mjs requiere ese fixture y servidor local con ingress limitado exclusivamente al workspace sintético. Cumple una integración WA activa por workspace, alternando proveedores durante la prueba. Reconciliar el fixture antes de repetir; no ejecutar contra otra cuenta. [Evidencia](evidencias/F3-RECEIPTS-2026-10-10.json). Fuentes oficiales consultadas: [YCloud delivery y externalId](https://docs.ycloud.com/reference/whatsapp-message-updated-webhook-examples), [Kapso message events](https://docs.kapso.ai/docs/platform/webhooks/message-events), [Supabase RPC y permisos](https://supabase.com/docs/guides/database/functions).

## Incremento 13 — mensajes humanos desde WhatsApp Business

El piloto de ingress de Kapso usa persist_business_app_echo antes del escritor legacy. HMAC y cuenta física exactos, E.164 sin país inventado, IDs y timestamp válidos; Zod descarta fechas ausentes/futuras, teléfonos ausentes y texto mayor de 4096. Sólo origen business_app y evento sent; cloud_api, history_sync y other_app permanecen en sus recorridos específicos. Adjuntos guardan caption o [Multimedia], sin descargar URLs ni registrar el rendering privado del proveedor.

private.business_app_echoes deduplica por workspace/conexión/wamid, comprueba conflictos y conserva datos mínimos. RPC SECURITY INVOKER service-only; tabla privada con RLS y sin políticas del navegador. Resuelve conversación por identidad verificada exacta y mismo contacto/conexión, nunca por contacts.phone. Sin match o cuenta revocada se conserva como ignored sin efectos; no se crea un contacto ni se concede consentimiento. Sin datos suficientes en modo piloto se reconoce el evento sin fallback. Con el flag apagado se conserva el camino legacy.

Historial, estado human_active, ai_enabled=false, revisión, cancelación durable de IA/automatización pending/leased y auditoría son atómicos. Una falla en cualquiera revierte mensaje/ledger/control; la reentrega recupera el mismo evento. Jobs sending/unknown no se cancelan ni vuelven a encolarse. No se asigna sender_user_id ficticio ni otro operador; la UI identifica WhatsApp Business incluso para historial legacy. No llama applyTransition/ACK externo, modelos, reglas o buffer y no modifica ventana/opt-in.

Nuevo campo channel_control_changed_at protegido por trigger de servidor (en INSERT queda null y en UPDATE sólo cambia junto al control). Un replay es no-op aunque se reanude la IA. Un wamid aún no visto, con fecha anterior o igual a un control posterior registrado, añade historial sin deshacer resume/close; last_message_at usa greatest. No reconstruye controles anteriores a esta migración ni identifica personas físicas del teléfono. Los ecos sólo BSUID/sin teléfono quedan fuera hasta un contrato específico; no se unen por username.

### Verificación del incremento 13

- **1.836 unitarias y 105 DB completas** pasan; últimas dirigidas 25 unitarias/10 DB. Typecheck/lint dirigido/build con valores ficticios pasan. DB prueba rollback forzado de auditoría, retry, scope/identidad, permiso ya sending, control temporal, denegación pública y colisión con mensaje de job.
- API Next real/HMAC/Supabase nuevo: catorce controles pasan. Pausa/cancelación, una auditoría, opt-in false y ventana/asignación intactas; replay no duplica, conflicto devuelve 500 sin segunda escritura, fecha inválida se ignora y resume resiste replay/otro wamid antiguo. Cero lotes y outbox; transporte nunca llamado.
- Antes de limpiar: dos echoes planned (uno older_than_control), dos mensajes de wamids diferentes, un job cancelled, conversación ai_active tras resume explícito. Navegador verifica atribución WhatsApp Business, dos filas por dos eventos diferentes, cola Cancelado · no enviado e interruptor activo tras resume. Sin errores/warnings; captura test-results/f3-business-app-browser/echo-author-and-cancelled-job.png.
- Migración 20261010211209_omnichannel_business_app_echo.sql aplicada una vez; **81** total, historial/nombres iguales. Asesor: cero ERROR, diez WARN heredados y catorce INFO. Nuevo INFO de RLS sin políticas en ledger service-only, intencional. [Permisos de funciones](https://supabase.com/docs/guides/database/functions).
- Fixture 996 eliminado con guarda id/slug y workspace habitual restaurado. Permanecen cinco mensajes QA, cero echoes/receipts/preparaciones/outbox/cron. Flags apagados y servidor local restaurado sin flags temporales; sin mensajes reales/modelos/compras/push/merge/deploy.

Reproducción: tests/db/business-app-echo.test.mjs y business-app-echo-checks.mjs; fixture Cloud tests/db/cloud-business-app-echo.mjs y HTTP tests/cloud/business-app-echo-smoke.mjs sólo sobre bzanbpyzujlogipxvkfn con ingress del workspace ficticio. No repetir un fixture existente; reconcile/cleanup primero. [Evidencia](evidencias/F3-BUSINESS-APP-2026-10-10.json). [Origen y payload oficial Kapso](https://docs.kapso.ai/docs/platform/webhooks/message-events).

## Estado de las tareas

| Tarea | Estado |
|---|---|
| F3-T1.1 contratos/adaptador/política | Contratos/política probados; IDs evento/Meta y idioma de plantilla ligados; prueba privada/reserva de comentarios local/Cloud; validación por cuenta externa pendiente |
| F3-T1.2 resolución/dispatch | Lector de identidad/capacidades y resolver por conexión preparados; WA compatible permanece; adaptadores Meta/web pendientes |
| F3-T1.3 buffer/agente independiente de settings WA | Runtime extraído y herramientas limitadas por canal; rutinas de transportes nuevos pendientes de su pipeline durable |
| F3-T2.1 eventos/jobs/outbox y lease/fencing | SQL y captura autenticada + worker HTTP bajo flags probados local/Cloud; productor humano conectado bajo flag; productor IA de texto conectado con checkpoint/handoff; cuotas/backoff y reserva atómica de comentarios probados local/Cloud; herramientas durables y scheduler pendientes |
| F3-T2.2 invalidación durable y revalidación inmediata | Permiso WA transaccional con grant/identidad/supresión/evento/membresía probado local/Cloud; generación mock probada y recuperación Cloud real; LLM/proveedor real pendiente |
| F3-T2.3 receipts/unknown/conciliación | Comprobantes firmados WA, dedup/estados monotónicos y conciliación exacta local/Cloud/UI probados; ecos humanos Kapso atómicos y dedup probados; BSUID, polling y proveedores reales pendientes |
| F3-T3.1 inbox/composer omnicanal | Lectura/filtros, disponibilidad y enqueue humano probados en UI/API/Cloud; vista permanente de pendientes probada; consumo/envío externo pendiente |
| F3-T3.2 pruebas integrales | SQL/GoTrue/RLS/navegador/Realtime/toma humana pasan; preflight reproducible y bloqueo API 422 probados; integración real/grants/identidades/envíos de proveedores pendientes |

## Próximo paso y límites

Completar cuotas/backoff y reintentos seguros, políticas/tipos de envío pendientes y reserva por comentario; verificar cuentas/identidades/grants reales y recorrido integral. Ecos humanos Kapso ya integrados bajo flag. El productor IA de texto ya está conectado al buffer con checkpoint privado y handoff interno sin ACK legacy; herramientas externas, n8n, Setter y efectos posteriores siguen fuera del piloto queue. El productor humano ya está conectado y probado bajo flag, con toma humana, auditoría e idempotencia transaccionales. La vista persistente de pendientes ya está implementada y probada; no habilita el transporte. La captura inbound firmada y el worker HTTP ya están conectados bajo flags desactivados; falta verificar identidades/grants reales y programar el consumo al activar una cuenta de prueba. El permiso y el mensaje transaccionales ya están implementados para WA texto; templates, comentarios, Human Agent y widget siguen fallando cerrado. Luego reserva por comentario, backoff/cuotas y conciliación antes de habilitar transportes nuevos. La app local y el usuario QA ya funcionan; resta definir el acceso administrador definitivo de Yani antes de uso operativo.

La base Cloud ya está inicializada; la app todavía no está desplegada ni enviando mensajes nuevos. No se usaron bases anteriores. Sin compras, push o merge. F1/F2/F3 continúan sin aceptación integral.


## Incremento 14: cuotas y reintentos seguros

Cuotas operativas transaccionales por workspace y conexión física: defaults internos de 60 y 30 permisos por minuto, modificables sólo por servicio en private.channel_send_budgets. No representan límites comerciales/verificados de Meta/YCloud/Kapso. Se serializan antes del permiso; consumen cupo sólo si éste se confirma. Si no hay cupo o hay cooldown, el mismo trabajo vuelve a pending con run_after y sin outbox, red ni consumo de intento de envío. El worker informa deferred; no duerme ni repite POST en la solicitud.

Rechazo confirmado retryable reprograma la misma operación con backoff 30×4^(intentos−1), jitter positivo de hasta 10% y demora no menor que Retry-After válido (segundos o fecha HTTP). Cinco intentos/24 horas; una espera posterior a esa vida útil deja dead_letter sin acortarla. El cooldown conservador bloquea esa conexión también para otras operaciones. HTTP 5xx/408, timeout, respuesta inválida y unknown siguen sin reenvío automático. Un comprobante correlacionado por external_operation_id que contradice el rechazo deja unknown antes de un nuevo permiso, con revisión manual; no se inventa entrega.

Cada intento conserva fence/outbox y revalida grant, evento/ventana, identidad, supresión y control/membresía. Un retry reutiliza su única fila de mensaje; no reaparece además como burbuja de pendientes. Una toma humana cancela el retry aún pendiente y actualiza esa fila. Sin bypass de admin. El adaptador durable separa diagnostic del resultado estricto antes del worker; se mantiene diagnóstico del dispatch legacy. Los errores de proveedor guardan sólo Retry-After en su clase del servidor; no payload/header secreto en UI.

**Verificación:** 1.842 unitarias y 118 DB locales pasan; typecheck/lint dirigido/build local de producción aprobados. Cloud SQL comprueba rechazo→pending→segundo permiso→accepted, Retry-After y cuota sin nuevo outbox. RPC HTTP real: dos jobs compiten por cupo 1, exactamente un permiso y una espera, acceso anon denegado, cero POST de proveedor. Navegador autenticado: una única fila tras dos intentos, pendiente por cupo separado de mensaje rechazado, recarga sin duplicados y cero errores/warnings. Aceptación y rechazo fueron estados sintéticos; no acredita entrega externa. Capturas ignoradas en test-results/f3-limits-browser.

Migración **20261010212657_omnichannel_send_limits.sql** aplicada una vez; **82** locales/Cloud, versiones/nombres iguales. Asesor: cero ERROR, mismos diez WARN heredados y quince INFO; nuevo INFO de RLS sin políticas corresponde a presupuesto privado sólo servicio. Fixture 997 retirado con guarda id/slug; workspace habitual restaurado, cinco mensajes QA anteriores y cero budgets/receipts/echoes/preparaciones/outbox/cron. Servidor 3100 restaurado sin flags temporales. [Evidencia](./evidencias/F3-LIMITES-2026-10-10.json).

**Siguiente bloque vigente:** completar tipos/políticas y reserva por comentario del motor compartido, luego cuentas/identidades/grants y recorrido integral real. Cupos/reintentos cubren la cola piloto, no los envíos legacy ni futuras campañas/CRM; calibración por cuenta pendiente. Flags y scheduler siguen apagados. F3 continúa sin aceptación integral (0/9 fases); Meta/widget/Brevo pendientes. Sin compras, mensajes reales, modelos, push, merge o deploy.

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

- Una nota puede quedar guardada aunque la suscripción Realtime se haya interrumpido. Refrescar el hilo al confirmar el guardado; no volver a insertar por no verla ni confundir el fallback con una prueba Realtime.
- Los grants que carga el servidor deben tener procedencia, scope y vencimiento. Nunca habilitar permisos desde capabilities booleanas ni certificar identidades copiadas por un backfill.
- La supresión del pipeline nuevo sigue al destinatario de la identidad, incluso si se editó el teléfono del contacto.

- Las comparaciones SQL entre el enum integration_provider y channel_connections.provider (text) deben castear explícitamente a text; cubierto por la prueba del permiso como service_role.
- No agregar Z a un to_char de now() sin convertir a UTC: el harness local hereda la zona horaria del equipo. Los fixtures usan serialización timestamptz de JSON con offset.
- Un reset de fixture no puede borrar una supresión todavía no confirmada: esperar el advisory lock antes de DELETE. El intento bloqueado fue correcto; la primera limpieza corrió antes del commit del escritor.
- Cambiar solo la cookie y ejecutar router.refresh() conserva la URL del chat anterior. El selector de workspace debe descartar ruta/filtros/estado cliente y abrir /inbox del nuevo workspace.
- En Windows, las ediciones Python de documentación UTF-8 deben indicar encoding="utf-8" al leer y escribir; el locale por defecto produjo mojibake detectado y corregido antes del commit.

- La captura durable debe ejecutarse antes del retorno legacy por duplicado: de lo contrario una caída entre las dos escrituras impide recuperar el evento al reentregar. No crear jobs desde ambos caminos.

- El interruptor de IA conservaba el inicializador de useState tras router.refresh. La key por conversación y ai_enabled lo remonta cuando el servidor cambia el control, sin un efecto que copie props a estado. Verificar siempre el control visible junto con el valor persistido.

- Las fechas de cola usan zona Argentina y hour12=false explícitos: el locale es-AR del runtime podía mostrar las 16 como 04 sin indicar PM. No depender de la zona o ciclo horario de Windows para SSR.

- El texto de metadata del batch es modificable por el cliente: queue sólo usa el checkpoint privado para encolar. Nunca confiar en pending_reply para emitir un mensaje.
- Persistir intención de handoff antes de los efectos de Jev; una caída entre veredicto y transición no puede perder la derivación. No cerrar un batch mientras el handoff devuelve settled=false.

- Los fixtures Cloud deben respetar uq_integrations_one_active_whatsapp: alternar proveedores antes del permiso; nunca habilitar dos WA a la vez para simplificar una prueba.
- Separar delivery-receipt-recovery del consumidor de ingress: job-store no puede importar receipt-store porque ingress ya depende de job-store. Evitar el ciclo de módulos.
- La actualización legacy de estados excluye filas de la cola. Un callback duplicado/tardío no puede sobrescribir la conciliación transaccional.

- No modificar provider/external_account_id para convertir una conexión de prueba: el routing es inmutable. Preparar el proveedor antes de migrar o crear otra conexión, conservando una integración WA activa por workspace.
- La pausa tras un eco debe ser atómica con el mensaje: insert seguido de applyTransition con error ignorado deja la IA activa; el replay legacy por dedup no lo repara. Piloto usa RPC transaccional sin segunda escritura.

- El worker valida un resultado estricto: diagnostic del adaptador WA no forma parte del contrato durable. Separarlo en durableWhatsAppAdapter antes de llamar a la cola; si no, un rechazo confirmado queda unknown y pierde su retry seguro.
- Los intentos de una operación reutilizan channel_operation_id: INSERT con conflicto para su fila visible, sin cambiar cuerpo/routing. Conservar cada fence en outbox, no reutilizar un permiso pasado.
- No usar parameter properties en clases TS ejecutadas por las unitarias con Node strip-types; declarar readonly y asignar en constructor. Un mock de error antiguo puede omitir Retry-After: el parser acepta ausencia sin lanzar ni alterar la clasificación.


## Continuación 2026-10-10 — F3, incremento 15

El contrato distingue el UUID del evento (`evidence.id`) del ID opaco de Meta (`externalCommentId`). La aprobación de plantilla también queda ligada al idioma solicitado. Comentarios no habilitan DM/media de seguimiento; Human Agent, templates y sesión web conservan contratos tipados pero carecen de permisos persistidos activos hasta sus fases.

Nueva evidencia privada `channel_comment_evidence`, con cuenta física, evento, destinatario, origen post/Reel, verificación y vencimiento. Un envelope o campos del cliente no bastan. F4/F5 deben verificar firma, cuenta/grants y elegibilidad (excluir propio/borrado/Live) antes de escribirla, con vigencia del endpoint/version realmente comprobados. No se inventó una ventana genérica ni se activó Meta.

`private_reply_claims` reserva una operación por workspace/conexión/comentario. Trigger AFTER INSERT guarda job + reserva en la misma transacción y revierte al perdedor. Repetir la clave recupera la misma operación; otra regla queda rechazada. Cuenta distinta conserva su propia reserva. La respuesta pública es independiente. Cancelar no libera la reserva; sending/unknown o cualquier outbox la proyectan como consumed. Es conservador incluso ante rechazo confirmado: no hay liberación ni retry Meta hasta verificar su contrato. El lector invoker sólo servicio devuelve una prueba acotada; nunca secretos ni autoridad desde el body.

**Verificación:** 1.852 unitarias, 137 DB completas, 106 DB dirigidas después de separar helpers, typecheck, lint y build de producción local pasan. Supabase HTTP real: dos productores compiten, una sola operación/reserva, relectura del contexto por createMessagePipeline, idempotencia del ganador y rechazo del competidor. Una respuesta pública independiente suma el segundo job. SQL verifica cancelación conservando reserva y permiso Meta denegado con cero outbox. Reader anon/authenticated denegado; resolver Meta sigue null. Bandeja autenticada recargada conserva sus dos conversaciones, sin errores/warnings. Cero llamadas a proveedores/modelos; pruebas de grants/elegibilidad sintéticas.

Migración **20261011010958_omnichannel_comment_reservations.sql** aplicada una vez; **83** locales/Cloud, versiones/nombres iguales. Asesor: cero ERROR, diez WARN heredados y diecisiete INFO; los dos nuevos corresponden a tablas privadas sólo servicio con RLS sin políticas de cliente ([detalle de Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)). Fixture 998 retirado con guarda id/slug: un workspace, cinco mensajes QA y cero proofs/claims/budgets/outbox/cron. Servidor 3100 restaurado sin flags. [Evidencia](./evidencias/F3-RESERVAS-2026-10-10.json).

**Siguiente bloque vigente:** cuentas/identidades/grants reales y recorrido integral de F3. Tres de los cuatro bloques técnicos de cierre cubiertos: ecos, cuotas/backoff, políticas/reservas compartidas. Esto no es aceptación integral de F3 ni habilitación de Instagram/Facebook. Onboarding, verificador Meta, reglas/editor, materialización de conversación y envío pertenecen a F4/F5; widget/Brevo siguen pendientes. No activar flags/scheduler ni ejecutar pruebas con mensajes reales por suposición. Sin compras, push, merge ni deploy.

Auto-Blindaje: no confundir el ID externo del comentario con el UUID de evidencia que consume el outbox. Una reserva no se borra por cancelación/TTL/unknown. En pruebas SQL parametrizadas, convertir primero el placeholder a uuid y luego a text al construir JSON. La contención NOWAIT puede fallar antes del claim; comprobar un único dueño y reevaluar el contexto antes de reintentar el productor, sin asumir un código de error único para toda carrera. El primer ensayo tuvo un rechazo distinto del esperado y un solo job; se retiró su fixture antes de repetir. No repetir mutaciones sobre un resultado desconocido.


## Continuación 2026-10-10 — F3, incremento 16: preflight y requisito externo

Se agregó `npm run channels:preflight -- <workspace UUID>`: comando interno de sólo lectura, restringido al Supabase nuevo, con `.env.local` ignorado. Verifica conexiones, grants de texto guardados/vigentes, transporte configurado, identidades verificadas y una muestra acotada de política inbound. Relee contexto del servidor, respeta supresión/opt-in obligatorio del piloto y publica sólo IDs internos, estados/conteos/motivos; no números de cuenta/destinatario, texto, secretos ni referencias de grants. Muestra los cuatro flags sin modificarlos. Nunca hace enqueue, recover, drain, POST de proveedor ni modelo.

Coverage complete significa que la inspección no fue truncada, no que F3 o el canal estén aceptados. Hasta diez conversaciones por conexión; lecturas con límites visibles y cobertura partial si se exceden. externalValidation permanece pending, incluso con credenciales configuradas. Exit 0 significa inspección completa; exit 2, muestra parcial; exit 1, error/config inválida. No usar el informe como permiso ni automatizar activación basándose en él. El envío debe volver a comprobar membresía, estado, contexto y permiso transaccional.

**Estado real comprobado:** Supabase nuevo accesible, 83 migraciones. Un workspace QA, cinco mensajes conservados; dos conexiones WA de laboratorio en connecting, cero integraciones WA activas, cero cuentas ready/identidades verificadas/grants de texto/transporte configurado/interacciones elegibles. Ingress/worker/human/ai apagados, cero outbox/cron/proofs/claims. Por eso aún no se puede ejecutar el recorrido real de envío.

**Verificación nueva:** 1.860 unitarias completas y ocho dirigidas finales pasan; typecheck y lint pasan. Comando probado por HTTP contra Supabase. GoTrue + API Next real: envío directo con campos falsificados devuelve 422 connection_not_ready; IDs de mensajes intactos. Sesión de prueba cerrada con scope local, sin invalidar navegador. Cero proveedor/modelo. Se reutiliza la evidencia DB/build del incremento 15: no cambió SQL ni rutas/componentes de aplicación. [Evidencia](./evidencias/F3-PREFLIGHT-2026-10-10.json).

**Próximo paso vigente:** definir una cuenta WhatsApp de prueba (pregunta a Yani: Kapso/YCloud/cuenta aún no disponible) y configurar credenciales dentro de Ajustes, nunca en chat. Verificar el activo concreto, vínculo conexión/integración, receptor HTTPS y recepción firmada; luego identidad, grants con procedencia/vencimiento y recorrido con destinos de prueba expresamente autorizados. La pregunta es por información faltante, no por una nueva aprobación de blueprint/Manual/Lista Roja. F3 mantiene tres de cuatro bloques de cierre, sin aceptación integral; 0/9 fases aceptadas. No promover las conexiones sintéticas a producción ni activar flags/scheduler por suposición.

**Onboarding revisado:** Kapso test lista números del proyecto; YCloud test consulta balance. Esas acciones no verifican por sí solas todos los permisos y recepción del activo elegido ni promueven channel_connections a ready. Guardar la integración legacy tampoco crea una prueba externa para el piloto. Conexión/capacidades deben resultar de verificación del servidor; no editar status/grants desde el cliente para pasar el preflight. La activación real necesita callback HTTPS alcanzable: localhost no es un callback del proveedor.

Auto-Blindaje: distinguir disponibilidad de Supabase de la conexión al proveedor WhatsApp. El preflight del piloto exige opt_in=true y respeta supresión, aunque la política de free reply legacy tenga otra semántica. Credencial/grant guardados y coverage complete jamás acreditan entrega externa. No registrar payloads de proveedor ni API keys en el informe.

### Secuencia de piloto con una cuenta real

1. Elegir proveedor y workspace de prueba. Configurar key, signing secret y número/Phone Number ID desde Ajustes como administrador; conservar una sola integración WA activa. No compartir valores en chat ni mover activos de otro tenant.
2. Ejecutar preflight manteniendo flags apagados. Es una foto del contexto; no modifica cuentas, integra proveedor ni prueba permisos remotos.
3. Validar número/cuenta concreta con el proveedor y resolver conexión → integración → cuenta física sin reemplazarla por otra activa. Verificar firma/routing y recepción en un callback HTTPS de prueba aprobado antes de declarar ready/grants. Ingress puede capturar cuentas no ready bajo allowlist; no otorga grants/identidades ni envía. El recorrido legacy tiene sus propios efectos, por lo que una captura shadow no equivale a ausencia total de envíos/modelos: debe quedar controlado antes de recibir tráfico real.
4. Mantener IA/herramientas/Setter y envíos legacy controlados durante la prueba. Acordar los destinos y mensajes de prueba antes de cualquier POST externo; verificar opt-in/ventana e identidad con evidencia del proveedor. No insertar pruebas/grants sintéticos para hacer pasar el piloto real.
5. Probar recepción → política → enqueue humano → permiso → envío → comprobante correlacionado → UI, y recepción → IA/checkpoint → cola sólo cuando el modelo/prueba esté autorizado. Aceptación HTTP no equivale a entrega; unknown se concilia sin segundo POST. Comprobar pausa humana y rollback por flags preservando mensajes.
6. Completar evidencia de F3 y revisar pendientes externos antes de aceptación. Apagar flags del piloto, conservar ledger y retirar sólo fixtures identificados. Ninguna de estas instrucciones autoriza deploy, scheduler, facturación ni mensajes reales por sí misma.

**Decisión posterior de Yani:** el piloto se hará mañana con otro número dedicado. El Kapso del dashboard original no se reutiliza para esta prueba y su webhook/credenciales se preservan. La conexión del nuevo número a Kapso todavía no está comprobada. Retomar desde el paso 1 cuando esté disponible; sin ejecución ni recordatorio automático. Mantener controlados los efectos legacy aunque los flags omnichannel estén apagados.

**Retomada 2026-10-14, decisión vigente:** el piloto inicial usa un número dedicado en **YCloud**. Se creó desde Agency Laboratorio F3 · YCloud dedicado (`ff50ed19-6330-43c1-a69d-32252c9ca756`), sin nueva cuenta Auth ni emails. Kapso activo del laboratorio anterior queda preservado. Preflight del nuevo espacio: cero conexiones, cuatro flags apagados y validación externa pendiente. Formulario YCloud abierto en Chrome; falta confirmar número conectado y cargar API Key/número, luego endpoint HTTPS propio/secret y control legacy antes de tráfico. No proveedor/modelo, webhook nuevo, flags/scheduler o envíos reales. Los conteos y cero integraciones de pruebas anteriores son históricos; no rerun del smoke que los asume sobre el laboratorio ahora configurado.

**Incremento 17, 2026-10-14:** codex/omnichannel-f3-ycloud-pilot incorpora receptor YCloud de verificación (firma/número, sin normalizar/persistir/CRM/medios/IA/envíos) y puente efímero de POST exclusivo en 3104. El requisito de verificación se vuelve a comprobar en ruta para evitar efectos si el flag se retira entre health/POST. 1.865 unitarias/27 dirigidas/typecheck/lint pasan; HTTPS bloquea UI/GET con 404 y firma inválida con 401. No nueva migración ni aceptación F3. API Key probada, número conectado confirmado por usuario y un número Connected observado en YCloud. Segundo webhook autorizado por Yani y creado Inactive, ID 6acfef56108a835e37b5c86d; el anterior sigue Active. Webhooks generales tienen alcance de cuenta; Custom apps indisponible en Free, no compra. Pendiente secreto nuevo/API Key/número → Guardar en laboratorio; activar nuevo endpoint y verificar firma sin tráfico real primero. No ready/grants/identidad todavía. Runtime efímero en test-results/f3-ycloud-runtime.json; continuidad y límites en PLAN-STATUS/evidencia F3-YCLOUD-VERIFICACION-2026-10-14.json. No usar imagen de pruebas sintéticas como prueba de entrega externa. Iniciar runtime antes de pedir claves para no perder drafts por reinicio.

**Después de «listo», 2026-10-14:** se verificó guardado cifrado, endpoint nuevo Active, secreto coincidente y número configurado CONNECTED mediante GET reales a YCloud. Prueba **sintética local** firmada sobre HTTPS devuelve 200/accountMatched sin persistir en siete tablas del laboratorio; no prueba que YCloud haya entregado un evento. Logs del proveedor al inspeccionar: cero. Referencia F3-YCLOUD-CONECTADO-2026-10-14.json. Siguiente: recepción de «hola prueba F3» enviado por Yani desde otro número propio, observar log/200 y conteos. No respuesta ni conversación desde el modo de verificación. No confundir counters matched de la prueba sintética con mensajes reales; original sigue independiente. Conexión durable/identidad/grants y recorrido completo siguen pendientes, F3 abierta. Checks anteriores conservados, producto sin cambios.

**Después de «enviado», 2026-10-14:** log real YCloud del nuevo endpoint confirma evento evt_6acff36a8c323a69db3d3cde (whatsapp.inbound_message.received) a 18:26:02 Argentina, HTTP 200/received/verificationOnly/accountMatched; mensaje de prueba coincide. Firma/destino válidos, una entrega del proveedor (separada de la sintética previa). Siete tablas permanecen en cero por diseño de verificación, sin modelos/CRM/envíos del fork. Evidencia F3-YCLOUD-RECEPCION-REAL-2026-10-14.json. Siguiente almacenamiento durable/identidad/inbox antes de preparar respuesta humana con destino/texto revisables; ampliar alcance de recepción sin efectos de forma explícita. F3 sigue abierta; cuenta/grants y prueba integral pendientes. Original independiente no auditado, temporalidad del túnel conservada.

### F3, incremento 18 — YCloud a bandeja, 2026-10-14

Rama codex/omnichannel-f3-ycloud-inbox desde b5af8d1. Materialización de texto YCloud transaccional y sólo recepción, con firma/cuenta exacta y RPC restringida a servicio. Migración84 aplicada; versiones locales/Cloud alineadas. Un mensaje real previamente verificado importado como histórico, deduplicado con dos RPC simultáneas. Conversación human_active/IA apagada; conexión needs_permissions/grants vacíos, identidad aún sin verificar. Consentimiento nuevo false, existente y supresión preservados; conflicto de cuenta/conversación legacy se rechaza sin adopción. No se modifica la restricción legacy de una conversación por contacto/canal.

Bandeja QA y recarga muestran «Hola prueba F3» y borrador interno guardado, sin envío. Un contacto/identidad/conversación/inbound histórico/nota, cero jobs/outbox/outbound de cliente. 1.868 unitarias,144 DB,seis relay,typecheck/lint pasan. RPC Cloud sólo servicio; asesores cero ERROR/diez WARN heredados. HTTP público401 ante firma inválida y404 para dashboard. Cuatro flags normales apagados; modo inbox sólo en proceso/workspace dedicado. UI local usar localhost3100. Detalle, límites, Auto-Blindaje y próximo paso en [continuidad](./PLAN-STATUS-omnichannel-pixiweb.md); evidencia F3-YCLOUD-INBOX-2026-10-14.json. Próximo: mensaje nuevo «Hola bandeja F3» enviado por Yani para comprobar guardado directo. Luego permisos reales y envío humano expresamente autorizado. F3 sigue abierta; no IA/envíos/compras/push/merge/deploy.
### Recepción YCloud directa — 2026-10-14

Yani «Enviado»: «Hola bandeja F3» se guarda live en la misma conversación desde el reintento real de YCloud a19:11:58 Argentina, HTTP200/recorded=true, después de tres fallos sin filas parciales. Un contacto/identidad/conversación, dos inbound (uno histórico), una nota; identidad verificada, IA apagada y cero envíos/jobs/outbox. Sin grants/ready/consentimiento por inferencia. Ajuste de receivedAt local limitado a5s y reloj de BD, occurredAt del proveedor sigue estricto; migración85 aplicada y versiones alineadas.145 DB,25 unitarias dirigidas,typecheck/lint pasan; asesores cero ERROR/diez WARN heredados. Recepción exitosa ocurrió antes del ajuste; relecturas RPC deduplican, no son nueva entrega del proveedor. Detalle/Auto-Blindaje en continuidad y F3-YCLOUD-INBOX-LIVE-2026-10-14.json. Próximo: permisos/evidencia y envío humano específicamente autorizado; F3 sigue abierta. Sin IA/envíos/compras/push/merge/deploy.

### F3, incremento 19 — estados en modo inbox, 2026-10-14

El piloto recibe comprobantes firmados con ingress apagado y los concilia sólo con la cuenta/operación durable exactas. No actualiza por el writer legacy, no genera otro inbound ni abre ventana/consentimiento/IA. Verify mantiene cero escrituras; la excepción no se aplica a Kapso ni a otros workspaces. receiptRecorded indica almacenamiento (también en replay), no una nueva inserción ni entrega confirmada por sí sola.

1.874 unitarias,7 relay,106 DB cola y9 DB inbox pasan; typecheck/lint aprobados. Next real rechaza firma inválida/cuenta ajena/estado no soportado; Cloud probó un receipt sintético en BEGIN/ROLLBACK y quedó en cero. No hay un nuevo comprobante externo real. Cuenta/endpoint YCloud verificados por GET; conexión aún needs_permissions.85 migraciones, sin SQL nuevo. Next local3100 activo, callback temporal anterior no disponible. Restaurar relay/túnel sobre el endpoint nuevo antes del próximo tráfico real. Original sin modificaciones; Yani no comprobó si respondió. F3 no aceptada. Estado, siguiente respuesta revisable y controles pendientes en [continuidad](./PLAN-STATUS-omnichannel-pixiweb.md); [evidencia](evidencias/F3-YCLOUD-RECEIPTS-PILOTO-2026-10-14.json).

Actualización del runtime: receptor HTTPS restablecido con Next81519/relay59493/túnel67399; un PATCH al mismo endpoint nuevo y GET de conciliación confirman URL activa y eventos/secreto intactos. Dashboard404/firma inválida401. El original no se solicitó ni modificó. No hubo POST de mensajes ni nuevos permisos; callback sigue temporal. Implementación18f1e33, rama local.

### F3, incremento 20 — respuesta humana real, 2026-10-15

Autorización específica y consentimiento temporal de Yani ejecutados. Una operación d6669099-a9d2-42b6-a88d-5a122d15f1dc se encola en API Next autenticada202 y el core productivo processClaimedJob se ejecuta desde runner acotado a esa operación/cuenta/texto; no se llama al cron. Un POST YCloud, una fila de mensaje/job/outbox y GET del proveedor delivered07:18:56 Argentina. Sent tiene receipt firmado automático; delivered fue recibido/ignorado200 y se recuperó del log real, corroborado con GET exacto. No contar esa importación como nuevo webhook o entrega automática posterior al fix.

Validación de hora: un receipt válido hasta5s futuro ahora pide500/retry, sin persistirlo; los inválidos/futuros lejanos siguen ignorados. El mismo payload luego normaliza: desfase inferido, delta no medido. HTTP real sintético+4s confirma CLOCK_SKEW,1.877 unitarias/38 dirigidas,typecheck/lint pasan; no SQL nuevo. Browser verifica Entregado/atribución humana y nuevo bloqueo del composer. Consentimiento y permiso temporal retirados, IA/campañas/cuatro flags apagados. Conteos:2 inbound/1nota/1outbound/1job accepted/1outbox accepted/2receipts planned. No nuevo envío ni modelo. Next19601/relay59493/túnel67399. Evidencia y próximo recorrido integral en [continuidad](./PLAN-STATUS-omnichannel-pixiweb.md) y [prueba humana](evidencias/F3-YCLOUD-RESPUESTA-HUMANA-2026-10-15.json). F3 sigue sin aceptación integral.

### F3, incremento 21 — recepción al buffer queue, 2026-10-15

Modo pipeline explícito y excluyente con verify/inbox, máximo tres workspaces. Texto firmado y cuenta exacta → materialización y preparación privada queue en la misma transacción. Las conversaciones nuevas son humanas; no se infiere consentimiento ni permiso. Buffer sólo con los tres flags ingress/worker/ai y elegibilidad DB vigente. Ráfagas sólo comparten batch aislado de la misma revisión sin intentos previos; legacy no lo adopta. Reentregas históricas o recibidas en pausa no generan respuestas retroactivas. Cambio de flags al consumir no vuelve a legacy. Webhook sin modelo/herramientas/worker/envío; receipts conservan la ruta durable.

Migración86 aplicada y alineada; cuatro funciones invoker sólo servicio. 1.886 unitarias/156 DB/ocho relay/typecheck/lint pasan. Cloud SQL sintético comprueba burst, checkpoint, enqueue único, toma humana y handoff; rollback deja cero fixture. Asesor sin nuevos hallazgos (0 ERROR/10 WARN heredados/17 INFO). Laboratorio real sigue inbox/human_active/IA y flags apagados, cuatro mensajes previos/1job/1outbox/0batches. No llamadas reales a modelo/proveedor. [Evidencia](evidencias/F3-YCLOUD-PIPELINE-2026-10-15.json) y límites/próximo paso en [continuidad](PLAN-STATUS-omnichannel-pixiweb.md). F3 sigue abierta; IA real requiere prueba concreta autorizada, onboarding permanente/multi-cuenta pendientes.

### F3, incremento22 — preparación de IA con consumidor exacto,2026-10-15

OpenRouter del laboratorio validado con GETkey200; GPT-4.1 y fallback Gemini3.5Flash guardados/listados, cero completions. processNextBatch admite target workspace/batch y llama sólo claim_ai_channel_batch; scanner legacy sin target intacto. RPC invoker sólo servicio, batch debido/queue elegible sin checkpoint/job y sin adelantar trabajo previo. Migración87 alineada.1.892 unitarias/159DB/siete guardas de red/typecheck/lint pasan, Cloud sintético por lote con rollback, asesor sin nuevos hallazgos. Runner privado prepare listo; limita una generación128tokens/un envío exacto, persiste intentos y bloquea redirects/otras redes. No activado: autorización específica de nueva respuesta/consentimiento temporal pendiente, flags y grants apagados/humano/opt_in false. [Evidencia](evidencias/F3-IA-PILOTO-PREPARADO-2026-10-15.json) y protocolo de activación/restauración en [continuidad](PLAN-STATUS-omnichannel-pixiweb.md). No compra/push/merge/deploy; F3 abierta.

### F3, incremento23 — texto IA real YCloud,2026-10-15

Prueba única autorizada ejecutada: inbound real firmado→bufferqueue exacto→GPT4.1 (una petición714/21tokens)→checkpoint/job→core worker (un POST/attempts1/fence1)→YCloud delivered11:10:16Argentina→receipts automáticos sent/delivered→inbox con atribución IA/Entregado. No importación manual, cron ni otro modelo/envío. Autorización consumida; consentimiento/grant/prompt/agente restaurados, humano/IAfalse/inbox y cuatro flags vacíos. Supervisor detectó restored y reinició Next. Replay procesado no trabaja; checkpoint queue y operaciónduplicateaccepted se conservan sin otrojob/outbox. El control humano fue posterior al envío; carreras durante generación y unknown mantienen pruebas sintéticas previas.87 migraciones,checks completos del incremento22 reutilizados. [Evidencia](evidencias/F3-IA-ENTREGADA-2026-10-15.json); próximo cierre AC/conexión permanente/multi-cuenta en [continuidad](PLAN-STATUS-omnichannel-pixiweb.md). F3 abierta; sin compras/push/merge/deploy.

### F3, incremento24 — filtros completos y cuenta persistente,2026-10-15

Asignación Todas/Mías/Sin asignar/Asignadas calculada con JWT/RLS y antes de cursor/LIMIT, junto a canal/cuenta/búsqueda/estado. Se agregan Esperando/Pausadas/Cerradas a la UI. Navegar al hilo y volver conserva filtros; cambio de filtro retira cursor. Etiqueta de canal/cuenta en lista y encabezado, incluso sin nombre, sin confundir teléfono del contacto con cuenta. min-h-0 en el contenedor del hilo y ScrollArea impide que el desplazamiento automático oculte encabezado/control humano. Cuenta del hilo usa las conexiones del workspace ya leídas por la sesión, sin consulta adicional.

Migración88 con RPC nueva de nombre único y wrapper compatible de la firma anterior, ambas invoker/search_path vacío/anon sin permiso.1.895 unitarias,162DB,typecheck/lint y dos renders desktop/mobile pasan. Navegador autenticado mine→hilo→volver/unassigned/mine+paused/recarga,375/1440px y cero errores de consola. Prueba Cloud60 conversaciones sintéticas,tenant ajeno/revocación/paginación/compatibilidad,rollback sin fixture; asesor sin hallazgos nuevos. No proveedor/modelo/consentimiento/flags nuevos ni datos operativos alterados. [Evidencia](evidencias/F3-INBOX-ASIGNACION-2026-10-15.json). No push/merge/deploy; F3 abierta.

## Matriz de aceptación F3 — 2026-10-15

Esta matriz separa implementación y evidencia de la aceptación integral. Los nueve criterios son los del blueprint; no convierte los canales aún deshabilitados en capacidades disponibles. No se exige repetir la prueba real de WhatsApp ya entregada.

| Criterio | Evidencia vigente | Límite para el cierre integral |
|---|---|---|
| US-006 AC1: filtros y cuenta visible | Incrementos24–25; dos hilos por contacto/cuenta y filtros por seis estados/canal/cuenta/asignación, RPC/RLS/paginación, hilo y fila, navegación real375/1440px | Incremento25 cubre esquema/lecturas de dos cuentas con fixtures; alta real de cuentas y canales nuevos pendiente |
| US-006 AC2: timeline, notas y origen | Notas y texto real humano/IA en incrementos18/20/23; tipos media legacy conservados; fixtures de diseño multicanal de F2 | Piloto nuevo recibe texto; media/origen de nuevas fuentes necesitan adapters/materialización y recorrido de sus fases |
| US-006 AC3: tenant/rol y delivered/read | Tests `inbox-read.test.mjs`, comprobaciones GoTrue previas y receipts YCloud reales; delivered IA automático en incremento23 | Extender recorrido de permisos/lecturas por cada cuenta/canal cuando se habiliten; accepted por sí solo no prueba entrega |
| US-007 AC1: toma humana y revisión | Incremento28 integra intake/claim/buffer/decisión/toma humana/checkpoint/enqueue/worker con SQL local real y generación diferida; casos sin cambio, toma y toma+resume | Carrera integrada sintética acreditada; no se provocó una carrera con modelo/proveedor reales. La restauración posterior de la prueba real anterior sigue siendo evidencia distinta |
| US-007 AC2: composer y bloqueos | Política/contexto y composer de incrementos5/6/8/16; rechazo422 con capabilities inventadas; bloqueo visible actual needs_permissions | Alta permanente de cuenta/grants y ampliación de cada capacidad externa; permisos temporales ya retirados |
| US-007 AC3: sin bypass y devolución explícita | `send-policy.test.ts`, contexto/permiso transaccional y control por revisión; UI de toma/devolución explícita | Probar onboarding permanente sin dar permisos por guardar API key ni por rol admin |
| US-008 AC1: dedup webhook/receipt/eco | DB y HTTP en incrementos7/12/13/18/19/21; replay real en23; incremento29 admite mismo wamid en conexiones distintas y conserva dedup/echo por cuenta, sin escrituras legacy ambiguas | Dos cuentas sintéticas local/PostgreSQL17; alta multicuenta operativa y ecos YCloud reales pendientes |
| US-008 AC2: lease, unknown y recuperación | DB/worker con fencing y carreras Cloud, receipts y límites; reanudación/replay real de23 sin envío nuevo | No se indujo timeout real ni se mató un proceso tras POST; pruebas de esas condiciones siguen sintéticas |
| US-008 AC3: firma/activo/orden/ACK | Ingress/receipts/pipeline con tests inválidos/ajenos/desorden; rechazos HTTP y recepción firmada real en17–23 | Mantener pruebas por nuevo adaptador y no afirmar que el ACK de verificación equivale a persistencia |

**Próximo bloque concreto (actualizado en incremento35):** primera entrega acotada del alta managed desde producto,sin SQL manual ni grant/consentimiento permanente previo. Guard SQL/source pin de envío ya corregidos/probados sintéticamente; no repetir como pendiente. Después hosting/DNS/HTTPS/cutover y AC;media/ecos managed e interacción pendientes. dashboard.pixiweb.com.ar elegido,NXDOMAIN observado34,no reconsultado. Meta/OAuth F4/F5,widget F6,Brevo F7. F3 abierta.

Auto-Blindaje24: filtrar antes de paginar y resolver “mí” por sesión. RPC con nombre único evita sobrecarga ambigua de PostgREST. Mantener min-h-0 en la cadena flex para que el scroll de mensajes no oculte la cuenta/controles. Un fixture WA también requiere teléfono; corregir fixture, nunca relajar esa invariante.

### F3, incremento25 — conversaciones por cuenta y legacy sin destinos ambiguos,2026-10-15

Migración89 reemplaza unicidad por contacto/canal con cuenta y NULLS NOT DISTINCT; trigger privado serializa por contacto y prohíbe mezclar historial sin cuenta con hilos vinculados. Inbox/pipeline consultan cuenta/identidad exactas. Legacy usa RPC atómica con integración/activo del webhook firmado, mantiene IDs/control/supresión y no modifica perfil si falla routing. Ecos, resolución de contacto en automatizaciones y lector común del dispatch se detienen ante ambigüedad o hilo de cola; nunca seleccionan el más reciente de otro canal. Flags apagados no ofrecen legacy para hilos nuevos.

1.905 unitarias/170DB/typecheck/lint pasan; SQL Cloud con rollback,roles/RLS y guardas de perfil; asesor sin nuevos hallazgos,89 versiones alineadas. Dos procesos PostgreSQL diferentes compiten por el mismo hilo B: segundo espera al primero y ambos obtienen el mismo ID; cuenta A intacta. Cron de prueba autoeliminado,0activo. UI real muestra un contacto ficticio con dos cuentas,previews/estados/filtros/historias separados. Fixture retirado y contexto/viewport restaurados; hashes de todos los contactos/conversaciones/mensajes previos idénticos. Una navegación demoró20s y luego200; no es prueba de rendimiento. [Evidencia](evidencias/F3-MULTICUENTA-2026-10-15.json).

No hay dos números reales nuevos conectados ni permisos persistentes activos: el onboarding WA todavía admite una integración activa por workspace y uq_messages_wamid conserva dedup global por workspace. Coincidencia externa entre cuentas se rechaza, no se mezcla. Nuevos canales siguen bloqueados por F1. F3 continúa abierta por alta/grants permanentes,demostración de toma humana durante generación y AC restantes. Sin nuevos mensajes/modelos reales,compras,push/merge/deploy. Prueba real humana/IA previa no se repite.


## Incremento26: comprobación persistente de alta YCloud

Admin verifica desde Ajustes con la clave guardada; manager lee evidencia saneada. Seis checks: acceso,número CONNECTED,webhook activo,URL,eventos y secreto exactos. Sólo GETs a YCloud; no consulta al callback ni cambios de proveedor/permisos/envíos. Tabla privada/RLS con fingerprint canónico24h y RPCs INVOKER sólo servicio; rol/fuente se revalidan bajo lock al guardar. Configuración modificada y resultados viejos invalidan la comprobación.

| Criterio | Evidencia |
|---|---|
| Cuenta y webhook coinciden | Prueba real16:51:44.239UTC; seis checks pasan |
| Persistencia y deriva | Volver al panel conserva resultado; editar endpoint marca desactualizado; SQL Cloud deriva/ROLLBACK |
| Control de acceso y datos | Admin verifica,manager consulta; anon401; ACL privada; respuestas sin claves ni otros números |
| No autorizar por una lectura | sendAuthorizationfalse,grants/status/opt-in/flags idénticos; túnel temporal visible |
| Validación |1.914 unitarias/176DB/typecheck/lint;90 migraciones alineadas; UI390/1440sin overflow,cero consola |

Datos previos intactos;0cron activos; sin modelos,mensajes,push/merge/deploy. Quedan emisión/revocación permanente de capacidades,publicación estable/recepción y carrera humano/IA integrada. F3 abierta,0/9 aceptadas. [Continuidad detallada](PLAN-STATUS-omnichannel-pixiweb.md) · [Evidencia](evidencias/F3-ALTA-YCLOUD-2026-10-15.json).


## Incremento27: permiso de texto gestionado

Admin autoriza/renueva/revoca el permiso local del pipeline durable. Requiere verificación vigente, origen estable del servidor, activo exacto y entrega confirmada en30d. Vigencia acotada por verificación +24h; renovación manual, sin cron ni permiso indefinido. Ledger privado y operaciones idempotentes; cambios de fuente o verificación invalidan sólo grants de este flujo. Revocar conserva los mensajes y resultados ya iniciados; no concede opt-in/IA/rollout ni hace cutover legacy.

| Criterio | Evidencia |
|---|---|
| Admin explícito, manager lector | API/schemas/RPC y prueba de roles incluido UPDATE RLS autenticado |
| Prueba del servidor y fuente exacta | Callback por CHANNEL_PUBLIC_ORIGIN; recibo/job/outbox/mensaje y fingerprint |
| Revocación/replay/deriva | SQL Cloud con ROLLBACK; pruebas DB y UI con fixture ficticio |
| UI y preservación | Autorizar→recargar→revocar; móvil/escritorio; fixture eliminado, datos reales idénticos |
| Validación |1.922 unitarias/188 DB/typecheck/lint;92 migraciones alineadas |

Configuración futura de despliegue: CHANNEL_PUBLIC_ORIGIN debe ser un origen HTTPS estable, sin ruta/credenciales/query/túnel. Se deriva /api/webhooks/ycloud?wsid=workspace. No se configura ni activa en este laboratorio; origen vacío bloquea la autorización real. Gestión de altas nuevas y renovación operativa antes de producción siguen. [Continuidad](PLAN-STATUS-omnichannel-pixiweb.md) · [Evidencia](evidencias/F3-PERMISOS-YCLOUD-2026-10-15.json). Próximo: carrera integrada humano/IA y AC restantes. F3 abierta,0/9 aceptadas.

## Incremento28 — toma humana durante generación pendiente, 2026-10-15

Se ejecuta el buffer real sobre el harness PostgreSQL local, con las migraciones existentes y un puente SQL en lugar del transporte HTTP. La generación simulada queda suspendida en una promesa explícita: sólo se libera cuando las transiciones humanas ya terminaron. No depende de sleeps ni del tiempo del modelo.

El caso de control sin cambios crea un único job pending con el texto esperado. Los casos de toma humana y toma+devolución a IA pasan por applyTransition real: aumenta state_revision, conserva assigned_to y los eventos manuales. Al resolver el modelo se conserva el checkpoint privado y se registra el uso simulado, pero enqueue rechaza la revisión vieja y handoff no sobrescribe el estado posterior. No quedan jobs, outbox ni mensajes salientes; un replay del batch no regenera y el drain real no encuentra trabajo ni resuelve adaptador. Cada escenario hace ROLLBACK y la base en memoria se cierra.

Verificado: cinco comprobaciones internas integradas; suite DB 189/189, unitarias1.922/1.922, typecheck y lint de los tres archivos nuevos. No se cambió código de producción ni migraciones. Sin accesos Cloud, claves reales, modelos reales, mensajes ni cambios de flags/consentimiento. La prueba es local y sintética; no acredita una carrera real con proveedor ni puede retirar un POST ya permitido/en curso.

Auto-Blindaje: al iniciar node --test desde un test aislado, eliminar NODE_TEST_CONTEXT del entorno heredado. De otro modo Node omite la ejecución por recursión y puede retornar0 sin probar nada. El wrapper exige los cinco pases y tiene un límite de tiempo del proceso hijo.

[Evidencia](evidencias/F3-TOMA-HUMANA-2026-10-15.json). Rama codex/omnichannel-f3-human-control desde0220639. Próximo: multicuenta operativa/dedup wamid y AC restantes; publicación estable, alta/cutover y renovación antes de activar. F3 sigue abierta,0/9 aceptadas. Estado Cloud/runtime previo no se revalidó en este incremento. Respaldo previo0220639/b70995e en GitHub verificado; este incremento sin push/merge/deploy.

### F3, incremento29 — deduplicación de mensajes por cuenta, 2026-10-15

La unicidad legacy (workspace_id,wamid) impedía conservar el mismo ID en dos cuentas. Se reemplaza por workspace/cuenta/wamid; una columna ordinaria con CHECK y trigger privado deriva la cuenta después del binding de conexión. El cliente no puede elegir otro scope. Historial sin cuenta conserva scope legacy; varios wamid nulos siguen permitidos. Los upserts inbound/echo usan el contrato nuevo y el SQL del echo consulta la conexión exacta.

El lector de estados legacy ya no usa LIMIT1. La RPC read_legacy_whatsapp_message es INVOKER, search_path vacío y sólo servicio: valida integración/cuenta vigentes, dirección, propiedad de cola y contexto de conversación. IDs contradictorios o coincidencias ambiguas se rechazan antes de actualizar; una única fila de otra cuenta tampoco se adopta. Los receipts durables conservan su resolución por cuenta/operación. YCloud ignora un from explícito ajeno; payload legacy sin from mantiene su contrato anterior y no prueba soporte multicuenta operativo.

Migración93: 20261015212823_omnichannel_message_account_dedup.sql, aplicada en el proyecto nuevo y alineada con las93 versiones locales. PostgreSQL17.11: fixture de dos cuentas/mismo contacto, IDs repetidos/replay, contradicción y denegación al navegador; rollback confirmado. Hashes de todos los campos anteriores de mensajes, conversaciones, contactos y conexiones idénticos antes/después. Siguen once mensajes globales, tres jobs/dos outbox y dos workspaces. Cron: cero activos y un automation-history-purge heredado inactivo; no se modificó ningún scheduler.

Validación final: 1.924 unitarias,200 DB (once en el archivo nuevo),typecheck y lint pasan. La misma prueba Cloud corre localmente. PostgREST llega a la RPC como servicio y rechaza anon; la respuesta P0002 del caso de servicio es intencional para una integración sintética inexistente. Asesor sin novedades:0ERROR/10WARN heredados/19INFO. [Referencia de avisos y remediación](https://supabase.com/docs/guides/database/database-linter). Configuración Realtime/RLS preservada; no es una nueva prueba de entrega Realtime en navegador. No se repiten modelo, mensaje o webhook real.

Auto-Blindaje29: una columna GENERATED en messages con REPLICA IDENTITY FULL y publicación heredada impide UPDATE en el ensayo local. Se descartó antes de Cloud: columna ordinaria comprobada + trigger del servidor conserva compatibilidad. Verificar backfill, hashes históricos y filas sin cuenta; no cambiar replica identity para hacer pasar el test.

Operación/rollback: esquema93 y escritores de la app deben desplegarse coordinados. No restaurar ciegamente un binario que use onConflict workspace_id,wamid; tampoco reconstruir la unicidad global si ya hay IDs repetidos entre cuentas. Ante un problema, pausar procesamiento y conservar historial/contrato vigente mientras se revisa. No hubo deploy ni cambio de recepción/flags/grants/consentimiento.

[Evidencia](evidencias/F3-DEDUP-CUENTAS-2026-10-15.json). Rama codex/omnichannel-f3-message-dedup desde3806f34. Dedup por cuenta resuelta con fixtures; falta alta multicuenta operativa, credenciales/routing por conexión, origen público estable/alta/cutover/renovación y aceptación de AC restantes. El onboarding WA aún permite una integración activa por workspace. F3 sigue abierta,0/9 aceptadas. Sin push/merge/deploy, nuevos mensajes/modelos ni compras.
### F3, incremento30 — registro seguro de cuentas adicionales,2026-10-15

Se conserva integrations y su único proveedor WA activo por workspace. Las adicionales se registran en channel_connections y private.channel_credentials de forma atómica, con status needs_permissions, capabilities vacío y sin adoptar historial/identidades ni copiar claves del proveedor principal. Se admiten YCloud (número E164) y Kapso (Phone Number ID); esto prueba registro, no acceso al proveedor.

Ajustes incorpora lista segura y formulario con secretos enmascarados; guardar no habilita recepción/respuestas/automatizaciones. Las credenciales se cifran como un payload AES-GCM cuyo AAD incluye workspace, conexión y proveedor. No hay fallback a texto plano; mover el ciphertext a otra cuenta falla la autenticación. GET devuelve sólo metadata/booleano de presencia, jamás el payload. API exige sesión admin para mutar y manager para leer, y RPC INVOKER/servicio revalida membresía activa en la transacción. Browser/tenant ajeno no pueden llamar RPC ni leer el esquema privado.

El UUID del alta liga su primera mutación cifrada; replay exacto SQL es idempotente y no reemplaza secretos. Payload distinto, ID de otra cuenta, activo ya registrado o fuente legacy se rechazan. Respuesta perdida se revisa mediante GET sin POST ciego; un resultado aún incierto bloquea otra mutación en la interfaz. Revocación explícita exige updated_at vigente, conserva historial/credenciales y no reactiva por replay. La integración principal no se puede revocar desde este flujo.

Migraciones94/95 aplicadas:20261015215248 y20261015220436;95 versiones alineadas.1.935 unitarias/211 DB/typecheck/lint pasan; once tests en archivo DB nuevo incluyen el mismo probe Cloud. PostgreSQL17: dos altas, aislamiento, replay tras revocar y bloqueo browser,con rollback. HTTP Next→GoTrue/RLS→RPC→BD con usuario QA:18 controles admin,3manager,3miembro inactivo y2rechazo obsoleto;401anon/403tenant ajeno,400payload inventado,409duplicado y stale,201alta y200revocación. Credenciales ficticias almacenadas sólo como ciphertext; sin jobs/outbox/grants. Workspace,privados y auditoría sintéticos retirados; hashes originales idénticos. Asesor0ERROR/10WARN heredados/19INFO,sin novedades; [remediaciones](https://supabase.com/docs/guides/database/database-linter).

**Límite visual:** Browser Use rechazó inspeccionar localhost:3100/settings por política de URL. No se intentó otro navegador/CDP/atajo. React DOM server renderizó únicamente el panel inicial; HTTP prueba servidor/BD, no interacción del formulario ni responsive. Esos recorridos quedan pendientes. No se afirma QA visual terminada ni aprobación de fase.

Auto-Blindaje30:40001 es una falla de serialización, no un conflicto de negocio; PostgREST puede reintentar la transacción, observado como rechazo stale de2,1min. Migración95 conserva la lógica y usa23514 en estos dos conflictos; mismo rechazo HTTP medido3204ms con compilación local. [Nota oficial de Supabase](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b). Revisar usos anteriores de dominio en otro bloque, sin sustituir errores genuinos de concurrencia globalmente. Fixture SQL con $$ debe usar callback en String.replace; el replacement string interpreta dobles dólares. Metadatos Next corruptos causaron404/tipos inválidos: se detuvo sólo el supervisor propio, respaldó types dentro del workspace, regeneró next typegen y reinició; typecheck final pasa con servidor activo. next-env generado restaurado y fuera del commit.

Runtime restaurado:Next3100 supervisor2232/sesión77359,inbox del dedicado,cuatro flags vacíos/public origin vacío/permissionsUiTestfalse. Túnel y callbacks no revalidados ni modificados. No rearmar el runner IA antiguo; autorizaciones únicas siguen consumidas. Sin nuevas cuentas/modelos/mensajes reales,compras,push/merge/deploy.

[Evidencia](evidencias/F3-ALTAS-CUENTAS-2026-10-15.json). Rama codex/omnichannel-f3-account-onboarding desde51d8230. Registro seguro completado; resolver/adapter actual aún requieren legacy_integration_id. Próximo webhook firmado y fuentes de transporte/verificación/permisos por conexión; luego origen estable/alta/cutover/renovación y aceptación de AC. F3 abierta,0/9aceptadas.
### F3, incremento31 — fuente y captura firmada por cuenta, 2026-10-15

La fuente de credenciales de adicionales ahora se resuelve por workspace/conexión/proveedor con RPC sólo servicio, INVOKER y search_path vacío. Excluye integración legacy, revocación y expiración; valida versión de clave y AES-GCM ligado al propietario. El adaptador usa la API key y remitente de esa cuenta sólo si está ready; no sustituye la integración principal ni crea capacidades verificadas.

Nueva entrada /api/webhooks/whatsapp-accounts/[workspaceId]/[connectionId], apagada por CHANNEL_ACCOUNT_INGRESS_CONNECTIONS vacío e independiente de flags legacy. HMAC del cuerpo crudo y destino exacto antes de guardar; máximo1MiB. Guarda eventos normalizados y comprobantes privados con conciliación por cuenta; no materializa contactos/conversaciones/mensajes de bandeja, no buffer/modelo ni nuevos jobs/envíos. ACK identifica shadowOnly. Un fingerprint interno de concurrencia y locks de conexión/credencial rechazan fuente cambiada o revocada entre firma y escritura; fingerprint no es una credencial de autenticación. Replays por cuenta toleran sólo variación de receivedAt; contenido/estado distinto colisiona y revierte.

96 migraciones locales/Cloud alineadas.1.952 unitarias/220DB/typecheck/lint pasan;9comprobaciones en el nuevo archivo DB. Probe PostgreSQL17.11 con rollback, mismo probe local y22controles HTTP reales a Next3100→PostgREST→SQL con2cuentas ficticias: firma,scope,dedup,colisión,receipts y revocación. Tres envíos de adaptador interceptados(2YCloud/1Kapso) verifican clave/remitente propios, sin red a proveedor. Fixture,privados,eventos/auditoría retirados; hashes originales idénticos,2workspaces/11mensajes/3jobs/2outbox/0cron activos preservados. Asesor0ERROR/10WARN heredados/19INFO, sumando count/findings, sin hallazgos nuevos. Next3100 restaurado inbox/flags apagados/origen vacío; ruta nueva503 comprobada.

Auto-Blindaje31: message_jobs tiene PK operation_id, no id; usar workspace_id para verificar tablas de efectos vacías. Tras fallo del smoke, conciliar evento y reutilizar occurredAt; cambiar timestamp bajo mismo ID es colisión, no retry. El ACK shadow sólo acredita captura, no recepción en bandeja, permisos ni conexión operativa. No hubo navegador ni cambios visuales; revisión interactiva del formulario30 sigue pendiente por política URL. No proveedores/modelos reales,mensajes nuevos,compras,push/merge/deploy;main intacto.

[Evidencia](evidencias/F3-INGRESO-CUENTAS-2026-10-15.json). Siguiente: verificar proveedor/callback y persistir permisos ligados a sourceRevision para adicionales; materializar sus mensajes en bandeja. Verificación/permisos/materialización legacy aún usan integración principal/callback anterior. Luego origen estable/alta/cutover/renovación y AC. F3 abierta,0/9aceptadas; rama codex/omnichannel-f3-account-ingress desde df68657.

### F3, incremento32 — verificación y permiso por cuenta, 2026-10-15

Adicionales YCloud tienen verificación GET de número/webhook con sus claves propias y callback exacto derivado del origen estable del servidor. La prueba queda en tabla privada RLS con SHA256 de identidad/credenciales/expiración, separado del sourceRevision que incluye estado. Admin verifica/muta; manager consulta; SQL revalida membresía bajo lock y rechaza fuente/respuesta antigua. Guardar proof no cambia estado ni concede permiso. Kapso muestra unsupported_provider y conserva su bloqueo.

Permiso local de texto con confirmación admin, proof completo vigente24h, callback estable y job/outbox/message/receipt delivered/read de esa cuenta. TTL limitado por prueba+24h/expiración de clave; UUID/revisión/replay no reactivan después de revocar. Cambiar/expirar clave o fallar/borrar proof invalida el grant propio. Frontera final channel_text_grant_until también comprueba procedencia/evidencia/vencimiento; ruta legacy preservada. No cambia opt-in,IA,campañas ni flags. Ajustes incluye consulta por cuenta,callback,verificador,bloqueos,checkbox y autorizar/revocar; incertidumbre conserva UUID/reintento explícito, lecturas paralelas ignoran respuestas viejas.

97 migraciones locales/Cloud alineadas;1.963 unitarias/233DB/typecheck/lint pasan.13checks DB nuevos bajo service_role y mismo probe local/PostgreSQL17 con rollback.33controles GoTrue→Next3100→PostgREST→SQL cubren origen ausente,admin,grant/revoke/replay,manager,inactivo y restauración. La prueba HTTP positiva usa proof y job/outbox/message/receipt deliberadamente ficticios; los GETs de proveedor se mockean en unitarias. No hubo comprobación/envío/modelo real. Render inicial React aprobado; no acredita interacción/responsive: bloqueo de política previo de Browser Use sigue vigente y no se intentaron rodeos.

Fixture y todo su historial/privados/auditoría retirados;0proofs/permisos managed. Hashes originales idénticos,2workspaces/11mensajes/3jobs/2outbox/0cron activos preservados. Asesor0ERROR/10WARN heredados/21INFO:dosINFO nuevos esperados por tablas privadas RLS sin políticas browser,sin grants públicos. Next3100 restaurado inbox/flags apagados/origen vacío; main intacto,sin compras/push/merge/deploy. No se repiten pruebas reales anteriores.

Auto-Blindaje32: la identidad/ruta del canal es inmutable. Fixture que intentaba quitar legacy_integration_id fue rechazado; se reconstruyó managed desde su alta, sin relajar guard. Separar fingerprint de proof y revisión de estado impide que grant→ready invalide su propia prueba. [Evidencia](evidencias/F3-PERMISOS-CUENTAS-2026-10-15.json). Siguiente: materializar adicionales en bandeja por conexión sin IA/envíos; luego origen permanente/alta/cutover/renovación y AC. F3 abierta,0/9aceptadas; rama codex/omnichannel-f3-account-permissions desde1f943e7.


### F3, incremento33 — bandeja de cuentas adicionales, 2026-10-15

Texto firmado de managed YCloud/Kapso se materializa con una RPC sólo servicio, INVOKER y search_path vacío. Captura, fuente vigente, contacto/identidad/hilo/mensaje y unread/ventana en una transacción; fallo tardío revierte todo. Requiere ambos UUID allowlists CHANNEL_ACCOUNT_INGRESS_CONNECTIONS y CHANNEL_ACCOUNT_INBOX_CONNECTIONS; vacíos apagados. Shadow31 preservado si inbox está apagada. Media sólo capturada sin descarga; receipts separados sin tocar unread. ACK materialized sólo tras guardado atómico.

Identidad conocida conserva su contacto aunque cambie contacts.phone; identidades/hilos/historial se separan por conexión. Replays no duplican ni cambian estado del operador; mismo wamid en otra cuenta es otro mensaje. No adopta legacy NULL, no convierte histórico en live, no habilita consentimiento/grants/IA/envíos. Hilos nuevos human_active/IAfalse; nueva entrada a hilo con IA activa falla. Ventana desde occurredAt. Revocación/rotación/expiración de fuente rechaza guardado.

Migración98:20261016023902_omnichannel_account_inbox.sql;98 nombres/versiones local/Cloud iguales.1.968unitarias/247DB/typecheck/lint pasan;14checks en archivo DB incluyen probe PostgreSQL17 local/Cloud con rollback.76controles HTTP/BD:54captura/invariantes,21lector productivo de bandeja/composer con sesión GoTrue/RLS/filtro por cuenta,1apagado restaurado;4checks setup aparte. Tres cuentas ficticias(2YCloud/1Kapso),mismo actor/ID→3hilos/mensajes/identidades,1contacto. No proveedor/modelo/envío real ni nueva prueba Realtime/navegador.

Fixture3301 y todos sus datos/privados/auditoría retirados con guardas. Hashes originales idénticos;2workspaces/11mensajes/3jobs/2outbox/0cron activos/0proofs-permisos managed preservados. Asesor sin novedades0ERROR/10WARN heredados/21INFO; [remediaciones](https://supabase.com/docs/guides/database/database-linter). Next3100 restaurado inbox/ambos flags por cuenta apagados/origen vacío,supervisor2040/sesión19969 efímeros. Sin compras/push/merge/deploy;main intacto.

Auto-Blindaje33: resolver identidad conocida antes del teléfono editable evita redirigir recepción. Anon recibe42501 por ACL de messages; no esperar [] ni relajar permisos. Reintentos HTTP reutilizan occurredAt persistido. [Evidencia](evidencias/F3-BANDEJA-CUENTAS-2026-10-15.json). Rama codex/omnichannel-f3-account-inbox desde5dde69a. Próximo: alta/origen permanente/cutover/renovación,verificador-permisos Kapso y AC restantes; media en bandeja/revisión interactiva de formularios pendientes. No eludir bloqueo previo del navegador ni repetir pilotos reales. F3 sigue abierta,0/9fases aceptadas.


### F3, incremento34 — verificación Kapso y renovación, 2026-10-16

Managed Kapso incorpora GETs acotados de número y webhook exactos con clave propia, sourceRevision y rol admin revalidados por SQL. Exige Meta Phone Number ID numérico/UUID de webhook por número; CONNECTED/inbound activo; kind kapso/v2 explícito/sin agrupación; evento recibido y estados sent/delivered/read/failed, callback exacto y secreto con comparación segura. Meta/v1/batch/null/propietario desconocido bloquean prueba. El callback nunca se consulta y no hay mutaciones al proveedor. Reporte existente compartido sin secretos; manager sólo lee.

Permiso local Kapso usa contrato managed vigente24h/replay/revocación/deriva ya existente. Resolver privado exige recibo y mensaje Kapso/cuenta/destinatario/wamid exactos, job/outbox texto aceptado/fence coincidente. YCloud delega a su resolver anterior; legacy preservado. Re-verificar no extiende grant previo: sólo renovación admin explícita con nueva operación; máximo proof+24h/expiración de clave. Ajustes valida UUID Kapso, explica v2/eventos/sin agrupación y muestra Renovar permiso de texto para permisos gestionados.

99 versiones/nombres local/Cloud alineados;1.974unitarias/257DB/typecheck/lint pasan.10checks DB nuevos incluyen mismo probe PostgreSQL17 local/Cloud con rollback.59controles HTTP/BD:58GoTrue→Next→PostgREST→SQL(8origen bloqueado,16grant,18renew/revoke/replay,4manager,4inactivo,8restaurado),1ingreso apagado. Evidencia positiva de proof/job/outbox/mensaje/receipt deliberadamente ficticia; GETs Kapso interceptados en unitarias,0proveedor/modelo/envío real. SSR inicial real de ambos proveedores pasa; interacción/responsive siguen pendientes por política URL previa,sin eludirla.

Fixture3401/proofs/permisos/receipt/job/outbox/mensaje/hilo/identidad/contacto/cuenta/claves/membresía/auditoría retirados con guardas. Hashes originales idénticos;2workspaces/11mensajes/3jobs/2outbox/0cron activos/0proofs-permisos managed preservados. Asesor sin novedades0ERROR/10WARN heredados/21INFO; [remediaciones](https://supabase.com/docs/guides/database/database-linter). Next3100 restaurado inbox/flags apagados/origen vacío,supervisor30020/sesión49592 efímeros. Sin compras/push/merge/deploy;main intacto.

Yani elige dashboard.pixiweb.com.ar. Preparación de origen/URLs y operación debajo; no configurado en runtime. Google/Cloudflare DoH devuelven NXDOMAIN el16/10,HTTPS no disponible. No crear un CNAME inventando destino ni sustituir dashboard original; hosting/publicación requieren revisión y autoridad específica.

Auto-Blindaje34: distinguir Meta Phone Number ID de internal_id y webhook por número del webhook de proyecto. Simular envejecimiento de proof guardado dentro de fixtures: save rechaza correctamente reportes de red mayores a2min. Jobs unknown sintéticos deben retirar resultados accepted; no relajar constraints. [Evidencia](evidencias/F3-KAPSO-VERIFICACION-2026-10-16.json). Rama codex/omnichannel-f3-kapso-verification desde dd2d58a. Próximo: prueba inicial acotada de alta managed sin SQL manual,hosting/DNS/HTTPS/cutover y AC; media/ecos managed/revisión interactiva pendientes. F3 abierta,0/9fases aceptadas.

## Alta permanente preparada — dashboard.pixiweb.com.ar

Dominio elegido expresamente por Yani el16/10/2026. Estado: preparado, no publicado. Ambas consultas DNS públicas(Google y Cloudflare DoH) devuelven NXDOMAIN; no se pudo comprobar HTTPS. Esta elección no configura registros, hosting ni webhooks.

1. **Preparar el destino.** Confirmar proyecto/host del fork y candidato revisable con las100 migraciones vigentes. Obtener del hosting el destino exacto para el registro dashboard; no inventar IP/CNAME ni cambiar el dominio raíz. Mantener separado el dashboard original. Revisar DNS, certificado HTTPS y rutas con/sin sesión antes de mover recepción.
2. **Configurar el entorno del despliegue autorizado.** NEXT_PUBLIC_APP_URL=https://dashboard.pixiweb.com.ar y CHANNEL_PUBLIC_ORIGIN=https://dashboard.pixiweb.com.ar, sin ruta/query/credenciales. Mantener vacíos CHANNEL_ACCOUNT_INGRESS_CONNECTIONS,CHANNEL_ACCOUNT_INBOX_CONNECTIONS y los cuatro CHANNEL_*_WORKSPACES de ingress/worker/human/ai. Conservar explícitamente el modo inbox del laboratorio legacy mediante su allowlist verificado; vaciar esa variable podría devolverlo al flujo legacy. El ejemplo versionado conserva valores vacíos y no modifica .env.local ni el servidor actual.
3. **Preparar el webhook por cuenta.** Cuentas managed: https://dashboard.pixiweb.com.ar/api/webhooks/whatsapp-accounts/{workspaceId}/{connectionId}. Integración YCloud principal: https://dashboard.pixiweb.com.ar/api/webhooks/ycloud?wsid={workspaceId}. No intercambiar rutas/IDs ni convertir una cuenta legacy a managed. Preservar el receptor previo y evitar dos automatismos respondiendo al mismo número. Kapso requiere webhook de número kind kapso/payload_version v2/buffer_enabled false y los cinco eventos verificados; YCloud sus dos eventos existentes. Secrets se cargan únicamente en Ajustes/servidor.
4. **Activar recepción gradualmente.** Sólo UUIDs explícitos de cuentas aprobadas en el ingreso; verificar firma/destino/evento durable sin envíos. Añadir esos mismos UUIDs a inbox para materializar texto en hilos humanos sin opt-in ni IA. ACK shadow acredita captura; ACK materialized acredita guardado, no entrega, permisos ni soporte multimedia.
5. **Resolver primera prueba de entrega y habilitación.** Una cuenta adicional nueva todavía no tiene evidencia job/outbox/mensaje/receipt entregado exigida para el grant permanente. Falta un flujo de primera prueba acotada y autorizada desde el producto, sin SQL manual ni permisos permanentes por guardar la clave. No reutilizar las autorizaciones reales consumidas del laboratorio ni usar la prueba ficticia de este incremento como entrega. Después de esa evidencia real: verificar cuenta/webhook desde Ajustes, revisar bloqueos, confirmar permiso de texto y habilitar sólo los productores/worker aprobados. Consentimiento del contacto y ventana se evalúan aparte.
6. **Renovar y retirar.** Antes de vencer, admin vuelve a verificar y después renueva con confirmación explícita. Una comprobación nueva no extiende sola el grant; caduca como máximo24h desde la prueba y antes si vence la clave. No hay cron ni renovación automática. Ante incidente, apagar flags de procesamiento/recepción nueva según alcance y revocar permiso, conservando mensajes/IDs/privados/historial. No reenviar unknown ni prometer retirar un POST ya autorizado/en curso. Mantener registro de cutover y revisión de AC antes de declarar F3 terminada.

Fuentes de contrato: [número Kapso](https://docs.kapso.ai/api/platform/v1/phone-numbers/get-phone-number), [webhook Kapso](https://docs.kapso.ai/api/platform/v1/webhooks/get-webhook). Los pasos de publicación no se ejecutaron en este bloque.

### F3, incremento35 — permiso final y origen de cada envío managed, 2026-10-16

Se corrigió un bloqueo del guard SQL final: channel_permit_until aún exigía legacy_integration_id aunque el adaptador ya resolvía credenciales managed. YCloud/Kapso adicionales ahora validan su prueba y permiso propios; la rama legacy conserva su contrato. Siguen obligatorios consentimiento/supresión, identidad/cuenta/ventana, actor/revisión, presupuesto, lease/fence y outbox durable. No se activa ningún envío por guardar o verificar una clave.

Cada job nuevo managed fija en private.channel_job_sources el fingerprint de sus credenciales/identidad/expiración y UUID del permiso original. Trigger AFTER INSERT con locks; tabla privada RLS sin acceso browser y servicio sólo SELECT/INSERT, sin UPDATE/DELETE. Sin backfill ni adopción de jobs antiguos. Rotar credenciales o renovar/revocar/recrear permiso no reactiva trabajos pendientes del origen anterior; el replay nunca los vuelve a ligar. Deben revisarse/cancelarse y crear una operación nueva si corresponde. Preview humano transitorio sin operation_id valida el permiso vigente; un job persistido exige su pin.

Migración100:20261016040458_omnichannel_managed_send_source.sql, aplicada sólo en el Supabase nuevo;100 versiones/nombres local/Cloud iguales.1.974unitarias/276DB/typecheck/lint pasan;19checks en archivo DB nuevo. Mismo probe PostgreSQL17 local/Cloud para ambos proveedores, bajo servicio y rollback.61controles HTTP/BD:60API humana autenticada→cola→worker/adaptador productivos→proveedor interceptado→finish→receipt firmado sintético→SQL y1ingreso apagado restaurado;4checks setup aparte. Se interceptaron tres POSTs(2YCloud/1Kapso): clave/remitente de cada cuenta, dedup y resultado unknown sin reenvío.0llamadas reales a proveedor/modelo. Proof/opt-in/job seed/receipt positivos son deliberadamente ficticios; no prueban un alta ni entrega reales.

Prueba extra de concurrencia no concluyente y no contada: los timestamps muestran holder04:13:18–04:13:43UTC y contender04:13:55–04:13:56UTC, sin superposición; permitted fuera del lock no acredita NOWAIT. Se concilió y retiró operación ficticia64; no se retuvo harness fallido como test aprobado. La protección secuencial contra rotación/renovación sí pasó. No hubo cambios visuales ni navegador; revisión interactiva pendiente y política URL previa respetada.

Fixtures3501/3601 y sus privados/historial/auditoría retirados con guardas. Hashes originales de mensajes/contactos/hilos/conexiones/integraciones idénticos;2workspaces/11mensajes/3jobs/2outbox/0cron activos,0pins/proofs/permisos managed. Asesor0ERROR/10WARN heredados/22INFO:un INFO nuevo esperado por tabla privada RLS sin políticas/grants browser; [remediación](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Next3100 restaurado inbox/flags apagados/origen vacío,supervisor22256/sesión59006 efímeros. No compras/push/merge/deploy;main intacto.

Auto-Blindaje35: el resolver TypeScript no reemplaza el guard SQL final; fijar fuente y permiso originales sin repin de replay. Verificar superposición temporal antes de afirmar concurrencia. Validator generado por Next tenía contenido duplicado: detener sólo supervisor propio, respaldar/regenerar/reiniciar; respaldos .ts deben terminar .ts.bak porque tsconfig incluye **/*.ts aun dentro de test-results ignorado. next-env generado restaurado y fuera del commit.

[Evidencia](evidencias/F3-ENVIO-MANAGED-2026-10-16.json). Rama codex/omnichannel-f3-managed-send-guard desde172a672. Se completó este prerrequisito de transporte, no el flujo de primera prueba desde producto: siguiente operación única autorizada con destino/texto/vencimiento acotados sin SQL manual ni consentimiento/grant permanente. Después hosting/DNS/HTTPS/cutover,media/ecos managed/revisión interactiva y AC restantes. dashboard.pixiweb.com.ar elegido; NXDOMAIN observado en34,no consultado de nuevo. F3 abierta,0/9fases aceptadas.
