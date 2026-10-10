# Relevamiento: de WhatsApp a mensajería centralizada

Fecha: 2026-10-10. Investigación documental y lectura estática del fork, commit `28a1530`.
No se ejecutaron conexiones reales, migraciones, envíos ni despliegues.

## Pedido y decisiones confirmadas

- Ampliar el SaaS existente a WhatsApp + Instagram + Facebook Messenger + chat web.
- Automatizar comentarios de publicaciones/Reels: «comentá hola y te mando la guía».
- Excluir TikTok.
- Cada cliente conecta sus propias cuentas desde el SaaS.
- Brevo: contactos, listas y oportunidades, sincronizados en ambos sentidos.
- Rediseñar con el design system **actual** de https://pixiweb.com.ar/.
- Entregable de esta etapa: investigación y blueprint Forge; construcción posterior a aprobación.

## Evidencia del repositorio

| Área | Evidencia local | Qué se conserva / qué falta |
|---|---|---|
| Stack | `package.json`, `package-lock.json` | Next 16, React 19, TS, Tailwind 3.4, shadcn/Radix, Supabase, Zod 4, Zustand 5, AI SDK 6; no bajar AI SDK a v5 por el template genérico de Forge |
| Inbox y estados | `src/features/inbox/types/index.ts`, `services/state-machine.ts` | Conversaciones, asignación, IA, humano, handoff y mensajes; agregar canal/cuenta visibles |
| Contactos | `supabase/migrations/20260608000000_foundation.sql` | `phone NOT NULL`, único por workspace/teléfono; incompatible con leads sociales sin teléfono |
| Conversaciones | misma migración | Enum `conversation_channel` solo `whatsapp`; unicidad `(workspace_id,contact_id,channel)` insuficiente para varias cuentas del mismo canal |
| Mensajes | `src/features/inbox/services/dispatch.ts` | Persiste antes de enviar y contempla envíos no confirmados; está acoplado a teléfono, WhatsApp y `wamid` |
| Proveedores WA | `services/whatsapp-provider.ts`, `services/whatsapp-sender.ts` | YCloud/Kapso, un proveedor WA activo por workspace; mantenerlos |
| Webhooks WA | `src/app/api/webhooks/{ycloud,kapso}/route.ts`, normalizadores correspondientes | Firmas, deduplicación y recepción. No se encontró manejo explícito de `referral`/`ctwa_clid` en `src`; atribución publicitaria pendiente |
| Buffer/agente | `src/features/inbox/services/buffer.ts` | Reutilizar procesamiento, conocimiento, costos, estado y handoff; desacoplar configuración/canales y herramientas disponibles |
| Automatizaciones | `src/features/automations/lib/rule-schema.ts`, `services/{expand,executor}.ts` | Ejecuta `first_message`, `keyword_match`, `handoff_requested`, `lead_qualified`, `appointment_upcoming`. No ejecuta `inactivity_24h`/`window_closing` aunque existan valores históricos |
| Acciones actuales | mismo schema | Template WA, asignar, etiquetar, cerrar, handoff; faltan comentario social, private reply y envío por canal |
| CRM | `src/features/inbox/services/crm-sync.ts`, `settings/lib/crm-integration.ts` | HighLevel y HubSpot, **un CRM activo por workspace**, sin interfaz común completa; Brevo debe incorporarse a la exclusividad y al despacho |
| Cifrado | `src/shared/lib/integration-secrets.ts`, `crypto.ts` | AES-256-GCM con contexto de tenant/proveedor; extender el contexto a conexión/cuenta |
| Ventana | `20260927000001_whatsapp_provider_per_workspace.sql` y `dispatch.ts` | La guarda SQL vigente aún es genérica, contempla null y `override_admin`; no trasladarla tal cual a Meta/Widget. Hacer permisos de envío explícitos por canal |
| UI | `src/app/globals.css`, `COMPONENT_RULES.md`, `src/features/ui-kit/` | DS actual del fork: Glass + Electric Lime, Space Grotesk/Geist, oscuro por defecto. Rediseño debe reemplazarlo conscientemente y actualizar showcase/reglas |
| Continuidad | `.claude/PRPs/pieza-base.md`, `pieza-ai.md` | Son templates de Forge, no planes aprobados de esta ampliación |

