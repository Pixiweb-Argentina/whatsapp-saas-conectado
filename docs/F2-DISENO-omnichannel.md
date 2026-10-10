# F2 — Sistema Pixiweb y revisión local

2026-10-10 · Build Manual · Rama codex/omnichannel-f2-pixiweb, base 5753e34 (F1).
Worktree reutilizado: C:/Users/Yani Acevedo/.codex/worktrees/omnichannel-f1/app-whatsapp-saas-conectado.

## Alcance entregado

- Tokens de DESIGN.md en OKLCH; piedra/violeta/lima, tema claro inicial y oscuro persistido. Manrope e Instrument Serif vía next/font; mono del sistema. Sin nuevas dependencias.
- Button/Input/Textarea/Card/Sheet, foco visible, objetivos principales de 44px, movimiento reducido. text-primary separado del fondo primary para contraste sobre piedra.
- AppShell/AppFrame/AppNavigation compartidos para app/agencia; sidebar 216px y navegación inferior responsive. Queries, redirects, roles y logout conservados en servidor.
- Layout editorial de acceso para login/signup/recovery/reset. Formularios y acciones existentes se conservan.
- Inbox una columna móvil, regreso a conversaciones, altura disponible sin tapar composer con navegación inferior. Ficha/observabilidad en DetailPanel: drawer antes de 1440px, Escape y retorno del foco; lateral desde 1440px.
- Variables HSL electric-lime inexistentes y colores de estados solo legibles en oscuro reemplazados por tokens.
- /ui actualizado y /ui/preview con cinco escenarios: cuatro canales, regla «hola», permiso faltante, conflicto Brevo y widget. Todos ficticios y sin envío/sincronización; no sustituyen implementación F3–F8.

## Cómo revisar

Desde el worktree ejecutar npm run dev -- --hostname 127.0.0.1 --port 3100 con la configuración local de desarrollo. Nunca usar 3300/3301. Para los smoke tests se usan valores públicos ficticios en playwright.config.ts; no configurar esas claves en producción.

- http://127.0.0.1:3100/ui/preview: vistas interactivas, búsqueda, ficha, simulación de palabra completa, selección local de conflicto y abrir/cerrar widget.
- http://127.0.0.1:3100/ui: biblioteca de componentes y estados.
- http://127.0.0.1:3100/login: layout real de acceso; no hay cuenta autenticada de prueba conectada todavía.

La simulación de keyword es una demostración local exacta, no la especificación final del motor de automatización. Botones de conexión/envío/sync quedan deshabilitados en las vistas.

## Evidencia y límites

- Typecheck y eslint dirigido pasan. Build de producción local pasa con configuración pública ficticia.
- Unitarias: 1.666 pasan. La suite de F1 sobre base (14) se conserva; no se repitió porque F2 no modifica SQL ni backfill.
- Navegador: 20/20 pasan (33,2s), desktop y móvil, incluyendo tests/e2e/pixiweb-design.spec.ts y la regresión pública existente. Sin errores de hidratación/keys detectados en carga limpia del preview.
- Comprobados: preferencia de tema tras recarga, Manrope cargada, búsqueda vacía, navegación por escenarios, drawer/teclado, login a 375/768/1440px, overflow horizontal y foco.
- Ocho pares de texto calculados en navegador por tema cumplen 4.5:1: CTA, foreground/background, muted/card, muted/background, primary-text/background, sidebar-muted/sidebar, selección sidebar y destructive/card. No es una certificación de todos los estados ni de los overrides personalizados.
- Capturas locales de ambos temas y cinco escenarios en test-results/pixiweb-design-*/; reporte navegable playwright-report/index.html. Estas carpetas están ignoradas por Git.
- /ui/preview ejecuta notFound fuera de development. El intento de iniciar servidor de producción en 3102 fue rechazado por revisión automática sin motivo detallado: respuesta HTTP 404 pendiente de verificación. No se eludió el rechazo.

## Pendiente para aceptación integral

Conectar proyecto de la cuenta Supabase nueva de Yani; no usar las bases antiguas. Validar login y recuperación reales, workspace switcher, roles, envío WA, handoff, ficha/observabilidad y todas las pantallas privadas (agentes, KB, herramientas, templates, settings, dashboard, análisis y agencia). Revisar filtros/scroll tras navegación autenticada y todos los estados de cada vista.

El sistema base está implementado; los flujos privados reciben tokens y shell pero no se consideran probados por el showcase. F1 y F2 conservan pendientes explícitos; ninguna fase se declara íntegramente cerrada. Sin compras, cambios Cloud, push/merge ni despliegue.

Actualización F3 incremento 4: Supabase nuevo conectado a la app local, 72 migraciones aplicadas. Login real, workspace desde agencia, inbox autenticado, filtros, móvil, Realtime y toma humana comprobados con fixtures. Se conserva un laboratorio sintético para revisión. El resto de pantallas privadas, acceso definitivo y contratos/proveedores siguen pendientes. Ver [continuidad F3](F3-MOTOR-omnichannel.md).
