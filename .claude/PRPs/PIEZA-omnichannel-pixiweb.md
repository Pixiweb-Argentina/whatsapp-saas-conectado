# La Pieza: Omnichannel Pixiweb

> **Estado del alcance:** APROBADO por Yani el 2026-10-10: «apruebo el blueprint comienza».
> **Ejecución:** Build Manual; F3 en progreso. Supabase nuevo, bandeja autenticada y texto humano/IA YCloud real probados; aceptación integral y alta permanente pendientes. 0/9 fases con aceptación integral.
> **Blueprint origen:** [BLUEPRINT-omnichannel-pixiweb.md](../../BLUEPRINT-omnichannel-pixiweb.md)
> **Build Mode:** SaaS Completo — ampliación de fork existente.
> **Rama de preparación:** codex/omnichannel-preparacion, base 28a1530.
> **Rama activa F3:** codex/omnichannel-f3-account-trial, desde4840c49. Se reutiliza el worktree C:/Users/Yani Acevedo/.codex/worktrees/omnichannel-f1/app-whatsapp-saas-conectado; el nombre del directorio no indica la fase activa.

## Objetivo

Ampliar el SaaS de WhatsApp a una bandeja de WhatsApp, Instagram, Messenger y chat web con agentes, atención humana y automatizaciones comentario→guía. Integrar contactos, listas y oportunidades de Brevo en ambos sentidos y aplicar el diseño actual de Pixiweb.

## Por qué

| Problema | Resultado buscado |
|---|---|
| Conversaciones fragmentadas | Atención desde una bandeja con canal y cuenta visibles |
| Entrega manual de guías solicitadas | Una respuesta privada por comentario elegible, con trazabilidad |
| Datos comerciales desactualizados | Sincronización bidireccional con conflictos visibles |
| Ampliación de un producto operativo | Conservar WhatsApp, identidades, historial y permisos |

Impacto medible durante piloto: tiempo de atención, fallos de automatización, antigüedad de jobs y demora de sincronización. No hay resultados comerciales ni SLA cuantificados todavía.

## Qué

### Criterios de éxito

- [ ] Cumplir los AC de las 27 historias del blueprint y conservar la trazabilidad de las 14 fuentes sin TikTok.
- [ ] Preservar IDs y conteos históricos en migración ensayada, con informe de colisiones y rollback por flags.
- [ ] Probar aislamiento entre dos workspaces y conservar roles, proveedor WhatsApp activo, plantillas, supresión y handoff.
- [ ] Cada cliente conecta sus cuentas Meta; una cuenta externa no queda activa en dos workspaces.
- [ ] Comentario elegible entrega una sola guía; duplicados y timeouts ambiguos no causan reenvíos ciegos.
- [ ] Seguimiento IG/FB solo cuando la política del canal lo permite; control humano cancela IA pendiente.
- [ ] Widget limita cada visitante a su conversación; persistencia y revocación probadas.
- [ ] Brevo sincroniza contactos/listas/oportunidades sin loops, con conciliación, cuotas y conflictos explícitos.
- [ ] Verificar flujos de las 18 pantallas, teclado y responsive; diseño basado en DESIGN.md.
- [ ] Typecheck, lint, unitarias, integración, E2E y build pertinentes pasan con evidencia; pruebas reales externas se distinguen de mocks.
- [ ] Fuentes no verificadas permanecen deshabilitadas y visibles como pendientes.

### Happy path

Admin conecta Página/Instagram → manager configura post y palabra «hola» con URL HTTPS → simula y activa → comentario válido recibe una guía → destinatario responde → IA u operador continúa dentro de la ventana → contacto, lista y oportunidad sincronizan con Brevo. Un error de CRM no repite el mensaje.

## Contexto

- [Estado y continuidad](../../docs/PLAN-STATUS-omnichannel-pixiweb.md).
- [Contratos y datos](../../TECH-SPEC-omnichannel-pixiweb.md), [historias](../../USER-STORIES-omnichannel-pixiweb.md), [diseño](../../DESIGN.md).
- [Investigación y fuentes](../../docs/investigacion/RELEVAMIENTO-omnichannel-pixiweb.md), [plan de verificación](../../docs/PLAN-VERIFICACION-omnichannel-pixiweb.md).
- Código a mapear al entrar en cada fase: src/features/inbox/, automations/, settings/ y auth/; supabase/migrations/; clientes y cifrado existentes.
- Mantener Next 16, React 19, Tailwind 3.4, Supabase, Zod y AI SDK **6** del fork; no downgrade por la plantilla Forge.
- Feature-First: channels, contacts, inbox, automations, crm, widget; rutas delgadas y componentes compartidos solo donde corresponde.
- Modelo contractual: conexiones, credenciales privadas, identidades, eventos durables, jobs, reglas versionadas, sesiones widget y enlaces/conflictos CRM. El diccionario completo está en el blueprint; esta Pieza no es una migración SQL.

## Ejecución y ramas

Yani autorizó actuar proactivamente con ordenador y navegador y prohibió compras. Solicitó una rama distinta de main para cada fase o etapa importante. Modo elegido: Build Manual (El Yunque).

| Etapa | Rama prevista |
|---|---|
| Preparación | codex/omnichannel-preparacion |
| F1 | codex/omnichannel-f1-base |
| F2 | codex/omnichannel-f2-pixiweb |
| F3 | codex/omnichannel-f3-inbox |
| F4 | codex/omnichannel-f4-instagram |
| F5 | codex/omnichannel-f5-facebook |
| F6 | codex/omnichannel-f6-widget |
| F7 | codex/omnichannel-f7-brevo |
| F8 | codex/omnichannel-f8-fuentes |
| F9 | codex/omnichannel-f9-validacion |

Las ramas dependientes parten del resultado validado de la fase anterior; no necesitan integrar a main para avanzar. Registrar el commit base al abrir cada fase. No mover cambios pendientes de una fase a otra sin cerrar su registro. Preservar scaffolding y documentos untracked ya existentes. Usar checkout aislado para la implementación amplia según las reglas del proyecto, llevando únicamente archivos necesarios y revisados; no copiar secretos a Git.

## Blueprint: fases de construcción

Las 72 tareas aprobadas permanecen en el blueprint. Esta Pieza define fases; el contexto y el detalle ejecutable se refinan al entrar a cada una.

### F1 — Base compatible y contratos comprobables
**Estado:** EN_PROGRESO. **Historias:** US-001–003. **Estimación:** 5–8 días-persona.
**Objetivo:** baseline de la app, identidades sin teléfono, expansión/backfill en copia y matriz de capacidades Meta/Brevo.
**Validación:** contratos WA, conteos/IDs, dos tenants, rollback y evidencia de pruebas externas; accesos faltantes quedan pendientes.

### F2 — Sistema Pixiweb y rediseño transversal
**Estado:** EN_PROGRESO; sistema visual implementado localmente, QA autenticada pendiente. **Historias:** US-004–005. **Estimación:** 4–7 días-persona.
**Objetivo:** tokens, componentes y pantallas existentes con Manrope, Instrument Serif, piedra/violeta/lima.
**Validación:** flujos reales, estados, contraste, teclado y desktop/móvil; sin alterar permisos por estética.

### F3 — Motor de canales e inbox unificado
**Estado:** COMPLETADA el 2026-10-18 (criterios US-006–008 aprobados por Yani con los límites de docs/F3-ACEPTACION-omnichannel.md; ver registro al final). Historial: incremento37 (media entrante managed, migración102 aplicada como 20261017234022 y desplegada en 4pap5nruy; prueba real: foto en bandeja, copia a Storage falló por redirección app.kapso.ai→R2, arreglada en 6efa86e y desplegada en msosahiyq; segunda foto guardada con archivo en Storage, sin envíos ni IA) y1.992unitarias/298DB pasan; Supabase nuevo en102. Prueba única managed implementada bajo flag separado,con consentimiento por operación,sin grant permanente ni reenvío. Texto humano/IA YCloud real anterior es evidencia aparte; no se repitió. Dominio y primera cuenta Kapso managed conectados. Pendientes aplicar102/desplegar con autorización,ecos managed,QA interactiva y aceptación integral. **Historias:** US-006–008. **Estimación original:** 5–8 días-persona.
**Objetivo:** adaptadores, políticas de envío, jobs durables, identidad por cuenta y handoff compartido.
**Validación:** regresión WA, eventos duplicados, carreras humano/IA, reintentos y timeout unknown sin reenvío automático.

### F4 — Instagram y comentario→guía
**Estado:** EN EJECUCIÓN (Build Manual desde 2026-10-18, rama codex/omnichannel-f4-instagram). **Historias:** US-009–012. **Estimación:** 7–10 días-persona.
**Objetivo:** OAuth por cliente, DM, reglas versionadas, simulación y respuesta privada por comentario.
**Validación:** state/roles/activos, firma webhook, una respuesta por comentario y seguimiento solo habilitado; sandbox real documentado.

### F5 — Facebook Messenger
**Estado:** PENDIENTE. **Historias:** US-013–014. **Estimación:** 4–6 días-persona.
**Objetivo:** DM y comentarios de Página en el mismo inbox/editor.
**Validación:** scopes y políticas vigentes, private replies, dedup y desconexión de Página en cuenta de prueba.

### F6 — Widget web
**Estado:** PENDIENTE. **Historias:** US-015–016. **Estimación:** 4–6 días-persona.
**Objetivo:** loader/iframe, sitio autorizado y sesión privada con atención IA/humana.
**Validación:** embed real, persistencia, TTL/revocación, límites, origen y aislamiento entre visitantes/workspaces.

### F7 — Brevo bidireccional
**Estado:** PENDIENTE. **Historias:** US-017–021. **Estimación:** 7–10 días-persona.
**Objetivo:** conexión cifrada, contactos/listas/oportunidades y resolución de conflictos.
**Validación:** cambios en ambos sentidos, tombstones, prevención de loops, cuotas y recuperación de creación ambigua sin duplicar.

### F8 — Fuentes ampliadas
**Estado:** PENDIENTE. **Historias:** US-022–025. **Estimación:** 5–8 días-persona.
**Objetivo:** historias, enlaces y origen publicitario conforme capacidades reales.
**Validación:** payload y permisos por cada variante; no tratar clics/impresiones como consentimiento ni inventar atribución.

### F9 — Validación y preparación de lanzamiento
**Estado:** PENDIENTE. **Historias:** US-026–027. **Estimación:** 4–6 días-persona.
**Objetivo:** evidencia integral, salud, revocación, operación y rollback.
**Validación:** checks del producto, recorridos de operador/visitante, RLS, recuperación y candidato revisable. Preparado no equivale a desplegado.

Los controles de F9 se aplican durante todas las fases y antes de publicar R1, aunque F8 siga pendiente por APIs. Estimación total 45–69 días-persona, no compromiso de calendario.

## Invariantes para Lista Roja

Confirmados por Yani el 2026-10-10: «confirmo, continuar». Aplican a auth, middleware, API routes, webhooks, migraciones y archivos con service_role:

1. Aislamiento por workspace y roles actuales intactos.
2. WhatsApp, proveedor activo, plantillas, opt-out y atención humana conservados.
3. Sin pérdida de contactos, IDs, conversaciones ni mensajes.
4. Credenciales solo servidor; firmas y políticas de canal obligatorias.
5. Migraciones ensayadas en copia, backfill reanudable y rollback sin borrar historial.
6. Sin enviar mensajes reales a terceros fuera de pruebas explícitamente autorizadas.

## Gotchas

- Los puertos 3300/3301 están reservados: nunca usarlos ni detener sus procesos.
- No activar canales por tener un token: comprobar eventos, permisos y capacidades.
- No hay garantía exactly-once de un proveedor remoto; unknown exige conciliación.
- No usar email o username sin verificar como identidad para unir historiales.
- No instalar dependencias latest ni cambiar proveedor IA por la plantilla.
- No ejecutar db push/reset remoto como preparación; no compras ni habilitación de facturación.
- La evidencia documental de /plan no prueba UI, envío, migraciones ni producción.

