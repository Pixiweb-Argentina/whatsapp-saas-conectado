# Screen flows — Omnichannel Pixiweb

18 templates de pantalla; las variantes existentes están enumeradas en cada alcance. Wireframes conceptuales, no capturas de una implementación. Todos se incluyen en su fase del blueprint con un prompt por template. Las páginas existentes conservan navegación/contratos; no se afirma que las nuevas rutas existan.

### S01 — Acceso y recuperación

**Fase F2 · US-004/005**. Alcance: Login, signup, forgot-password, reset-password.

**Flujo:** Formulario listo → submit → validación → destino existente; error conserva email.

**Desktop, 1440px**

```text
[Marca Pixiweb] | Acceso a tu negocio
[Email____________]
[Clave____________] [Mostrar]
[Ingresar]  [Recuperar acceso]
```

**Mobile, 375px**

```text
[Marca]
[Email]
[Clave]
[Ingresar]
[Recuperar]
```

**Prompt de UI:** Usar el Design System Prompt de F2. Rediseñá formularios de acceso y sus variantes con el Design System Prompt. Preservá validaciones, recuperación y redirects; errores junto al campo y sin revelar si existe una cuenta.

**Estados/target:** loading estable; empty con próxima acción; error con recuperación y correlation ID cuando corresponda; success confirmado, separado de pending. A 768px pasar panel secundario a drawer. Texto/control accesible por rol y teclado. Verificar el recorrido y sus alternativas de la historia asociada.

### S02 — Inicio

**Fase F2 · US-004/005**. Alcance: Dashboard.

**Flujo:** Workspace → periodo → detalle; sin datos muestra conectar/probar según estado real.

**Desktop, 1440px**

```text
[Nav] [Workspace v]          [Tema]
      [Resumen con datos reales]
      [Actividad] [Canales / avisos]
      [Abrir Chats]
```

**Mobile, 375px**

```text
[Workspace v] [Menú]
[Resumen]
[Actividad]
[Abrir Chats]
```

**Prompt de UI:** Usar el Design System Prompt de F2. Aplicá el sistema a Inicio. Mostrá métricas reales, periodo y estado de carga; sin números de ejemplo que parezcan datos del negocio.

**Estados/target:** loading estable; empty con próxima acción; error con recuperación y correlation ID cuando corresponda; success confirmado, separado de pending. A 768px pasar panel secundario a drawer. Texto/control accesible por rol y teclado. Verificar el recorrido y sus alternativas de la historia asociada.

### S03 — Análisis

**Fase F2 · US-004/005**. Alcance: Analisis y sus estados.

**Flujo:** Cambiar filtro → loading localizado → resultado; error permite reintentar sin perder filtro.

**Desktop, 1440px**

```text
[Nav] [Periodo] [Canal] [Cuenta]
      [Métrica] [Métrica]
      [Serie y leyenda accesible]
      [Tabla de resultados]
```

**Mobile, 375px**

```text
[Filtros]
[Métricas]
[Serie]
[Tabla adaptable]
```

**Prompt de UI:** Usar el Design System Prompt de F2. Rediseñá Análisis conservando consultas y significado. Diferenciá canal y periodo con etiquetas; vistas sin integración muestran sin datos.

**Estados/target:** loading estable; empty con próxima acción; error con recuperación y correlation ID cuando corresponda; success confirmado, separado de pending. A 768px pasar panel secundario a drawer. Texto/control accesible por rol y teclado. Verificar el recorrido y sus alternativas de la historia asociada.

### S04 — Configuración existente

**Fase F2 · US-004/005**. Alcance: Settings, agentes, KB, herramientas, plantillas, equipo.

**Flujo:** Seleccionar sección → editar → guardar; navegación advierte solo cambios sin guardar.

**Desktop, 1440px**

```text
[Nav] [Configuración: tabs]
      [Lista agentes/KB] | [Editor]
      [Estado validación y guardado]
      [Guardar cambios]
```

**Mobile, 375px**

```text
[Configuración v]
[Lista]
[Editar >]
[Formulario]
[Guardar]
```

