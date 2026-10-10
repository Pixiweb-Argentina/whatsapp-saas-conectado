# Evaluación heurística propuesta

Evaluación de especificación, no prueba de una UI implementada. Riesgo alto = puede causar envío equivocado, filtración o pérdida de trabajo; medio = impide completar tarea; bajo = fricción.

| Heurística | Riesgo detectado en el diseño del problema | Severidad propuesta | Control verificable |
|---|---|---|---|
| Estado visible | «Conectado» sin permisos o sin webhook | Alto | Diferenciar conexión, readiness, última recepción |
| Lenguaje familiar | Hablar de scopes/PSID como primer nivel | Medio | Cuenta, permisos y motivo; detalles desplegables |
| Control | IA responde tras tomar chat | Alto | Revisión de estado y cancelación de jobs |
| Consistencia | Un estado verde significa activo, entregado y consentido | Alto | Estados distintos + texto |
| Prevención | Comentario interpretado como permiso de secuencia | Alto | Preview y guard de envío |
| Reconocimiento | Confundir varios negocios/cuentas | Alto | Workspace/canal/cuenta persistentes |
| Eficiencia | Filtros perdidos al volver del móvil | Medio | Restituir lista/posición |
| Claridad | Hero de landing ocupa bandeja de trabajo | Medio | Adaptar densidad/tipografía |
| Recuperación | Timeout lleva a repetir manualmente sin advertencia | Alto | Unknown con reconciliación guiada |
| Ayuda | Revisión Meta bloquea sin instrucciones | Medio | Checklist específico de permiso/capacidad |

Aceptación: sesiones de tarea con operador/admin/visitante, 375/768/1440px, teclado y lector de pantalla en flujo principal. Registrar hallazgos y evidencia por historia; no asignar una puntuación de usabilidad sin probar.