## Auto-Blindaje

Next dev regenera next-env.d.ts apuntando a .next/dev/types/routes.d.ts. Tras el smoke test se restauró únicamente ese cambio generado, sin tocar el trabajo ajeno. No versionar diferencias de entorno como cambios funcionales.

## Avance F1 — 2026-10-10

- F1-T1.1: baseline local completado, 66 migraciones inventariadas, suite inicial 1.638/1.638; [reporte](../../docs/F1-BASELINE-omnichannel.md).
- F1-T1.2: fixtures sintéticos de ambos proveedores y 24 pruebas de contratos/preflight. Regresión completa final: 1.662/1.662. Capturas de cuenta real todavía pendientes.
- Harness Playwright: ocho pruebas públicas desktop/móvil pasan; no prueba de login autenticado.
- Contratos de conexión/evento/identidad y preflight implementados. Expansión SQL aditiva y teléfono opcional en ContactRow/UI preparados y probados localmente; no aplicados a Cloud.
- F1-T1.3/T1.4: cuentas y contratos reales Meta/Brevo pendientes.
- F1-T2.1–T2.4: tres migraciones, RLS, identidades por cuenta y backfill acotado/reanudable implementados. Ensayo local: 65 migraciones heredadas, fixtures de dos tenants, copia/restauración y 14 comprobaciones DB. Validación sobre copia de la base real y concurrencia pendiente.
- Verificación actual: 1.666 unitarias, 14 pruebas DB, 10 pruebas de navegador; typecheck, lint dirigido y build pasan. Límites y procedimiento en [reporte F1](../../docs/F1-BASELINE-omnichannel.md).
- No se habilitaron canales, no se hicieron compras, push/merge ni despliegues.

Decisión posterior de Yani: usar una cuenta Supabase nueva; las anteriores están saturadas. La pregunta db-whatsapp/db-chatfuel queda resuelta: ninguna se usará para este fork. Falta identificar/conectar el proyecto nuevo; no se modificó ningún proyecto remoto ni se habilitó facturación. F1 sigue incompleta hasta probar datos y contratos externos.

## Avance F2 — 2026-10-10

Autorizado por Yani: «dale avanza y así lo haremos, ya creé una nueva cuenta». Se avanza diseño sin simular cierre de F1. Rama propia desde 5753e34; no merge a main.

- Tokens Pixiweb, tipografías, botones/campos/cards/foco/reduced-motion y temas; COMPONENT_RULES actualizado.
- Navegación compartida en app/agencia, login editorial, inbox móvil con regreso y panel de detalle adaptable. Queries, roles y acciones de servidor conservadas.
- Cinco previews de diseño con datos ficticios y sin escrituras externas; no son los canales operativos.
- Pruebas y alcance de QA registrados en docs/F2-DISENO-omnichannel.md. Pendiente aceptación completa en sesión autenticada del Supabase nuevo.

Auto-Blindaje F2: los tokens deben seguir siendo triplets OKLCH, no hex dentro de oklch(var()). text-primary necesita violeta profundo sobre piedra; el violeta de CTA se mantiene separado. El tema oscuro requiere texto oscuro sobre lavanda. Las variables electric-lime no definidas se reemplazaron por tokens semánticos; no recrear variables HSL incompatibles.

Auto-Blindaje de este incremento: un cambio del proveedor WA no debe etiquetar mensajes nuevos con la conexión histórica. El trigger conserva esos mensajes sin mapear y el backfill rechaza historial ambiguo. Playwright transforma imports TSX como componentes de prueba: para revisar el componente real se renderiza en un proceso Node separado y se carga con los estilos de la app; esto no acredita un inbox autenticado.

## Registro de ejecución

### Avance F3 — 2026-10-10

Yani pidió continuar el build. Se registró el bloqueo de acceso al Supabase nuevo en F2 (2fea741) y se creó `codex/omnichannel-f3-inbox` desde ese commit. Se conserva la falta de aceptación Cloud de F1/F2.

Implementados contratos/adaptador de envío, política pura por cuenta y la integración del adaptador WA en dispatch. Comprobar canal evita que una conversación de Instagram con teléfono termine en WhatsApp. Timeouts/5xx/408/respuesta sin IDs quedan unknown, nunca retry automático; persiste la fila antes del POST. Regresión completa: 1.696 unitarias pasan. [Reporte F3](../../docs/F3-MOTOR-omnichannel.md).

Segundo incremento: runtime de configuración separado del buffer y herramientas restringidas por canal/capacidad tanto al preparar el modelo como al ejecutar el registry. Se conserva KB/costos/historial/reintentos. El buffer legado no procesa canales nuevos; las lecturas y derivación del decision engine ahora llevan filtro de workspace. 121 pruebas dirigidas y 1.707 unitarias completas pasan, al igual que typecheck y lint.

Tercer incremento: eventos/jobs/outbox y worker con lease/fencing, invalidación durable por cambio de control y permiso antes del POST. 1.722 unitarias y 33 DB locales pasan; typecheck/lint/build aprobados. Acceso al Supabase nuevo resuelto: 71 migraciones aplicadas, historial remoto verificado, smoke SQL con rollback y dos carreras con procesos PostgreSQL distintos. Fixtures retirados; cron heredado inactivo; sin envíos externos.

Cuarto incremento: app configurada al proyecto nuevo, login GoTrue, workspace desde UI, inbox con filtros/cursores y previews por conversación. 1.725 unitarias, 40 DB y 20 E2E públicos/diseño pasan; UI autenticada, aislamiento REST, Realtime y toma humana con cancelación durable probados. 72 migraciones Cloud aplicadas. Se conserva laboratorio sintético para revisar; credenciales solo en archivos locales ignorados.

Pendientes vigentes: conectar productores/contexto/worker y composer al inbox, reservas por comentario, backoff/cuotas y receipts/conciliación. Acceso definitivo de Yani pendiente; QA no es una cuenta operativa. No confundir soporte de código con capacidades verificadas en una cuenta externa. Continuidad y evidencia detalladas en [F3](../../docs/F3-MOTOR-omnichannel.md).

| Fecha | Acción | Evidencia |
|---|---|---|
| 2026-10-10 | Aprobación del blueprint y orden de comienzo | Mensaje de Yani; no repetir aprobación del alcance |
| 2026-10-10 | Autonomía de ordenador/navegador y prohibición de compras | Mensaje de Yani |
| 2026-10-10 | Rama por fase importante | Mensaje de Yani; preparación creada desde main 28a1530 |
| 2026-10-10 | Pieza generada desde template base | Solo documentación; modo pendiente; sin código ni migraciones modificados |
| 2026-10-10 | Lista Roja confirmada; F1 local ampliada | 1.666 unitarias, 14 DB, 10 navegador y build pasan; Cloud pendiente |

Auto-Blindaje F3: Playwright limpia outputDir al iniciar; usar test-results/playwright para no borrar ledgers Cloud/capturas manuales. Los cierres Auth del smoke deben usar scope local para preservar el navegador de QA.

Séptimo incremento: recepción firmada YCloud/Kapso conectada al registro durable y worker HTTP autenticado bajo flags independientes, desactivados por defecto. No hay scheduler ni productor doble; generación IA y envío humano siguen legacy. Fixture Cloud sintético de captura/dedup y worker vacío retirado sin envíos. Evidencia y validaciones: [F3 recepción](../../docs/evidencias/F3-INGRESS-2026-10-10.json).

**Próximo paso vigente (reemplaza los anteriores):** integrar productor humano/composer y luego IA con idempotencia, toma humana y flags, verificar identidades/grants y completar conciliación/reservas/cuotas. App, login QA y Supabase ya funcionan; no recrear accesos ni pedir aprobación de blueprint/Manual/Lista Roja. No activar transportes ni scheduler hasta validar una cuenta de prueba. F3 continúa sin aceptación integral.

Octavo incremento: envío humano del composer a cola con UUID estable por intento, sesión/rol servidor, toma humana y auditoría atómicas, idempotencia y separación de modos sin fallback. UI/API/Supabase real probados con fixture sintético y sin transporte; interruptor IA sincronizado al refresh. 1.782 unitarias y 72 DB pasan. Dos migraciones nuevas, total 76. Evidencia: [F3 humano](../../docs/evidencias/F3-HUMANO-2026-10-10.json).

**Próximo paso vigente:** generación IA a cola sin doble envío; vista permanente de pendientes; verificación real de cuentas y conciliación/reservas/cuotas. Productor humano ya conectado, flags apagados; fixture temporal retirado. F3 continúa sin aceptación integral.

Noveno incremento: vista persistente y acotada de cola para miembros activos, sin conceder lectura de tablas internas. Estado antes del permiso separado de mensajes; transición sin duplicados, actualización mientras hay pendientes y recarga comprobadas en desktop/móvil. 1.785 unitarias y 75 DB pasan; GoTrue/RPC real y revocación de membresía probados; 77 migraciones Cloud. Fixture retirado, flags apagados y ningún transporte invocado. Evidencia: [F3 cola](../../docs/evidencias/F3-COLA-2026-10-10.json).

**Próximo paso vigente:** productor IA desde batch con modo fijado, revisión y evidencia anteriores al modelo; checkpoint/idempotencia y handoff sin despacho legacy doble. Vista de pendientes ya implementada. Restan verificación de cuentas y conciliación/reservas/cuotas; F3 sin aceptación integral.


Décimo incremento: contrato IA privado y transaccional preparado; batch fija modo/cuenta/identidad/revisión/evento antes del modelo, y conserva texto/operación en enqueue/reintentos. Control humano invalidado incluso tras resume; acceso sólo servicio. 1.793 unitarias, 83 DB y nueve controles GoTrue/RPC real pasan. Migración 78 aplicada; fixture 993 limpiado. [Evidencia](../../docs/evidencias/F3-IA-PREPARACION-2026-10-10.json).

**Próximo paso vigente:** conectar el productor al buffer antes de decide/Jev/modelo; recuperar texto/estado sin regenerar o despachar legacy. Cubrir handoff/ack, herramientas n8n y Setter antes del rollout. La preparación es infraestructura interna, no generación real conectada. Flags apagados, cero outbox/cron; sin compras/envíos/push/merge/deploy. F3 sin aceptación integral.

Auto-Blindaje: los fixtures también cumplen las invariantes del esquema. Revocar una conexión requiere revoked_at; para ensayar ausencia de evidencia en batch quitar batch_id, no cambiar wamid de una identidad ya vinculada (el trigger lo rechaza). El test DB se separó para conservar archivos menores de 500 líneas.

Undécimo incremento: IA de texto conectada al buffer antes de decisiones/modelos, con recuperación de texto/job privado y sin fallback legacy. Handoff interno atómico espera operaciones pendientes; no cancela el mensaje ni manda ACK al contacto. Jev persiste la intención antes de sus efectos. Herramientas externas/n8n, Setter y autoetiquetado deshabilitados en el piloto de cola; legacy sin cambios. 1.814 unitarias, 87 DB, typecheck/lint/build y ocho controles API Next/Supabase pasan. Handoff unknown simulado es idempotente. Migración 79 aplicada, fixture 994 retirado. [Evidencia](../../docs/evidencias/F3-IA-BUFFER-2026-10-10.json).

**Próximo paso vigente:** cuentas/identidades/grants reales; receipts/ecos/conciliación, cuotas/backoff y reserva por comentario. Extender herramientas sólo con contratos durables. La generación nueva usa mocks en pruebas; Cloud probó recuperación, no LLM/entrega real. Flags apagados, cero outbox/cron, sin compras/envíos/push/merge/deploy. F3 sin aceptación integral.

