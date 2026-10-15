# Estado de /plan — Omnichannel Pixiweb

> **Trabajo activo de F3:** continuar en C:/Users/Yani Acevedo/.codex/worktrees/omnichannel-f1/app-whatsapp-saas-conectado, rama codex/omnichannel-f3-ai-pilot, commit 9425751. Supabase nuevo bzanbpyzujlogipxvkfn tiene86 migraciones. Entrada YCloud al buffer queue probada local/Cloud con datos sintéticos, sin activar en laboratorio. Una respuesta humana anterior entregada; consentimiento/grant temporal retirados y flags/IA apagados. Fuentes canónicas: docs/PLAN-STATUS-omnichannel-pixiweb.md, docs/F3-MOTOR-omnichannel.md y La Pieza del worktree. No implementar aquí ni reiniciar blueprint/Manual/Lista Roja.

**Preparación IA vigente — 2026-10-15:** falta integrar OpenRouter: no hay clave del workspace ni general local. Formulario vacío abierto en Ajustes→Integraciones→OpenRouter. Esperando ingreso de clave por Yani o alternativa gratuita; no pedir secretos en chat. Sin modelo/proveedor/envío ni compras/cambios de flags/permisos. Runner de generación única todavía por preparar después de concretar modelo/prompt/costo. Checks del incremento21 reutilizados;86 migraciones,F3 abierta.

**Antecedente — incremento21, 2026-10-15:** recepción/materialización y preparación privada del buffer en una sola transacción. Nuevo modo pipeline explícito, acotado y separado de legacy; conversaciones nuevas humanas, sin inferir permisos/consentimiento. Buffer sólo con tres flags y elegibilidad DB, modo queue fijado antes del consumo, sin mezclar batches legacy ni responder retroactivamente a replays/pausas. Migración86 aplicada una vez, ACL invoker sólo servicio.1.886 unitarias/156 DB/ocho relay/typecheck/lint pasan. SQL Cloud sintético verifica ráfaga/checkpoint/enqueue único/toma humana/handoff y revierte todos sus datos; cero modelo/proveedor/outbox de prueba. Asesor0ERROR/10WARN heredados/17INFO, sin nuevos hallazgos. Laboratorio real conserva cuatro mensajes/1job/1outbox accepted/0batches; GET Next inboxOnly, human_active/IA false/opt_in false/grants vacíos/cuatro flags apagados. HTTPS temporal no revalidado; sin cambios de endpoint/credenciales/original, envíos, modelos, compras, push, merge ni deploy. Próximo: preparar prueba real de IA con autorización concreta, más onboarding permanente/multi-cuenta. F3 abierta,0/9 aceptadas. Evidencia F3-YCLOUD-PIPELINE-2026-10-15.json en worktree.

**Antecedente — incremento20, 2026-10-15:** Yani autorizó una única respuesta y consentimiento temporal. API humana autenticada202 y core productivo del worker enviaron un solo POST a YCloud; GET confirma delivered a07:18:56 Argentina. Bandeja muestra una sola respuesta con atribución humana/Entregado. Receipt sent automático; delivered recibido/ignorado200 fue recuperado desde log real+GET exacto, sin reenvío. Fix para receipt válido hasta5s futuro pide retry500 antes de escribir; no fecha futura ni ventana extendida.1.877 unitarias/38 dirigidas/typecheck/lint pasan, HTTP sintético+4s confirma CLOCK_SKEW. Final:2 inbound/1nota/1outbound delivered/1job accepted/1outbox accepted/2receipts planned. Consentimiento false/opt_in_at null/grants vacíos/needs_permissions, IA/campañas/cuatro flags apagados. Next19601/relay59493/túnel67399. F3 aún abierta por IA/handoff/recuperación integral y onboarding permanente;0/9 aceptadas. Aprobación de mensaje consumida, no autoriza más envíos/modelos. Rama local, main intacto; sin nuevo push/merge/deploy. Evidencia F3-YCLOUD-RESPUESTA-HUMANA-2026-10-15.json en worktree.

**Antecedente de recepción — 2026-10-14:** Yani «Enviado». Evento evt_6acffccf47f5ae0997b23dae de «Hola bandeja F3» guardado por reintento real YCloud a19:11:58 Argentina; HTTP200/inboxOnly/accountMatched/recorded, una inserción en la conversación existente. Tres fallos previos sin filas parciales. Un contacto/identidad/conversación, dos inbound (uno histórico), una nota interna; identidad verificada, IA apagada y cero envíos/jobs/outbox. Corrección posterior de receivedAt local admite desfase máximo5s y limita marca al reloj de BD; occurredAt del proveedor sigue estricto.145 DB,25 unitarias dirigidas,typecheck/lint pasan; RPC Cloud del mismo evento con reloj+2s deduplica sin nueva fila.85 migraciones, ACL sólo servicio; cero ERROR/diez WARN heredados. Permisos de envío/grants y flags normales apagados; no promover consentimiento/ready por recepción. Evidencia F3-YCLOUD-INBOX-LIVE-2026-10-14.json en worktree. Próximo permisos reales y respuesta humana expresamente autorizada. F3 sigue abierta; main y original preservados, sin IA/envíos/compras/push/merge/deploy.

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