«Funciona bien» es el estado reportado por Yani para la base. La inspección de código no equivale a haber probado el despliegue o la base remota.

## Las 14 fuentes de la captura, sin TikTok

R1 = núcleo omnicanal; R2 = expansión de fuentes de entrada. R2 sigue dentro del alcance del blueprint.

| ID | Canal / fuente | Requisito funcional | Mecanismo y límite | Entrega |
|---|---|---|---|---|
| IG-01 | Mensajes directos | Responder con IA o humano; bandeja y contexto compartidos | Messaging API, eventos de mensajes; cuenta profesional y ventana aplicable [M1,M3] | R1 |
| IG-02 | Publicaciones y Reels | Elegir post, palabra clave y guía; respuesta privada; respuesta pública opcional | Webhook `comments`, private reply por `comment_id`; una respuesta inicial, hasta 7 días; seguimiento tras respuesta del destinatario [M2] | R1 |
| IG-03 | Historias | Automatizar respuestas, menciones y comentarios cuando el evento esté disponible | Separar DM de respuesta a historia, mención y comentario público; no asumir un webhook idéntico ni tratar visualizaciones como mensajes [M1,M2]; validar payloads por variante | R2 |
| IG-04 | Anuncios en publicaciones | Disparar desde comentario elegible en anuncio | No es lo mismo que clic a mensaje; permisos/activos publicitarios y acceso al comentario deben probarse [M2,M4] | R2 condicionado |
| IG-05 | Enlace IG.me | Abrir conversación y conservar origen si Meta lo entrega | Entrada por enlace; no prometer que cada clic entregue un evento ni habilite mensaje; fallback a mensaje entrante sin atribución | R2 condicionado |
| IG-06 | Anuncios que dirigen a Instagram | Regla por origen publicitario de conversación | Mensaje/postback/referral recibido; no actuar por impresión o clic sin evento habilitante. Requiere prueba del payload vigente | R2 condicionado |
| FB-01 | Mensajes entrantes | Inbox de Messenger de Páginas, IA y humano | Send API + webhooks, token de Página y permisos de mensajería [M3,M5] | R1 |
| FB-02 | Publicaciones | Comentario con keyword → mensaje privado y respuesta pública opcional | Private Replies de Página; una respuesta inicial hasta 7 días; seguir conversando solo luego de respuesta [M5] | R1 |
| FB-03 | Enlace m.me | Abrir Messenger y clasificar referencia disponible | `ref`/postback/referral cuando existan; un clic aislado no se toma como consentimiento universal | R2 condicionado |
| FB-04 | Anuncios a Messenger | Enrutar conversación según anuncio de origen | Usar metadata efectivamente recibida. No incluye crear/comprar/optimizar anuncios | R2 condicionado |
| WA-01 | Mensajes entrantes | Mantener lo existente y mostrarlo junto a otros canales | Adaptador hacia YCloud/Kapso; preservar plantillas, opt-out, buffer y coexistencia | R1 regresión |
| WA-02 | Click-to-WhatsApp Ads | Conservar origen y ejecutar regla tras mensaje entrante | Parsear referral de proveedor cuando esté presente; evidenciar con fixtures y cuenta real [M6] | R2 |
| WA-03 | Publicaciones Click-to-WhatsApp | Distinguir mensajes originados desde una publicación/enlace | No hay equivalencia automática con comentario→DM de IG. Enlace/texto prellenado puede orientar; atribución puede faltar | R2 condicionado |
| WEB-01 | Chats del sitio web | Widget embebible con IA, humano y persistencia | Canal propio, loader + iframe y sesión de visitante; mismo inbox; no depende de Messenger ni Brevo Conversations | R1 |

