# Continuidad de Omnichannel Pixiweb

Guardado por pedido de Yani el 2026-10-15 para /avivar.

## Dónde continuar

- Implementación: C:/Users/Yani Acevedo/.codex/worktrees/omnichannel-f1/app-whatsapp-saas-conectado.
- Rama al guardar: codex/omnichannel-f3-account-permissions, incremento32 desde1f943e7. Confirmar Git antes de trabajar; el nombre omnichannel-f1 del worktree no indica la fase actual.
- Checkout original C:/Users/Yani Acevedo/Documents/GitHub/apps/app-whatsapp-saas-conectado: preparación y documentación, NO implementar allí.
- Leer AGENTS.md y luego, en el worktree activo: docs/PLAN-STATUS-omnichannel-pixiweb.md, .claude/PRPs/PIEZA-omnichannel-pixiweb.md y docs/F3-MOTOR-omnichannel.md.
- Última evidencia: docs/evidencias/F3-PERMISOS-CUENTAS-2026-10-15.json. Las pruebas y el historial están en esas fuentes, no se duplican aquí.

## Próximo paso acordado

F3 sigue abierta. Incremento32 agrega verificación YCloud de cuentas managed, permiso local de texto persistente, APIs autenticadas y controles en Ajustes. Admin verifica/muta; manager lee; SQL revalida membresía activa. Callback procede de CHANNEL_PUBLIC_ORIGIN estable del servidor, no del cuerpo. Proveedor usa GETs acotados con clave/secret propios y fuente exacta; nuevas tablas private.whatsapp_account_verifications/private.whatsapp_account_permission_changes con RLS y sin acceso browser. Proof vigente24h ligado a SHA256 de identidad/credenciales/expiración, separado del sourceRevision de ingreso31 que también incluye estado. Guardar verificación no cambia estado ni concede capacidades.

Permiso exige confirmación admin, proof completo/callback exacto y evidencia de texto delivered/read en job/outbox/message/receipt de la misma cuenta. TTL máximo comprobación+24h limitado por expiración de clave. UUID/revisión/replay no reactivan tras revocar; cambio/expiración de clave o fallo/borrado del proof retira permiso propio. Frontera final SQL channel_text_grant_until revalida grants wa-account-text; ruta legacy no alterada. No concede consentimiento,IA,campañas ni flags. Kapso sigue sin verificador/permisos por este flujo (unsupported_provider). Fuente/ingreso31 y su flag por UUID siguen separados de legacy; shadow no materializa bandeja.

Siguiente: materializar eventos firmados de adicionales en contactos/identidades/conversaciones/mensajes de bandeja por conexión, conservando IA/envíos apagados y dedup por cuenta. Materializadores legacy todavía usan integration_id; no afirmar multicuenta operativa por verificación/API exitosa. Luego origen público permanente,alta/cutover/cadencia de renovación y AC restantes US006–008. No repetir pilotos humanos/IA reales ya acreditados. Revisión interactiva/responsive de formularios30/32 pendiente: Browser Use denegó localhost/settings por política URL; no intentar otro navegador/CDP para eludirlo. Este bloque verificó SSR inicial/API, no interacción visual. Instagram/Facebook/widget/Brevo siguen fases posteriores.

Evidencia32:97 nombres/versiones locales/Cloud iguales,1.963 unitarias/233DB/typecheck/lint pasan;13checks del archivo DB nuevo bajo service_role. ProbeSQL igual local/PostgreSQL17 con rollback.33controles GoTrue→Next3100→PostgREST→SQL:origen bloqueado7,admin grant/revoke/replay11,manager4,inactivo4,origen restaurado7. Prueba positiva HTTP usó evidencia SQL deliberadamente ficticia y job/outbox accepted sintéticos; proveedorGETs mockeados en unitarias,0verificación/envío/modelo reales. No confundirlo con entrega real o habilitación de cuentas. SSR inicial del componente aprobado,interacción/responsive pendientes.

Fixture00000000-0000-4000-9000-000000003201 y todos sus proofs/permisos/keys/receipt/mensaje/job/outbox/conversación/identidad/contacto/auditoría retirados;0filas managed proof/permission. Hashes originales de mensajes/contactos/conversaciones/conexiones/integraciones idénticos.2workspaces/11mensajes/3jobs/2outbox/0cron activos preservados,cron heredado inactivo existe. Asesor0ERROR/10WARN heredados/21INFO; dosINFO esperados por tablas privadas RLS sin policies browser. Sumar count/findings de grupos.

Next3100 restaurado al wrapper test-results/f3-permissions-next.mjs inbox,supervisor26200/sesión5862,normalRolloutFlags off/publicOrigin vacío/permissionsUiTestfalse/CHANNEL_ACCOUNT_INGRESS_CONNECTIONS vacío. PIDs/sesiones efímeros: verificar antes de operar. QA27060/sesión98846 y anterior20456 detenidos; no reiniciar. Túnel/callbacks no revalidados ni modificados. Runner IA antiguo apagado. Último respaldo GitHub sigue df68657/preparación7ede6e4; incrementos31(1f943e7)/32 locales sin push/merge/deploy.

Auto-Blindaje32: la identidad/ruta de channel_connections es inmutable; no convertir legacy a managed con UPDATE. Fixture inicial correctamente rechazado; se creó managed desde nacimiento y se conservó guard. Fingerprint del proof excluye estado/capabilities para que grant→ready no invalide su propia evidencia; fuente de ingreso mantiene revisión de ciclo de vida. Mantener mensajes/jobs keyscorrectas y reintentos mismos IDs/occurredAt,conflictos de negocio23514(no40001),SQL$$ con callback y next-env generado fuera deGit.

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
