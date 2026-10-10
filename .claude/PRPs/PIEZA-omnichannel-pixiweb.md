# La Pieza: Omnichannel Pixiweb

> **Estado del alcance:** APROBADO por Yani el 2026-10-10: «apruebo el blueprint comienza».
> **Ejecución:** Build Manual; F3 en progreso. Supabase nuevo y recorrido autenticado probados con datos sintéticos; contratos externos/pipeline integral pendientes. 0/9 fases con aceptación integral.
> **Blueprint origen:** [BLUEPRINT-omnichannel-pixiweb.md](../../BLUEPRINT-omnichannel-pixiweb.md)
> **Build Mode:** SaaS Completo — ampliación de fork existente.
> **Rama de preparación:** codex/omnichannel-preparacion, base 28a1530.
> **Rama activa F3:** codex/omnichannel-f3-inbox, desde F2 2fea741. Se reutiliza el worktree C:/Users/Yani Acevedo/.codex/worktrees/omnichannel-f1/app-whatsapp-saas-conectado; el nombre del directorio no indica la fase activa.

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
**Estado:** EN_PROGRESO; 74 migraciones, Auth/inbox y concurrencia probados en Supabase nuevo. Permiso WA texto y mensajes de jobs transaccionales; incertidumbre y atribución visibles. Falta conectar escritores/worker bajo flags, otros tipos de evidencia y conciliación. Canales nuevos deshabilitados. **Historias:** US-006–008. **Estimación:** 5–8 días-persona.
**Objetivo:** adaptadores, políticas de envío, jobs durables, identidad por cuenta y handoff compartido.
**Validación:** regresión WA, eventos duplicados, carreras humano/IA, reintentos y timeout unknown sin reenvío automático.

### F4 — Instagram y comentario→guía
**Estado:** PENDIENTE. **Historias:** US-009–012. **Estimación:** 7–10 días-persona.
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