Auto-Blindaje: message_batches.meta es modificable por el cliente y nunca es autoridad para el texto outbound en modo queue. El checkpoint está en private.ai_reply_preparations. Una decisión de handoff debe persistir antes de efectos/etapas; no cerrar el batch si hay una operación pendiente y la transición devuelve settled=false.

Duodécimo incremento: comprobantes YCloud/Kapso firmados y privados, correlación por cuenta/IDs y externalId YCloud, conciliación sin reenvío ni IA. Mensaje/job/outbox transaccionales, fence, dedup y estados monotónicos; worker recupera comprobantes tempranos. Legacy excluye mensajes de la cola. 1.825 unitarias, 95 DB, typecheck/lint/build, diez controles HTTP Next/Supabase y lectura en navegador pasan. Migración 80 aplicada; fixture 995 retirado y workspace habitual restaurado. [Evidencia](../../docs/evidencias/F3-RECEIPTS-2026-10-10.json).

**Próximo paso vigente:** ecos humanos de WhatsApp Business durables, cuentas/identidades/grants reales, cuotas/backoff y reservas por comentario. Unknown sin IDs/referencia continúa incierto; no hay polling remoto. Flags apagados, cero receipts/preparaciones/outbox/cron y cinco mensajes QA anteriores; sin compras/envíos/push/merge/deploy. F3 sin aceptación integral; Meta/widget/Brevo pendientes.

Auto-Blindaje: fixtures respetan una integración WA activa por workspace, alternando proveedores antes del permiso. Recuperación de receipts separada de ingress para evitar ciclo job-store → receipt-store → ingress → job-store. Legacy no actualiza mensajes con channel_operation_id.

Decimotercer incremento: mensajes de WhatsApp Business recibidos por Kapso guardan ledger/historial/pausa/auditoría en una transacción, dedup exacta e identidad por conexión; no extienden ventana ni opt-in. Controles con timestamp del servidor preservan resume frente a replays/eventos antiguos; sending no se cancela. UI muestra WhatsApp Business. 1.836 unitarias, 105 DB, typecheck/lint/build, catorce controles HTTP/Cloud y navegador pasan. Migración 81 aplicada, fixture 996 retirado. [Evidencia](../../docs/evidencias/F3-BUSINESS-APP-2026-10-10.json).

**Próximo paso vigente:** cuotas/backoff y reintentos seguros; tipos/políticas pendientes, reserva por comentario, cuentas/grants y pruebas integrales reales. Ecos sin teléfono/BSUID y controles previos a la migración no se reconstruyen. Flags apagados, cinco mensajes QA y cero echoes/receipts/preparaciones/outbox/cron. F3 sin aceptación integral; sin compras/envíos/modelos/push/merge/deploy.

Auto-Blindaje: routing de conexión inmutable; preparar otro proveedor antes del fixture/migración o crear otra conexión. Un insert legacy seguido de una pausa no transaccional puede dejar IA activa y el dedup impedir su reparación. Echo piloto usa una RPC y nunca cae al segundo escritor si falla.


Decimocuarto incremento: cuotas operativas por workspace/conexión, espera durable sin permiso, backoff/jitter y Retry-After para rechazos confirmados. Un solo mensaje/operación, outbox por fence; pausa humana y política se vuelven a validar. Unknown/timeout/5xx no se reenvían; comprobante contradictorio por operación suspende retry. 1.842 unitarias, 118 DB, typecheck/lint/build y concurrencia HTTP/Cloud con cupo 1 pasan. Navegador verifica una fila tras dos intentos y cola separada; sin proveedor/modelo. Migración 82 aplicada, fixture 997 retirado. [Evidencia](../../docs/evidencias/F3-LIMITES-2026-10-10.json).

**Próximo paso vigente:** tipos/políticas y reserva por comentario; cuentas/grants reales y prueba integral. Los límites 60/workspace y 30/conexión por minuto son defaults internos del piloto, no cuotas certificadas del proveedor. No afectan el despacho legacy. Flags apagados, cinco mensajes QA, cero tablas privadas nuevas/outbox/cron. F3 sigue sin aceptación integral; sin compras/envíos/modelos/push/merge/deploy.

Auto-Blindaje: separar diagnostic del resultado durable estricto en el resolver WA; conservar el diagnóstico del dispatch compatible. Reintento visible usa el mismo channel_operation_id y no crea otra burbuja/permiso previo. Evitar parameter properties en clases TS ejecutadas con Node strip-types y admitir ausencia de Retry-After en errores legacy/mocks.


Decimoquinto incremento: evidencia privada de comentario y reserva por cuenta/comentario/operación, atómica con enqueue. UUID de evento distinto del ID Meta; aprobación de plantilla ligada al idioma. Respuesta pública independiente; cancelar/unknown/outbox no libera reserva. 1.852 unitarias, 137 DB completas, 106 dirigidas finales, typecheck/lint/build y productor/concurrencia HTTP Cloud pasan. Permiso y transporte Meta permanecen apagados; prueba sintética, no entrega externa. Migración 83 aplicada; fixture 998 retirado, cinco mensajes QA conservados. [Evidencia](../../docs/evidencias/F3-RESERVAS-2026-10-10.json).

**Próximo paso vigente:** cuentas/identidades/grants reales y recorrido integral de F3. Tres de cuatro bloques técnicos de cierre cubiertos (ecos, cuotas, políticas/reservas); F3 sigue sin aceptación integral, 0/9 fases. F4/F5 verificarán comentarios/ventanas y crearán onboarding/editor/transportes/materialización de conversación. Templates/Human Agent/widget conservan contratos sin permisos persistidos activos. Flags/scheduler apagados; sin compras/envíos/modelos/push/merge/deploy.

Auto-Blindaje: separar event UUID de externalCommentId. No liberar reservas por cancelación/TTL/unknown. Ante contención antes de enqueue, releer contexto y conservar operación; el código de error puede variar por lock. Pruebas SQL: placeholder UUID explícito antes de convertir a text para JSON. La reserva prueba exclusividad, no recepción ni entrega real de Meta.


Decimosexto incremento: preflight CLI de sólo lectura, acotado y sin secretos/POST/modelos. 1.860 unitarias completas, ocho dirigidas finales, typecheck/lint y consulta real Supabase pasan; API autenticada sigue rechazando con 422 sin insertar mensajes. 83 migraciones; no SQL nuevo. Estado observado: dos conexiones QA connecting, cero WA activa/ready/grants/identidades/transporte/evidencia; cuatro flags apagados. [Evidencia](../../docs/evidencias/F3-PREFLIGHT-2026-10-10.json).

**Próximo paso vigente:** Yani define Kapso/YCloud/cuenta de prueba aún no disponible; completar configuración/validación del activo y recepción firmada HTTPS, identidad/grants y recorrido real con destinos autorizados. Supabase está conectado; lo pendiente es la cuenta WhatsApp. Tres de cuatro bloques de cierre cubiertos; F3 sigue abierta y 0/9 fases aceptadas. Preflight no activa ni autoriza, guardar/probar API key no promueve cuentas a ready. Flags/scheduler apagados, datos QA intactos. Sin compras/envíos/modelos/push/merge/deploy.

Auto-Blindaje: coverage complete del preflight sólo indica inspección completa. Mantener el opt-in requerido del piloto y la supresión separados de la semántica legacy de free reply. Shadow ingress comparte ruta con legacy; controlar sus efectos antes del tráfico real. No confundir prueba de API key con validación completa de un canal.

**Decisión posterior de Yani:** «lo haremos mañana con otro número». Se difiere el piloto real y se elige un número dedicado distinto del Kapso operativo del dashboard original. Confirmar su conexión a Kapso al retomar; no tocar webhook/credenciales del original. Preparar aislamiento del recorrido legacy, callback HTTPS firmado e identidad/grants antes de recibir tráfico; acordar destinatarios/mensajes antes de enviar. No hay recordatorio ni ejecución automática, nueva cuenta configurada o permisos de envío implícitos. F3 sigue abierta, tres de cuatro bloques de cierre.

**Retomada 2026-10-14:** Yani elige número dedicado con **YCloud primero**. Laboratorio anterior del fork tiene Kapso activo guardado; se preserva y no se cambia su proveedor. Nuevo workspace creado desde Agency, sin cuenta Auth ni email: `ff50ed19-6330-43c1-a69d-32252c9ca756`, Laboratorio F3 · YCloud dedicado. Preflight real: cero conexiones, cuatro flags apagados, externalValidation pending. Ajustes → Integraciones abierto con YCloud y campos vacíos; Guardar deshabilitado. Pendiente: número conectado al proveedor, API Key en formulario y prueba de acceso; luego endpoint HTTPS/secret, control legacy e identidad/grants antes de mensajes autorizados. Dos workspaces visibles, Kapso anterior y conversaciones preservados. No webhook/credencial YCloud guardados, proveedor/modelo/envíos/compras/push/merge/deploy. Detalle vigente en docs/PLAN-STATUS-omnichannel-pixiweb.md; no repetir las suposiciones históricas de un único workspace/sin integraciones.

**Incremento 17, 2026-10-14:** nueva rama codex/omnichannel-f3-ycloud-pilot. API Key aceptada (usuario/HTTP 200), modo YCloud de verificación sin persistencia/CRM/medios/IA/envíos, puente 3104 restringido por ruta/workspace/body/presupuesto y bloqueo contra caída a legacy aun al retirar el flag entre health y POST. HTTPS temporal sobre puente, dashboard inaccesible. 1.865 unitarias/27 dirigidas, typecheck/lint y HTTP de rechazo pasan. Cuatro rollout flags apagados, cero conexiones durable del piloto. Yani autoriza crear segundo webhook; ID 6acfef56108a835e37b5c86d, Inactive, dos eventos WhatsApp. Original sigue Active. Cuenta Free, un número observado; webhook general es global, Custom apps requiere pago y no se contrató. Pendiente copiar secreto nuevo en formulario, reingresar draft perdido por reinicio y guardar; luego nueva activación/prueba firmada sin WhatsApp real. No ready/grants/identidad/aceptación de F3. Detalle/evidencia en docs/PLAN-STATUS-omnichannel-pixiweb.md y docs/evidencias/F3-YCLOUD-VERIFICACION-2026-10-14.json. Túnel/sesiones efímeros en test-results/f3-ycloud-runtime.json, nunca secretos en chat/Git. Sin compras/envíos/modelos/push/merge/deploy de producción. Auto-Blindaje: preparar runtime antes del ingreso de secretos y no perder borradores; reconciliar endpoint por ID antes de repetir creación.

**Guardado verificado 2026-10-14:** Yani «listo»; integración YCloud enabled, claves cifradas y aviso handoff apagado. Endpoint nuevo observado Active, original intacto. GET del proveedor confirma endpoint/URL/events/secreto igual y único número CONNECTED coincidente; valores no impresos. Prueba local sintética firmada → HTTPS → 200/accountMatched, sin filas nuevas en siete tablas del laboratorio. No equivale a webhook real de YCloud; logs de nuevo endpoint aún cero. Evidencia F3-YCLOUD-CONECTADO-2026-10-14.json. Código sin cambios; checks previos reutilizados. Próximo: Yani envía «hola prueba F3» desde otro número propio al dedicado y avisa «enviado» para verificar recepción sólo; fork no contestará. Original puede procesar de forma independiente: detener si contesta y resolver propiedad antes de respuestas. Sin conexión durable/identidad/grants/aceptación F3 ni envíos/modelos/compras/push/merge/deploy.

