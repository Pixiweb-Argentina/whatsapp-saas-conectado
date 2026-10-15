# Continuidad de Omnichannel Pixiweb

Guardado por pedido de Yani el 2026-10-15 para /avivar.

## Dónde continuar

- Implementación: C:/Users/Yani Acevedo/.codex/worktrees/omnichannel-f1/app-whatsapp-saas-conectado.
- Rama al guardar: codex/omnichannel-f3-account-onboarding, incremento30 desde51d8230. Confirmar Git antes de trabajar; el nombre omnichannel-f1 del worktree no indica la fase actual.
- Checkout original C:/Users/Yani Acevedo/Documents/GitHub/apps/app-whatsapp-saas-conectado: preparación y documentación, NO implementar allí.
- Leer AGENTS.md y luego, en el worktree activo: docs/PLAN-STATUS-omnichannel-pixiweb.md, .claude/PRPs/PIEZA-omnichannel-pixiweb.md y docs/F3-MOTOR-omnichannel.md.
- Última evidencia: docs/evidencias/F3-ALTAS-CUENTAS-2026-10-15.json. Las pruebas y el historial están en esas fuentes, no se duplican aquí.

## Próximo paso acordado

F3 sigue abierta. Carrera humana y dedup por cuenta acreditadas en28–29. Incremento30 permite registrar/listar/revocar adicionales WA desde Ajustes, con AES-GCM ligado a workspace/conexión/proveedor, credenciales privadas, roles revalidados y UUID/revisión/replay seguros. No reemplaza la integración principal ni la vuelve multicuenta.95 migraciones alineadas;1.935 unitarias/211DB/typecheck/lint,26checks HTTP y probe PostgreSQL17 pasan. Fixtures y credenciales ficticias retirados; datos originales conservados por hashes. No repetir pilotos reales.

Siguiente: webhook firmado y fuente de transporte/verificación/permisos por conexión. Las adicionales guardadas quedan needs_permissions; resolveConnectionAdapter/ingress todavía dependen de legacy_integration_id. El registro principal sigue con un proveedor activo por workspace; no relajar esa restricción ni copiar claves existentes por inferencia. Luego origen estable/alta/cutover/renovación y aceptación US006–008. Revisión interactiva/responsive de nuevo formulario pendiente: Browser Use denegó inspección de localhost/settings por política de URL; no intentar otro navegador/CDP para eludirlo. HTTP autenticado y render inicial no equivalen a esa revisión. Instagram/Facebook/widget/Brevo son fases posteriores.

Snapshot Cloud de incremento30: dos workspaces, once mensajes globales, tres jobs/dos outbox y cero cron activos. Datos/contactos/conversaciones/conexiones/integraciones originales idénticos; no afirmar cero filas cron (hay uno heredado inactivo). Next3100 reiniciado con wrapper de permisos en inbox, supervisor2232/sesión77359, flags vacíos/public origin vacío/permissionsUiTestfalse. PIDs efímeros: comprobar antes de usar. Túnel/callbacks no revalidados ni modificados. Runner IA antiguo apagado. Ramas respaldadas en origin según el registro superior; sin merge/deploy.

Auto-Blindaje30: conflictos de negocio no deben usar40001 (reintentos PostgREST); migración95 usa23514, rechazo viejo medido3,2s. Auditar usos previos por separado, sin reemplazar errores genuinos de serialización. Metadatos Next corruptos se regeneraron con servidor propio detenido y backup acotado; typecheck final pasa, next-env generado no se versiona. SQL con $$ requiere callback en String.replace.

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
