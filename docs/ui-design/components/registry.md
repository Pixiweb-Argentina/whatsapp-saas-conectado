# Registro de componentes propuesto

Reutilizar shadcn/Radix y componentes del fork antes de crear variantes. Cambios futuros feature-first; no instalar otro UI kit.

| Componente | Estrategia | Ubicación propuesta | Contrato/target |
|---|---|---|---|
| Button/Input/Select/Dialog/Tabs/Toast | Retematizar existentes | src/shared/components/ | Teclado, focus, error, disabled, loading; tokens semánticos |
| WorkspaceSwitcher/Sidebar | Adaptar existentes | workspace + layout actual | Tenant visible y selección autorizada |
| ChannelBadge/AccountLabel | Crear composición | src/features/channels/components/ | Canal+cuenta+texto, no solo color |
| ConnectionCard/PermissionChecklist | Componer | channels/components/ | Ready distinto de connected; recovery por permiso |
| ConversationList/Timeline/Composer | Adaptar | inbox/components/ | Identidad, media por capacidad, policy y entrega verdadera |
| SendPolicyNotice | Crear | channels/components/ | reasonCode→texto/acción; sin override de reglas Meta |
| RuleSourcePicker/RuleSteps/RulePreview | Componer | automations/components/ | Valores válidos, versiones, pasos, simulación sin efectos |
| RunTimeline | Crear | automations/components/ | Resultado independiente por paso y unknown |
| ContactIdentityList | Crear | contacts/components/ | Vínculo verificado, sin merge por username |
| CRMSyncBadge/DealForm/ListPicker | Componer | crm/components/ | Pending/confirmed/conflict; catálogos reales |
| SyncConflictResolver | Crear | crm/components/ | Base/local/remoto por campo, control de revisión |
| WidgetLauncher/WidgetShell | Crear | widget/components/ | Foco, cierre, sesión, mobile, sin secretos |
| IntegrationHealthPanel | Componer | channels/components/ | Diagnóstico filtrado por rol con redacción de secretos |

Targets de prueba: nombres accesibles y roles antes que test IDs; data-testid estable solo para controles ambiguos. No usar selectores por color, posición de DOM o texto dinámico de contacto. Story IDs se enlazan a los escenarios, no se muestran en producto.

