# Continuidad de Omnichannel Pixiweb

Guardado por pedido de Yani el 2026-10-15 para /avivar. Actualizado al cerrar incremento33.

## Dónde continuar

- Implementación: C:/Users/Yani Acevedo/.codex/worktrees/omnichannel-f1/app-whatsapp-saas-conectado.
- Rama al guardar: codex/omnichannel-f3-account-inbox, incremento33 desde5dde69a. Confirmar Git; el nombre omnichannel-f1 del worktree no indica la fase actual.
- Checkout original C:/Users/Yani Acevedo/Documents/GitHub/apps/app-whatsapp-saas-conectado: preparación/documentación, NO implementar allí.
- Leer AGENTS.md y luego docs/PLAN-STATUS-omnichannel-pixiweb.md, .claude/PRPs/PIEZA-omnichannel-pixiweb.md y docs/F3-MOTOR-omnichannel.md DEL WORKTREE ACTIVO.
- Última evidencia: docs/evidencias/F3-BANDEJA-CUENTAS-2026-10-15.json. Historial detallado y pruebas en esas fuentes.

## Próximo paso acordado

F3 sigue abierta. Incremento33 materializa texto firmado de cuentas managed YCloud/Kapso en bandeja con RPC atómica sólo servicio/INVOKER/search_path vacío. Revalida sourceRevision/locks antes de crear evento/contacto/identidad/hilo/mensaje; fallo tardío revierte todo. Dos flags por UUID: CHANNEL_ACCOUNT_INGRESS_CONNECTIONS y CHANNEL_ACCOUNT_INBOX_CONNECTIONS; vacíos apagados. Conserva shadow31 cuando inbox está apagada; media queda sólo capturada, sin descarga/IA; receipts separados sin alterar unread/hilo. ACK materialized sólo después del guardado atómico.

Identidad conocida manda sobre contacts.phone editable. Actores E164 nuevos pueden compartir contacto entre cuentas, pero identidad/hilo/historial son exactos de cada conexión. No adopta conversaciones legacy NULL ni habilita opt-in. Hilos nuevos human_active/IAfalse, existentes con IA activa bloquean nueva materialización. Replays conservan IDs/unread/estado del operador; mismo wamid entre cuentas no colisiona. Ventana desde occurredAt, nunca receipt/reintento. No transforma histórico shadow en prueba live. Revocación/cambio/expiración de clave invalida guardado.

Incremento32 ya tiene verificación/permisos YCloud por cuenta con clave/fingerprint propio, callback desde CHANNEL_PUBLIC_ORIGIN estable, proof24h y evidencia delivered/read exacta de esa cuenta. Admin verifica/muta; manager consulta; SQL revalida membresía. Grant no habilita consentimiento/IA/rollout; UUID/replay/deriva/revocación protegidos en frontera final SQL. Kapso todavía sin verificador/permisos en ese flujo; no confundir recepción firmada sintética33 con habilitación operativa de proveedor.

Siguiente: alta operativa/origen permanente/cutover y preparación de renovación; verificador/permisos Kapso y cierre de AC US006–008. Preparar configuración/runbook reversible antes de publicar; despliegue requiere autoridad específica. No seguir anunciando materialización managed como pendiente de texto: ya está implementada y probada sintéticamente. Media en bandeja y revisión interactiva/responsive de formularios30/32 siguen pendientes. Browser Use denegó localhost/settings por política URL: no eludir con otro navegador/CDP/surface. Instagram/Facebook/widget/Brevo son fases posteriores. No repetir pilotos humanos/IA reales ya acreditados.

Evidencia33:98 versiones/nombres locales/Cloud iguales;1.968 unitarias/247DB/typecheck/lint pasan.14checks en nuevo archivo DB incluyen mismo probe local/PostgreSQL17 con rollback.76controles HTTP/Cloud:54captura/BD,21lector productivo readInboxPage/composer con GoTrue/RLS/filtros por cuenta,1ruta deshabilitada tras restaurar;4checks de setup aparte. Tres cuentas ficticias (2YCloud/1Kapso),mismo actor/ID,3hilos/mensajes/identidades,1contacto. Sin proveedor/modelo/mensaje real; no acredita nueva entrega ni Realtime en navegador.

Fixture3301 y sus eventos/mensajes/hilos/identidades/contacto/cuentas/claves/receipt/auditoría/membresía retirados mediante guardas de propiedad y contenido ficticio;0proofs/permisos managed. Hashes de todos los campos originales de mensajes/contactos/conversaciones/conexiones/integraciones idénticos.2workspaces/11mensajes/3jobs/2outbox/0cron activos preservados; existe cron heredado inactivo. Asesor sin novedades0ERROR/10WARN heredados/21INFO (sumar count/findings de grupos).

Next3100 restaurado al wrapper test-results/f3-permissions-next.mjs inbox,supervisor2040/sesión19969,normalRolloutFlags off/publicOrigin vacío/permissionsUiTestfalse/CHANNEL_ACCOUNT_INGRESS_CONNECTIONS y CHANNEL_ACCOUNT_INBOX_CONNECTIONS vacíos. PIDs/sesiones efímeros: verificar antes de operar. QA13040/sesión41430 y anterior26200 detenidos; no reiniciar. Túnel/callbacks no revalidados ni modificados; runner IA antiguo apagado. Último respaldo GitHub registrado df68657/preparación7ede6e4; incrementos31(1f943e7)/32(5dde69a)/33 locales, sin nuevo push/merge/deploy.

Auto-Blindaje33: resolver identidad conocida antes de teléfono editable; el teléfono editado no debe redirigir recepción. Anon tiene ACL sin SELECT a messages: espera42501, no [] por RLS, y nunca relajar permisos para que pase un test. Reintentos del smoke reutilizan occurredAt del evento persistido. Mantener además fuente managed desde nacimiento/inmutable, fingerprint proof separado de revisión de estado, conflictos23514(no40001),SQL$$ con callback y next-env generado fuera deGit.

## Autorizaciones y límites que deben sobrevivir

- Blueprint, Build Manual e invariantes de Lista Roja ya aprobados: no reiniciar entrevista ni pedir esas aprobaciones de nuevo. Ramas codex/ por etapa importante; main intacto.
- No compras ni billing. Sólo nueva cuenta Supabase/proyecto bzanbpyzujlogipxvkfn; no db-whatsapp/db-chatfuel.
- Ensayos reales humano/IA entregados, autorizaciones únicas consumidas; consentimiento/permisos temporales retirados. Nuevos mensajes/modelos necesitan autorización nueva.
- Mantener recepción original inbox y rollout apagado, opt-in false/grants reales vacíos hasta activación expresamente autorizada. Permiso de texto no es consentimiento ni IA.
- No reiniciar runner IA antiguo ni prepare/activate/generate/drain. Revisar runtime ignorado test-results/f3-ycloud-runtime.json; PIDs/túnel son efímeros.
- No usar ni detener puertos3300/3301. Proteger dashboard original/webhooks/credenciales.
- Push,merge,deploy y mensajes/modelos reales requieren autoridad específica; continuar no la implica.
- Conservar AGENTS.md y scaffolding ajeno untracked. No guardar secretos ni datos de contacto reales en memoria/Git.
