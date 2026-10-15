# Continuidad de Omnichannel Pixiweb

Guardado por pedido de Yani el 2026-10-15 para /avivar.

## Dónde continuar

- Implementación: C:/Users/Yani Acevedo/.codex/worktrees/omnichannel-f1/app-whatsapp-saas-conectado.
- Rama al guardar: codex/omnichannel-f3-account-ingress, incremento31 desde df68657. Confirmar Git antes de trabajar; el nombre omnichannel-f1 del worktree no indica la fase actual.
- Checkout original C:/Users/Yani Acevedo/Documents/GitHub/apps/app-whatsapp-saas-conectado: preparación y documentación, NO implementar allí.
- Leer AGENTS.md y luego, en el worktree activo: docs/PLAN-STATUS-omnichannel-pixiweb.md, .claude/PRPs/PIEZA-omnichannel-pixiweb.md y docs/F3-MOTOR-omnichannel.md.
- Última evidencia: docs/evidencias/F3-INGRESO-CUENTAS-2026-10-15.json. Las pruebas y el historial están en esas fuentes, no se duplican aquí.

## Próximo paso acordado

F3 sigue abierta. Incremento31 completa fuente privada por conexión, transporte exacto y captura firmada aislada de eventos/comprobantes YCloud/Kapso. RPC sólo servicio/invoker/search_path vacío; credenciales expiradas/revocadas/legacy excluidas y AES-GCM con propietario exacto. Revisión de fuente y locks conexión/clave antes de guardar; replay dedup por cuenta, colisiones rechazadas. Ingreso separado /api/webhooks/whatsapp-accounts/[workspaceId]/[connectionId] bajo CHANNEL_ACCOUNT_INGRESS_CONNECTIONS, nuevo flag por UUID de conexión, vacío=apagado. No comparte flags de workspace. Capta eventos y ledger de receipts; no materializa bandeja/contactos/conversaciones, no buffer/modelo/envío ni permiso por guardar. Adaptador managed exige ready; no hay cuentas reales nuevas ready ni grants.

Siguiente: verificación de proveedor y permisos persistentes ligados a sourceRevision/callback por conexión; después materializar bandeja de adicionales, origen estable/alta/cutover/renovación y AC restantes US006–008. Verificadores/permisos y materialización existentes aún usan legacy_integration_id y callback antiguo; no afirmar onboarding multicuenta operativo. Las pruebas reales de respuesta humana/IA ya acreditadas no se repiten. Revisión interactiva/responsive del formulario anterior pendiente: Browser Use denegó localhost/settings por política URL; no intentar otro navegador/CDP para eludirlo. Este bloque sólo backend, sin operaciones de navegador. Instagram/Facebook/widget/Brevo siguen fases posteriores.

Evidencia31:96 nombres/versiones locales/Cloud iguales,1.952 unitarias/220 DB/typecheck/lint pasan; probe PostgreSQL17 con rollback y22 controles por HTTP real a Next→PostgREST→SQL con2cuentas ficticias. Tres solicitudes de transporte interceptadas (2YCloud/1Kapso), sin proveedor real. Hashes de mensajes/contactos/conversaciones/conexiones/integraciones originales idénticos. Fixture00000000-0000-4000-9000-000000003101,claves,ledger,eventos/auditoría retirados.2workspaces/11mensajes/3jobs/2outbox/0cron activos preservados; cron heredado inactivo existe. Asesor0ERROR/10WARN heredados/19INFO, sumando count/findings por grupo.

Next3100 restaurado al wrapper test-results/f3-permissions-next.mjs inbox con CHANNEL_ACCOUNT_INGRESS_CONNECTIONS vacío; endpoint comprobado503 después de restaurar. Supervisor20456/sesión79517,normalRolloutFlags off/publicOrigin vacío/permissionsUiTestfalse. PIDs/sesiones efímeros: verificar antes de operar. Supervisor QA20800/sesión5571 y anterior2232 ya detenidos; no reiniciar. Túnel/callbacks no revalidados ni modificados. Runner IA antiguo apagado. Respaldo previo df68657 y preparación7ede6e4 verificados en GitHub; incremento31 local sin push/merge/deploy.

Auto-Blindaje31: message_jobs usa operation_id como PK, no id; para comprobar ausencia común usar workspace_id. Antes de reintentar HTTP, leer evento persistido y reutilizar occurredAt: mismo ID con timestamp nuevo es colisión. No reintentar altas/mutaciones a ciegas. Mantener aprendizajes30: conflictos de negocio23514, no40001/PostgREST retry; SQL con $$ requiere callback en String.replace; next-env generado no se versiona.

## Autorizaciones y límites que deben sobrevivir

- Blueprint, Build Manual e invariantes de Lista Roja ya aprobados: no reiniciar entrevista ni pedir otra vez esas aprobaciones. Ramas codex/ por etapa importante; main intacto.
- No compras ni billing. Usar sólo la nueva cuenta Supabase, proyecto bzanbpyzujlogipxvkfn; no db-whatsapp/db-chatfuel.
- Ensayos reales de respuesta humana e IA ya entregados y sus autorizaciones únicas consumidas; consentimiento y permisos temporales retirados. No repetirlos sin autorización nueva.
- Mantener recepción en inbox, rollout apagado, opt-in false y grants reales vacíos hasta activación expresamente autorizada. El permiso local de texto no es consentimiento del contacto ni habilitación de IA.
- No reiniciar el runner antiguo de IA ni usar sus scripts prepare/activate/generate/drain; podrían rearmar el piloto. Revalidar runtime ignorado test-results/f3-ycloud-runtime.json y puertos antes de operar; sesiones/PIDs/túnel son efímeros.
- No usar ni detener puertos 3300/3301. Proteger dashboard original, webhooks y credenciales.
- Push, merge, deploy y nuevos mensajes/modelos reales requieren autoridad específica; no inferirla de continuar o de una prueba anterior.
- Conservar AGENTS.md y scaffolding ajeno sin seguimiento. No guardar secretos ni datos de contacto en memoria/Git.

**Respaldo GitHub verificado — 2026-10-15:** Yani autorizó subir los commits. En origin quedaron codex/omnichannel-f3-human-control (3806f34), codex/omnichannel-f3-message-dedup (51d8230), codex/omnichannel-f3-account-onboarding (e25e8af) y codex/omnichannel-preparacion (c836f86); hashes completos contrastados con git ls-remote. Este registro se versiona después de esos commits. Main permanece en 28a1530, sin merge ni deploy. Los antecedentes que indican sin push describen el estado previo al respaldo.