**Recepción real, 2026-10-14:** Yani «enviado». Log del endpoint nuevo confirma una entrega YCloud de whatsapp.inbound_message.received, evt_6acff36a8c323a69db3d3cde, a 18:26:02 Argentina; texto de prueba coincide ignorando mayúsculas. HTTP 200/verificationOnly/accountMatched, firma/cuenta comprobadas. Relay matched=2 incluye la sintética previa; no cuenta mensajes únicos. Siete tablas del laboratorio permanecen en cero, sin IA/CRM/envío del fork; efectos del original no auditados. Evidencia F3-YCLOUD-RECEPCION-REAL-2026-10-14.json. Próximo: almacenamiento durable/identidad/conversación en inbox, luego respuesta humana concreta para aprobar destino/texto y recorrido integral. Mantener límites de la prueba sólo recepción hasta ampliar esa etapa; no cerrar F3 ni habilitar flags/IA/envíos por inferencia. Código sin cambios, checks vigentes. Runtime temporal activo, verificar URL/sesiones al retomar.

### F3, incremento 18 — YCloud a bandeja, 2026-10-14

Rama codex/omnichannel-f3-ycloud-inbox desde b5af8d1. Materialización de texto YCloud transaccional y sólo recepción, con firma/cuenta exacta y RPC restringida a servicio. Migración84 aplicada; versiones locales/Cloud alineadas. Un mensaje real previamente verificado importado como histórico, deduplicado con dos RPC simultáneas. Conversación human_active/IA apagada; conexión needs_permissions/grants vacíos, identidad aún sin verificar. Consentimiento nuevo false, existente y supresión preservados; conflicto de cuenta/conversación legacy se rechaza sin adopción. No se modifica la restricción legacy de una conversación por contacto/canal.

Bandeja QA y recarga muestran «Hola prueba F3» y borrador interno guardado, sin envío. Un contacto/identidad/conversación/inbound histórico/nota, cero jobs/outbox/outbound de cliente. 1.868 unitarias,144 DB,seis relay,typecheck/lint pasan. RPC Cloud sólo servicio; asesores cero ERROR/diez WARN heredados. HTTP público401 ante firma inválida y404 para dashboard. Cuatro flags normales apagados; modo inbox sólo en proceso/workspace dedicado. UI local usar localhost3100. Detalle, límites, Auto-Blindaje y próximo paso en [continuidad](../../docs/PLAN-STATUS-omnichannel-pixiweb.md); evidencia F3-YCLOUD-INBOX-2026-10-14.json. Próximo: mensaje nuevo «Hola bandeja F3» enviado por Yani para comprobar guardado directo. Luego permisos reales y envío humano expresamente autorizado. F3 sigue abierta; no IA/envíos/compras/push/merge/deploy.
### Recepción YCloud directa — 2026-10-14

Yani «Enviado»: «Hola bandeja F3» se guarda live en la misma conversación desde el reintento real de YCloud a19:11:58 Argentina, HTTP200/recorded=true, después de tres fallos sin filas parciales. Un contacto/identidad/conversación, dos inbound (uno histórico), una nota; identidad verificada, IA apagada y cero envíos/jobs/outbox. Sin grants/ready/consentimiento por inferencia. Ajuste de receivedAt local limitado a5s y reloj de BD, occurredAt del proveedor sigue estricto; migración85 aplicada y versiones alineadas.145 DB,25 unitarias dirigidas,typecheck/lint pasan; asesores cero ERROR/diez WARN heredados. Recepción exitosa ocurrió antes del ajuste; relecturas RPC deduplican, no son nueva entrega del proveedor. Detalle/Auto-Blindaje en continuidad y F3-YCLOUD-INBOX-LIVE-2026-10-14.json. Próximo: permisos/evidencia y envío humano específicamente autorizado; F3 sigue abierta. Sin IA/envíos/compras/push/merge/deploy.

### F3, incremento 19 — receipts sin abrir IA, 2026-10-14

Rama codex/omnichannel-f3-ycloud-receipts desde1da1062. Estados firmados del piloto persisten/concilián por cuenta y operación exactas en modo inbox, sin ingress normal ni writer legacy; verify continúa sin escrituras. Relay distingue comprobante de nuevo inbound.1.874 unitarias,7 relay,115 DB dirigidas,typecheck/lint pasan; SQL Cloud sintético revertido y tres rechazos HTTP reales sin filas nuevas. No acredita entrega externa nueva; se conservan2 inbound/1nota y0outbound/jobs/outbox/receipts. Cuenta YCloud/endpoint nuevo verificados por GET, conexión sigue needs_permissions/grants vacíos/opt_in=false.85 migraciones sin cambios.

Next3100 reiniciado en modo inbox; túnel anterior no disponible, relay/túnel sin ejecutar. Restaurar callback nuevo antes de tráfico real. Yani no comprobó si el original respondió; no se tocó. Respuesta humana propuesta y ventana/destino/permisos pendientes detallados en continuidad; no envío ni consentimiento por inferencia. Los seis branches previos ya están en origin, este incremento todavía es local. F3 abierta,0/9 aceptadas. [Evidencia](../../docs/evidencias/F3-YCLOUD-RECEIPTS-PILOTO-2026-10-14.json).

Receptor restablecido después: Next81519/relay59493/túnel67399; PATCH único al endpoint nuevo y GET confirma URL activa, mismos eventos/secreto. HTTPS/settings404 y firma inválida401; original sin lectura/mutación, sin mensajes/modelos. Callback efímero en runtime ignorado.18f1e33 es el commit del incremento; rama local, F3 pendiente de envío humano autorizado y permisos.

### F3, incremento 20 — respuesta humana entregada, 2026-10-15

Yani autoriza una única respuesta y consentimiento temporal. Rama codex/omnichannel-f3-ycloud-human. Cuenta CONNECTED, API key de cuenta, identidad live, ventana/supresión y endpoint revalidados. Permiso de texto diez minutos sólo para piloto y consentimiento auditados; API Next autenticada encola202 una operación humana. El core productivo del worker se ejecuta una vez desde runner acotado, no por cron: un POST a YCloud, una fila de mensaje/job/outbox. GET exacto del proveedor confirma delivered a07:18:56 Argentina. El receipt sent se guardó/conciliò por webhook; delivered llegó firmado pero fue ignorado200. Se recuperó del log real previamente verificado, corroborado por GET exacto y con mismo eventId, sin firma sintética ni reenvío. Es recuperación del operador, no una nueva entrega webhook posterior al fix.

Fix: comprobante válido hasta5s en el futuro pide retry500 antes de escribir; más allá de5s o malformado sigue ignorado. No se persiste hora futura ni se amplía permiso. Desfase inferido, delta no medido.1.877 unitarias completas/38 dirigidas,typecheck/lint pasan; HTTP Next sintético con+4s devuelve500/CLOCK_SKEW. SQL sin cambios,85 migraciones. Browser muestra respuesta única con atribución humana e icono Entregado; composer vuelve a estar bloqueado. Consentimiento/opt_in_at y grant retirados, status needs_permissions, IA y cuatro flags normales apagados. Next19601/relay59493/túnel67399; original intacto. F3 continúa abierta: IA real/handoff/recuperación integral y onboarding permanente pendientes.0/9 fases aceptadas. [Evidencia](../../docs/evidencias/F3-YCLOUD-RESPUESTA-HUMANA-2026-10-15.json).

### F3, incremento 21 — entrada YCloud transaccional al buffer, 2026-10-15

Rama codex/omnichannel-f3-ycloud-pipeline desde c357501. Modo pipeline acotado/excluyente, sin activar en laboratorio. El receptor inbox no cubría conversaciones IA y el camino legacy tiene reglas distintas de consentimiento/dedup; se incorpora materialización + preparación queue fijada antes del consumo, en una transacción. Nuevas conversaciones humanas, sin consentimiento/grants inferidos. Tres flags y elegibilidad DB para buffer; ráfagas aisladas por revisión, sin adoptar legacy ni responder retroactivamente a replays/pausas. Fallo de preparación revierte todos los artefactos. No despacho de modelo/worker/proveedor en webhook.

Migración86 aplicada una vez y versiones alineadas; cuatro funciones invoker sólo servicio. 1.886 unitarias completas,156 DB,ocho relay,typecheck/lint pasan. SQL Cloud sintético prueba recepción/burst/checkpoint/enqueue único/toma humana/handoff, revierte fixture y cero outbox. Asesor sin hallazgos nuevos,0ERROR/10WARN heredados/17INFO. Laboratorio conserva cuatro mensajes (dos inbound/nota/única respuesta delivered),1job/1outbox accepted,0batches/cron; IA/flags/pipeline apagados, consentimiento/grant retirados. GET Next3100 inboxOnly y preflight completo sin efectos. HTTPS efímero no revalidado; sin tocar proveedor/original/credenciales ni enviar/modelos/comprar/push/merge/deploy. [Evidencia](../../docs/evidencias/F3-YCLOUD-PIPELINE-2026-10-15.json).

**Próximo vigente:** preparar y autorizar prueba real acotada de IA: entrada→buffer→generación→cola→comprobante y toma humana/recuperación. Autorización anterior consumida en una respuesta humana. Onboarding permanente y multi-cuenta legacy pendientes; F3 sigue abierta,0/9 fases aceptadas. No reabrir blueprint/Manual/Lista Roja. Auto-Blindaje: fijar modo al crear batch evita fallback si cambian flags antes de consumir; replays no cambian autoridad ni crean respuestas retrospectivas. Sumar findings/count del asesor, no categorías agrupadas.

Preparación IA real 2026-10-15: rama codex/omnichannel-f3-ai-pilot. No hay integración OpenRouter ni clave general local. UI Integraciones→OpenRouter abierta con API Key vacía; esperando ingreso de Yani o alternativa gratuita. Valor inicial visual Sonnet4.6 no está guardado. Sin modelo/envío/compra/grants/flags ni SQL nuevo. Antes de ejecutar: prompt de laboratorio, límite de llamadas/costo, claim exacto sin batches ajenos y autorización de respuesta/consentimiento temporal; runner aún pendiente. Detalle vigente en continuidad. Checks completos del incremento21 reutilizados,86 migraciones,F3 abierta.

### F3, incremento22 — prueba IA preparada,2026-10-15

Yani guardó OpenRouter: GETkey200, GPT-4.1 y fallback Gemini3.5Flash listados; cero generación/envío. Consumer opcional por workspace/batch exactos, sin scanner global/fallback; migración87 aplicada invoker sólo servicio.1.892 unitarias,159DB,siete guardas de red,typecheck/lint y Cloud rollback pasan. Asesor0ERROR/10WARN heredados/17INFO. Runner privado preparado sin activar: una generación128tokens/una respuesta exacta al número propio, contador persistido, sin herramientas/CRM/Jev/embeddings/campañas. Consentimiento/grant temporales y restauración condicionada preparados, no ejecutados. Laboratorio sigue humano/IA-flagspipeline apagados/grants vacíos/opt_in false/cuatro mensajes/cero batches. Próximo: autorización concreta, luego activar y probar/restaurar; aprobación humana anterior consumida. Detalle y comandos operativos en continuidad; evidencia F3-IA-PILOTO-PREPARADO-2026-10-15.json. No compras/push/merge/deploy; F3 abierta. Auto-Blindaje: --use-system-ca mantiene TLS; igualdad JSON estructural y revisión persistida antes de activación; claim secuencial requiere cerrar lote anterior.

### F3, incremento23 — respuesta IA real entregada,2026-10-15

Yani autoriza una consulta GPT4.1 y una respuesta exacta al número propio, consentimiento/grant temporales10min. Recibe «Hola IA F3» por webhook real firmado, materialización/batchqueue de un mensaje; consumidor exacto genera una vez (714tokensentrada/21salida), checkpoint/job único. Core worker una vez, un POST YCloud/attempts1/fence1/mensaje/outbox; GET confirma delivered11:10:16Argentina. Sent/delivered se persistieron/conciliaron automáticamente, sin importación. Bandeja muestra atribución IA/Entregado; captura sin teléfonos ignorada en test-results/f3-ai-delivered-2026-10-15.jpg. Operación a6aa9e6c-6fed-43ba-9173-930453a7f13c, mensaje52195406-f2ca-4dbd-8d07-d05a1ebd36bc. No cron/herramientas/CRM/Jev/Setter/embeddings/campañas/compras.

