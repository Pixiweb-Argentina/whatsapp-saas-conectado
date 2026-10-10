# Recorridos y oportunidades

## A. Del comentario a una oportunidad

| Paso | Persona/acción | Respuesta visible | Alternativa / recuperación | Historia |
|---|---|---|---|---|
| 1 | Admin conecta Página/IG | Activos y permisos; prueba pendiente | Explicar vínculo Página y reconectar | US-009 |
| 2 | Manager selecciona publicación y «hola» | Preview de texto/enlace y alcance | Post sin permiso: elegir otro o corregir acceso | US-011/012 |
| 3 | Prueba y activa | Simulación sin envío; versión activa | Corregir regla sin alterar versión ya activa | US-012 |
| 4 | Contacto comenta | Una guía enviada o razón de bloqueo | Unknown queda para conciliar, no duplicar | US-008/011 |
| 5 | Contacto responde | Chat entra a ventana habilitada | Sin respuesta queda esperando, sin secuencia | US-010 |
| 6 | Operadora toma chat | IA pausada; contexto de post visible | Estado cambiado por colega: refrescar y explicar | US-006/007 |
| 7 | Crea/vincula oportunidad | Pending → confirmado Brevo | Error/cola sin perder conversación; conflicto visible | US-018/020/021 |

## B. Widget → humano

Admin registra origen y copia snippet → visitante inicia sesión anónima → escribe → agente responde → visitante pide humano → operador toma → visitante recarga y conserva solo su sesión. Si la sesión vence, se informa y se crea otra; no se busca historia por un email sin verificar (US-015/016/007).

## C. Cambio en Brevo → SaaS

Admin elige cuenta y listas/pipeline administrados → carga inicial previsualizada → cambio remoto → webhook o reconciliación → comparación con base común → actualización o conflicto → operador resuelve → confirmación y auditoría. Desuscripción y borrado no se revierten automáticamente (US-017–021).

## D. Revocación

Cliente retira acceso en Meta/Brevo → worker detecta revocación → pausa jobs → UI «Reconectá esta cuenta» → otras cuentas siguen funcionando → admin reconecta mismo activo → conserva identidad/historia y verifica webhook antes de activar (US-009/026).

Emociones, frecuencia y duración aún desconocidas; estos mapas son propuestas, no mediciones.

