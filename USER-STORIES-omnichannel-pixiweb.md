# USER-STORIES — Omnichannel Pixiweb

Versión 1.0 · 2026-10-10 · BORRADOR. 27 historias; F1–F7 núcleo, F8 fuentes ampliadas, F9 cierre de controles transversales. Los controles P0 de F9 se aplican desde la primera fase; F9 no autoriza postergarlos.

### US-001 — Preservar el SaaS operativo

**Prioridad:** P0 · **Fase:** F1

Como administradora quiero conservar WhatsApp, roles, agentes y datos para ampliar el producto sin perder atención.

- AC1: Con una copia de la base, el backfill conserva IDs y conteos de contactos/conversaciones/mensajes WA y produce reporte de colisiones.
- AC2: YCloud y Kapso superan los contratos vigentes, incluyendo templates, ecos, supresión y handoff.
- AC3: Se puede desactivar el nuevo canal y seguir atendiendo WhatsApp sin borrar historial.

### US-002 — Contactos e identidades sin teléfono

**Prioridad:** P0 · **Fase:** F1

Como operadora quiero atender a una persona de Instagram aunque no tenga teléfono.

- AC1: Crear contacto con phone nulo funciona en backend, UI y exportaciones aplicables; no se inventa email/phone.
- AC2: Dos IDs iguales de cuentas distintas no se mezclan; FKs/RLS bloquean relaciones entre workspaces.
- AC3: La conversación conserva connection_id e identidad; reconectar la misma cuenta no duplica identidades.

### US-003 — Verificar contratos externos

**Prioridad:** P0 · **Fase:** F1

Como administradora quiero saber qué capacidades están realmente habilitadas antes de ofrecerlas.

- AC1: Registrar versión Graph, scopes, activos de prueba y fixtures anonimizados para DM/comentario IG/FB.
- AC2: Registrar resultado de prueba Brevo de ext_id, listas, pipeline/deal, webhooks Sales y recuperación de un create ambiguo.
- AC3: Distinguir soporte documental, prueba sandbox, acceso avanzado y habilitación productiva; una falta de credenciales queda pendiente, no exitosa.

### US-004 — Aplicar diseño Pixiweb

**Prioridad:** P0 · **Fase:** F2

Como usuaria quiero una interfaz coherente con Pixiweb en todas las pantallas.

- AC1: Tokens, Manrope y acento Instrument Serif reemplazan el sistema visual previo según DESIGN.md.
- AC2: Auth, dashboard, inbox, settings, agentes/KB, analisis, onboarding, agency, /ui y /probar están cubiertos.
- AC3: Loading, empty, error y success no usan métricas ni datos reales inventados.

### US-005 — Usar la app en móvil y con teclado

**Prioridad:** P0 · **Fase:** F2

Como operadora quiero completar tareas desde 375px y usando teclado.

- AC1: No hay desbordamiento del flujo principal a 375/768/1440px; volver del chat conserva filtros/scroll.
- AC2: Foco, labels, errores, diálogos y contraste de los pares reales cumplen los objetivos definidos.
- AC3: Reduced-motion desactiva movimiento decorativo; canal y estado no dependen solo del color.

### US-006 — Atender desde una bandeja

**Prioridad:** P0 · **Fase:** F3

Como operadora quiero ver las conversaciones de los cuatro canales en el mismo inbox.

- AC1: Filtrar por canal, cuenta, asignación y estado; cada fila y conversación identifica canal/cuenta.
- AC2: Timeline presenta texto y tipos de media soportados, notas internas y contexto de origen sin tratar comentario público como DM.
- AC3: Lecturas y búsquedas respetan tenant y rol; estados delivered/read solo aparecen si el proveedor los confirma.

### US-007 — Controlar IA y atención humana

**Prioridad:** P0 · **Fase:** F3

Como operadora quiero tomar una conversación y evitar respuestas automáticas simultáneas.

- AC1: Tomar/pausar invalida jobs IA pendientes y revalida state_revision antes del envío.
- AC2: Composer explica por qué puede o no enviar según canal, evidencia y ventana.
- AC3: Un admin no puede eludir una política de Meta; devolver a IA es explícito.

### US-008 — Conservar fiabilidad de mensajes

**Prioridad:** P0 · **Fase:** F3

Como administradora quiero reintentos seguros y trazabilidad.

- AC1: Duplicados de webhook/receipt/eco no generan nuevos mensajes ni ejecuciones.
- AC2: Reinicio durante job recupera lease; timeout tras POST produce unknown y no retry ciego.
- AC3: Firma inválida, activo ajeno y evento fuera de orden tienen pruebas; ACK ocurre luego de persistir.

### US-009 — Conectar cuentas Meta por cliente

