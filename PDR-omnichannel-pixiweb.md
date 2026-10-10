# PDR — Omnichannel Pixiweb

Versión 1.0 · 2026-10-10 · **BORRADOR para aprobación**.

## Visión

Ampliar el SaaS funcional de agentes de WhatsApp a una mensajería centralizada para WhatsApp, Instagram, Facebook Messenger y chat web, con automatizaciones por fuente de entrada y CRM Brevo bidireccional. Aplicar la identidad visual actual de Pixiweb.

La base existente es el punto de partida; se conservan tenancy, roles, agentes, conocimiento, agendamiento, proveedores WA y CRMs actuales. No se mide aún cuánto tiempo/dinero pierde el cliente por la fragmentación ni se declaran metas comerciales.

## Decisiones de Yani

1. Sin TikTok.
2. Instagram: DM y automatizaciones por comentarios de posts/Reels («hola» → guía).
3. Facebook conectado; widget de chat web.
4. Cada cliente conecta sus propias cuentas Meta.
5. Brevo: contactos, listas, oportunidades y dos sentidos de sincronización.
6. Design system de `https://pixiweb.com.ar/`, observado en vivo el 2026-10-10.

## Roles y público

Operador de atención (primario), administrador del cliente y administradora de agencia. Preservar roles técnicos `admin`, `manager`, `agent`, `viewer` y superadmin; ajustar capacidades, no inventar nuevo sistema de login.

## Recorrido principal

1. Administrador entra a su workspace, conecta Página/Instagram profesional y comprueba permisos/webhook.
2. Crea regla: post o Reel, keyword «hola», texto + enlace de guía y respuesta pública opcional.
3. Prueba en simulador, revisa resultado y activa.
4. Persona comenta; el SaaS envía una respuesta privada permitida y registra el resultado.
5. Cuando la persona responde, la conversación pasa a atención IA/humana dentro de la ventana aplicable.
6. El operador ve canal/cuenta, contexto de campaña y ficha de contacto sin exigir teléfono.
7. Brevo recibe contacto/lista/oportunidad mapeados y refleja cambios remotos; errores/conflictos son visibles.
8. WhatsApp, Messenger y widget participan del mismo inbox con políticas propias.

Alternativas: token revocado → reconectar; permiso incompleto → acción deshabilitada con motivo; comentario repetido → no duplicar; timeout ambiguo → conciliar; pausa humana → IA no envía; Brevo caído → atención sigue y sync queda pendiente.

## Alcance por entrega

**R1, núcleo utilizable:** regresión WA; modelo omnicanal; diseño Pixiweb en toda la app existente; onboarding Meta; IG DM/post/Reel; Messenger DM/comentario; widget; inbox unificado; Brevo bidireccional; reglas simples con condiciones y pasos ordenados; registros/pruebas/políticas.

**R2, fuentes ampliadas incluidas en el plan:** historias; IG.me/m.me; anuncios a IG/Messenger/WA; comentarios en anuncios IG y publicaciones Click-to-WhatsApp, según capacidad efectiva. No se promete paridad absoluta con Chatfuel antes de probar cada fuente.

**Fuera:** TikTok, campañas de email, compras/optimización de anuncios, difusiones sociales sin autorización de plataforma, builder visual libre de nodos, Instagram Live, grupos/perfiles personales de Facebook, nuevo billing, calendario/Kanban completos, migración masiva del historial de Chatfuel.

## Datos

Entradas: mensajes/comentarios/eventos Meta, mensajes YCloud/Kapso, mensajes del widget, configuración del cliente, catálogo/listas/contactos/oportunidades Brevo.
Salidas: mensajes autorizados, inbox y timeline, estados CRM, trazabilidad de automatizaciones, alertas operativas.
Entidades: workspace, conexión de canal, contacto, identidad por cuenta, conversación, mensaje, evento social, regla/version/paso/run, sesión web, enlace CRM y operación de sync.

## Criterios de éxito del producto

- Un comentario elegible «hola» genera como máximo una respuesta privada y abre seguimiento únicamente tras respuesta entrante habilitante.
- Una conversación de cada canal es operable en el mismo inbox con asignación/handoff.
- No se accede ni envía desde activos de otro workspace; probado con dos tenants.
- Un lead sin teléfono puede existir y sincronizarse a Brevo usando `ext_id`.
- Cambios de contacto/lista/oportunidad convergen en ambos sentidos sin loop; bajas no se revierten.
- Flujos WA anteriores y cambio YCloud/Kapso conservan su comportamiento.
- Diseño Pixiweb consistente a 375/768/1440 px, teclado y contraste AA en combinaciones de texto/control usadas.

Son objetivos de aceptación futuros, no resultados medidos.

## Supuestos y decisiones propuestas

- Onboarding Meta inicial vía Facebook Login for Business: requiere IG profesional vinculado a Página. Validar accesibilidad con cuentas objetivo.
- Un CRM activo por workspace; Brevo no fuerza desconectar otros clientes ni borra integraciones guardadas.
- Varias cuentas soportadas por el modelo, límite inicial configurable; no hacer teléfono o nombre de usuario claves globales.
- Nombre de trabajo «Omnichannel Pixiweb»; nombre comercial/precio/planes no definidos.
- Presupuesto, volumen, SLA comercial, cuentas de pruebas y fechas: pendientes. No condicionan la documentación; sí el dimensionamiento final y el lanzamiento.

## Límites de esta etapa

Investigación y documentos editables locales. `/build` requiere aprobación del blueprint y elección Build Manual/Modo Forja. En ese paso se genera La Pieza y se confirman invariantes de la Lista Roja antes de tocar webhooks, rutas o migraciones.