Las filas condicionadas deben mostrar «Disponible al validar esta fuente» hasta aprobar una prueba real. No presentar como «Activado» una capacidad cuya recepción no fue comprobada.

## Elementos adicionales visibles en el menú de Chatfuel

| Elemento | Decisión de alcance |
|---|---|
| Reglas «Por defecto» / asistente de IA | Reutilizar agente/KB y sumar reglas por canal/cuenta/fuente con precedencia explícita |
| Base de conocimiento | Reutilizar; evitar duplicarla por canal |
| Chats | Ampliar inbox existente |
| Contactos | Identidad unificada con perfiles por canal y ficha CRM |
| Tablero Kanban | No se encontró módulo autónomo equivalente. Oportunidades Brevo en lista/ficha en R1; Kanban completo queda fuera de esta ampliación salvo pedido posterior |
| Calendario | Preservar agendamiento actual; no crear un calendario completo por aparecer en la referencia |
| Difusiones | No ampliar a envíos masivos de IG/Messenger; su presencia en Chatfuel no otorga permiso de envío |
| Optimización de anuncios | Fuera: solo recepción/atribución de conversaciones, no gestión de campañas ni gasto |
| Plantillas | Preservar WA; distinguirlas de los textos guardados para private replies |
| Probar automatización / vista previa | Incluir simulación sin efectos externos y prueba real separada, explícita y registrada |

## Meta: camino recomendado

**Integración directa oficial**, sin scraping ni reutilización de cookies. Una app del SaaS y onboarding por workspace con **Facebook Login for Business**, para conectar la Página y su Instagram profesional vinculado. Es un supuesto de producto explícito: Instagram Business/Creator vinculado a Página; no cuentas personales.

La alternativa Instagram Login permite IG profesional sin Página. La colección oficial [M4] conserva restricciones que no deben generalizarse: la descripción principal actualizada el 2026-09-28 [M7] incluye menciones en ambos flujos y distingue limitaciones de anuncios/product tagging. Prevalece la documentación actual de cada endpoint. No mezclar sus scopes `instagram_business_*` con los de Facebook Login. Se reserva como ampliación posterior, si el onboarding con Página impide adopción; no implementar dos flujos de autenticación de entrada.

Permisos candidatos para el flujo elegido, a contrastar con el App Dashboard y versión fijada en F1: `pages_show_list`, `pages_manage_metadata`, `pages_messaging`, `pages_read_engagement`, `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`; `pages_read_user_content` para contenido de usuarios cuando corresponda y `pages_manage_engagement` para respuestas públicas. `ads_read`/`ads_management` solo si los endpoints/roles requeridos lo exigen. Pedir y revisar por capacidad, no conceder acceso publicitario genérico innecesario.

Para cuentas de clientes ajenas a roles de desarrollo se requiere el acceso avanzado aplicable, revisión de la app y verificaciones de negocio que Meta exija. Preparar sitio/privacidad/eliminación de datos, URLs HTTPS, OAuth, screencast y credenciales de revisión. No se verificó una app Meta concreta ni su aprobación. No estimar tiempos de aprobación como tiempo de desarrollo.

**Ventanas verificadas en la documentación vigente [M7]:** la regla habitual es 24 horas desde mensaje entrante habilitante. La primera interacción a partir de anuncios Click-to-Instagram Direct puede habilitar hasta 7 días, bajo las condiciones del producto. Registrar la evidencia del evento y habilitar esta excepción solo después del spike con la versión fijada; no extender a Messenger ni a todos los mensajes de Instagram por analogía. Human Agent tiene otra extensión, exclusivamente para atención humana y con el acceso aplicable; no habilita IA ni secuencias automáticas. El plazo de private reply desde un comentario es un permiso separado, no una ventana general de conversación.

