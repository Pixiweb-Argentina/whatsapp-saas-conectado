# Plan de verificación y riesgos — Omnichannel Pixiweb

2026-10-10 · **Plan futuro, no auditoría ejecutada ni certificado de seguridad**.

## Matriz de aceptación

| ID | Escenario | Evidencia exigida al construir | Historias |
|---|---|---|---|
| QA-01 | Backfill WA en copia | Conteos/IDs antes-después, colisiones, restauración y jobs detenidos durante cutover | 001/002 |
| QA-02 | Dos tenants y cuatro roles | Intentos de leer/escribir/conectar activo ajeno rechazados en API/DB, no solo UI | 001/002/006/009 |
| QA-03 | Regresión WA YCloud/Kapso | Suites existentes + mensaje/template/eco/handoff/opt-out en pruebas autorizadas | 001/007/008 |
| QA-04 | OAuth/callback/revocación | State replay/tenant swap/rol cambiado, scopes parciales y token revocado | 003/009/026 |
| QA-05 | Duplicación/crash | Webhook repetido, doble worker, lease vencido y timeout remoto sin segunda entrega | 008/011/014/020 |
| QA-06 | Políticas temporales | Reloj controlado en borde 24h/7d, comentario viejo, private reply sin respuesta, actor humano vs IA | 007/010/011/013/014/024 |
| QA-07 | Comentario→guía | Post y Reel reales; keyword, no-match, comentario propio, dos reglas, respuesta pública parcial | 011/012 |
| QA-08 | Conversaciones Meta | IG y Página reales con media soportada, eco/receipt, cuenta/identidad correctas | 010/013 |
| QA-09 | Widget | Sitio externo, sin cookies de terceros, token robado/revocado, otro origen, email impostado, teclado | 015/016 |
| QA-10 | Brevo contactos/listas | ext_id sin email/phone, cambios en ambos sentidos, membresía removida y opt-out que persiste | 017/018/019 |
| QA-11 | Brevo oportunidades | Create/update/associate, etapa remota, create ambiguo, cambio de cuenta | 020/021 |
| QA-12 | Convergencia y cuotas | Webhook ausente, 429, pausa, paginación/cursor, conflicto simultáneo y borrado sin resurrección | 019/021 |
| QA-13 | 14 fuentes | Fixture + prueba real + scopes/version registrados o limitación explícita; nunca solo toggle | 022/023/024/025 |
| QA-14 | Visual y accesibilidad | Capturas 375/768/1440, teclado/foco, lector de pantalla en recorrido clave, contraste y reduced-motion | 004/005 |
| QA-15 | Inyección y secretos | Texto social/documento/tool output no autoriza envíos, SSRF/media bloqueados, logs sin keys, RLS | 008/012/016/026 |
| QA-16 | Recuperación final | Apagar canal, revocar cuenta, restaurar copia, seguir WA y conservar mensajes; checklist release | 026/027 |

Los fixtures permiten desarrollo repetible. No sustituyen entrega real, revisión Meta, permisos externos ni comportamiento de una cuenta Brevo. Pruebas que envían mensajes se ejecutan solo con cuentas/destinos de prueba expresamente autorizados.

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación y responsable | Gate |
|---|---|---|---|
| App Meta sin Advanced Access | Clientes externos no pueden conectar/operar | Admin SaaS prepara negocio/app/revisión; ingeniería valida demo y permisos | Lanzamiento Meta |
| IG profesional no vinculado a Página | Onboarding elegido no cubre esa cuenta | Explicar requisito; medir fricción, evaluar IG Login como cambio posterior | Conexión individual |
| Paridad incompleta en historias/ads/referrals | Fuentes de Chatfuel no equivalentes | Spikes por variante, capability gating y brecha visible | Activación de fuente |
| Phone obligatorio en consumidores antiguos | Fallos al entrar lead social | Búsqueda de usos + tipos/validación + backfill en copia | Activación omnicanal |
| Race IA/humano o doble envío | Respuesta improcedente/duplicada | State revision, outbox, reservas y unknown sin retry ciego | Todo canal |
| ID scoped mal vinculado | Exposición de historial | FK compuesta, binding de activo a tenant, no merge por nombre | Todo canal |
| Brevo Sales webhook o cuota limitada | Sync lento/no inmediato | Conciliación paginada con presupuesto y lag visible | Promesa de sync |
| CRM create ambiguo/edición simultánea | Duplicados o pérdida de información | Base común, operation ID, no forceMerge y resolución explícita | CRM |
| Bloqueo de cookies de terceros | Widget pierde sesión | Protocolo first-party y token acotado, pruebas en navegador real | Widget |
| Rediseño de landing trasladado literalmente | Baja legibilidad/densidad | Adaptación de tamaños/radios/glow, QA de trabajo real | Diseño |
| Aumento de volumen/costos | Saturación workers/API/IA | Medir carga, colas, cuota, token budget y costo por conversación; límites por workspace | Escalado |
| Dependencias normativas/retención no definidas | Uso indebido de datos | Revisar avisos/consentimientos, exportación y borrado de producto; no copiar textos de marca | Lanzamiento |

Responsabilidades humanas propuestas: Yani decide alcance/aceptación; administrador de la app gestiona Meta; cada cliente aporta acceso a sus activos y Brevo; ingeniería implementa y guarda evidencia. No se asignan personas adicionales ni se afirma que ya aportaron cuentas.

## Runbook que debe entregar /build

1. Reconectar cuenta sin duplicar identidad.
2. Pausar reglas/canal y drenar/cancelar jobs.
3. Conciliar unknown de mensaje/deal.
4. Resolver conflicto CRM y borrado remoto.
5. Recuperar webhook perdido por reconciliación/historial sin disparar campañas históricas.
6. Rotar secretos/invalidar sesión y comprobar redacción de logs.
7. Exportar/eliminar datos con alcance tenant/cuenta y cumplir callback del proveedor.
8. Restaurar copia y rollback por flags sin perder datos nuevos.
9. Agregar evidencia App Review y verificar permisos de un cliente externo.
10. Desplegar solo con autorización y smoke real de raíz/login/ruta principal, no solo build exitoso.

## Evidencia de esta etapa de planificación

Realizado: lectura estática del fork, investigación de documentación oficial, inspección visual/estilos del sitio Pixiweb, cálculo de contraste de pares opacos y controles de consistencia documental.

No realizado: instalación de dependencias, tests del producto, app conectada, mensajes reales, DB Cloud, migraciones, aprobación Meta, UI nueva, deploy, push o merge. Esta separación debe mantenerse en el estado del proyecto.

