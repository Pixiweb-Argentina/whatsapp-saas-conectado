# DESIGN — Pixiweb aplicado al SaaS omnicanal

Versión 1.1 · Observación 2026-10-10 · **Sistema base implementado localmente en F2; validación autenticada pendiente**.

## Fuente actual y alcance

Fuente solicitada: [pixiweb.com.ar](https://pixiweb.com.ar/). Se inspeccionaron hero y tarjetas de servicios en navegador, DOM y estilos computados. Hoja observada: `/assets/claro-BzD5AU3q.css`; el hash puede cambiar.

La captura de Chatfuel informa capacidades y organización. La referencia estética es el sitio actual de Pixiweb. No importar automáticamente textos comerciales, precios, promesas, datos ni el historial de paletas anteriores.

El fork partía de Glass + Electric Lime, Space Grotesk/Geist y oscuro por defecto. F2 actualiza tokens, fuentes, componentes, estados y COMPONENT_RULES.md. El claro es inicial; se conserva la preferencia guardada. Evidencia y pendientes: docs/F2-DISENO-omnichannel.md.

## Tokens observados en Pixiweb

| Uso / variable observada | Valor |
|---|---|
| Tipografía interfaz/cuerpo | Manrope, cuerpo observado 16px/24px, peso 500 |
| Acento editorial | Instrument Serif, cursiva |
| Titulares | Manrope, peso 800; tamaños de landing no transferidos literalmente |
| --ground / --stone | #cfcfcf |
| --mist | #eeeeee |
| --black / --white | #000000 / #ffffff |
| --indigo / --indigo-deep | #5d47ce / #432fb0 |
| --lavender | #b9a0ff |
| --lime raíz | #cbe269 |
| --surface / --input | #ffffff66 / #ffffff99 |
| --line / --line-strong | #00000029 / #0000003d |
| --input-border | #00000073 |
| --btn-primary-bg / hover | #5d47ce / #432fb0 |
| --r-s / --r-m / --r-l | 16px / 24px / 40px |
| --r-input / --r-pill | 14px / 999px |
| --ease | cubic-bezier(.22,1,.36,1) |

**Overrides del hero oscuro:** lima #c6ff33 y CTA violeta #7d39eb. El hero combina negro, glow violeta contenido y palabra serif en lima; no confundir sus variables locales con la paleta global. Las tarjetas claras combinan piedra, vidrio blanco y brillo violeta leve.

## Adaptación propuesta a un dashboard

Estas decisiones derivan del sitio; no se presentan como tokens extraídos de una aplicación Pixiweb existente.

- Sidebar negra, workspace siempre visible; superficie de trabajo piedra con paneles claros. Tema oscuro opcional conservado del fork con superficies derivadas #101014/#1b1a22, verificadas al implementar.
- Violeta principal para acción primaria; lima solo como acento de selección/foco sobre fondo oscuro o relleno con texto negro. Estado «conectado» usa símbolo+texto; no inferir éxito del color de marca.
- Manrope en interfaz, mensajes, tablas y formularios. Instrument Serif cursiva solo en bienvenida/onboarding/empty states editoriales; no en conversación, montos ni texto denso.
- Tipos UI: 12px metadata no crítica, 14–16px cuerpo, 20–24px títulos de panel, 28–36px portada. Fechas/IDs con fuente monoespaciada del sistema y números tabulares cuando ayuden.
- Espaciado 4/8/12/16/24/32/40. Radios 14 inputs, 16 controles/tarjetas compactas, 24 paneles; 40 solo bienvenida. Iconos Lucide consistentes; logos oficiales de canal solo para identificar canal.
- Gradientes/glow en introducción o fondos amplios; timeline y tablas sobre superficie estable. No blur sobre texto ni fondos decorativos que bajen contraste.
- Movimiento 120–220ms en cambios de estado/panel, respeta reduced-motion. Sin animación continua en bandeja.
- Escritorio: navegación 216–240px, lista 300–340px, conversación flexible y ficha 280–320px solo con ancho suficiente. A 768px ficha en drawer; a 375px una columna con regreso preservando filtros y scroll.
- Tocar/responder con acciones primarias de al menos 44px; foco visible, tab order, accesibilidad del diálogo/drawer y anuncios live de errores/envíos sin leer cada receipt.

### Correspondencia semántica futura

| Token SaaS | Claro propuesto | Uso |
|---|---|---|
| background | piedra #cfcfcf | Lienzo |
| card | blanco opaco o vidrio sobre fondo fijo verificado | Formularios/listas; opaco para texto extenso |
| foreground | negro #000000 | Texto primario |
| primary / primary-foreground | #5d47ce / blanco | CTA |
| primary-hover | #432fb0 | Hover |
| accent / accent-foreground | #cbe269 / negro | Selección puntual |
| sidebar | negro / blanco | Navegación |
| sidebar-accent | #c6ff33 / negro | Indicador activo |
| border | línea neutra visible según control | Separación; no depender solo de un borde translúcido débil |
| destructive / warning / success | Tonos semánticos a ajustar en /ui | Etiqueta+ícono y contraste; nunca sustituirlos por lima indiscriminadamente |

Mantener convención de tokens del fork (variables OKLCH crudas si esa es la que consume Tailwind). Convertir estos sRGB una sola vez y verificar el resultado visual; no pegar hex en una variable que se usa como `oklch(var(...))`.

### Contraste calculado de pares opacos

Cálculo WCAG de luminancia sRGB, realizado para esta especificación. No reemplaza validar transparencias/foco/estados en navegador.

| Texto / fondo | Relación |
|---|---|
| Blanco / #5d47ce | 6.45:1 |
| Blanco / #7d39eb | 5.74:1 |
| Negro / #cbe269 | 14.62:1 |
| Negro / #c6ff33 | 17.75:1 |
| #432fb0 / #cfcfcf | 5.93:1 |
| Negro / #cfcfcf | 13.48:1 |
| #c6ff33 / blanco | 1.18:1 — no usar para texto ni control esencial |

Objetivo AA: texto normal 4.5:1, texto grande 3:1 y controles/foco distinguibles 3:1 donde corresponde. Validar combinaciones reales sobre fondos compuestos.

## Inventario de rediseño

| Superficie | Aplicación del sistema y preservación funcional |
|---|---|
| Login/signup/forgot/reset | Campos y errores Pixiweb; mantener autenticación, recovery y redirects |
| Layout principal + workspace switcher | Jerarquía clara, active nav, theme switch, aviso de workspace |
| Dashboard | Métricas reales con canal/cuenta; empty/loading/error sin números ficticios |
| Inbox/lista/timeline/ficha/composer | Distinción canal+cuenta, actor humano/IA, política/envío y CRM; no perder densidad útil |
| Settings e integraciones | Cards por cuenta/proveedor, permisos y reconexión, secretos write-only |
| Agentes/KB/herramientas/plantillas dentro de settings | Editor, carga de documentos, validaciones y pruebas existentes |
| Automatizaciones | Fuentes agrupadas por canal, reglas/versiones, simulador y ejecuciones |
| Onboarding | Conectar → verificar → primer éxito; serif solo en encabezado editorial |
| Analisis | Tokens y leyendas accesibles; no sumar canales inexistentes a métricas sin etiquetar |
| Agency/workspaces | Selector/datos y aislamiento visibles; no mezclar logos/nombres de clientes |
| /ui | Showcase actualizado de todos los componentes y cuatro estados |
| /probar | Chat de prueba identifica simulación; no prometer entrega |
| Widget público | Mismo sistema en dimensiones reducidas, launcher accesible y opción de color controlada |

No crear nuevas páginas de calendario/Kanban/billing por el solo rediseño. Donde el fork use modales/tabs de settings, reutilizar su navegación antes de inventar rutas.

## Design System Prompt para /build

> Rediseñá el SaaS de atención omnicanal usando el sistema observado de Pixiweb el 10/10/2026. Usá Manrope para UI y Instrument Serif cursiva únicamente como acento editorial. Aplicá sidebar negra, lienzo piedra #cfcfcf, paneles legibles claros, CTA #5d47ce/hover #432fb0 con blanco, lavanda #b9a0ff y lima #cbe269 como acento; en áreas oscuras el lima puede ser #c6ff33. Conservá las capacidades, roles y estados del fork. Adaptá la densidad a una bandeja de trabajo: radios 14/16/24, jerarquía de texto de 14–24px y una sola acción primaria por sección. Usá tokens semánticos compatibles con la convención CSS vigente. Incluí loading, empty, error y success; no inventes datos. Diseñá desktop 1440px, tablet 768px y mobile 375px. El canal y la cuenta, la disponibilidad de envío, el estado humano/IA y la salud CRM deben ser visibles sin depender del color. Respetá teclado, foco, contraste AA y reduced-motion. No copies el tamaño de los titulares ni las promesas comerciales de la landing.

## Criterios de aceptación visual

- Login → workspace → conexión → regla → inbox → ficha Brevo conserva estados/contexto a 375/768/1440.
- Revisar todos los templates/rutas del inventario, incluyendo pantallas existentes no tocadas por la integración.
- No hay una mezcla accidental de Space Grotesk/Geist con Manrope ni variables hardcodeadas dispersas.
- Cinco previews obligatorias: inbox con 4 canales, regla «hola», conexión con permiso faltante, conflicto Brevo, widget en web cliente.
- QA visual y accesibilidad con capturas reales se realiza durante /build; este documento no certifica UI ni contraste integral de la aplicación.

## Decisiones de implementación F2

- Tokens OKLCH convertidos desde los hex observados, sin dependencias nuevas. Manrope e Instrument Serif con next/font; mono del sistema para datos.
- CTA claro violeta #5d47ce/blanco; text-primary usa #432fb0 para cumplir AA sobre piedra. Oscuro usa lavanda #b9a0ff con texto #101014 para conservar legibilidad. Override de marca por deployment se mantiene; requiere su propia verificación de contraste.
- Card opaca para trabajo, glass heredado casi opaco solo para compatibilidad; sin glow continuo sobre datos.
- AppFrame/AppShell compartidos: sidebar negra 216px desde 1024px, navegación inferior antes. Inbox una columna bajo 768px; DetailPanel lateral desde 1440px y drawer accesible antes.
- Cinco previews en /ui/preview (solo desarrollo, ficticias); no habilitan fuentes ni muestran métricas comerciales reales.
- Pendiente: revisión completa de pantallas privadas/roles/estados con el nuevo Supabase, incluidos filtros y scroll tras navegación real.