### «Comentá hola» sin violar el modelo de mensajes

1. Recibir comentario, comprobar firma y determinar la cuenta de destino desde el activo Meta registrado.
2. Persistir evento antes de acusar recibo, deduplicar y evaluar regla activa/versionada.
3. Normalizar texto, comparar keyword y validar publicación, edad del comentario, exclusiones y política.
4. Reservar atómicamente el derecho de respuesta: una respuesta inicial por comentario, aunque coincidan varias reglas.
5. Enviar **un texto con enlace HTTPS a la guía** mediante private reply, no intentar adjuntar un PDF a una capacidad no validada.
6. Marcar esperando respuesta; no iniciar una secuencia de DMs ni al agente por el mero comentario.
7. Si la persona responde, abrir la ventana pertinente y continuar con agente/humano. La IA nunca decide si Meta permite enviar.
8. Si hay timeout después de un posible envío, estado `unknown`; conciliar, nunca reintentar a ciegas.

El link de la guía lo provee/configura cada cliente. No se inventa ni se publica una guía.

## Brevo: factibilidad y decisiones

- REST API v3 admite contactos, listas, oportunidades y asociaciones [B1–B5].
- Un contacto puede crearse con `ext_id`, sin inventar email ni teléfono para un lead de Instagram [B1]. Usar identificador estable del SaaS, con workspace en el namespace.
- Las apps OAuth nuevas se documentan como privadas, autorizables dentro de la propia organización [B6]. Base del SaaS: API key individual por workspace, cifrada y nunca devuelta al navegador. OAuth público no es requisito del lanzamiento.
- Mantener un solo CRM activo: HighLevel **o** HubSpot **o** Brevo. «Bidireccional» no significa sincronizar tres CRMs entre sí.
- Webhooks de contactos y listas disponibles; la referencia genérica documenta `contactUpdated`, `contactDeleted`, `listAddition` y otros eventos, pero no promete cada cambio posible [B3].
- La guía Sales CRM enumera eventos de oportunidades [B4]; el endpoint genérico de webhooks no expone un tipo `sales` en la referencia leída. Verificar forma de alta disponible en la cuenta; no inventar `type: sales`.
- Bidireccionalidad garantizada por diseño con webhooks **más reconciliación paginada** y cursor/presupuesto de API. Donde falte evento, se informa sincronización eventual y última revisión.
- La documentación tiene cuotas distintas por grupo de endpoints, incluso 100 solicitudes/hora para «otros» en la categoría general [B7]. No hacer polling de cada oportunidad por minuto.
- Desuscripción/opt-out no se revierte por un comentario, una importación, un merge o una edición. No usar `forceMerge:true`. No borrar remotamente por un borrado local sin una acción específica.
- Listas: catálogo, creación/renombre explícitos y membresías mapeadas en ambos sentidos; no equivalen a todas las etiquetas locales. Oportunidades: pipeline/etapa/importe/moneda/contacto; no inventar importes.
- Email marketing/campañas y Brevo Conversations quedan fuera; son productos distintos de esta integración CRM.

## Widget propio

Elegido para que el SaaS posea su inbox, identidad, agente y handoff sin requerir login social. Script pequeño que monta iframe del SaaS; configuración pública mínima por `site_id`; origen permitido exacto, sesión aleatoria y credencial firmada acotada a sitio/visitante/conversación. No exponer la service-role ni consultas abiertas a conversaciones.

El identificador de visitante no prueba quién es una persona. Un email tipeado tampoco autoriza recuperar historiales previos. Empezar conversación anónima, vincular solo con prueba de identidad o revisión autorizada. El embedding debe funcionar sin depender de cookies de terceros y permitir revocar sesión/retención.

## Registro de fuentes consultadas