**Prompt de UI:** Usar el Design System Prompt de F2. Rediseñá settings y los editores existentes con Manrope y tokens Pixiweb. Conservá campos, validaciones, carga de KB, templates y permisos; secretos write-only.

**Estados/target:** loading estable; empty con próxima acción; error con recuperación y correlation ID cuando corresponda; success confirmado, separado de pending. A 768px pasar panel secundario a drawer. Texto/control accesible por rol y teclado. Verificar el recorrido y sus alternativas de la historia asociada.

### S05 — Agencia

**Fase F2 · US-004/005**. Alcance: Workspaces y selector de negocio.

**Flujo:** Abrir negocio → servidor verifica acceso → layout del negocio; volver no mezcla datos.

**Desktop, 1440px**

```text
[Pixiweb] [Agencia]
[Buscar negocio] [Acción autorizada]
[Workspace | salud | abrir]
[Workspace | salud | abrir]
```

**Mobile, 375px**

```text
[Agencia]
[Buscar]
[Negocio]
[Salud] [Abrir]
```

**Prompt de UI:** Usar el Design System Prompt de F2. Rediseñá la vista de agencia. El negocio activo debe quedar inequívoco; ocultá acciones sin permiso sin confiar en eso como autorización.

**Estados/target:** loading estable; empty con próxima acción; error con recuperación y correlation ID cuando corresponda; success confirmado, separado de pending. A 768px pasar panel secundario a drawer. Texto/control accesible por rol y teclado. Verificar el recorrido y sus alternativas de la historia asociada.

### S06 — Componentes

**Fase F2 · US-004/005**. Alcance: /ui.

**Flujo:** Elegir componente/tema → comparar variantes; no componentes de demo con side effects.

**Desktop, 1440px**

```text
[Tokens] [Tipos] [Controles] [Estados]
[Botones: activo/disabled/loading]
[Form: error/success/focus]
[Cards y tabla de canales]
```

**Mobile, 375px**

```text
[Sección v]
[Control]
[Estados]
[Contraste]
```

**Prompt de UI:** Usar el Design System Prompt de F2. Actualizá el showcase con tokens nuevos, modo claro/oscuro y componentes densos; exhibí estados reales y foco.

**Estados/target:** loading estable; empty con próxima acción; error con recuperación y correlation ID cuando corresponda; success confirmado, separado de pending. A 768px pasar panel secundario a drawer. Texto/control accesible por rol y teclado. Verificar el recorrido y sus alternativas de la historia asociada.

### S07 — Chat de prueba

**Fase F2 · US-004/005**. Alcance: /probar.

**Flujo:** Elegir agente → mensaje → resultado; error no lo envía a un contacto real.

**Desktop, 1440px**

```text
[Agente v] [SIMULACIÓN]
[Transcript de prueba]
[Resultado y herramienta simulada]
[Escribir...] [Probar]
```

**Mobile, 375px**

```text
[SIMULACIÓN]
[Chat]
[Escribir]
[Probar]
```

**Prompt de UI:** Usar el Design System Prompt de F2. Rediseñá el chat de prueba usando el sistema compartido y etiqueta inequívoca de simulación; no confundas prueba local con envío al canal.

**Estados/target:** loading estable; empty con próxima acción; error con recuperación y correlation ID cuando corresponda; success confirmado, separado de pending. A 768px pasar panel secundario a drawer. Texto/control accesible por rol y teclado. Verificar el recorrido y sus alternativas de la historia asociada.

### S08 — Inbox omnicanal

**Fase F3 · US-006/007/008**. Alcance: Lista, conversación, ficha y composer.

**Flujo:** Filtro → abrir → tomar → responder → confirmación; expiración conserva borrador y explica bloqueo.

**Desktop, 1440px**

```text
[Nav] [Canal v][Cuenta v] | IG @negocio [Tomar] | [Contacto]
      [Chat WA]          | contexto del post   | [Identidades]
      [Chat IG *]        | mensaje / respuesta | [CRM]
      [Chat Web]         | [Ventana / estado]  | [Actividad]
                         | [Escribir...] [Enviar]
```

**Mobile, 375px**

