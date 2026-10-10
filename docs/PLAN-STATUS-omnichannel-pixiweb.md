# Estado de /plan — Omnichannel Pixiweb

Actualizado: 2026-10-10. Fuente de construcción: [BLUEPRINT-omnichannel-pixiweb.md](../BLUEPRINT-omnichannel-pixiweb.md).

## Resultado

Blueprint **APROBADO por Yani el 2026-10-10**: «apruebo el blueprint comienza». Incluye 9 fases, 27 historias, 72 tareas, 18 templates de pantalla y 14 fuentes funcionales sin TikTok. Build Manual elegido. F3 en ejecución; Supabase nuevo tiene 72 migraciones. Contexto de envío y composición productor/worker preparados; inbox autenticado con disponibilidad por cuenta y controles servidor de texto/plantillas. Pipeline completo y proveedores pendientes. Fases con aceptación integral: 0/9.

**Continuar en:** C:/Users/Yani Acevedo/.codex/worktrees/omnichannel-f1/app-whatsapp-saas-conectado, ahora en rama codex/omnichannel-f3-inbox desde 2fea741. Se reutiliza el worktree; su nombre heredado no indica la fase activa.

## Decisiones de Yani incorporadas

- WhatsApp existente como base del fork; ampliar a Instagram, Facebook Messenger y widget.
- Automatización de post/Reel «comentá hola» → guía.
- Cada cliente conecta sus propias cuentas Meta desde el SaaS.
- Brevo contactos/listas/oportunidades en ambos sentidos.
- Usar el design system actual de pixiweb.com.ar.
- Entregable solicitado: investigación + flujo /plan de Forge.
- Aprobación posterior del blueprint y orden de comenzar /build.
- Uso proactivo del ordenador/navegador; prohibido comprar por Yani.
- Cada fase o etapa importante en una rama distinta de main. Preparación actual: codex/omnichannel-preparacion; mapa de ramas en La Pieza.

## Ejecución de La Herrería

| Etapa | Resultado |
|---|---|
| Selección de ruta | SaaS existente, planificación de ampliación; no reiniciar el producto |
| 0 Viabilidad | VIABILITY: viable técnicamente con condiciones; negocio por validar |
| 1 BMC/VPC | Documentos con hipótesis, sin precios/resultados inventados |
| 2 PDR | Scope R1/R2, exclusiones, decisiones y aceptación |
| 3 Tech spec | Modelo, adaptadores, política, seguridad, migraciones propuestas y contratos |
| 4 UX research | Personas/modelos/journeys derivados; sin entrevistas ficticias |
| 5 Stories | 27 historias con AC |
| 6 UX design | Arquitectura, interacciones, onboarding y evaluación propuesta |
| 7 UI workflow | 18 templates desktop/mobile, prompts y componentes |
| 8 UI | Especificada con diseño actual; implementación fuera del pedido /plan |
| 9 Seguridad de implementación | No ejecutada: existe plan QA/riesgos; no se generó auditoría ficticia |
| 10 Blueprint | Documento integrado para revisión y futuro /build |

Se aplicó la excepción «solo quiere el plan» de La Herrería para no escribir código. Se completó adicionalmente el diseño documental porque Yani pidió rediseño. La autorización para planificar permitió producir el borrador completo sin pedir aprobación repetida de cada documento; no equivale a aprobar su construcción.

Skills/instrucciones leídos: AGENTS.md, .claude/commands/plan.md, .claude/skills/la-herreria/SKILL.md y assets pertinentes, reglas de componentes, pauta Supabase y documentación de uso de navegador. Paths template de AGENTS con {{path:...}} se resolvieron usando la estructura real .claude; no se alteró Forge.

## Verificación hecha