**Prioridad:** P0 · **Fase:** F4

Como admin quiero conectar mi Página y cuenta profesional desde mi workspace.

- AC1: OAuth state es de un uso, ligado a sesión/tenant/rol; solo se pueden seleccionar activos autorizados.
- AC2: Permisos parciales, token revocado y webhook no recibido se muestran con recuperación.
- AC3: Un activo ya asignado a otro workspace no se asocia silenciosamente; credenciales nunca llegan al navegador.

### US-010 — Automatizar mensajes de Instagram

**Prioridad:** P0 · **Fase:** F4

Como operadora quiero responder DMs de Instagram con el agente existente o manualmente.

- AC1: DM real elegible entra al inbox, conserva identidad scoped y puede recibir respuesta autorizada.
- AC2: Mensajes expirados o sin permisos bloquean envío con razón; media no soportada muestra alternativa clara.
- AC3: Prueba con cuenta externa distingue desarrollo de acceso avanzado.

### US-011 — Enviar guía por comentario

**Prioridad:** P0 · **Fase:** F4

Como cliente quiero que quien comente hola en mi post/Reel reciba mi guía.

- AC1: Regla activa coincide con post y keyword; reserva única por comentario; envía un texto con URL HTTPS configurada.
- AC2: Un duplicado, dos reglas coincidentes o replay no repite private reply; comentario viejo/no elegible queda bloqueado.
- AC3: No hay seguimiento hasta respuesta del destinatario; respuesta pública opcional tiene su propio resultado.

### US-012 — Crear y probar reglas

**Prioridad:** P0 · **Fase:** F4

Como manager quiero configurar una regla y ver su resultado antes de activarla.

- AC1: Seleccionar cuenta/fuente/post, keyword y pasos, revisar prioridad y activar una versión inmutable.
- AC2: Simulación muestra match/política/pasos sin enviar mensajes ni escribir CRM.
- AC3: Pausar cancela pendientes; migración de v1 conserva comportamiento y no habilita triggers no implementados.

### US-013 — Atender Messenger

**Prioridad:** P0 · **Fase:** F5

Como operadora quiero atender mensajes de una Página de Facebook junto a WhatsApp e Instagram.

- AC1: Evento entrante resuelve Page/PSID/conversación correctos y admite respuesta autorizada.
- AC2: Handoff, adjuntos soportados y expiración utilizan capacidades Messenger, no las de IG por analogía.
- AC3: Misma persona con otro ID de plataforma no se fusiona automáticamente.

### US-014 — Responder comentarios de Facebook

**Prioridad:** P0 · **Fase:** F5

Como cliente quiero responder por privado a comentarios elegibles de mis publicaciones.

- AC1: Keyword y post disparan una única private reply con políticas vigentes verificadas en la Página de prueba.
- AC2: Respuesta pública exige permisos propios y no duplica la privada por error de uno de los pasos.
- AC3: Perfil personal, grupo o comentario no habilitado nunca se ofrecen como conexión compatible.

### US-015 — Instalar widget

**Prioridad:** P0 · **Fase:** F6

Como admin quiero copiar un snippet e incluir chat en mis sitios autorizados.

- AC1: Snippet versionado crea iframe accesible con configuración mínima y un site_id público.
- AC2: Origen permitido funciona, no permitido se rechaza; escritorio y móvil completan mensaje/respuesta.
- AC3: Crear varios sitios no permite que un visitante acceda a conversaciones de otro sitio/workspace.

### US-016 — Continuar una sesión web privada

**Prioridad:** P0 · **Fase:** F6

Como visitante quiero recuperar mi conversación sin revelar el historial de otra persona.

- AC1: Sesión opaca con TTL/revocación funciona sin cookies de terceros y solo permite su conversación.
- AC2: Ingresar el email de otra persona no obtiene su historial ni verifica identidad.
- AC3: Rate limit, texto inseguro, postMessage falso y sesión vencida tienen recuperación y no exponen secretos.

### US-017 — Conectar Brevo

**Prioridad:** P0 · **Fase:** F7

Como admin quiero conectar la cuenta Brevo de mi negocio y revisar sus permisos.

- AC1: API key se guarda cifrada/write-only, prueba conexión y muestra cuenta sin exponer credencial.
- AC2: Un solo CRM activo por workspace; cambiar de CRM requiere selección explícita sin borrar el anterior.
- AC3: Cuenta distinta invalida mapeos/jobs anteriores; desconectar detiene sync.

### US-018 — Sincronizar contactos

**Prioridad:** P0 · **Fase:** F7

Como operadora quiero que los datos del contacto converjan con Brevo.

