# La Pieza: Omnichannel Pixiweb

> **Estado del alcance:** APROBADO por Yani el 2026-10-10: «apruebo el blueprint comienza».
> **Ejecución:** Build Manual elegido por Yani el 2026-10-10; F1 EN_PROGRESO; 0/9 fases completadas.
> **Blueprint origen:** [BLUEPRINT-omnichannel-pixiweb.md](../../BLUEPRINT-omnichannel-pixiweb.md)
> **Build Mode:** SaaS Completo — ampliación de fork existente.
> **Rama de preparación:** codex/omnichannel-preparacion, base 28a1530.

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
**Estado:** PENDIENTE. **Historias:** US-001–003. **Estimación:** 5–8 días-persona.
**Objetivo:** baseline de la app, identidades sin teléfono, expansión/backfill en copia y matriz de capacidades Meta/Brevo.
**Validación:** contratos WA, conteos/IDs, dos tenants, rollback y evidencia de pruebas externas; accesos faltantes quedan pendientes.

### F2 — Sistema Pixiweb y rediseño transversal
**Estado:** PENDIENTE. **Historias:** US-004–005. **Estimación:** 4–7 días-persona.
**Objetivo:** tokens, componentes y pantallas existentes con Manrope, Instrument Serif, piedra/violeta/lima.
**Validación:** flujos reales, estados, contraste, teclado y desktop/móvil; sin alterar permisos por estética.

### F3 — Motor de canales e inbox unificado
**Estado:** PENDIENTE. **Historias:** US-006–008. **Estimación:** 5–8 días-persona.
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

Confirmar antes de editar auth, middleware, API routes, webhooks, migraciones o archivos con service_role:

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

Sin incidencias de implementación todavía. Registrar aquí errores, corrección y comprobación cuando ocurran; no inventar pruebas superadas.

## Registro de ejecución

| Fecha | Acción | Evidencia |
|---|---|---|
| 2026-10-10 | Aprobación del blueprint y orden de comienzo | Mensaje de Yani; no repetir aprobación del alcance |
| 2026-10-10 | Autonomía de ordenador/navegador y prohibición de compras | Mensaje de Yani |
| 2026-10-10 | Rama por fase importante | Mensaje de Yani; preparación creada desde main 28a1530 |
| 2026-10-10 | Pieza generada desde template base | Solo documentación; modo pendiente; sin código ni migraciones modificados |
