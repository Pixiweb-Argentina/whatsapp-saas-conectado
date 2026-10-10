# Modelos mentales

**Hipótesis derivadas, pendientes de validar.**

| Expectativa de la persona | Modelo real del sistema | Consecuencia de diseño |
|---|---|---|
| «Tengo un cliente» | Un contacto puede tener varias identidades y conversaciones | Ficha compartida solo tras vínculo verificado; historial separado por cuenta/canal |
| «Conecté Instagram» | OAuth, permisos, suscripción, webhook y revisión son pasos distintos | Estado paso a paso; listo solo después de recibir evento válido |
| «Comentó hola; puedo escribirle» | Derecho de private reply no equivale a conversación libre | Vista previa separa primer envío de seguimiento; política visible |
| «Pausé el bot» | Puede haber trabajo encolado | Pausa invalida jobs; UI indica enviados ya irrevocables |
| «Sincronizado» | La convergencia depende de evento/cuota/cola | Mostrar última confirmación, pendiente, conflicto o error, no verde constante |
| «Ingresé mi email» | Email declarado no verifica identidad | No recuperar historial por coincidencia de texto |
| «Activado» | Una fuente depende del proveedor | Mostrar capacidad disponible, pendiente de prueba o no compatible |

Vocabulario UI: Canales, Cuentas, Automatizaciones, Chats, Contacto, Oportunidades, Historial de ejecuciones. Evitar mostrar scopes, leases, PSID o webhooks como explicación principal; detalles técnicos desplegables.