- Inspección del fork en commit 28a1530; estado funcional de producción tomado del reporte de Yani, no comprobado remotamente.
- Fuentes oficiales Meta/Brevo y sitio Pixiweb actual consultados; límites/incertidumbres con trazabilidad en relevamiento.
- Hero/tarjetas y estilos computados de Pixiweb: Manrope, Instrument Serif, piedra/violeta/lima; contraste de pares opacos calculado.
- Validación documental de historias/fases/pantallas/tareas, enlaces locales y cercos Markdown. Resultado final en [validación](validacion-plan-omnichannel-pixiweb.json).
- No se instalaron dependencias ni se ejecutaron tests de producto; el cambio es documental.
- No se tocaron src, migraciones, secretos ni configuración productiva; no push/merge/deploy.

## Pendientes y próximos pasos

1. Ejecutar F1 en Build Manual, elegido por Yani. Blueprint ya aprobado; no repetir su aprobación.
2. La Pieza ya generada; invariantes de Lista Roja confirmados por Yani: «confirmo, continuar».
3. Completar F1: baseline, migraciones/backfill y E2E locales preparados; falta copia Supabase, flujo autenticado y cuentas reales de prueba.
4. Obtener/configurar app Meta y activos de prueba, versión/scopes/App Review; credenciales por canales seguros.
5. Verificar en cuenta Brevo el alta de webhooks Sales/cuotas; usar conciliación eventual donde falte evento.
6. Construir por fases con flags. Solo fuentes probadas pasan a disponibles.
7. Autorizar despliegue aparte cuando exista candidato revisable y QA real.

F1–F7 entregan núcleo. F8 cubre fuentes ampliadas incluidas. Controles de F9 se aplican durante toda la construcción y antes de cualquier salida R1. La estimación 45–69 días-persona es preliminar; no calendario comprometido.

Diseño y alcance aprobados. Modo Manual confirmado; F1 iniciada. Accesos externos y pruebas reales son condiciones para habilitar capacidades y lanzar, sin impedir preparación local independiente.

## Estado Git preservado

Ya había scaffolding Forge sin seguimiento (.claude, .forge, AGENTS.md, CLAUDE.md y archivos de ejemplo). No se movió ni se sobrescribió. Esta tarea agregó documentos Markdown y el reporte de validación; no se creó commit.

## Inicio de /build — 2026-10-10

Se leyeron AGENTS.md, el comando build, el template pieza-base y la referencia de Lista Roja. Se creó codex/omnichannel-preparacion desde main (28a1530), conservando los untracked. Se actualizó la aprobación en el blueprint y se generó La Pieza con nueve fases y ramas previstas. Solo cambios documentales: no código, migraciones, pruebas de producto, mensajes ni despliegues. La validación JSON anterior corresponde a la entrega /plan; no acredita implementación ni se reescribe como si lo hiciera.

## F1 en ejecución — Build Manual

F1 quedó en codex/omnichannel-f1-base, commit 5753e34. El worktree se reutiliza para F2. Rama de preparación conserva el plan; main no se modificó. AGENTS.md permanece como instrucción local sin incorporar a commits.

Implementado: contratos Zod, normalización WA y preflight; tres migraciones aditivas con RLS, credenciales privadas, identidades por conexión y backfill acotado/reanudable. ContactRow, búsqueda, presentación y envío toleran teléfono ausente; WhatsApp sigue exigiéndolo. Nuevos canales permanecen deshabilitados. No hay cambios aplicados a Cloud.

Verificado: 1.666 unitarias, 14 comprobaciones DB y 10 pruebas de navegador desktop/móvil; typecheck, lint dirigido y build pasan. Ensayo DB local con PGlite/PostgreSQL 18.3, 65 de 66 migraciones heredadas, fixtures sintéticos y restauración de copia; no sustituye Supabase/PostgreSQL 17 ni login real. Reporte y procedimiento: [F1 baseline](F1-BASELINE-omnichannel.md). Logs/reportes HTML en carpetas ignoradas.

F1 incompleta: validar en Supabase, autenticación, concurrencia y cuentas Meta/Brevo. Lista Roja ya confirmada. Yani resolvió usar una cuenta nueva porque las anteriores están saturadas: no usar db-whatsapp ni db-chatfuel. No se consultaron datos operativos ni se modificaron bases. No comprar ni habilitar facturación. No repetir aprobación de blueprint, Manual ni invariantes. main sigue en 28a1530; sin push/merge/deploy.

