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

1. Confirmación de invariantes de Lista Roja solicitada en este chat antes de modificar migraciones/auth/rutas/webhooks.
2. Entorno Supabase de prueba y copia consistente con backup restaurable. No hay migración SQL creada/aplicada ni prueba DB ejecutada.
3. App Meta y activos de prueba, versión Graph y scopes verificables; no se inventó una versión ni se enviaron mensajes.
4. Cuenta Brevo de prueba, cuotas, pipeline/etapas y mecanismo de Sales webhooks; no se crearon contactos u oportunidades externos.
5. Integrar los contratos, ejecutar backfill y verificar flujo autenticado antes de dar F1 por completa.

F1 sigue EN_PROGRESO. Ninguna prueba local de contrato se presenta como habilitación productiva.
