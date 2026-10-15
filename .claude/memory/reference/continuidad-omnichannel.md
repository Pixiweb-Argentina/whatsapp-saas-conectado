# Continuidad de Omnichannel Pixiweb

Guardado por pedido de Yani el 2026-10-15 para /avivar.

## Dónde continuar

- Implementación: C:/Users/Yani Acevedo/.codex/worktrees/omnichannel-f1/app-whatsapp-saas-conectado.
- Rama al guardar: codex/omnichannel-f3-permissions. Confirmar Git antes de trabajar; el nombre omnichannel-f1 del worktree no indica la fase actual.
- Checkout original C:/Users/Yani Acevedo/Documents/GitHub/apps/app-whatsapp-saas-conectado: preparación y documentación, NO implementar allí.
- Leer AGENTS.md y luego, en el worktree activo: docs/PLAN-STATUS-omnichannel-pixiweb.md, .claude/PRPs/PIEZA-omnichannel-pixiweb.md y docs/F3-MOTOR-omnichannel.md.
- Última evidencia: docs/evidencias/F3-PERMISOS-YCLOUD-2026-10-15.json. Las pruebas y el historial están en esas fuentes, no se duplican aquí.

## Próximo paso acordado

F3 sigue abierta. Retomar con una prueba sintética integrada de toma humana mientras una generación IA está pendiente: demostrar que no se encola ni envía la respuesta y que se conserva la revisión/handoff. Usar generación simulada controlada, sin llamadas a modelos ni mensajes reales.

Después quedan alta/cutover y operación permanente de cuentas con origen público estable, renovación de permisos (actualmente manual, máximo 24 h), multicuenta operativa/deduplicación wamid y aceptación formal de US006–008. Instagram, Facebook, widget y Brevo corresponden a fases posteriores. No confundir avances parciales con fases aceptadas.

## Autorizaciones y límites que deben sobrevivir

- Blueprint, Build Manual e invariantes de Lista Roja ya aprobados: no reiniciar entrevista ni pedir otra vez esas aprobaciones. Ramas codex/ por etapa importante; main intacto.
- No compras ni billing. Usar sólo la nueva cuenta Supabase, proyecto bzanbpyzujlogipxvkfn; no db-whatsapp/db-chatfuel.
- Ensayos reales de respuesta humana e IA ya entregados y sus autorizaciones únicas consumidas; consentimiento y permisos temporales retirados. No repetirlos sin autorización nueva.
- Mantener recepción en inbox, rollout apagado, opt-in false y grants reales vacíos hasta activación expresamente autorizada. El permiso local de texto no es consentimiento del contacto ni habilitación de IA.
- No reiniciar el runner antiguo de IA ni usar sus scripts prepare/activate/generate/drain; podrían rearmar el piloto. Revalidar runtime ignorado test-results/f3-ycloud-runtime.json y puertos antes de operar; sesiones/PIDs/túnel son efímeros.
- No usar ni detener puertos 3300/3301. Proteger dashboard original, webhooks y credenciales.
- Push, merge, deploy y nuevos mensajes/modelos reales requieren autoridad específica; no inferirla de continuar o de una prueba anterior.
- Conservar AGENTS.md y scaffolding ajeno sin seguimiento. No guardar secretos ni datos de contacto en memoria/Git.