Consultadas el 2026-10-10. Meta devolvió errores al lector web en varias páginas; M2 y M7 se leyeron directamente en navegador (páginas oficiales, actualizadas 2026-06-30 y 2026-09-28). No se usaron artículos de terceros como autoridad técnica.

| ID | Fuente primaria | Uso / estado de evidencia |
|---|---|---|
| M1 | [Meta, colección Instagram](https://www.postman.com/meta/workspace/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00) | Send API, cuentas profesionales, límites; colección puede ir detrás del App Dashboard |
| M2 | [Meta, Private Replies Instagram](https://developers.facebook.com/documentation/instagram-platform/private-replies) | Leída en navegador: comentarios, endpoint, permisos de ambos logins, 7 días, respuesta única y seguimiento de 24h |
| M3 | [Meta, Conversations API](https://www.postman.com/meta/messenger-platform-api/folder/22794852-255610cd-47f5-4f4d-b3fa-71aec360be9a) | Permisos Messenger/IG, acceso avanzado, alcance del historial |
| M4 | [Meta, Instagram Login](https://www.postman.com/meta/instagram/folder/1z5vxzu/instagram-api-with-instagram-login) | Scopes; las restricciones de la colección deben contrastarse con M7 y el endpoint vigente |
| M5 | [Meta, Private Replies Messenger](https://developers.facebook.com/docs/messenger-platform/discovery/private-replies) | Página, una respuesta, 7 días y respuesta del destinatario; lectura disponible pero página con antigüedad de rastreo: reconfirmar al construir |
| M6 | [Meta, WhatsApp webhook reference](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components) | Referencia para spike de referral; payload/version/proveedor todavía por validar, no prueba de paridad en este fork |
| M7 | [Meta, Instagram Platform Overview](https://developers.facebook.com/documentation/instagram-platform/overview) | Leída en navegador; ventanas 24h y caso Click-to-Instagram Direct de hasta 7 días, Human Agent, logins, revisión, IDs e historial |
| B1 | [Brevo, crear contacto](https://developers.brevo.com/reference/create-contact) | `ext_id`, email/SMS, `forceMerge` y atributos; Markdown oficial leído por HTTP |
| B2 | [Brevo, sincronizar contactos/listas](https://developers.brevo.com/docs/synchronise-contact-lists) | Atributos, listas y membresías |
| B3 | [Brevo, crear webhook](https://developers.brevo.com/reference/create-webhook) | Eventos, autenticación y headers personalizados |
| B4 | [Brevo, Sales CRM webhooks](https://developers.brevo.com/docs/sales-crm-webhooks) | Eventos de etapas/atributos/asociaciones |
| B5 | [Brevo, crear oportunidad](https://developers.brevo.com/reference/create-a-deal) | Pipelines/etapas/asociación a contactos |
| B6 | [Brevo, crear app](https://developers.brevo.com/docs/apps-getting-started) | Restricción actual a apps privadas |
| B7 | [Brevo, límites API](https://developers.brevo.com/docs/api-limits) | Presupuesto y backoff |
| B8 | [Brevo, changelog](https://developers.brevo.com/changelog) | No iniciar nueva integración con `/contacts/batch`, deprecación anunciada para 2026-10-30 |
| D1 | [Pixiweb, sitio actual](https://pixiweb.com.ar/) | Inspección visual y estilos computados; ver `DESIGN.md` |
| S1 | [Supabase changelog](https://supabase.com/changelog.md) | Lectura del índice reciente; no justifica cambiar el stack del fork |

## Incertidumbres que se resuelven con spikes

App/negocio Meta disponibles y aprobados, versión Graph a fijar, scopes efectivamente exigidos por activos, entrega de referrals IG.me/m.me/ads, eventos de historias, payloads publicitarios de YCloud/Kapso, alta de webhooks Sales Brevo, cuotas/planes de cada cliente y carga esperada. Son condiciones del lanzamiento, no motivos para inventar capacidades ni bloquear la redacción del plan.
