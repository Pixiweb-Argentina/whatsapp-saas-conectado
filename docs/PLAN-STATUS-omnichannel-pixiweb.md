# Estado de /plan — Omnichannel Pixiweb

> **Trabajo activo de F3:** continuar en C:/Users/Yani Acevedo/.codex/worktrees/omnichannel-f1/app-whatsapp-saas-conectado, rama codex/omnichannel-f3-inbox desde F2 2fea741. Se reutilizó el worktree de F1. F3: contratos/política y adaptador WA integrados al dispatch; runtime de configuración y herramientas restringidas por canal; 1.707 unitarias pasan. El proyecto Supabase nuevo es bzanbpyzujlogipxvkfn, pero el conector del chat sigue sin permisos. No usar db-whatsapp/db-chatfuel. La continuidad vigente y el reporte F3-MOTOR-omnichannel.md están en el worktree. Próximo bloque: eventos/jobs/outbox con revalidación transaccional. No iniciar otra fase aquí.

Actualizado: 2026-10-10. Fuente de construcción: [BLUEPRINT-omnichannel-pixiweb.md](../BLUEPRINT-omnichannel-pixiweb.md).

## Resultado

Blueprint **APROBADO por Yani el 2026-10-10**: «apruebo el blueprint comienza». Incluye 9 fases, 27 historias, 72 tareas, 18 templates de pantalla y 14 fuentes funcionales sin TikTok. /build iniciado en preparación; [La Pieza](../.claude/PRPs/PIEZA-omnichannel-pixiweb.md) generada. Yani eligió Build Manual: «ok avanzamos con manual». Fases implementadas: 0/9.

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
2. La Pieza ya generada; confirmar invariantes de Lista Roja antes de editar rutas/auth/webhooks/migraciones.
3. Ejecutar F1: baseline, copia/backfill, E2E inicial (script/dependencia presentes, suite/config no encontrados), cuentas de prueba y spikes.
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
