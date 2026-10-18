# F3 — Evidencia para aceptar los criterios (revisión de Yani)

Fecha: 2026-10-18. Rama: `codex/omnichannel-f3-managed-echoes`. Producción: deploy `q6e14chvs`.

Este documento junta, criterio por criterio, qué está probado, si la prueba fue **real** (con WhatsApp y producción de verdad) o **sintética** (con datos de prueba en una base local o con rollback), qué falta, y un veredicto sugerido. Los nueve criterios son los de `USER-STORIES-omnichannel-pixiweb.md` (US-006, US-007, US-008). La decisión es de Yani: nada de esto da F3 por cerrada hasta que lo apruebe.

Para armarlo no se envió nada, no se cambió ninguna variable y no se desplegó nada.

## Estado real verificado hoy (solo lectura)

| Qué | Valor |
|---|---|
| Workspace de prueba | 7 entrantes, 4 salientes, 3 contactos, 3 conversaciones |
| Jobs de IA/envío | 2: uno cancelado el 10/10 (la conversación cambió) y el de la prueba única del 18/10 (aceptado y entregado) |
| Último mensaje | la saliente de la prueba única, 18/10 04:44 UTC |
| Conexión Kapso | lista (ready), con permiso de texto vigente hasta 19/10 04:40 UTC, concedido por Yani a las 04:56 |
| Conexiones YCloud nuevas | las dos siguen “conectando” (sin permisos) |
| Interruptores de envío en producción | panel (HUMAN), worker y IA **vacíos** = apagados; la variable de prueba única ya no está |
| Chequeos de producción | `/login` 200 · webhook Kapso sin firma 401 · YCloud managed 503 |
| Tests | ver sección “Tests de hoy” al final |

## Resumen

| # | Criterio | Veredicto sugerido |
|---|---|---|
| 1 | US-006 AC1 — filtros y cuenta visible | Aceptar con límites |
| 2 | US-006 AC2 — timeline, notas y origen | Aceptar con límites |
| 3 | US-006 AC3 — tenant/rol y entregado/leído | Aceptar |
| 4 | US-007 AC1 — tomar/pausar frena a la IA | Aceptar con límites |
| 5 | US-007 AC2 — el composer explica si puede enviar | Aceptar con límites |
| 6 | US-007 AC3 — nadie se saltea a Meta; volver a IA es explícito | Aceptar |
| 7 | US-008 AC1 — duplicados no generan nada nuevo | Aceptar con límites |
| 8 | US-008 AC2 — reinicio y timeout sin reenvío ciego | Aceptar con límites |
| 9 | US-008 AC3 — firma, activo ajeno, desorden y ACK | Aceptar |

“Aceptar con límites” quiere decir: el comportamiento está construido y probado, pero alguna parte sólo se probó con datos sintéticos o depende de cuentas/canales que todavía no están dados de alta. Esos límites quedan anotados para las fases siguientes (F4 en adelante) o para cuando se encienda el envío.

## Criterio por criterio

### 1. US-006 AC1 — Filtrar por canal, cuenta, asignación y estado; cada fila y conversación muestra su canal y cuenta

- **Probado (real):** la bandeja de producción filtra por estado, canal, cuenta y asignación; la cuenta Kapso y la YCloud original aparecen identificadas en filas y conversación. Navegación revisada en celular (375 px) y escritorio (1440 px). Incrementos 24, 25 y 33.
- **Probado (sintético):** dos hilos del mismo contacto en dos cuentas distintas, con historias, previews y filtros separados; dos procesos compitiendo por el mismo hilo no lo duplican. [Multicuenta](evidencias/F3-MULTICUENTA-2026-10-15.json), [Asignación](evidencias/F3-INBOX-ASIGNACION-2026-10-15.json), [Bandeja por cuenta](evidencias/F3-BANDEJA-CUENTAS-2026-10-15.json).
- **Falta:** ver dos números reales conviviendo (las YCloud nuevas siguen conectando) y los canales nuevos (Instagram, Messenger, web), que son de F4–F6.
- **Sugerido:** aceptar con límites.

