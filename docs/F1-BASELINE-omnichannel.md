# F1 — Baseline y compatibilidad omnicanal

Fecha: 2026-10-10. Modo: Build Manual. Rama: codex/omnichannel-f1-base.
Base de implementación: a5f60ed (plan aprobado), código heredado de 28a1530.
Worktree: C:/Users/Yani Acevedo/.codex/worktrees/omnichannel-f1/app-whatsapp-saas-conectado.

## Estado inicial comprobado

| Comprobación | Resultado |
|---|---|
| Node / npm | 24.21.0 / 11.19.0 |
| Dependencias | npm ci --no-audit --no-fund, lockfile conservado |
| TypeScript | npm run typecheck: exit 0 |
| Lint | npm run lint: exit 0 |
| Unitarias heredadas | 1.638 pasan, 0 fallos, 0 omitidas; 126 archivos |
| Migraciones | 66; última 20261003000017_stale_calcom_claims.sql |
| Orden de migraciones | node scripts/check-migrations.mjs main: exit 0; ninguna nueva |
| Configuración E2E inicial | No había playwright.config.ts ni suite tests/e2e |
| Secretos del worktree | No hay .env.local; no se copiaron credenciales |
| Herramientas de DB en PATH | No se encontraron supabase, docker ni psql |

La suite existente cubre plantillas, proveedores YCloud/Kapso, deduplicación, ecos de coexistencia, opt-out, handoff, presupuesto IA, roles y CRM. Sus mocks no prueban una instalación Cloud. El historial real, RLS aplicada y login autenticado requieren una base de prueba identificada.

Los logs locales están en test-results/ (ignorado por Git). npm informó scripts de instalación no autorizados para sharp y unrs-resolver; las comprobaciones anteriores pasaron sin habilitarlos. No se cambió package.json ni package-lock.json.

## Primer incremento de F1

- Contratos Zod de conexión, identidad y evento; combinaciones canal/proveedor válidas, IDs opacos y rechazo de campos extra.
- Clave de identidad por workspace + conexión + ID externo, sin inferir identidad por email/username.
- Normalización de compatibilidad WA reutilizando parsers existentes. El workspace viene del contexto resuelto en servidor; la cuenta receptora debe coincidir. No está conectada a las rutas activas.
- Fixtures sintéticos explícitos de YCloud/Kapso y 14 pruebas de compatibilidad. No son capturas de cuentas reales.
- Preflight puro sobre snapshot completo: detecta cuentas compartidas, proveedores ambiguos, referencias huérfanas, cruce de tenant y colisiones. No escribe datos ni crea IDs y devuelve cero asignaciones si hay un bloqueo.
- Diez pruebas de preflight: IDs/conteos conservados, snapshot no modificado y casos adversos.

Los contratos son una base para la migración y el adaptador; no habilitan nuevos canales. ContactRow y la DB existentes todavía exigen teléfono. El preflight debe recibir un snapshot completo y consistente: no valida por sí solo paginación, backup, restauración ni RLS de una base.

## Reproducción local

```powershell
npm ci --no-audit --no-fund
npm run typecheck
npm run lint
node --experimental-test-module-mocks --import ./scripts/register-alias-hook.mjs --import ./scripts/mock-module-compat.mjs --test "src/features/channels/**/*.test.ts"
node scripts/check-migrations.mjs main
```

No ejecutar backfill ni db push/reset remoto a partir de este reporte.

## Verificación del incremento

| Comprobación | Resultado |
|---|---|
| Suite unitaria completa final | 1.662 pasan, 0 fallos, 0 omitidas (1.638 heredadas + 24 nuevas) |
| TypeScript y lint | Exit 0; eslint también sobre config Playwright y tests/e2e |
| Navegador | npm run test:e2e: 8/8 pasan, escritorio y móvil Chromium |
| Smoke público | Raíz → login; inbox protegido; /probar conserva destino; recuperación vuelve a login |
| Proveedores y DB | Sin conexión real; sin migraciones ni envíos |

