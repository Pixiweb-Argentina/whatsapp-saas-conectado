# Continuidad de Omnichannel Pixiweb

Guardado por pedido de Yani para /avivar. Actualizado al cerrar incremento34 el2026-10-16.

## Dónde continuar

- Implementación: C:/Users/Yani Acevedo/.codex/worktrees/omnichannel-f1/app-whatsapp-saas-conectado.
- Rama: codex/omnichannel-f3-kapso-verification, incremento34 desde dd2d58a. Confirmar Git; omnichannel-f1 es el nombre histórico del worktree, no la fase.
- Original C:/Users/Yani Acevedo/Documents/GitHub/apps/app-whatsapp-saas-conectado: preparación/documentación, NO implementar ahí.
- Leer AGENTS.md, docs/PLAN-STATUS-omnichannel-pixiweb.md, .claude/PRPs/PIEZA-omnichannel-pixiweb.md y docs/F3-MOTOR-omnichannel.md DEL WORKTREE ACTIVO.
- Evidencia vigente: docs/evidencias/F3-KAPSO-VERIFICACION-2026-10-16.json. Historial33 y anteriores en los mismos documentos.

## Próximo paso acordado

F3 sigue abierta. Incremento34 completa verificación managed Kapso y contrato de permisos/renovación. GETs sólo api.kapso.ai,20s/1MiB/no redirect: Meta Phone Number ID numérico exacto y webhook UUID por número; CONNECTED/inbound activo; kind kapso/v2 explícito/sin batch; cinco eventos inbound/sent/delivered/read/failed,callback exacto y secreto. No consulta callback ni modifica proveedor. Reporte compartido conserva nombres históricos y seis checks sin secretos. SQL revalida admin/sourceRevision; manager lee.

Kapso necesita recibo/mensaje/job/outbox texto aceptado y provider/cuenta/recipient/wamid/fence exactos. YCloud conserva su helper previo,legacy intacto. Guardar proof no concede grant; nueva verificación no extiende el grant anterior hasta renovación admin explícita. TTL máximo proof+24h/expiración de clave,replay antiguo no reactiva tras revocar; fuente/roles/deriva/fallo/deletion protegidos. Ajustes valida UUID Kapso y explica formato/renovación; SSR inicial probado para ambos proveedores,interacción/responsive pendiente.

Dominio elegido por Yani: dashboard.pixiweb.com.ar (16/10). No volver a preguntar el dominio. Origen preparado https://dashboard.pixiweb.com.ar; DNS del sistema falla y Google/Cloudflare DoH Status3 NXDOMAIN el16/10,sin HTTPS. No es una publicación. .env.local.example agrega defaults vacíos,el servidor actual sigue origen vacío. Runbook al final de F3-MOTOR: destino hosting/DNS/HTTPS,candidato,URLs exactas,recepción gradual,primera entrega/permiso,renovación y rollback. No inventar IP/CNAME ni tocar el sitio raíz o dashboard original.

Siguiente: resolver desde el producto la primera prueba de entrega managed acotada y autorizada,sin SQL manual ni grant permanente previo. El permiso permanente exige entrega de esa cuenta y una cuenta nueva aún no tiene esa evidencia; no llamar operativo al alta sólo por una prueba SQL ficticia. Preparar hosting/DNS/HTTPS/cutover y AC US006–008; despliegue/cambios de webhook/mensajes reales requieren autoridad específica. Media y ecos Business App de managed/revisión interactiva de formularios siguen pendientes; no repetir Kapso verifier/renovación como implementación faltante. Instagram/Facebook/widget/Brevo son fases posteriores.

Incremento33 ya materializa texto firmado de managed YCloud/Kapso con RPC atómica sólo servicio,sourceRevision/locks,identidad/cuenta/hilo exactos,dedup por cuenta y unread/ventana desde occurredAt. Identidad conocida manda sobre contacts.phone editable; no adopta legacy NULL ni transforma histórico en live. Hilos nuevos human_active/IAfalse,contacto nuevo opt_infalse,existingconsent intacto. Dos UUID allowlists CHANNEL_ACCOUNT_INGRESS_CONNECTIONS y CHANNEL_ACCOUNT_INBOX_CONNECTIONS,vacíos apagados; shadow sigue si inbox apagada. Media capturada sin descarga; receipts separados. Nunca activar AI/send por recibir o guardar clave.