### 2. US-006 AC2 — La conversación muestra texto, media, notas internas y de dónde vino, sin tratar un comentario público como mensaje privado

- **Probado (real):** texto entrante y saliente (humano e IA), notas internas, foto real por Kapso guardada con su archivo (incremento 37), respuesta real escrita desde el celular con la app Business que aparece en la conversación (incremento 38).
- **Probado (sintético):** un comentario público sólo reserva, nunca abre un mensaje privado ([Reservas](evidencias/F3-RESERVAS-2026-10-10.json)); tipos de media, ubicación y botones.
- **Falta:** el origen de los canales nuevos (comentarios de Instagram/Facebook, widget) se muestra en sus propias fases. Todavía no hay archivo de evidencia JSON para los incrementos 37 y 38: están descriptos en `F3-MOTOR-omnichannel.md`.
- **Sugerido:** aceptar con límites.

### 3. US-006 AC3 — Cada uno ve sólo lo suyo según su rol; “entregado/leído” sólo si el proveedor lo confirma

- **Probado (real):** el 18/10 el proveedor confirmó enviado → entregado → leído de la prueba única, y la app lo mostró recién con esa confirmación; antes ya había recibos reales de YCloud. Un mensaje sólo “aceptado” no se muestra como entregado.
- **Probado (sintético):** lecturas y búsquedas filtradas por workspace y rol (tests de bandeja y RLS); un usuario de otro workspace no ve nada. [Recibos](evidencias/F3-RECEIPTS-2026-10-10.json), [IA entregada](evidencias/F3-IA-ENTREGADA-2026-10-15.json).
- **Falta:** repetir el recorrido de permisos por cada canal nuevo cuando se habilite (no bloquea F3).
- **Sugerido:** aceptar.

### 4. US-007 AC1 — Tomar o pausar la conversación cancela lo que la IA tenía pendiente y se vuelve a chequear antes de enviar

- **Probado (sintético, con las piezas reales):** el recorrido completo entrada → espera → decisión → toma humana → cola → worker con SQL real local: si una persona toma la conversación mientras la IA está pensando, el job se cancela y no sale nada; también los casos “sin cambio” y “tomar y devolver”. [Toma humana](evidencias/F3-TOMA-HUMANA-2026-10-15.json), [Humano](evidencias/F3-HUMANO-2026-10-10.json).
- **Probado (real):** el 10/10 un job de IA real quedó cancelado porque la conversación cambió antes de enviarse (se ve hoy en la base).
- **Falta:** una carrera en vivo con el modelo y el proveedor reales. Yani aceptó que alcance con los tests para la pausa de la IA.
- **Sugerido:** aceptar con límites.

### 5. US-007 AC2 — El composer explica por qué puede o no puede enviar (canal, permiso, ventana de 24 h)

- **Probado (real):** en producción el composer mostró el bloqueo “faltan permisos” mientras la cuenta no tenía permiso, y la prueba única del 18/10 salió desde el producto con todas las condiciones visibles en Ajustes.
- **Probado (sintético):** políticas y mensajes del composer (incrementos 5, 6, 8 y 16); si alguien inventa permisos, el servidor rechaza (422).
- **Falta:** responder desde el panel con el nuevo circuito en producción: eso necesita encender el interruptor del panel (HUMAN), que sigue apagado a propósito.
- **Sugerido:** aceptar con límites (el envío desde el panel se valida cuando Yani decida encenderlo).

### 6. US-007 AC3 — Ni un admin puede saltear una regla de Meta; volver a IA es una acción explícita