Restore y relectura exacta confirman consentimiento false/opt_in_atnull/grantsvacíos/needs_permissions/human_active/IAfalse/prompt-agente originales. Supervisor de Next detecta restored y reinicia en inbox con flags vacíos; fallback por expiración no necesario. Preflight sideEffectsfalse. Replay del lote procesado processedfalse, preparación siguequeue/eligiblefalse/checkpoint; enqueue recupera duplicateaccepted sin otrojob/envío/modelo. Autorización consumida. Seis mensajes totales (3inbound/nota/humana/IA),2jobs/2outbox accepted,1batchprocessed,0cron. No DDL/producto nuevo;87 migraciones y checks completos previos reutilizados (1892unit/159DB/7guardas). [Evidencia](../../docs/evidencias/F3-IA-ENTREGADA-2026-10-15.json). Estado detallado y runtime efímero en continuidad (Next3525/relay56796/túnel67399).

**Próximo vigente:** cierre formal de AC de F3, conexión/grants permanentes y multi-cuenta legacy; la prueba WA humano/IA ya está acreditada. Carreras durante generación y unknown no se indujeron en este mensaje; conservar evidencia sintética previa y demostrar control humano con fixtures. F3 abierta/0de9 aceptadas, F4–F9 pendientes. Sin push/merge/deploy; no repetir pruebas reales/modelos sin nueva autorización. Auto-Blindaje: respetar flush_at, restaurar baseline/flags además de grant y distinguir accepted/entregado con receipt/GET reales.

### F3, incremento24 — revisión de aceptación y filtros,2026-10-15

US-006 AC1 ampliado: asignación por sesión en DB antes de paginar, seis estados visibles, filtros persistidos al navegar; canal/cuenta en fila e hilo con fallback inequívoco. Flex/ScrollArea corregidos para no ocultar controles al cargar el último mensaje. Migración88 invoker/RLS y RPC compatible;1.895 unitarias/162DB/typecheck/lint/dos renders y recorrido real375/1440px pasan. SQL Cloud60 conversaciones/revocación/tenant ajeno con rollback; asesor0ERROR/10WARN heredados/17INFO. Dos workspaces,seis mensajes/dos jobs/cero cron conservados. Sin modelo/proveedor/grants/activación adicional. Rama codex/omnichannel-f3-acceptance; main intacto y sin push/merge/deploy.