```text
[< Chats] [IG @cuenta]
[Tomar / Devolver a IA]
[Mensajes]
[Ver contacto >]
[Motivo / ventana]
[Escribir] [Enviar]
```

**Prompt de UI:** Usar el Design System Prompt de F2. Diseñá bandeja de trabajo con canal y cuenta persistentes. Priorizá leer y responder, drawer de ficha en tablet y una vista por vez en móvil. Mostrá paused/unknown/expired con texto y acción concreta.

**Estados/target:** loading estable; empty con próxima acción; error con recuperación y correlation ID cuando corresponda; success confirmado, separado de pending. A 768px pasar panel secundario a drawer. Texto/control accesible por rol y teclado. Verificar el recorrido y sus alternativas de la historia asociada.

### S09 — Conectar Meta

**Fase F4 · US-009/010/013**. Alcance: Canales y onboarding Meta.

**Flujo:** Autorizar → elegir activos → verificar → prueba → ready; cancelar retorna al workspace.

**Desktop, 1440px**

```text
[Workspace] [Conectar Instagram / Facebook]
[1 Requisitos] [2 Autorizar] [3 Activos] [4 Probar]
[Pagina A] [IG vinculado] [Permisos]
[Evento recibido: pendiente] [Continuar]
```

**Mobile, 375px**

```text
[Conectar cuentas]
[Paso 2 de 4]
[Activo]
[Permisos]
[Continuar]
```

**Prompt de UI:** Usar el Design System Prompt de F2. Diseñá onboarding de conexión con Página/Instagram profesional, permisos faltantes y webhook pendiente separados. Mostrá activo y negocio antes de confirmar conexión.

**Estados/target:** loading estable; empty con próxima acción; error con recuperación y correlation ID cuando corresponda; success confirmado, separado de pending. A 768px pasar panel secundario a drawer. Texto/control accesible por rol y teclado. Verificar el recorrido y sus alternativas de la historia asociada.

### S10 — Editor de automatización

**Fase F4 · US-011/012/014**. Alcance: Regla, preview y simulación.

**Flujo:** Draft → simular → corregir → revisar → activar versión; pausar cancela pendientes.

**Desktop, 1440px**

```text
[Regla: Guía] [Borrador v2]        [Guardar] [Activar]
[Canal/cuenta] [Fuente/post] | [Vista previa]
[Keyword: hola] [Prioridad] | [Texto + link]
[Pasos ordenados]          | [Simular: comentario]
[Condiciones / política]   | [Resultado sin envíos]
```

**Mobile, 375px**

```text
[Guía - Borrador]
[Cuenta / Fuente]
[Post / Keyword]
[Pasos]
[Preview / Simular]
[Revisar y activar]
```

**Prompt de UI:** Usar el Design System Prompt de F2. Diseñá editor de reglas por formulario y pasos ordenados, sin canvas libre. Diferenciá private reply inicial de seguimiento; link de guía requerido; simulación no envía.

**Estados/target:** loading estable; empty con próxima acción; error con recuperación y correlation ID cuando corresponda; success confirmado, separado de pending. A 768px pasar panel secundario a drawer. Texto/control accesible por rol y teclado. Verificar el recorrido y sus alternativas de la historia asociada.

### S11 — Ejecuciones

**Fase F4 · US-008/012**. Alcance: Runs y resultados por paso.

**Flujo:** Run → detalle → recuperar solo paso fallido idempotente; unknown dirige a conciliación.

**Desktop, 1440px**

```text
[Regla] [Versión] [Fecha] [Estado]
[Evento] [Coincidencia] [Política]
[1 Privado: confirmado]
[2 CRM: pendiente] [Detalle seguro]
```

**Mobile, 375px**

```text
[Ejecución]
[Evento]
[Pasos]
[Motivo]
[Acción disponible]
```

**Prompt de UI:** Usar el Design System Prompt de F2. Mostrá resultados por paso y correlación, distinguiendo confirmado, bloqueado, pendiente, error y unknown. Retry no promete reenviar mensaje ya confirmado.

