# Continuidad de Omnichannel Pixiweb

Guardado por pedido de Yani para /avivar. Actualizado al cerrar incremento35 el2026-10-16.

## Dónde continuar

- Implementación: C:/Users/Yani Acevedo/.codex/worktrees/omnichannel-f1/app-whatsapp-saas-conectado.
- Rama: codex/omnichannel-f3-managed-send-guard, incremento35 desde172a672. Confirmar Git; omnichannel-f1 es nombre histórico del worktree, no fase.
- Original C:/Users/Yani Acevedo/Documents/GitHub/apps/app-whatsapp-saas-conectado: preparación/documentación, NO implementar ahí.
- Leer AGENTS.md, docs/PLAN-STATUS-omnichannel-pixiweb.md, .claude/PRPs/PIEZA-omnichannel-pixiweb.md y docs/F3-MOTOR-omnichannel.md DEL WORKTREE ACTIVO.
- Evidencia vigente: docs/evidencias/F3-ENVIO-MANAGED-2026-10-16.json. Historial34 y anteriores en los mismos documentos.

## Próximo paso acordado

F3 sigue abierta,0/9fases con aceptación integral. Incremento35 completó un prerrequisito del transporte: channel_permit_until aún exigía legacy_integration_id pese a que el adaptador ya resolvía credenciales managed. Ahora YCloud/Kapso adicionales pasan por proof/permiso propios y pin privado del origen de cada job. Rama legacy conserva contrato. No se implementó todavía la primera prueba desde producto.

Siguiente: flujo de primera entrega managed explícitamente autorizada y acotada a una operación,destino,texto y vencimiento corto,sin SQL manual ni permiso/consentimiento permanente. Una cuenta nueva no tiene job/outbox/mensaje/receipt entregado exigido para el grant permanente; no usar fixtures como evidencia real ni dar ready/capacidades por guardar clave. Consentimiento específico de la prueba separado de marketing/IA. Preparar producto/candidato y solicitar sólo la autorización real concreta si falta. Luego hosting/DNS/HTTPS/cutover y AC US006–008. Media/ecos Business App de managed y revisión interactiva de formularios pendientes. Instagram/Facebook F4/F5,widget F6,Brevo F7.

## Contrato vigente

Nuevo private.channel_job_sources: RLS,sin políticas/grants browser,servicio sólo SELECT/INSERT,no UPDATE/DELETE. AFTER INSERT en message_jobs fija fingerprint identidad/credencial/expiración y UUID del permiso original,con locks de conexión/credencial; sin backfill. Replay UPDATE nunca repin. Rotación seguida de proof/grant nuevo o renovación/revocación del permiso no reviven jobs viejos; revisarlos/cancelarlos y crear operación nueva si corresponde. Falta pin o permiso original NULL bloquea. Preview humano transitorio operation_id NULL valida permiso vigente; persistidos siempre requieren pin. FinalSQL conserva opt-in/supresión/identidad/ventana/actor/revisión/outbox/lease/fence/cupos/unknown. No activación implícita.

Incrementos31–34: credenciales AES por workspace/cuenta/proveedor,fuente RPC servicio,no fallback legacy para managed. Captura HMAC/raw/destino exactos con CHANNEL_ACCOUNT_INGRESS_CONNECTIONS. Texto materializado sólo si además CHANNEL_ACCOUNT_INBOX_CONNECTIONS,ambos vacíos apagados; shadow si inboxoff. Identidad conocida precede contacts.phone editable,cuenta/hilo/dedup separados. Nuevos hilos human_active/IAfalse y contactos opt_infalse; no adopción legacy ni histórico→live. Media capturada sin descarga; receipts separados.

Managed YCloud/Kapso tienen verificación GET acotada por número/webhook exactos,callback derivado de CHANNEL_PUBLIC_ORIGIN y secretos propios. Kapso Meta Phone Number ID numérico,webhook UUID por número,kind kapso/payload_version v2/buffer_enabled false y cinco eventos. Guardar proof no concede permiso. Grant sólo admin,sourceRevision y rol revalidados,prueba vigente+receipt/job/outbox/message exactos; TTL máximo proof+24h/expiración. Manager lee. Re-verificar no renueva: nueva acción admin explícita; replay tras revocar no reactiva. Kapso verifier/renovación ya implementados, no repetir.

Dominio elegido por Yani dashboard.pixiweb.com.ar el16/10; no preguntar de nuevo. Origen preparado https://dashboard.pixiweb.com.ar. DNS del sistema/Google/Cloudflare NXDOMAIN observado en34 el16/10; no reconsultado en35. No publicación ni DNS/HTTPS configurados. .env.local.example defaults vacíos; runtime origen vacío. Runbook existente F3-MOTOR: hosting/destino real,DNS/HTTPS,URLs exactas,recepción gradual,prueba inicial/permiso,renovación/rollback. No inventar IP/CNAME ni tocar sitio raíz/dashboard original.