[Matriz vigente de los nueve AC](../../docs/F3-MOTOR-omnichannel.md#matriz-de-aceptación-f3--2026-10-15) y [evidencia](../../docs/evidencias/F3-INBOX-ASIGNACION-2026-10-15.json). Próximo: mismo contacto en varias cuentas, alta/grants permanentes y demostración sintética de toma humana durante generación. La prueba real de IA ya no bloquea. F3 abierta,0/9 fases aceptadas. No repetir blueprint/Manual/Lista Roja ni consumos reales autorizados una sola vez.

### F3, incremento25 — unicidad y resolución por cuenta,2026-10-15

Mismo contacto admite hilos explícitos por cuenta; NULL legacy único no se mezcla con vinculados. Inbox/pipeline fijan cuenta/identidad; legacy resuelve integración/activo y contacto/conversación en transacción. Ecos/automatizaciones/dispatch no eligen cuenta ambigua ni cola por fallback. Migración89 invoker en RPC pública y trigger privado acotado;1.905 unitarias/170DB/typecheck/lint/Cloud SQL pasan. Concurrencia real en2procesos crea un único hiloB con cuentaA intacta; cron efímero retirado. UI autenticada con mismo contacto ficticio y dos hilos/cuentas/estados/historias,fixture eliminado. Hashes de todos los datos anteriores intactos; dos workspaces/cero cron activos.89 versiones alineadas y asesor0ERROR/10WARN heredados/17INFO. Una navegación20s terminó200; rendimiento no certificado.

[Evidencia](../../docs/evidencias/F3-MULTICUENTA-2026-10-15.json), límites y matriz en F3-MOTOR/continuidad. Rama codex/omnichannel-f3-multiaccount; main intacto,sin push/merge/deploy. Alta/grants permanentes y demostración sintética de toma humana durante generación siguen. Integración multicuenta real y dedup global de wamid no resueltos por esta migración. F3 abierta,0/9 aceptadas; nuevas pruebas reales requieren autorización específica.


### F3, incremento26 — alta verificable sin scripts del operador, 2026-10-15

Ajustes permite al admin verificar credenciales guardadas,número y webhook con GETs acotados a YCloud. Manager lee evidencia saneada; no ve secretos ni otras cuentas. Migración90 guarda reporte privado RLS con fingerprint/frescura24h, revalida rol/fuente en transacción y evita sobreescribir resultados nuevos. La UI conserva comprobación y avisa desactualización/túnel temporal. Seis checks reales pasan, sin conceder envíos ni alterar grants/consentimiento/status/flags.1.914 unitarias/176DB,typecheck/lint,ACL/deriva SQL Cloud y UI móvil/escritorio pasan.90 migraciones alineadas;datos previos idénticos. [Evidencia](../../docs/evidencias/F3-ALTA-YCLOUD-2026-10-15.json). Emisión/revocación de permisos permanentes,publicación estable y carrera integrada humano/IA siguen pendientes; F3 abierta,0/9 aceptadas. No repetir pruebas reales sin nueva autorización. Sin push/merge/deploy;main intacto.


### F3, incremento27 — permiso de texto con vencimiento y revocación

UI y RPC para admin explícito, manager lector, prueba de entrega/fuente/origen de servidor, TTL24h ligado a verificación, renovación manual y registro privado. Cambios de integración/verificación invalidan sólo permisos gestionados; replay no reactiva un grant revocado. No activa transporte/IA/opt-in ni reemplaza legacy. Fixture UI autoriza→persiste→revoca, luego retirado; laboratorio real sin permisos/origen estable, flags apagados. 1.922 unitarias/188DB/typecheck/lint;92 migraciones alineadas y datos originales idénticos. Error previo de tipos exportados como server actions corregido en4797a0c y recorrido Ajustes/Automatizaciones probado. [Evidencia](../../docs/evidencias/F3-PERMISOS-YCLOUD-2026-10-15.json). Próximo carrera integrada humano/IA/AC; publicación estable y renovación operativa pendientes. F3 abierta,0/9 aceptadas;main intacto,sin push/merge/deploy.

### F3, incremento28 — carrera integrada de toma humana durante generación

Control de generación diferida con promesa, sin red; intake/claim/buffer/decisión/applyTransition/checkpoint/enqueue/handoff y drain reales sobre PostgreSQL local. Sin cambios crea un job; toma y toma+resume conservan revisión/asignación/eventos manuales y no producen jobs/outbox/salidas. Checkpoint privado y uso simulado persisten; replay no regenera. ROLLBACK de cada escenario. Cinco checks internos,189DB/1.922unitarias/typecheck/lint pasan. Sin cambios productivos/migraciones/Cloud, modelos reales, mensajes o activación.

[Evidencia](../../docs/evidencias/F3-TOMA-HUMANA-2026-10-15.json) y matriz actualizada en F3-MOTOR. Auto-Blindaje: runner hijo elimina NODE_TEST_CONTEXT y exige conteo de pases para no aceptar un test omitido por recursión. Rama codex/omnichannel-f3-human-control desde0220639; siguiente multicuenta/dedup wamid y AC restantes. Origen estable/alta/cutover/renovación operativa pendientes. F3 abierta,0/9 aceptadas. Snapshot Cloud/runtime de incremento27 no revalidado; autorizaciones reales únicas consumidas. Main intacto; sin push/merge/deploy en este incremento.

### F3, incremento29 — IDs por cuenta y estados legacy seguros, 2026-10-15

Dedup wamid por workspace/conexión, con trigger posterior al binding y CHECK que impide elegir scope desde el cliente; nulos e historial legacy preservados. Upserts y materialización SQL del echo adaptados. RPC de estados legacy INVOKER/servicio valida routing y rechaza ambigüedad/IDs contradictorios/otra cuenta; YCloud ignora from explícito ajeno. Contrato nuevo no habilita multicuenta operativa por sí mismo.

Migración93 aplicada en Supabase nuevo;93 versiones alineadas.1.924 unitarias/200 DB/typecheck/lint,fixture PostgreSQL17 con rollback y comprobación PostgREST servicio/anon pasan. Hashes de mensajes previos,conversaciones,contactos y conexiones conservados. Dos workspaces,once mensajes globales,tres jobs/dos outbox;cron0activos/1heredado inactivo. Asesor sin novedades0ERROR/10WARN/19INFO. Sin nuevos modelos/mensajes/permisos/consentimiento/flags ni cambios al dashboard original.

Auto-Blindaje: no usar columna GENERATED con replica identity FULL/publicación heredada; el ensayo local detectó incompatibilidad antes de Cloud. Se usa scope ordinario comprobado y trigger del servidor. Esquema/escritores requieren despliegue coordinado; no restaurar onConflict viejo ni imponer unicidad global tras admitir IDs entre cuentas.

[Evidencia](../../docs/evidencias/F3-DEDUP-CUENTAS-2026-10-15.json). Próximo alta multicuenta operativa/credenciales y routing por conexión,origen estable/alta/cutover/renovación y AC restantes. F3 abierta,0/9aceptadas. Rama codex/omnichannel-f3-message-dedup desde3806f34;main intacto,sin push/merge/deploy.

### F3, incremento30 — registro adicional con credenciales por cuenta,2026-10-15

Ajustes permite registrar/listar/revocar adicionales YCloud/Kapso sin cambiar proveedor principal. Alta atómica de conexión/credenciales privadas, AES-GCM ligado a workspace/conexión/proveedor, ningún secreto en resumen; admin muta,manager lee,membresía revalidada por SQL. UUID/ciphertext inmutables, revocación con revisión, replay sin reactivación y pérdida de respuesta conciliada por GET. Nuevas cuentas needs_permissions/sin grants; no recepción, envío o IA por guardar.

95 migraciones alineadas;1.935 unitarias/211 DB/typecheck/lint,probe PostgreSQL17 con rollback y26 controles HTTP pasan. Fixtures/privados/auditoría retirados y hashes de datos/integraciones originales conservados. Browser Use bloqueó la inspección de Ajustes por política URL: sólo render inicial y HTTP,interacción/responsive pendientes. No proveedor/modelo/mensaje real,compras,push/merge/deploy;main intacto.

Auto-Blindaje: conflictos de negocio usan23514 en migración95 para evitar reintentos PostgREST asociados a40001; rechazo obsoleto pasó de2,1min a3,2s en ensayo local. No hacer reemplazo global de errores de serialización. SQL con $$ usa callback String.replace; caché de tipos Next corrupto respaldado/regenerado con servidor propio detenido. Fuente compilada y servidor inbox restaurado; no versionar next-env.

[Evidencia](../../docs/evidencias/F3-ALTAS-CUENTAS-2026-10-15.json). Próximo conectar webhook y transporte/verificación/permisos a credenciales por conexión; resolver legacy no fue reemplazado. Registro es previo a multicuenta operativa. Siguen origen estable/alta/cutover/renovación y AC restantes. F3 abierta,0/9aceptadas.
### F3, incremento31 — fuente y captura firmada por cuenta, 2026-10-15

La fuente de credenciales de adicionales ahora se resuelve por workspace/conexión/proveedor con RPC sólo servicio, INVOKER y search_path vacío. Excluye integración legacy, revocación y expiración; valida versión de clave y AES-GCM ligado al propietario. El adaptador usa la API key y remitente de esa cuenta sólo si está ready; no sustituye la integración principal ni crea capacidades verificadas.

Nueva entrada /api/webhooks/whatsapp-accounts/[workspaceId]/[connectionId], apagada por CHANNEL_ACCOUNT_INGRESS_CONNECTIONS vacío e independiente de flags legacy. HMAC del cuerpo crudo y destino exacto antes de guardar; máximo1MiB. Guarda eventos normalizados y comprobantes privados con conciliación por cuenta; no materializa contactos/conversaciones/mensajes de bandeja, no buffer/modelo ni nuevos jobs/envíos. ACK identifica shadowOnly. Un fingerprint interno de concurrencia y locks de conexión/credencial rechazan fuente cambiada o revocada entre firma y escritura; fingerprint no es una credencial de autenticación. Replays por cuenta toleran sólo variación de receivedAt; contenido/estado distinto colisiona y revierte.

96 migraciones locales/Cloud alineadas.1.952 unitarias/220DB/typecheck/lint pasan;9comprobaciones en el nuevo archivo DB. Probe PostgreSQL17.11 con rollback, mismo probe local y22controles HTTP reales a Next3100→PostgREST→SQL con2cuentas ficticias: firma,scope,dedup,colisión,receipts y revocación. Tres envíos de adaptador interceptados(2YCloud/1Kapso) verifican clave/remitente propios, sin red a proveedor. Fixture,privados,eventos/auditoría retirados; hashes originales idénticos,2workspaces/11mensajes/3jobs/2outbox/0cron activos preservados. Asesor0ERROR/10WARN heredados/19INFO, sumando count/findings, sin hallazgos nuevos. Next3100 restaurado inbox/flags apagados/origen vacío; ruta nueva503 comprobada.

Auto-Blindaje31: message_jobs tiene PK operation_id, no id; usar workspace_id para verificar tablas de efectos vacías. Tras fallo del smoke, conciliar evento y reutilizar occurredAt; cambiar timestamp bajo mismo ID es colisión, no retry. El ACK shadow sólo acredita captura, no recepción en bandeja, permisos ni conexión operativa. No hubo navegador ni cambios visuales; revisión interactiva del formulario30 sigue pendiente por política URL. No proveedores/modelos reales,mensajes nuevos,compras,push/merge/deploy;main intacto.

[Evidencia](../../docs/evidencias/F3-INGRESO-CUENTAS-2026-10-15.json). Siguiente: verificar proveedor/callback y persistir permisos ligados a sourceRevision para adicionales; materializar sus mensajes en bandeja. Verificación/permisos/materialización legacy aún usan integración principal/callback anterior. Luego origen estable/alta/cutover/renovación y AC. F3 abierta,0/9aceptadas; rama codex/omnichannel-f3-account-ingress desde df68657.

### F3, incremento32 — verificación y permiso por cuenta, 2026-10-15

Adicionales YCloud tienen verificación GET de número/webhook con sus claves propias y callback exacto derivado del origen estable del servidor. La prueba queda en tabla privada RLS con SHA256 de identidad/credenciales/expiración, separado del sourceRevision que incluye estado. Admin verifica/muta; manager consulta; SQL revalida membresía bajo lock y rechaza fuente/respuesta antigua. Guardar proof no cambia estado ni concede permiso. Kapso muestra unsupported_provider y conserva su bloqueo.

Permiso local de texto con confirmación admin, proof completo vigente24h, callback estable y job/outbox/message/receipt delivered/read de esa cuenta. TTL limitado por prueba+24h/expiración de clave; UUID/revisión/replay no reactivan después de revocar. Cambiar/expirar clave o fallar/borrar proof invalida el grant propio. Frontera final channel_text_grant_until también comprueba procedencia/evidencia/vencimiento; ruta legacy preservada. No cambia opt-in,IA,campañas ni flags. Ajustes incluye consulta por cuenta,callback,verificador,bloqueos,checkbox y autorizar/revocar; incertidumbre conserva UUID/reintento explícito, lecturas paralelas ignoran respuestas viejas.

97 migraciones locales/Cloud alineadas;1.963 unitarias/233DB/typecheck/lint pasan.13checks DB nuevos bajo service_role y mismo probe local/PostgreSQL17 con rollback.33controles GoTrue→Next3100→PostgREST→SQL cubren origen ausente,admin,grant/revoke/replay,manager,inactivo y restauración. La prueba HTTP positiva usa proof y job/outbox/message/receipt deliberadamente ficticios; los GETs de proveedor se mockean en unitarias. No hubo comprobación/envío/modelo real. Render inicial React aprobado; no acredita interacción/responsive: bloqueo de política previo de Browser Use sigue vigente y no se intentaron rodeos.

Fixture y todo su historial/privados/auditoría retirados;0proofs/permisos managed. Hashes originales idénticos,2workspaces/11mensajes/3jobs/2outbox/0cron activos preservados. Asesor0ERROR/10WARN heredados/21INFO:dosINFO nuevos esperados por tablas privadas RLS sin políticas browser,sin grants públicos. Next3100 restaurado inbox/flags apagados/origen vacío; main intacto,sin compras/push/merge/deploy. No se repiten pruebas reales anteriores.

Auto-Blindaje32: la identidad/ruta del canal es inmutable. Fixture que intentaba quitar legacy_integration_id fue rechazado; se reconstruyó managed desde su alta, sin relajar guard. Separar fingerprint de proof y revisión de estado impide que grant→ready invalide su propia prueba. [Evidencia](../../docs/evidencias/F3-PERMISOS-CUENTAS-2026-10-15.json). Siguiente: materializar adicionales en bandeja por conexión sin IA/envíos; luego origen permanente/alta/cutover/renovación y AC. F3 abierta,0/9aceptadas; rama codex/omnichannel-f3-account-permissions desde1f943e7.


### F3, incremento33 — bandeja de cuentas adicionales, 2026-10-15

Texto firmado de managed YCloud/Kapso se materializa con una RPC sólo servicio, INVOKER y search_path vacío. Captura, fuente vigente, contacto/identidad/hilo/mensaje y unread/ventana en una transacción; fallo tardío revierte todo. Requiere ambos UUID allowlists CHANNEL_ACCOUNT_INGRESS_CONNECTIONS y CHANNEL_ACCOUNT_INBOX_CONNECTIONS; vacíos apagados. Shadow31 preservado si inbox está apagada. Media sólo capturada sin descarga; receipts separados sin tocar unread. ACK materialized sólo tras guardado atómico.

Identidad conocida conserva su contacto aunque cambie contacts.phone; identidades/hilos/historial se separan por conexión. Replays no duplican ni cambian estado del operador; mismo wamid en otra cuenta es otro mensaje. No adopta legacy NULL, no convierte histórico en live, no habilita consentimiento/grants/IA/envíos. Hilos nuevos human_active/IAfalse; nueva entrada a hilo con IA activa falla. Ventana desde occurredAt. Revocación/rotación/expiración de fuente rechaza guardado.

Migración98:20261016023902_omnichannel_account_inbox.sql;98 nombres/versiones local/Cloud iguales.1.968unitarias/247DB/typecheck/lint pasan;14checks en archivo DB incluyen probe PostgreSQL17 local/Cloud con rollback.76controles HTTP/BD:54captura/invariantes,21lector productivo de bandeja/composer con sesión GoTrue/RLS/filtro por cuenta,1apagado restaurado;4checks setup aparte. Tres cuentas ficticias(2YCloud/1Kapso),mismo actor/ID→3hilos/mensajes/identidades,1contacto. No proveedor/modelo/envío real ni nueva prueba Realtime/navegador.

Fixture3301 y todos sus datos/privados/auditoría retirados con guardas. Hashes originales idénticos;2workspaces/11mensajes/3jobs/2outbox/0cron activos/0proofs-permisos managed preservados. Asesor sin novedades0ERROR/10WARN heredados/21INFO; [remediaciones](https://supabase.com/docs/guides/database/database-linter). Next3100 restaurado inbox/ambos flags por cuenta apagados/origen vacío,supervisor2040/sesión19969 efímeros. Sin compras/push/merge/deploy;main intacto.

Auto-Blindaje33: resolver identidad conocida antes del teléfono editable evita redirigir recepción. Anon recibe42501 por ACL de messages; no esperar [] ni relajar permisos. Reintentos HTTP reutilizan occurredAt persistido. [Evidencia](../../docs/evidencias/F3-BANDEJA-CUENTAS-2026-10-15.json). Rama codex/omnichannel-f3-account-inbox desde5dde69a. Próximo: alta/origen permanente/cutover/renovación,verificador-permisos Kapso y AC restantes; media en bandeja/revisión interactiva de formularios pendientes. No eludir bloqueo previo del navegador ni repetir pilotos reales. F3 sigue abierta,0/9fases aceptadas.


### F3, incremento34 — verificación Kapso y renovación, 2026-10-16

Managed Kapso incorpora GETs acotados de número y webhook exactos con clave propia, sourceRevision y rol admin revalidados por SQL. Exige Meta Phone Number ID numérico/UUID de webhook por número; CONNECTED/inbound activo; kind kapso/v2 explícito/sin agrupación; evento recibido y estados sent/delivered/read/failed, callback exacto y secreto con comparación segura. Meta/v1/batch/null/propietario desconocido bloquean prueba. El callback nunca se consulta y no hay mutaciones al proveedor. Reporte existente compartido sin secretos; manager sólo lee.

Permiso local Kapso usa contrato managed vigente24h/replay/revocación/deriva ya existente. Resolver privado exige recibo y mensaje Kapso/cuenta/destinatario/wamid exactos, job/outbox texto aceptado/fence coincidente. YCloud delega a su resolver anterior; legacy preservado. Re-verificar no extiende grant previo: sólo renovación admin explícita con nueva operación; máximo proof+24h/expiración de clave. Ajustes valida UUID Kapso, explica v2/eventos/sin agrupación y muestra Renovar permiso de texto para permisos gestionados.

99 versiones/nombres local/Cloud alineados;1.974unitarias/257DB/typecheck/lint pasan.10checks DB nuevos incluyen mismo probe PostgreSQL17 local/Cloud con rollback.59controles HTTP/BD:58GoTrue→Next→PostgREST→SQL(8origen bloqueado,16grant,18renew/revoke/replay,4manager,4inactivo,8restaurado),1ingreso apagado. Evidencia positiva de proof/job/outbox/mensaje/receipt deliberadamente ficticia; GETs Kapso interceptados en unitarias,0proveedor/modelo/envío real. SSR inicial real de ambos proveedores pasa; interacción/responsive siguen pendientes por política URL previa,sin eludirla.

Fixture3401/proofs/permisos/receipt/job/outbox/mensaje/hilo/identidad/contacto/cuenta/claves/membresía/auditoría retirados con guardas. Hashes originales idénticos;2workspaces/11mensajes/3jobs/2outbox/0cron activos/0proofs-permisos managed preservados. Asesor sin novedades0ERROR/10WARN heredados/21INFO; [remediaciones](https://supabase.com/docs/guides/database/database-linter). Next3100 restaurado inbox/flags apagados/origen vacío,supervisor30020/sesión49592 efímeros. Sin compras/push/merge/deploy;main intacto.

Yani elige dashboard.pixiweb.com.ar. Preparación de origen/URLs y operación en [F3-MOTOR](../../docs/F3-MOTOR-omnichannel.md); no configurado en runtime. Google/Cloudflare DoH devuelven NXDOMAIN el16/10,HTTPS no disponible. No crear un CNAME inventando destino ni sustituir dashboard original; hosting/publicación requieren revisión y autoridad específica.

Auto-Blindaje34: distinguir Meta Phone Number ID de internal_id y webhook por número del webhook de proyecto. Simular envejecimiento de proof guardado dentro de fixtures: save rechaza correctamente reportes de red mayores a2min. Jobs unknown sintéticos deben retirar resultados accepted; no relajar constraints. [Evidencia](../../docs/evidencias/F3-KAPSO-VERIFICACION-2026-10-16.json). Rama codex/omnichannel-f3-kapso-verification desde dd2d58a. Próximo: prueba inicial acotada de alta managed sin SQL manual,hosting/DNS/HTTPS/cutover y AC; media/ecos managed/revisión interactiva pendientes. F3 abierta,0/9fases aceptadas.

### F3, incremento35 — permiso final y origen de cada envío managed, 2026-10-16

Se corrigió un bloqueo del guard SQL final: channel_permit_until aún exigía legacy_integration_id aunque el adaptador ya resolvía credenciales managed. YCloud/Kapso adicionales ahora validan su prueba y permiso propios; la rama legacy conserva su contrato. Siguen obligatorios consentimiento/supresión, identidad/cuenta/ventana, actor/revisión, presupuesto, lease/fence y outbox durable. No se activa ningún envío por guardar o verificar una clave.

Cada job nuevo managed fija en private.channel_job_sources el fingerprint de sus credenciales/identidad/expiración y UUID del permiso original. Trigger AFTER INSERT con locks; tabla privada RLS sin acceso browser y servicio sólo SELECT/INSERT, sin UPDATE/DELETE. Sin backfill ni adopción de jobs antiguos. Rotar credenciales o renovar/revocar/recrear permiso no reactiva trabajos pendientes del origen anterior; el replay nunca los vuelve a ligar. Deben revisarse/cancelarse y crear una operación nueva si corresponde. Preview humano transitorio sin operation_id valida el permiso vigente; un job persistido exige su pin.

Migración100:20261016040458_omnichannel_managed_send_source.sql, aplicada sólo en el Supabase nuevo;100 versiones/nombres local/Cloud iguales.1.974unitarias/276DB/typecheck/lint pasan;19checks en archivo DB nuevo. Mismo probe PostgreSQL17 local/Cloud para ambos proveedores, bajo servicio y rollback.61controles HTTP/BD:60API humana autenticada→cola→worker/adaptador productivos→proveedor interceptado→finish→receipt firmado sintético→SQL y1ingreso apagado restaurado;4checks setup aparte. Se interceptaron tres POSTs(2YCloud/1Kapso): clave/remitente de cada cuenta, dedup y resultado unknown sin reenvío.0llamadas reales a proveedor/modelo. Proof/opt-in/job seed/receipt positivos son deliberadamente ficticios; no prueban un alta ni entrega reales.

Prueba extra de concurrencia no concluyente y no contada: los timestamps muestran holder04:13:18–04:13:43UTC y contender04:13:55–04:13:56UTC, sin superposición; permitted fuera del lock no acredita NOWAIT. Se concilió y retiró operación ficticia64; no se retuvo harness fallido como test aprobado. La protección secuencial contra rotación/renovación sí pasó. No hubo cambios visuales ni navegador; revisión interactiva pendiente y política URL previa respetada.

Fixtures3501/3601 y sus privados/historial/auditoría retirados con guardas. Hashes originales de mensajes/contactos/hilos/conexiones/integraciones idénticos;2workspaces/11mensajes/3jobs/2outbox/0cron activos,0pins/proofs/permisos managed. Asesor0ERROR/10WARN heredados/22INFO:un INFO nuevo esperado por tabla privada RLS sin políticas/grants browser; [remediación](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Next3100 restaurado inbox/flags apagados/origen vacío,supervisor22256/sesión59006 efímeros. No compras/push/merge/deploy;main intacto.

Auto-Blindaje35: el resolver TypeScript no reemplaza el guard SQL final; fijar fuente y permiso originales sin repin de replay. Verificar superposición temporal antes de afirmar concurrencia. Validator generado por Next tenía contenido duplicado: detener sólo supervisor propio, respaldar/regenerar/reiniciar; respaldos .ts deben terminar .ts.bak porque tsconfig incluye **/*.ts aun dentro de test-results ignorado. next-env generado restaurado y fuera del commit.

[Evidencia](../../docs/evidencias/F3-ENVIO-MANAGED-2026-10-16.json). Rama codex/omnichannel-f3-managed-send-guard desde172a672. Se completó este prerrequisito de transporte, no el flujo de primera prueba desde producto: siguiente operación única autorizada con destino/texto/vencimiento acotados sin SQL manual ni consentimiento/grant permanente. Después hosting/DNS/HTTPS/cutover,media/ecos managed/revisión interactiva y AC restantes. dashboard.pixiweb.com.ar elegido; NXDOMAIN observado en34,no consultado de nuevo. F3 abierta,0/9fases aceptadas.

### F3, incremento 36 — primera prueba única desde el producto, 2026-10-16

Las cuentas managed YCloud/Kapso ya pueden preparar una primera prueba sin entrega previa ni permiso permanente. Admin elige una conversación con identidad verificada y texto entrante materializado dentro de 24 horas, revisa el número y el mensaje fijo, y confirma una autorización para esa operación. Preparar guarda autoridad privada y job en una transacción; enviar requiere otro botón explícito. Vigencia máxima de diez minutos, limitada también por evento, verificación y credenciales. La cuenta sigue needs_permissions y el contacto conserva opt_in; no activa IA ni campañas.

La autoridad guarda operación, cuenta, actor, conversación, destinatario/texto, evento, revisión, fingerprint de credenciales, comprobación y callback del servidor. El guard SQL final revalida todo, incluida supresión, admin activo y conversación human_active/IAfalse. La cola común excluye trials; el endpoint reclama sólo el UUID elegido y usa el transporte/outbox/cupos/fencing/conciliación existentes. No construye una cuenta ready ficticia. El permiso de prueba no se convierte automáticamente en grant general.

No hay segundo outbox ni reenvío automático, tampoco tras rechazo retryable, recuperación de lease o resultado unknown. Unknown/accepted no se reemplazan con un UUID nuevo. Retirar cancela lo aún no iniciado y conserva historial; no retira un POST ya permitido. Replays no renuevan autorización. Una respuesta incierta conserva la misma operación; errores not_claimed/not_permitted/deferred se explican en pantalla. Managers sólo consultan. El padre ahora monta también el verificador Kapso, antes oculto por una condición exclusiva de YCloud.

Migración101:20261016101806_omnichannel_account_trial.sql aplicada al proyecto nuevo;101 versiones/nombres local/Cloud iguales.1.985unitarias/297DB/typecheck/lint pasan;11unitarias y21checks DB nuevos. Ambos probes PostgreSQL17 pasan local/Cloud con rollback.77controles HTTP/BD:58flujo completo,6manager,6inactivo,6trial apagado restaurado y1ingreso503;4checks setup aparte. Dos POSTs interceptados dentro del servidor Next: YCloud unknown sin reenvío y Kapso accepted→delivered por recibo HMAC ficticio. No proveedor/modelo real. Se retiraron TODOS los seeds de entrega y grants del fixture antes de probar el alta; la comprobación del proveedor sigue siendo deliberadamente ficticia.

React DOM SSR inicial de los paneles de ambos proveedores pasa. No acredita interacción de formularios, responsive o Realtime. Política URL previa respetada, sin navegador alternativo/CDP. Skill React aplicada a estados por instancia, lecturas obsoletas, controles etiquetados, errores/status y pureza de render.

Fixtures3701/3801 y sus privados/trials/pins/historial/auditoría retirados con guardas; hashes originales completos idénticos. Siguen2workspaces/11mensajes/3jobs/2outbox/0cron activos;0trials/pins/proofs/permisos managed. Asesor0ERROR/10WARN heredados/23INFO:un INFO nuevo esperado por tabla privada RLS sin políticas/grants browser; [remediación](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Next3100 restaurado inbox/origen vacío/flags comunes y tres managed vacíos,supervisor30612/sesión92989 efímeros. QA29132 detenido; interceptor sólo del proceso de QA retirado. No compras/push/merge/deploy;main intacto.

Auto-Blindaje36: PostgreSQL least ignora NULL; validar primero el deadline de evento. Excluir trials de claims normales y convertir rechazos retryable a finales en SQL, además del servicio. Verificar que el padre monte los controles Kapso. React impide Date.now durante render; vencimiento revalidado por servidor. Para probar POST HTTP completo, interceptar dentro del servidor QA con allowlist de destinos y claves ficticias, sin fallback a proveedor.

[Evidencia](../../docs/evidencias/F3-PRUEBA-UNICA-2026-10-16.json). Rama codex/omnichannel-f3-account-trial desde4840c49. El flujo inicial está implementado y deshabilitado; no repetirlo como pendiente de código. Falta hosting/DNS/HTTPS/cutover autorizado, revisión interactiva y entrega real de una cuenta nueva con autorización concreta;media/ecos managed y AC restantes. dashboard.pixiweb.com.ar elegido,NXDOMAIN observado34,no reconsultado36. F3 abierta,0/9fases aceptadas.

### F3 — cutover del laboratorio YCloud a dashboard.pixiweb.com.ar, 2026-10-16

Webhook YCloud del número dedicado del laboratorio legacy (workspace ff50ed19) movido del túnel local al dominio nuevo con autorización de Yani. Producción en modo inbox: firma falsa 401, GET 200. Texto real de Yani recibido y guardado en la bandeja (6→7, `in` 17:09:48Z), sin salida automática ni IA. Vercel sin cambios. No prueba todavía la ruta managed por cuenta ni envíos. Detalle en [F3-MOTOR](../../docs/F3-MOTOR-omnichannel.md#cutover-del-laboratorio-ycloud-al-dominio-nuevo-2026-10-16). F3 abierta, 0/9 fases aceptadas.

### F3 — primera cuenta managed real (Kapso 6572) por la ruta por cuenta, 2026-10-16

A pedido de Yani, número Kapso terminado en 6572 retirado del original (sólo se pausó su webhook ahí; integración intacta). Alta managed en workspace 52aa2172, conexión f07797e6, webhook por número be0fbd88 verificado. Vercel: ingress e inbox = sólo f07797e6, trial/workspaces vacíos, redeploy cfe4ueabg. Texto real de Yani guardado en la bandeja (in 21:08:22Z, IA apagada, cero salidas, needs_permissions). Detalle en [F3-MOTOR](../../docs/F3-MOTOR-omnichannel.md#primera-cuenta-managed-real-por-la-ruta-por-cuenta--kapso-2026-10-16). Cierre: Yani borró la API key vieja del original en Kapso y creó su usuario del panel; quedó super admin y admin de 52aa2172 y ff50ed19. F3 abierta, 0/9 fases aceptadas.

### F3, incremento 37 — multimedia entrante en cuentas managed, 2026-10-17

Fotos, audios, videos, documentos, stickers, ubicaciones y respuestas de botón que llegan a una cuenta managed con ingreso y bandeja habilitados se guardan en la bandeja (cuerpo = pie o «[Multimedia]», raw_type en meta). La copia del archivo a Storage corre después de responder al proveedor, sólo para filas nuevas y sin reintento; si falla, el mensaje igual queda. Plantillas/sistema siguen sólo capturados. Sin IA, jobs ni outbox. Migración102 20261017234022_omnichannel_account_inbox_media.sql probada en PGlite; **no aplicada** al Supabase nuevo ni desplegada (requiere autorización de Yani). 1.989 unitarias, 298 DB, typecheck y lint pasan. Rama codex/omnichannel-f3-managed-media. Detalle en [F3-MOTOR](../../docs/F3-MOTOR-omnichannel.md). Pendiente: aplicar/desplegar, prueba real con una foto, ecos managed, revisión interactiva y AC. F3 abierta, 0/9 fases aceptadas.

### F3, incremento 38 — respuestas desde la app Business en cuentas managed, 2026-10-17

Si Yani contesta desde la app WhatsApp Business en un número Kapso managed con ingreso y bandeja habilitados, la respuesta queda en la bandeja como saliente humana en el hilo del contacto y la IA de esa conversación se pausa. Sólo para contactos que ya escribieron (si no, queda ignorada sin crear contacto); sin envíos, jobs, outbox ni cambios de consentimiento; cerradas no se reabren. Migración103 20261018012110_omnichannel_account_business_app_echo.sql probada en PGlite y **aplicada** en el Supabase nuevo el 2026-10-17 con autorización de Yani; código **desplegado** a producción el 2026-10-17 con su autorización (4tphp5igk; rollback msosahiyq). 1.995 unitarias, 306 DB, typecheck y lint pasan. Rama codex/omnichannel-f3-managed-echoes. Detalle en [F3-MOTOR](../../docs/F3-MOTOR-omnichannel.md). Prueba real el 2026-10-18: respuesta desde el celular guardada en la bandeja en el hilo correcto, sin contactos nuevos, envíos ni jobs; la pausa de IA sólo en tests (esa conversación ya estaba pausada). Pendiente: revisión interactiva y AC. F3 abierta, 0/9 fases aceptadas.

**Primera prueba de entrega habilitada, 2026-10-18.** Con el sí de Yani («sí activa»), CHANNEL_ACCOUNT_TRIAL_CONNECTIONS se cargó en producción sólo con la conexión Kapso f07797e6 y se redesplegó (deploy qlciyzc2j, alias dashboard.pixiweb.com.ar; chequeos: /login 200, Kapso sin firma 401, YCloud managed 503). Antes de la prueba: 3 salientes, 6 entrantes y 3 contactos en el workspace. Esto sólo habilita el flujo de paso5: nada sale hasta que Yani escriba desde su número, revise destino y mensaje en Ajustes y confirme «Enviar esta única prueba». Al terminar: retirar la autorización y vaciar la variable con redeploy. Rollback: quitar la variable y redeployar, o redeployar 4tphp5igk.

**Primera entrega real hecha, 2026-10-18 04:44 UTC.** La verificación de cuenta/webhook había vencido (vale 24 h); Yani la repitió desde Ajustes y la prueba quedó sin bloqueos. Yani preparó y envió la prueba única a su propio número (operación 9e574206, conversación de prueba 3278adca): el proveedor informó enviado, entregado y leído, y el texto le llegó al celular. El workspace pasó a 4 salientes (antes 3); siguen 3 contactos; un solo job aceptado. La autorización de prueba se retiró a las 04:45 UTC. Con esto la cuenta ya tiene una prueba de texto entregado conciliada y el permiso permanente de texto queda revisable sin bloqueos, pero NO se concedió: requiere su propio sí. Con el sí de Yani, CHANNEL_ACCOUNT_TRIAL_CONNECTIONS se quitó de producción y se redesplegó (deploy q6e14chvs, alias dashboard.pixiweb.com.ar; chequeos: /login 200, Kapso sin firma 401, YCloud managed 503): la prueba única ya no se puede preparar. Rollback: redeployar qlciyzc2j (vuelve a habilitar la prueba) o 4tphp5igk.

**Permiso local de texto concedido, 2026-10-18 04:56 UTC.** Con el sí de Yani («sí hacelo») se concedió el permiso de texto de la conexión Kapso f07797e6 (misma operación que «Autorizar texto», como Yani): antes, revisión sin bloqueos y ningún job pendiente. Ahora la conexión está en ready con una sola capacidad de texto, vigente hasta 2026-10-19 04:40 UTC (24 h desde la verificación; para extenderlo: volver a verificar y «Renovar permiso de texto»). No salió nada: sigue 1 job (el de la prueba), 4 salientes, 3 contactos. Esto no envía por sí solo: CHANNEL_HUMAN_WORKSPACES, CHANNEL_WORKER_WORKSPACES y CHANNEL_AI_WORKSPACES siguen vacías en producción, así que responder desde el panel, el worker y la IA siguen apagados; habilitarlos requiere otro sí. Rollback: «Revocar permiso de texto» en Ajustes.

**Paquete de aceptación armado, 2026-10-18.** A pedido de Yani («todavía no prendas envíos; armá la evidencia») se escribió `docs/F3-ACEPTACION-omnichannel.md`: los 9 criterios de US-006, US-007 y US-008 con lo probado real y sintético, lo que falta y un veredicto sugerido (3 aceptar: US-006 AC3, US-007 AC3, US-008 AC3; 6 aceptar con límites). Typecheck pasa y 1.995 de 1.995 unitarios pasan. Para armarlo no se envió nada, no se cambió ninguna variable y no se desplegó. F3 sigue abierta hasta que Yani apruebe los criterios.

**F3 ACEPTADA por Yani, 2026-10-18.** «Apruebo los 9 criterios de F3 con los veredictos sugeridos, incluidos los límites anotados.» Quedan aceptados los 9 criterios de US-006, US-007 y US-008 (3 sin límites y 6 con los límites de `docs/F3-ACEPTACION-omnichannel.md`). Los límites no se pierden: pasan a F4 en adelante o al momento de encender envíos (panel, worker e IA, cada uno con su propio sí), junto con el alta YCloud con dos cuentas reales, los ecos reales de YCloud, los JSON de evidencia pendientes y la renovación del permiso de texto Kapso (vence 2026-10-19 04:40 UTC). Aprobar los criterios no autoriza envíos, push, merge ni deploy.

**F4 en ejecución — incremento 1, 2026-10-18.** Con el «go» de Yani («arrancá F4 Instagram en Build Manual desde el worktree activo») se abrió la rama codex/omnichannel-f4-instagram desde 7557a71 (main intacto). Se hicieron sólo piezas puras, sin ruta, migración ni cuenta externa: configuración Meta server-only todo-o-nada (META_APP_ID, META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN, META_GRAPH_API_VERSION, META_REDIRECT_URI; ninguna NEXT_PUBLIC_) y verificación del webhook (challenge y firma HMAC SHA-256 sobre bytes crudos, comparación en tiempo constante, tope 1 MiB) en 97868d5 (T1.3); normalizador Instagram de DM y comentarios al contrato de entrada (ecos, borrados, comentarios propios, eventos desconocidos y destinatario ajeno se ignoran con motivo; media no soportada queda visible como evento de sistema sin URL; el comentario lleva post y evidencia) en 48b9692 (T2.1); matcher comentario→regla (NFKC, minúsculas, acentos opcionales por regla, palabras o frases completas sin regex, sólo reglas activas del mismo activo/post, nunca comentarios anteriores a la activación, un único ganador por prioridad y luego id) en cae0492 (T3.2). 15 unitarias nuevas, typecheck y lint pasan; escaneo de secretos limpio. Commits locales, sin push. Bloqueo: no existe app Meta ni variables META_; Yani debe crear o autorizar la app y cargar los 5 valores. Siguiente: T1.1/T1.2 OAuth y credenciales cifradas (sumar meta al enum de proveedores) y T3.1 prioridad en rule-schema, con parada de Lista Roja antes de rutas y migraciones. Nada se envió, no se desplegó ni se cambió ninguna variable.

**F4 incremento 2, 2026-10-18.** Con «continuá con lo que podés» se siguió sólo con piezas puras. T2.2 en c06874a: ventanas de respuesta Instagram como evidencia de la política de envío (DM abre 24 h; HUMAN_AGENT 7 días y la política sigue exigiendo humano; un comentario habilita una sola respuesta privada por 7 días y nunca abre la ventana de DM; históricos, ecos, recibos, comentarios propios o borrados y eventos futuros no abren nada; estado de reserva incoherente se rechaza). T1.2 en 9851d9d: credenciales Meta cifradas en archivo propio (meta-credentials.ts) con AAD atada a workspace, conexión y proveedor meta, sin texto plano de respaldo, rechazando cifrado de entrada y campos extra; account-credentials.ts de WhatsApp no se tocó y meta todavía no está en su enum. Más un cálculo puro del estado de conexión (revocada, faltan permisos o token vencido, esperando webhook, lista) con los permisos requeridos recibidos como dato porque dependen del App Review. 14 unitarias nuevas (26/26 del área), typecheck y lint pasan; sólo valores sintéticos. Commits locales, sin push. T3.1 (prioridad en reglas de automatización) FRENADA: la tabla automation_rules no tiene columna priority y el formulario guarda todos los campos, así que agregarla al esquema rompe la creación de reglas; requiere migración (Lista Roja) y espera el sí de Yani. Las reglas comentario→guía probablemente vivan en una tabla propia con prioridad, también por migración. Sigue el bloqueo de app Meta y las 5 variables META_. Nada se envió, no se desplegó ni se cambió ninguna variable.

**F4 incremento 3, 2026-10-18.** Con el sí de Yani («armá la migración de prioridad para reglas (y la tabla de reglas de comentario si conviene) como archivo para revisar. No la apliques todavía») se escribió el BORRADOR supabase/drafts/automation_rule_scope_versions.sql (T3.1), fuera de supabase/migrations/ a propósito: ni db push ni el CI lo leen. NO APLICADO en ningún proyecto. Contenido: automation_rules.priority (relleno por workspace en el orden actual de 10 en 10 sin tocar updated_at, trigger que asigna el último lugar si el formulario v1 no la manda, rango 0..1000000; gana la menor y luego id, sólo entre reglas de comentario); alcance channel/connection_id/source_type con FK compuesta a channel_connections sin CASCADE ni SET NULL; trigger comment_keyword permitido sólo con Instagram + comentario + cuenta, y las reglas v1 quedan WhatsApp sin cambios; action_type pasa a opcional sólo para comment_keyword; tabla automation_rule_versions inmutable (condiciones + 1..10 pasos, RLS de lectura por workspace, escrituras revocadas, se borra sólo con su regla) y active_version_id obligatorio para activar una regla de comentario; automation_runs.rule_version_id con SET NULL sólo de esa columna para no bloquear el borrado de reglas (las corridas ya se borran con su regla por el CASCADE existente fk_automation_runs_rule_id_same_workspace; corregido el 2026-10-18 tras la prueba). No se creó tabla aparte de reglas de comentario (una lista, un tope, un camino de permisos), ni columna status (enabled + paused_reason ya lo dicen), ni private_reply_claims (ya existe desde 20261011010958). Revisión estática únicamente: no hay Postgres local; la revisión encontró y corrigió el bloqueo de borrado por FK de corridas y el cambio masivo de updated_at. check-migrations pasa. Para aplicarlo: copiarlo a supabase/migrations/ con versión nueva y el sí explícito de Yani; en la misma entrega cambian rule-schema, automation-actions, el formulario, rule-cap (excluir reglas de comentario) y la lista (mostrar comment_keyword). Nada se aplicó, envió ni desplegó.

**F4 incremento 4, 2026-10-18.** Con el sí de Yani («creá una rama de Supabase descartable, aplicá el borrador ahí, probalo y borrá la rama. No toques el proyecto principal») se probó el borrador. No se creó rama de Supabase: el conector MCP está fijado al proyecto principal y sus herramientas de SQL no aceptan otro destino, así que la prueba corrió en una base Postgres descartable en memoria (PGlite) con las 103 migraciones reales + el borrador, y se borró al terminar. Proyecto principal intacto (list_branches vacío, nada aplicado). Resultado: 60 de 60 comprobaciones pasan: relleno de prioridad 10/20 por workspace sin tocar updated_at, trigger re-habilitado, borrador repetible 3 veces, regla v1 nueva al final, rechazos de rango, de acción faltante y de alcance, FK de cuenta (otro canal u otro workspace), versión obligatoria para activar, versiones inmutables (editar o borrar con la regla viva falla; borrar el autor deja created_by vacío), RLS (un miembro ve sólo su workspace, nadie de afuera ve nada, insertar o editar da permiso denegado), corrida atada a una versión de su misma regla, cuenta en uso no se puede desconectar, borrar una regla se lleva versiones y corridas, borrar un workspace no deja restos. Hallazgo: el comentario de la sección 6 decía que las corridas sobreviven al borrar la regla; es falso (ya existía CASCADE). Se corrigió el comentario; el SQL no cambió. Las 2 fallas iniciales eran del propio test. Sigue SIN APLICAR: aplicarlo pide el sí explícito de Yani.