## F2 en ejecución — 2026-10-10

Yani autorizó avanzar diseño mientras se prepara Supabase: «dale avanza y así lo haremos, ya creé una nueva cuenta». Esta excepción permite trabajo local independiente, sin declarar F1 completa.

Implementado: sistema Pixiweb claro/oscuro, Manrope/Instrument Serif, componentes compartidos, navegación negra app/agencia, login editorial, inbox móvil y panel de detalle accesible. Cinco vistas de desarrollo con ejemplos ficticios; no habilitan Meta/Brevo/widget.

Verificación y capturas en [F2 diseño](F2-DISENO-omnichannel.md). Próximo paso: revisión visual de Yani y conexión al proyecto de su cuenta nueva para probar pantallas privadas, aislamiento, roles, migraciones y flujos reales. No se tocó ninguna cuenta anterior.

## Acceso al proyecto nuevo — 2026-10-10

Yani informó que creó el proyecto y conectó la nueva cuenta. Se encontró abierto en Chrome el dashboard de `bzanbpyzujlogipxvkfn`. Sin embargo, el conector Supabase disponible en este chat todavía lista únicamente proyectos de la organización anterior; consultar el proyecto nuevo devuelve «You do not have permission to perform this action».

Pendiente: actualizar la autorización del conector con la nueva cuenta/organización y volver a verificar acceso al proyecto. No pedir claves ni contraseñas por chat. No se aplicaron migraciones ni se alteró ninguna base. Una vez disponible, inspeccionar esquema e historial antes de inicializar el entorno nuevo; no tratarlo como una copia de producción ni ejecutar backfill por suposición.

## F3 en ejecución — 2026-10-10

Yani ordenó continuar el build. La comprobación de acceso al proyecto nuevo sigue devolviendo falta de permisos, por lo que se continúa trabajo local independiente, sin declarar aceptadas F1/F2. F2 quedó en 2fea741 y se abrió `codex/omnichannel-f3-inbox` desde ese commit; main no se modificó.

Primer incremento: contratos de envío, política por canal/cuenta, adaptador WA YCloud/Kapso integrado al dispatch, extracción del destinatario con verificación del canal, clasificación explícita de envíos ambiguos sin retry automático. Suite completa: 1.696 unitarias pasan. [Alcance, evidencias y tareas pendientes F3](F3-MOTOR-omnichannel.md).

Segundo incremento: buffer conectado a runtime neutral de configuración, guardas contra procesamiento de canales no soportados y herramientas restringidas por canal/capacidad tanto en el modelo como en el registry. Se conserva KB, presupuesto, memoria y reintentos. Lecturas/derivación inicial del decision engine filtradas por workspace. 121 pruebas dirigidas y 1.707 unitarias completas pasan; typecheck y lint pasan.

Build de producción local del segundo incremento aprobado. Próximo paso local: persistencia durable de eventos/jobs/outbox y revalidación transaccional. La política pura de permisos/revisión no reemplaza esa persistencia. Instagram, Messenger y widget siguen deshabilitados. No hubo cambios Cloud, envíos externos, push/merge ni despliegue.

## Estado al cerrar incremento 3 — cola durable y Supabase habilitado, 2026-10-10

El bloqueo de acceso anterior quedó **resuelto**. Usar exclusivamente la conexión **Cuenta de saas whatsapp omni**, proyecto **bzanbpyzujlogipxvkfn** (PostgreSQL 17.11). Estaba vacío; ahora tiene las **71 migraciones aplicadas**, 42 tablas públicas y el historial idéntico al del repo. No repetir migraciones ni usar proyectos de la cuenta anterior.

F3 incremento 3: eventos/jobs/outbox, RPC de reserva con lease/fencing, recuperación segura y trigger de revisión/invalidez tras toma humana. Worker con revalidación de política y permiso durable previo al POST. No se conectó todavía el productor IA ni el cron de aplicación a este pipeline; WA mantiene su ruta compatible.