Evidencia34:99 nombres/versiones local/Cloud iguales;1.974unitarias/257DB/typecheck/lint pasan.10checks DB nuevos incluyen mismo probe PostgreSQL17 local/Cloud con rollback.59controles HTTP/BD:58GoTrue→Next→PostgREST→SQL(8blocked,16grant,18renew/revoke/replay,4manager,4inactive,8restored),1ingreso apagado. Prueba positiva usa proof/job/outbox/mensaje/receipt deliberadamente ficticios; GET Kapso interceptado en unitarias.0proveedor/modelo/envío real. SSR inicial real YCloud/Kapso pasa, no prueba loaded controls/interacción/responsive/Realtime. Política URL previa denegó localhost/settings: no eludir con otro navegador/CDP/surface.

Fixture3401/proofs/permisos/receipt/job/outbox/mensaje/hilo/identidad/contacto/cuenta/claves/membresía/auditoría retirados con guardas;0proofs/permisos managed. Hashes originales completos idénticos;2workspaces/11mensajes/3jobs/2outbox/0cron activos preservados,un cron heredado inactivo. Asesor0ERROR/10WARN heredados/21INFO,sin novedades(sum count/findings).

Runtime restaurado Next3100: wrapper test-results/f3-permissions-next.mjs inbox,supervisor30020/sesión49592,normalRolloutFlags off,origin vacío,permissionsUiTestfalse,ambos flags managed vacíos. QA31236/sesión92701 y anterior2040 detenidos; no reiniciar. PIDs/sesiones/túneles son efímeros,revalidar antes de operar. Túnel/callbacks no revalidados ni modificados. Runner IA antiguo apagado. Respaldo GitHub previo registrado df68657/preparación7ede6e4; incrementos31(1f943e7)/32(5dde69a)/33(dd2d58a)/34 locales,sin nuevo push/merge/deploy.

Auto-Blindaje34: Phone Number ID no es internal_id; webhook por número no es webhook de proyecto. Para probar renovación, envejecer proof ya guardado dentro del fixture; save rechaza correctamente reporte de red mayor a2min. Job unknown debe retirar campos de resultado accepted; preservar constraints. Mantener además identidad antes de teléfono editable,anon42501 por ACL sin debilitar permisos,replay mismo occurredAt,managed desde nacimiento/ruta inmutable,fingerprint de proof separado de revisión de estado,conflictos23514(no40001),SQL$$ con callback y next-env generado fuera de Git.

## Autorizaciones y límites que deben sobrevivir

- Blueprint,Build Manual e invariantes Lista Roja aprobados: no reiniciar entrevista ni pedir otra vez. Ramas codex/ por etapa importante;main intacto.
- No compras/billing. Sólo nueva cuenta Supabase/proyecto bzanbpyzujlogipxvkfn,no db-whatsapp/db-chatfuel.
- Pilotos humano/IA reales entregados,autorizaciones únicas consumidas;consentimiento/permisos temporales retirados. No repetir sin autorización nueva.
- Mantener recepción original inbox/rollout apagado/opt-infalse/grants reales vacíos hasta activación explícita. Permiso local no equivale a consentimiento ni IA.
- No runner IA antiguo ni prepare/activate/generate/drain. Revisar runtime ignorado test-results/f3-ycloud-runtime.json.
- No usar/detener puertos3300/3301. Preservar dashboard original,webhooks y credenciales.
- Push/merge/deploy/mensajes/modelos reales requieren autoridad específica; continuar o elegir dominio no la implica.
- AGENTS.md/scaffolding ajeno untracked;sin secretos ni datos de contactos reales en memoria/Git.
