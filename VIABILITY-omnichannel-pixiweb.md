# Viabilidad — Omnichannel Pixiweb

Fecha: 2026-10-10. Estado: evaluación de planificación, no aprobación comercial.

**Conclusión técnica: viable con condiciones externas.** Las APIs principales existen y el fork aporta la base de inbox, tenancy, agentes y CRM. La complejidad reside en preservar WhatsApp, separar identidades y políticas de envío, habilitar cuentas de terceros en Meta y conciliar Brevo.

Se continúa la planificación solicitada. El GO de construcción/lanzamiento queda sujeto a aprobación del blueprint y evidencia de acceso a proveedores. No se atribuye un score comercial: faltan entrevistas, costos reales, demanda y precio; asignar números daría precisión ficticia.

| Dimensión | Evaluación | Evidencia / condición |
|---|---|---|
| Técnica | Factible, complejidad alta | Relevamiento del fork y APIs oficiales; pruebas con cuentas reales pendientes |
| Negocio | Hipótesis razonable, sin validación de demanda | Yani define ampliación de SaaS; precio, segmento inicial y disposición a pagar no informados |
| Marketing | Por validar | Hay demo natural comentario→guía→CRM; no se presume canal de adquisición ni conversiones |

## Experimentos propuestos antes de comprometer lanzamiento

Son propuestas de verificación, no compromisos de presupuesto/plazo de Yani.

1. Meta: conectar una Página/IG de prueba, recibir comentario y completar un único private reply más respuesta entrante. Éxito técnico: trazabilidad de evento/envío/ventana y ausencia de duplicado ante replay. Para comercializar: repetir con cliente sin rol de la app y acceso aprobado.
2. Brevo: contacto solo `ext_id`, lista y oportunidad; modificar desde ambos lados, verificar conflicto y desuscripción. Éxito: convergencia sin loops ni duplicación y consumo dentro de cuota real.
3. Producto: operador prueba inbox unificado y campaña «hola» con datos de prueba; recoger problemas y medir pasos/tiempo. Umbral de adopción, precio y presupuesto: a acordar, no inventado.

Riesgos principales: revisión Meta, permisos parciales, envíos duplicados, identidad cruzada, desgaste por mantenimiento, cuotas Brevo y mezcla de consentimientos. Mitigaciones en el blueprint.