**Estados/target:** loading estable; empty con próxima acción; error con recuperación y correlation ID cuando corresponda; success confirmado, separado de pending. A 768px pasar panel secundario a drawer. Texto/control accesible por rol y teclado. Verificar el recorrido y sus alternativas de la historia asociada.

### S12 — Configuración widget

**Fase F6 · US-015**. Alcance: Sitios, orígenes y snippet.

**Flujo:** Registrar sitio → copiar → instalar → probar → comprobar recepción; no habilitar cualquier dominio.

**Desktop, 1440px**

```text
[Sitio] [Dominios permitidos]
[Apariencia] [Saludo] | [Preview]
[Snippet versionado] [Copiar]
[Verificación] [Abrir chat de prueba]
```

**Mobile, 375px**

```text
[Sitio]
[Dominios]
[Apariencia]
[Copiar snippet]
[Probar]
```

**Prompt de UI:** Usar el Design System Prompt de F2. Diseñá configuración simple de sitio con dominios exactos, preview y código copiable. El snippet contiene solo identificadores públicos.

**Estados/target:** loading estable; empty con próxima acción; error con recuperación y correlation ID cuando corresponda; success confirmado, separado de pending. A 768px pasar panel secundario a drawer. Texto/control accesible por rol y teclado. Verificar el recorrido y sus alternativas de la historia asociada.

### S13 — Widget público

**Fase F6 · US-015/016**. Alcance: Launcher e iframe visitante.

**Flujo:** Abrir → sesión → enviar → responder → recargar; vencimiento no muestra conversaciones ajenas.

**Desktop, 1440px**

```text
[Sitio del cliente]
                       [Chat - Negocio] [Cerrar]
                       [Hola / mensajes]
                       [Hablar con persona]
                       [Escribir...] [Enviar]
```

**Mobile, 375px**

```text
[Chat - Negocio] [X]
[Mensajes]
[Estado de atención]
[Escribir...]
[Enviar]
```

**Prompt de UI:** Usar el Design System Prompt de F2. Diseñá launcher e iframe accesibles y compactos con el sistema Pixiweb. Visitante anónimo por defecto; explicá sesión vencida, offline y handoff sin revelar datos internos.

**Estados/target:** loading estable; empty con próxima acción; error con recuperación y correlation ID cuando corresponda; success confirmado, separado de pending. A 768px pasar panel secundario a drawer. Texto/control accesible por rol y teclado. Verificar el recorrido y sus alternativas de la historia asociada.

### S14 — Conectar CRM

**Fase F7 · US-017/018/019**. Alcance: Brevo y mapeo inicial.

**Flujo:** Probar → seleccionar alcance → revisar → activar; error mantiene formularios sin devolver la key.

**Desktop, 1440px**

```text
[CRM activo: Brevo] [Cuenta confirmada]
[API key write-only] [Probar]
[Listas administradas] [Pipeline]
[Atributos] [Preview inicial] [Activar]
```

**Mobile, 375px**

```text
[Brevo]
[Probar cuenta]
[Elegir listas]
[Pipeline/atributos]
[Revisar sync]
```

**Prompt de UI:** Usar el Design System Prompt de F2. Diseñá conexión Brevo con secretos write-only, cuenta identificada, mapeo y preview antes de carga inicial. Explicá exclusividad de CRM sin borrar configuración anterior.

**Estados/target:** loading estable; empty con próxima acción; error con recuperación y correlation ID cuando corresponda; success confirmado, separado de pending. A 768px pasar panel secundario a drawer. Texto/control accesible por rol y teclado. Verificar el recorrido y sus alternativas de la historia asociada.

### S15 — Ficha CRM

**Fase F7 · US-018/019/020**. Alcance: Contacto, listas y oportunidades.

**Flujo:** Editar → guardar local pendiente → confirmar remoto; cambio externo refresca sin perder edición concurrente.

**Desktop, 1440px**

```text
[Contacto] [Identidades] [Última sync]
[Nombre/email/teléfono opcionales]
[Listas administradas +]
[Oportunidad | Pipeline/Etapa | Importe]
[Guardar] [Pendiente / Confirmado]
```

**Mobile, 375px**

```text
[Ficha]
[Datos]
[Listas]
[Oportunidades]
[Sync: pendiente]
```

