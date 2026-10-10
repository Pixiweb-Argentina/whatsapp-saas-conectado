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

## Estado de las tareas

| Tarea | Estado |
|---|---|
| F3-T1.1 contratos/adaptador/política | Base local implementada y probada; validación por cuenta externa pendiente |
| F3-T1.2 resolución/dispatch | Lector de identidad/capacidades y resolver por conexión preparados; WA compatible permanece; adaptadores Meta/web pendientes |
| F3-T1.3 buffer/agente independiente de settings WA | Runtime extraído y herramientas limitadas por canal; rutinas de transportes nuevos pendientes de su pipeline durable |
| F3-T2.1 eventos/jobs/outbox y lease/fencing | SQL y captura autenticada + worker HTTP bajo flags probados local/Cloud; productor humano conectado bajo flag; contrato IA preparado; conexión al buffer, scheduler, cuotas y backoff pendientes |
| F3-T2.2 invalidación durable y revalidación inmediata | Permiso WA transaccional con grant/identidad/supresión/evento/membresía probado local/Cloud; falta integrar generación real |
| F3-T2.3 receipts/unknown/conciliación | Job → mensaje visible, resultados y recuperación unknown probados; consumidores de ecos/receipts y conciliación pendientes |
| F3-T3.1 inbox/composer omnicanal | Lectura/filtros, disponibilidad y enqueue humano probados en UI/API/Cloud; vista permanente de pendientes probada; consumo/envío externo pendiente |
| F3-T3.2 pruebas integrales | SQL/GoTrue/RLS/navegador/Realtime/toma humana pasan; cuentas y envíos de proveedores pendientes |

## Próximo paso y límites

Conectar el contrato IA preparado al buffer antes de sus modelos/herramientas, sin doble productor/envío ni ACK legacy paralelo. El productor humano ya está conectado y probado bajo flag, con toma humana, auditoría e idempotencia transaccionales. La vista persistente de pendientes ya está implementada y probada; no habilita el transporte. La captura inbound firmada y el worker HTTP ya están conectados bajo flags desactivados; falta verificar identidades/grants reales y programar el consumo al activar una cuenta de prueba. El permiso y el mensaje transaccionales ya están implementados para WA texto; templates, comentarios, Human Agent y widget siguen fallando cerrado. Luego reserva por comentario, backoff/cuotas y conciliación antes de habilitar transportes nuevos. La app local y el usuario QA ya funcionan; resta definir el acceso administrador definitivo de Yani antes de uso operativo.

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
