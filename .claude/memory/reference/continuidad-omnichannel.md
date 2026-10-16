# Continuidad de Omnichannel Pixiweb

Guardado por pedido de Yani para /avivar. Actualizado al cerrar incremento36 el2026-10-16.

## Dónde continuar

- Implementación: C:/Users/Yani Acevedo/.codex/worktrees/omnichannel-f1/app-whatsapp-saas-conectado.
- Rama: codex/omnichannel-f3-account-trial, incremento36 desde4840c49. Confirmar Git; omnichannel-f1 es nombre histórico del worktree, no fase.
- Original C:/Users/Yani Acevedo/Documents/GitHub/apps/app-whatsapp-saas-conectado: preparación/documentación, NO implementar ahí.
- Leer AGENTS.md, docs/PLAN-STATUS-omnichannel-pixiweb.md, .claude/PRPs/PIEZA-omnichannel-pixiweb.md y docs/F3-MOTOR-omnichannel.md DEL WORKTREE ACTIVO.
- Evidencia vigente: docs/evidencias/F3-PRUEBA-UNICA-2026-10-16.json. Historial35 y anteriores en los mismos documentos.

## Próximo paso acordado

F3 sigue abierta,0/9fases con aceptación integral. Incremento36 implementó el flujo de primera prueba managed en producto. NO volver a tratarlo como código faltante. Falta hosting/DNS/HTTPS y cutover autorizado, revisión interactiva y entrega real de una cuenta nueva con autorización concreta. Media/ecos Business App managed y AC US006–008 pendientes. Meta/OAuth F4/F5,widget F6,Brevo F7.

Cada cuenta adicional muestra Primera prueba de entrega en Ajustes. Admin revisa destinos de conversaciones humanas con texto entrante materializado en24h, elige número propio autorizado y confirma un mensaje fijo. Preparar sólo persiste autoridad/job por operación; enviar es otro botón explícito. TTL máximo10min, limitado por evento/prueba/clave. No cambia contacts.opt_in ni account needs_permissions/capabilities. Sólo delivered/read conciliado habilita luego revisar un grant permanente separado.

Para usarlo realmente hace falta dominio/callback estable y cuenta/webhook verificados. CHANNEL_ACCOUNT_TRIAL_CONNECTIONS es un allowlist por UUID independiente de ingress/inbox y de flags normales. Por defecto todos vacíos. Mantener productores/worker/IA normales apagados durante prueba inicial. Recepción/inbox requieren sus dos flags propios. No activar una cuenta ni enviar por la instrucción genérica continuar. Procedimiento concreto actualizado en paso5 del runbook docs/F3-MOTOR.

La cola común excluye trials. El endpoint reclama sólo la operación y admin originales, validando sourceRevision; finalSQL valida consentimiento por operación, fuente/proof/callback/evento/identidad/supresión/estado/revisión/admin/TTL. Usa transporte y outbox/cupos/fencing/finish/receipts existentes. No fake ready ni grant general. No reenvíos automáticos, incluso rechazo retryable o lease recuperado. Unknown/accepted bloquean crear otra prueba con UUID nuevo. Retirar cancela sólo lo aún no permitido; no revierte un POST en curso. Replay nunca renueva.

## Contrato vigente

Nuevo private.channel_job_sources: RLS,sin políticas/grants browser,servicio sólo SELECT/INSERT,no UPDATE/DELETE. AFTER INSERT en message_jobs fija fingerprint identidad/credencial/expiración y UUID del permiso original,con locks de conexión/credencial; sin backfill. Replay UPDATE nunca repin. Rotación seguida de proof/grant nuevo o renovación/revocación del permiso no reviven jobs viejos; revisarlos/cancelarlos y crear operación nueva si corresponde. Falta pin o permiso original NULL bloquea. Preview humano transitorio operation_id NULL valida permiso vigente; persistidos siempre requieren pin. FinalSQL conserva opt-in/supresión/identidad/ventana/actor/revisión/outbox/lease/fence/cupos/unknown. No activación implícita.

Incrementos31–34: credenciales AES por workspace/cuenta/proveedor,fuente RPC servicio,no fallback legacy para managed. Captura HMAC/raw/destino exactos con CHANNEL_ACCOUNT_INGRESS_CONNECTIONS. Texto materializado sólo si además CHANNEL_ACCOUNT_INBOX_CONNECTIONS,ambos vacíos apagados; shadow si inboxoff. Identidad conocida precede contacts.phone editable,cuenta/hilo/dedup separados. Nuevos hilos human_active/IAfalse y contactos opt_infalse; no adopción legacy ni histórico→live. Media capturada sin descarga; receipts separados.

Managed YCloud/Kapso tienen verificación GET acotada por número/webhook exactos,callback derivado de CHANNEL_PUBLIC_ORIGIN y secretos propios. Kapso Meta Phone Number ID numérico,webhook UUID por número,kind kapso/payload_version v2/buffer_enabled false y cinco eventos. Guardar proof no concede permiso. Grant sólo admin,sourceRevision y rol revalidados,prueba vigente+receipt/job/outbox/message exactos; TTL máximo proof+24h/expiración. Manager lee. Re-verificar no renueva: nueva acción admin explícita; replay tras revocar no reactiva. Kapso verifier/renovación ya implementados, no repetir.

