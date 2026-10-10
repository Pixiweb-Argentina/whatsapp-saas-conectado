# Interacciones y estados

| Patrón | Comportamiento |
|---|---|
| Conexión | Wizard con pasos y un único CTA; permisos parciales recuperables; regreso preserva workspace |
| Regla | Draft editable, simulación, revisión, activar versión; pausar afecta pendientes |
| Composer | Canal/cuenta visibles; botón bloqueado con razón específica y acción de recuperación |
| Handoff | Cambio optimista solo con reversión clara; servidor/revisión manda; no borrar texto escrito |
| Guardar CRM | Pending visible, confirmación remota separada de guardado local |
| Conflicto | Comparación por campo, base/local/remoto; selección explícita y guardado con revisión |
| Errores | Mensaje útil y correlation ID copiable; no tokens ni stack trace en UI |
| Riesgo | Desconectar, transferir activo o borrar: mostrar alcance real; no confirmación para cada edición reversible |
| Pruebas | Simulador inequívocamente sin envíos; prueba real identifica cuenta/destino y produce auditoría |
| Búsqueda/filtros | URL/estado controlado, retorno preserva contexto, empty filtrado distinto de sin datos |

Toda pantalla tiene loading con estructura estable, empty con siguiente acción, error con recovery y success con datos reales. Disabled explica motivo. Reconexión y conflictos no bloquean navegar a otros canales.