**Prompt de UI:** Usar el Design System Prompt de F2. Ampliá la ficha del inbox con datos CRM y oportunidades en lista. Monto opcional, catálogos reales y estado local/remoto diferenciados; no crear Kanban.

**Estados/target:** loading estable; empty con próxima acción; error con recuperación y correlation ID cuando corresponda; success confirmado, separado de pending. A 768px pasar panel secundario a drawer. Texto/control accesible por rol y teclado. Verificar el recorrido y sus alternativas de la historia asociada.

### S16 — Conciliación CRM

**Fase F7 · US-021**. Alcance: Conflictos y jobs.

**Flujo:** Abrir conflicto → elegir → guardar revisión → confirmar; si cambió mientras tanto, volver a comparar.

**Desktop, 1440px**

```text
[Conflictos] [Última revisión] [Reintentar seguro]
[Campo | Base | Local | Brevo | Elegir]
[Etapa | ...  | ...   | ...   | opción]
[Resolver con revisión]
```

**Mobile, 375px**

```text
[Conflicto]
[Campo]
[Base]
[Local / Brevo]
[Resolver]
```

**Prompt de UI:** Usar el Design System Prompt de F2. Diseñá comparación por campo con explicación simple; estados de cuota/error/unknown y borrados. No resolver silenciosamente con el cambio más reciente.

**Estados/target:** loading estable; empty con próxima acción; error con recuperación y correlation ID cuando corresponda; success confirmado, separado de pending. A 768px pasar panel secundario a drawer. Texto/control accesible por rol y teclado. Verificar el recorrido y sus alternativas de la historia asociada.

### S17 — Fuentes ampliadas

**Fase F8 · US-022/023/024/025**. Alcance: Catálogo de 14 fuentes y capacidades.

**Flujo:** Elegir fuente → ver capacidad/evidencia → configurar; una fuente indisponible explica alternativa.

**Desktop, 1440px**

```text
[Por defecto] [Canal / cuenta]
[Instagram: DM | Posts | Historias | Anuncios | IG.me]
[Facebook: DM | Posts | m.me | Anuncios]
[WA: DM | Ads | Publicaciones] [Web]
[Disponible / Pendiente / No compatible] [Configurar]
```

**Mobile, 375px**

```text
[Canal v]
[Fuente]
[Estado y motivo]
[Reglas]
[Configurar]
```

**Prompt de UI:** Usar el Design System Prompt de F2. Diseñá fuentes agrupadas como referencia funcional de Chatfuel con estética Pixiweb. Mostrá condición real por variante; no toggles activos para capacidades sin probar.

**Estados/target:** loading estable; empty con próxima acción; error con recuperación y correlation ID cuando corresponda; success confirmado, separado de pending. A 768px pasar panel secundario a drawer. Texto/control accesible por rol y teclado. Verificar el recorrido y sus alternativas de la historia asociada.

### S18 — Salud y recuperación

**Fase F9 · US-026/027**. Alcance: Diagnóstico de conexiones.

**Flujo:** Alerta → cuenta → incidente → reconectar/conciliar → prueba → recuperar; otros canales siguen disponibles.

**Desktop, 1440px**

```text
[Cuenta | Permisos | Último evento | Jobs | Estado]
[IG ... | OK | hora real | 1 unknown | revisar]
[Brevo ... | OK | hora real | 3 pendientes | cuota]
[Ver incidente] [Pausar] [Reconectar]
```

**Mobile, 375px**

```text
[Conexiones]
[Cuenta / Estado]
[Último evento]
[Ver incidente]
[Reconectar]
```

**Prompt de UI:** Usar el Design System Prompt de F2. Diseñá diagnóstico operativo legible para admin: impacto, motivo, acción, correlación. No expongas tokens ni cuerpos completos; pausa y revocación explican alcance.

**Estados/target:** loading estable; empty con próxima acción; error con recuperación y correlation ID cuando corresponda; success confirmado, separado de pending. A 768px pasar panel secundario a drawer. Texto/control accesible por rol y teclado. Verificar el recorrido y sus alternativas de la historia asociada.