## Evidencia35 y límites

100 nombres/versiones local/Cloud iguales; migración20261016040458_omnichannel_managed_send_source.sql aplicada sólo proyecto nuevo.1.974unitarias/276DB/typecheck/lint pasan.19checks DB nuevos incluyen ambos probes PostgreSQL17 local/Cloud bajo servicio/rollback,pin/permit-once/unknown/replay/stalegrant.61controles HTTP/BD:60GoTrue→Next3100APIhumana→cola→worker/store/policy/resolver/adaptador productivos→proveedor interceptado→finish→receipt HMAC sintético→SQL;1ingreso503 restaurado.4checks setup aparte. Tres POSTs interceptados(2YCloud/1Kapso),clave/remitente propios;unknown conserva un intento sin reenvío.0llamadas reales proveedor/modelo. Opt-in/proof/seedaccepted/receipt son deliberadamente ficticios; no prueban entrega real ni bootstrap.

Concurrencia extra no concluyente y no contada: holder04:13:18–04:13:43UTC y contender04:13:55–04:13:56UTC, sin superposición efectiva por despacho de tools. No afirmar NOWAIT probado en Cloud. Operación ficticia64 reconciliada/retirada; harness exploratorio descartado, no suite fallida retenida. Pruebas secuenciales de deriva/renovación sí pasan.

Fixtures3501/3601/proofs/permisos/receipt/outbox/messages/jobs/pins/eventos/hilos/identidades/contactos/cuentas/claves/membresías/auditoría retirados con guardas. Hashes originales completos idénticos de mensajes/contactos/conversaciones/conexiones/integraciones;2workspaces/11mensajes/3jobs/2outbox/0cron activos,un cron heredado inactivo.0pins/proofs/permisos managed. Asesor0ERROR/10WARN heredados/22INFO,un INFO nuevo esperado por tabla privada RLS sin políticas browser,0grants browser.

Sin cambios UI/navegador en35. SSR inicial de34 no acredita interacción/responsive/Realtime. Política previa denegó localhost/settings: no eludir con otro navegador/CDP/surface. Aceptación integral pendiente.

Runtime restaurado Next3100: wrapper test-results/f3-permissions-next.mjs inbox,supervisor22256/sesión59006,normalRolloutFlags off,origen vacío,permissionsUiTestfalse,managedTransportQafalse,ambos flags managed vacíos. QA12028 detenido. Durante cierre validator generado quedó duplicado: se detuvo propio supervisor23724,se respaldó/regeneró/reinició; typecheck final pasa. PIDs/sesiones/túneles efímeros,revalidar antes de operar. Túnel/callbacks no revalidados ni modificados. Runner IA antiguo apagado. Respaldo GitHub previo registrado df68657/preparación7ede6e4; incrementos31(1f943e7)/32(5dde69a)/33(dd2d58a)/34(172a672)/35 locales,sin nuevo push/merge/deploy.

Auto-Blindaje35: revisar guard SQL final además del resolverTS; pin de fuente y permiso originales sin repin. Prueba concurrencia requiere timestamps superpuestos. Respaldar tipos como .ts.bak porque tsconfig incluye **/*.ts aun en test-results ignorado; no añadir exclusiones para ocultar código real. Preservar también separación identidad antes de teléfono editable,fingerprint de proof separado de estado,conflictos23514(no40001),SQL$$ con callback y next-env generado fuera de Git. Aprendizajes34 y anteriores documentados en La Pieza/motor.

## Autorizaciones y límites que deben sobrevivir

- Blueprint,Build Manual e invariantes Lista Roja aprobados: no reiniciar entrevista ni pedir otra vez. Ramas codex/ por etapa importante;main intacto.
- No compras/billing. Sólo nueva cuenta Supabase/proyecto bzanbpyzujlogipxvkfn,no db-whatsapp/db-chatfuel.
- Pilotos humano/IA reales entregados,autorizaciones únicas consumidas;consentimiento/permisos temporales retirados. No repetir sin autorización nueva.
- Mantener recepción original inbox/rollout apagado/opt-infalse/grants reales vacíos hasta activación explícita. Permiso local no equivale a consentimiento ni IA.
- No runner IA antiguo ni prepare/activate/generate/drain. Revisar runtime ignorado test-results/f3-ycloud-runtime.json.
- No usar/detener puertos3300/3301. Preservar dashboard original,webhooks y credenciales.
- Push/merge/deploy/mensajes/modelos reales requieren autoridad específica; continuar o elegir dominio no la implica.
- AGENTS.md/scaffolding ajeno untracked;sin secretos ni datos de contactos reales en memoria/Git.