Verificado: 1.722 unitarias, 33 DB locales, typecheck/lint/build; smoke SQL sobre Cloud con rollback y dos carreras en procesos PostgreSQL distintos. Fixtures retirados: cero workspaces/usuarios/jobs; cron temporales eliminados y purga heredada inactiva. [Reporte F3 y evidencia](F3-MOTOR-omnichannel.md). Los avisos de seguridad heredados están clasificados allí; no equivalen a una auditoría integral terminada.

**Próximo paso:** configurar la app local para el proyecto nuevo y probar login/GoTrue + workspace de desarrollo, después conectar contexto/productores/worker/inbox. No hay usuario de acceso creado, credenciales de la app configuradas ni transportes nuevos activos. Mantener la rama `codex/omnichannel-f3-inbox`; main sigue intacta. No pedir otra aprobación de blueprint, Manual o Lista Roja. Sin compras, push, merge ni despliegue de la aplicación.

## Continuidad vigente — incremento 4, 2026-10-10

App local conectada al proyecto nuevo; **72 migraciones aplicadas**. Login GoTrue y creación de workspace desde la UI pasan. Inbox real con filtros por canal/cuenta/estado, búsqueda SQL, previews acotados y cursor. Navegación móvil mantiene filtros; Realtime y toma humana probados. Se conserva el guard de nuevos transportes.

Verificación: 1.725 unitarias, 40 DB, 20 E2E públicos/diseño, typecheck/lint y recorrido autenticado en Cloud. [Reporte y evidencia](F3-MOTOR-omnichannel.md). Se conserva el laboratorio sintético: un usuario QA, un workspace, dos conversaciones y un job cancelado. .env.local/.env.qa.local son privados e ignorados; no imprimir. Ledger en test-results/f3-inbox-fixture.json. El smoke Cloud no crea duplicados si falta su ledger: conciliar primero los IDs existentes.

**Próximo paso:** contexto confiable de identidad/capacidades, productores y worker/composer, reserva por comentario, backoff/cuotas y conciliación. Acceso administrador definitivo pendiente. Mantener codex/omnichannel-f3-inbox; no tocar main, puertos 3300/3301 ni cuentas Supabase antiguas. Sin compras, push/merge, despliegue de app o mensajes externos. Fases con aceptación integral: 0/9.

## Continuidad vigente — incremento 5, 2026-10-10

Contexto de servidor por identidad y cuenta, grants con evidencia/vencimiento, evento entrante WA referenciado y supresión por destinatario. Productor/worker compuestos internamente con adaptador de conexión exacta; **sin conectar todavía webhook, buffer o cron**. Composer, API de texto y acciones de plantillas bloquean cuentas no listas/revocadas y canales no habilitados. Notas internas siguen disponibles y refrescan el hilo al guardarse.

**Verificación:** 1.743 unitarias, 97 dirigidas tras ajuste final, typecheck/lint/build. Cloud GoTrue + API: 422 para un intento con capacidades inventadas, cero mensajes creados por ese intento. Navegador desktop/móvil: bloqueo visible y notas persistidas. [Reporte F3](F3-MOTOR-omnichannel.md), [evidencia](evidencias/F3-CONTEXTO-2026-10-10.json). Se reutilizan las 40 DB y 20 E2E públicos/diseño previas; no fueron repetidas en este corte.

Sin migraciones nuevas: 72 aplicadas. Laboratorio conserva 5 mensajes (3 entradas + 2 notas internas), cero outbox/cron activos. No hay credenciales de proveedores ni envíos reales. Mantener archivos .env/QA y ledger ignorados; no imprimirlos ni regenerar fixtures sin reconciliar.

**Siguiente bloque:** revalidar grant/identidad/supresión en el permiso transaccional; persistir mensaje y resultado del job en el inbox; conectar productores autenticados con flags. Luego reserva por comentario, cuotas/backoff y conciliación. Continúa F3 en su rama; no tocar main ni cambiar de fase todavía. No repetir aprobaciones.