- **Probado (sintético):** guardar o verificar una clave no da permiso de envío; las cuentas nuevas nacen “sin permisos”; el rol admin no alcanza; la base revisa de nuevo membresía, consentimiento, bloqueo, identidad, ventana, revisión, presupuesto y cola antes de cada envío (incrementos 30, 32 y 35). [Permisos por cuenta](evidencias/F3-PERMISOS-CUENTAS-2026-10-15.json), [Altas](evidencias/F3-ALTAS-CUENTAS-2026-10-15.json).
- **Probado (real):** la conexión Kapso estuvo verificada y sin permiso hasta que Yani tocó “Autorizar texto” el 18/10; quedó registrado quién y cuándo, con vencimiento a 24 h. Devolver la conversación a la IA es un botón aparte.
- **Falta:** nada para F3.
- **Sugerido:** aceptar.

### 7. US-008 AC1 — Webhooks, recibos o ecos repetidos no crean mensajes ni ejecuciones nuevas

- **Probado (real):** reenvío real de eventos en el incremento 23 sin duplicar nada; la respuesta real desde la app Business (Kapso) quedó guardada como respuesta del negocio, sin crear un contacto nuevo.
- **Probado (sintético):** duplicados por base y por HTTP (incrementos 7, 12, 13, 18, 19, 21); el mismo identificador de WhatsApp en dos cuentas distintas no se mezcla (incremento 29). [Dedup por cuenta](evidencias/F3-DEDUP-CUENTAS-2026-10-15.json), [Business App](evidencias/F3-BUSINESS-APP-2026-10-10.json).
- **Falta:** ecos reales de YCloud y dos cuentas reales a la vez.
- **Sugerido:** aceptar con límites.

### 8. US-008 AC2 — Si el sistema se reinicia a mitad de un job lo retoma; si el proveedor no contesta tras enviar, queda “desconocido” y no se reenvía a ciegas

- **Probado (sintético):** el worker retoma jobs con lease vencido y el “fencing” impide que dos procesos envíen lo mismo ([Cola](evidencias/F3-COLA-2026-10-10.json), [Límites](evidencias/F3-LIMITES-2026-10-10.json)). Envíos interceptados (2 de YCloud y 1 de Kapso) a los que se les cortó la respuesta quedaron como “desconocido”, sin reenvío, y luego pasaron a entregado al llegar el recibo firmado.
- **Probado (real):** reanudación y reenvío real del incremento 23 sin mensaje nuevo.
- **Falta:** un timeout real del proveedor o matar el proceso en producción justo después de enviar; no se hizo para no arriesgar mensajes duplicados a contactos reales.
- **Sugerido:** aceptar con límites.

### 9. US-008 AC3 — Firma inválida, activo ajeno y eventos fuera de orden tienen pruebas; se responde OK recién después de guardar

- **Probado (real):** hoy el webhook Kapso sin firma responde 401 y el de YCloud managed responde 503 (apagado); recepciones firmadas reales en los incrementos 17 a 23 y 38.
- **Probado (sintético):** tests de firma inválida, cuenta ajena y recibos fuera de orden en entrada, recibos y pipeline; el OK se devuelve después de persistir. [Ingreso](evidencias/F3-INGRESS-2026-10-10.json), [Ingreso por cuenta](evidencias/F3-INGRESO-CUENTAS-2026-10-15.json).
- **Falta:** repetir estas pruebas con cada adaptador nuevo (F4 en adelante). El OK de la verificación de webhook no equivale a persistencia de un mensaje.
- **Sugerido:** aceptar.

## Qué queda pendiente aunque se aprueben los criterios

1. Encender el envío desde el panel, el worker o la IA: cada uno necesita un sí propio de Yani.
2. Dar de alta los números YCloud nuevos (siguen conectando) y probar dos cuentas reales a la vez.
3. Ecos reales de YCloud.
4. Archivos de evidencia JSON para los incrementos 37 y 38, la prueba única del 18/10 y el permiso de texto (hoy están en `F3-MOTOR-omnichannel.md`).
5. El permiso de texto de Kapso vence el 19/10 04:40 UTC; renovarlo es volver a verificar y tocar “Renovar permiso de texto”.

## Tests de hoy

- Typecheck: pasa.
- Unitarios: 1.995 de 1.995 pasan, 0 fallan.