Dominio elegido por Yani dashboard.pixiweb.com.ar el16/10; no preguntar de nuevo. Origen preparado https://dashboard.pixiweb.com.ar. DNS del sistema/Google/Cloudflare NXDOMAIN observado en34 el16/10; no reconsultado en36. No publicación ni DNS/HTTPS configurados. .env.local.example defaults vacíos; runtime origen vacío. Runbook existente F3-MOTOR: hosting/destino real,DNS/HTTPS,URLs exactas,recepción gradual,prueba inicial/permiso,renovación/rollback. No inventar IP/CNAME ni tocar sitio raíz/dashboard original.

## Evidencia36 y límites

101 nombres/versiones local/Cloud iguales; migración20261016101806_omnichannel_account_trial.sql aplicada sólo proyecto nuevo.1.985unitarias/297DB/typecheck/lint pasan;11unitarias/21checksDB nuevos. Probes PostgreSQL17 YCloud/Kapso corren local/Cloud bajo servicio y rollback, sin seeds de entrega/grants al comenzar la prueba.77controles HTTP/BD:58flujo GoTrue→Next3100GET/POSTtrial→SQL/job→claim exacto→guard durable→sender real interceptado DENTRO de Next→finish→receipt sintético,6manager,6inactivo,6trial apagado restaurado,1ingreso503.4checks setup aparte.

Dos POSTs interceptados con claves/números ficticios;YCloud simula unknown sin reenvío yKapso accepted→delivered con HMAC ficticio.0proveedor/modelo real. La comprobación del proveedor es deliberadamente fabricada en fixture. No confundir con entrega/alta real. El grant permanente y opt_in siguen intactos. Padre del panel corregido para montar también verificación Kapso, antes implementada pero escondida por condición YCloud-only.

SSR inicial React de paneltrial/checks para ambos proveedores pasa; no acredita formularios cargados/interacción/responsive/Realtime. Skill React aplicada: estado/ref por instancia, lecturas obsoletas, controles etiquetados, errores/status, mutaciones en eventos y pureza de render. Política previa denegó localhost/settings: no eludir con otro navegador/CDP/surface. Revisión interactiva pendiente.

Fixtures3701/3801 y trialauthority/pins/jobs/outbox/mensajes/receipt/proof/permisos/hilos/identidades/contactos/cuentas/claves/membresías/auditoría retirados con guardas. Hashes originales completos idénticos de mensajes/contactos/conversaciones/conexiones/integraciones;2workspaces/11mensajes/3jobs/2outbox/0cron activos,un cron heredado inactivo.0trials/pins/proofs/permisos managed. Asesor0ERROR/10WARN heredados/23INFO,un INFO nuevo esperado por tabla privada RLS sin políticas/grants browser.

Runtime restaurado Next3100: wrapper test-results/f3-permissions-next.mjs inbox,supervisor30612/sesión92989,normalRolloutFlags off,origen vacío,permissionsUiTestfalse,managedTransportQafalse,accountTrialQafalse,tres flags managed vacíos. QA29132 y su preload de red detenidos. PIDs/sesiones/túneles efímeros,revalidar antes de operar. Túnel/callbacks no revalidados ni modificados. Runner IA antiguo apagado. GitHub previo registrado df68657/preparación7ede6e4; incrementos31–36 locales,sin nuevo push/merge/deploy.

Antecedente35: guard SQL managed y pin de origen/grant original completos (4840c49). La prueba adicional de concurrencia quedó NO concluyente: holder04:13:18–04:13:43UTC y contender04:13:55–04:13:56UTC no se superpusieron. No afirmar NOWAIT probado en Cloud. Evidencia/fixtures retirados en35; pruebas secuenciales de deriva/renovación sí pasan.

Auto-Blindaje36: PostgreSQL least ignora NULL, validar deadline antes de combinarlo. Claims comunes deben excluir trials, y finish SQL debe normalizar retryablefalse para ellos. Verificar montaje real del panel Kapso. No Date.now en render; servidor revalida vencimiento. Interceptar dentro del servidor QA para probar POST HTTP completo, sin fallback a proveedor. Conservar de35: guard SQL además de resolverTS; pin sin repin, superposición medida para concurrencia, respaldos de tipos .ts.bak (tsconfig incluye **/*.ts en test-results), identidad antes de teléfono editable,fingerprint separado de estado,23514 para conflicto de negocio,SQL$$ con callback,next-env generado fuera de Git.

## Autorizaciones y límites que deben sobrevivir

- Blueprint,Build Manual e invariantes Lista Roja aprobados: no reiniciar entrevista ni pedir otra vez. Ramas codex/ por etapa importante;main intacto.
- No compras/billing. Sólo nueva cuenta Supabase/proyecto bzanbpyzujlogipxvkfn,no db-whatsapp/db-chatfuel.
- Pilotos humano/IA reales entregados,autorizaciones únicas consumidas;consentimiento/permisos temporales retirados. No repetir sin autorización nueva.
- Mantener recepción original inbox/rollout apagado/opt-infalse/grants reales vacíos hasta activación explícita. Permiso local no equivale a consentimiento ni IA.
- No runner IA antiguo ni prepare/activate/generate/drain. Revisar runtime ignorado test-results/f3-ycloud-runtime.json.
- No usar/detener puertos3300/3301. Preservar dashboard original,webhooks y credenciales.
- Push/merge/deploy/mensajes/modelos reales requieren autoridad específica; continuar o elegir dominio no la implica.
- AGENTS.md/scaffolding ajeno untracked;sin secretos ni datos de contactos reales en memoria/Git.