- AC1: Lead sin teléfono/email se vincula por ext_id estable; remote ID queda mapeado sin forceMerge.
- AC2: Cambios en ambos sentidos convergen; un eco no crea loop y conflicto mismo campo es visible.
- AC3: Supresión/baja no se revierte por importación, etiqueta ni nuevo comentario.

### US-019 — Sincronizar listas

**Prioridad:** P0 · **Fase:** F7

Como manager quiero mantener listas y membresías administradas entre SaaS y Brevo.

- AC1: Catálogo seleccionado y renombres/altas explícitas se reflejan en ambos lados.
- AC2: Deltas de membresías no borran listas ajenas; baja simultánea conserva restricción hasta resolver.
- AC3: Sin evento disponible, reconciliación paginada refleja el cambio y muestra última revisión/lag.

### US-020 — Sincronizar oportunidades

**Prioridad:** P0 · **Fase:** F7

Como operadora quiero crear y actualizar una oportunidad sin salir de la ficha.

- AC1: Usa pipeline/etapa reales, vínculo a contacto y monto/moneda opcionales sin inventar valores.
- AC2: Cambios remotos de etapa/atributos/asociación se reflejan y cambios locales se confirman.
- AC3: Timeout de creación queda unknown y no crea otra oportunidad al reintentar sin conciliación.

### US-021 — Resolver conflictos y recuperar sync

**Prioridad:** P0 · **Fase:** F7

Como admin quiero entender y resolver cambios simultáneos o fallas.

- AC1: Comparación local/base/remoto por campo, resolución con expectedRevision y auditoría.
- AC2: Cuotas/429/backoff, paginación, cursor y cola persistente permiten converger después de caída.
- AC3: Borrado remoto genera tombstone; retry no resucita datos ni afecta atención por chat.

### US-022 — Atender desde historias

**Prioridad:** P1 · **Fase:** F8

Como cliente quiero reglas para las interacciones de historias que permita Meta.

- AC1: Pruebas distinguen respuesta DM, mención y comentario; habilitan solo variantes recibidas y soportadas.
- AC2: Vista/like aislado no dispara un DM ni amplía la ventana.
- AC3: Historia vencida/media ausente muestra contexto mínimo sin romper inbox.

### US-023 — Conservar origen de enlaces

**Prioridad:** P1 · **Fase:** F8

Como cliente quiero distinguir chats que llegaron por ig.me/m.me cuando haya referencia.

- AC1: Enlace/configuración de referencia se prueba en cuenta real y el evento conserva metadata disponible.
- AC2: Clic sin mensaje/evento habilitante no dispara respuesta.
- AC3: Si la atribución no está disponible, entra como DM normal con origen desconocido, sin inventarlo.

### US-024 — Usar fuentes de anuncios IG/FB

**Prioridad:** P1 · **Fase:** F8

Como cliente quiero reglas de comentarios de anuncios y conversaciones publicitarias.

- AC1: Distingue comentario en anuncio de conversación desde anuncio; valida scopes y payloads por variante.
- AC2: Extensión Click-to-Instagram Direct de hasta 7 días solo se activa con elegibilidad demostrada; no se propaga a Messenger.
- AC3: No hay compra, modificación ni optimización de campañas; capability gate visible.

### US-025 — Atribuir entradas WhatsApp

**Prioridad:** P1 · **Fase:** F8

Como cliente quiero conservar la fuente de anuncios/publicaciones que llevan a WhatsApp.

- AC1: Fixtures y prueba real en YCloud/Kapso identifican referral/ctwa_clid si existen.
- AC2: Texto prellenado no se trata como identificador confiable; origen faltante se informa desconocido.
- AC3: La metadata no altera políticas de templates ni reglas actuales por sí sola.

### US-026 — Operar y revocar integraciones

**Prioridad:** P0 transversal · **Fase:** F9

Como admin quiero diagnosticar, pausar y revocar una conexión.

- AC1: Panel muestra salud, último evento, jobs/unknown/conflictos y error accionable sin secretos.
- AC2: Revocación cancela nuevos envíos/sync de esa conexión; auditoría, exportación/retención/eliminación se prueban.
- AC3: Guías de rollback y recuperación se ensayan; autorización necesaria antes de acciones productivas.

### US-027 — Aceptar el producto completo

**Prioridad:** P0 transversal · **Fase:** F9

Como dueña del SaaS quiero evidencia de que la ampliación funciona y conserva la base.

- AC1: Matriz de 14 fuentes diferencia validado/no disponible/pendiente; no se declara paridad por tener un toggle.
- AC2: QA real de WA/IG/FB/Web/Brevo, dos tenants, roles, móvil y diseño; evidencia sin datos sensibles.
- AC3: Build/typecheck/lint/tests pertinentes pasan; aprobación de blueprint, modo, credenciales/accesos y autorización de deploy se registran por separado.