Para reproducir navegador: npx --no-install playwright install chromium y npm run test:e2e. Playwright inicia y cierra un servidor propio en 127.0.0.1:3100, sin reutilizar procesos existentes; PLAYWRIGHT_PORT permite otro puerto libre excepto 3300/3301. La suite usa valores públicos ficticios, no inicia sesión ni manda formularios. El servidor se cerró al terminar; main sigue en 28a1530.

## Pendientes externos y límites de integración

1. Invariantes de Lista Roja confirmados el 2026-10-10: «confirmo, continuar».
2. Entorno Supabase de prueba y copia consistente con backup restaurable. El ensayo local del siguiente incremento no sustituye una copia de datos reales.
3. App Meta y activos de prueba, versión Graph y scopes verificables; no se inventó una versión ni se enviaron mensajes.
4. Cuenta Brevo de prueba, cuotas, pipeline/etapas y mecanismo de Sales webhooks; no se crearon contactos u oportunidades externos.
5. Integrar los contratos, ejecutar backfill y verificar flujo autenticado antes de dar F1 por completa.

F1 sigue EN_PROGRESO. Ninguna prueba local de contrato se presenta como habilitación productiva.

## Segundo incremento — expansión y compatibilidad local

Los resultados anteriores describen los puntos previos de la fase. Estado actualizado al 2026-10-10:

| Comprobación | Resultado |
|---|---|
| Unitarias completas | 1.666 pasan, 0 fallos/omitidas |
| DB local | 14 pasan, incluyendo restauración de copia, RLS entre dos tenants, permisos privados, colisiones y reanudación |
| Navegador | 10 pasan: ocho recorridos públicos y dos pruebas del componente real de contacto sin teléfono, desktop/móvil |
| Typecheck / eslint dirigido / diff whitespace | Exit 0 |
| Build de producción local | npm run build: exit 0; URL/key públicas ficticias, sin conexión Cloud |
| Orden de migraciones contra main | 3 nuevas, todas posteriores a 20261003000017; exit 0 |

Cambios: tablas channel_connections/contact_identities y private.channel_credentials; claves compuestas por tenant; nuevos campos de conversación/mensaje sin reemplazar los IDs heredados; contactos sin teléfono y guardas para conservar WhatsApp. Las conversaciones de canales nuevos se rechazan hasta implementar F3. Las credenciales existentes no se copian. Conexiones e identidades tienen lectura por tenant y escritura solo de servidor; credenciales/backfill privados no accesibles por anon/authenticated.

El inbox presenta y busca contactos sin teléfono. Dispatch devuelve NOT_FOUND y no envía ni persiste mensajes si falta el número. La prueba del componente usa render del código real con estilos de la app, pero no representa una sesión autenticada ni el rediseño Pixiweb de F2.

### Alcance exacto del ensayo DB

Dependencias de desarrollo fijadas: @electric-sql/pglite 0.5.8 y @electric-sql/pglite-pgvector 0.0.9, verificadas en npm e instaladas sin scripts. El producto sigue usando Supabase; PGlite se usa únicamente en tests. Motor local PostgreSQL 18.3; proyectos Cloud inventariados usan PostgreSQL 17.

tests/db/database-harness.mjs aplica literalmente 65 de 66 migraciones heredadas. Excluye explícitamente 20260615000003_enable_pg_cron_pg_net.sql. El sustrato de prueba emula roles, auth.uid, tablas mínimas auth/storage, publicación y registro de cron.schedule. No ejecuta cron/red, GoTrue, Storage ni Realtime reales. PGlite tiene una conexión: no acredita carreras/concurrencia.

Se cargan dos workspaces sintéticos antes de la expansión, se guarda/restaura un dump local y se comparan campos históricos e IDs. Después se aplican las tres migraciones nuevas y se prueba backfill en lotes de una fila, reintento sin duplicados, rechazo de identidad conflictiva con rollback del lote, escrituras/receipts heredados, cambio de proveedor, aislamiento y bloqueo de nuevos canales. No son datos extraídos de producción.

Reproducir:

```powershell
npm run test:db:local
npm run test:unit
npm run typecheck
npm run test:e2e
```

### Procedimiento de adopción pendiente en copia Supabase

1. Yani eligió una cuenta nueva; no usar db-whatsapp/db-chatfuel. El proyecto bzanbpyzujlogipxvkfn quedó inicializado durante F3 con 71 migraciones, sobre una base vacía verificada. Para cualquier importación de datos operativos futura, identificar y autorizar por separado su origen/copia; no inferir que forman parte de este entorno nuevo.
2. Obtener un snapshot consistente, respaldarlo y probar restauración en el motor destino. Registrar conteos e IDs por tenant sin exportar secretos a Git. Verificar permisos reales, volumen, locks y duración.
3. Publicar lectores compatibles con teléfono nullable antes de permitir contactos sin teléfono. Ensayar primero sobre copia; la entrega local no autoriza despliegue.
4. Aplicar en orden, cada migración en su transacción: 20261010152038_omnichannel_channel_enum.sql, 20261010152041_omnichannel_expand.sql y 20261010152044_omnichannel_backfill.sql. El enum se confirma antes de usar sus valores. Aplicar las migraciones no ejecuta backfill.
5. Ejecutar el preflight con snapshot completo. Un operador verifica cuenta/proveedor/integración de cada workspace y registra su conexión sin copiar credenciales. No inferir la cuenta externa del nombre ni usar IDs de fixtures. Historial con múltiples proveedores requiere conciliación explícita y queda bloqueado para este backfill.
6. Invocar private.backfill_whatsapp_workspace desde sesión SQL de servidor autorizada, con workspace y conexión comprobados; límite entre 1 y 1.000 (500 por defecto). No exponer el esquema private como RPC. Cada llamada es atómica: repetir hasta remaining_conversations y remaining_messages iguales a cero. Registrar contadores sin contenido de mensajes. Ante colisión/proveedor ambiguo detener y conciliar; no saltar filas a ciegas.
7. Comparar IDs/conteos y campos históricos por tenant, RLS/roles, login, UI autenticada, recepción/envío WA, plantillas, opt-out y handoff en cuentas de prueba autorizadas. Probar concurrencia y rollback en la copia. Mantener los otros canales cerrados hasta sus fases.

### Recuperación y límites

Un lote fallido revierte sus cambios y puede reintentarse tras resolver la causa. Parar el backfill deja las conversaciones heredadas operables. Deshabilitar las capacidades nuevas conserva datos; no borrar columnas/identidades ni revertir a lectores que asuman phone no nulo. La restauración del respaldo completo se ensaya en copia: en producción requiere reconciliar escrituras posteriores para no perder historial.

Revocar una conexión preparada no desconecta por sí solo al proveedor WhatsApp heredado; la integración actual sigue controlando ese transporte hasta F3. Un cambio de proveedor conserva mensajes nuevos sin mapear en lugar de asignarlos a una conexión anterior. El backfill rechaza ese historial ambiguo. La unicidad heredada de conversación por contacto/canal se conserva hasta el cutover de F3.

Actualización durante F3: se aplicaron las 71 migraciones al Supabase nuevo y se validaron allí esquema, fixtures/backfill, RLS y concurrencia de la cola en PostgreSQL 17.11. No volver a aplicar esas migraciones. [Evidencia Cloud y límites](F3-MOTOR-omnichannel.md). No se importó historial de producción: los datos de prueba fueron sintéticos y se retiraron. Continúan pendientes flujos autenticados y contratos Meta/Brevo con cuentas de prueba. No hubo compras, mensajes reales, push/merge ni despliegue de la app.
