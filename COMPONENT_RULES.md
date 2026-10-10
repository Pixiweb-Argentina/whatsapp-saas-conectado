# Component Rules — Pixiweb Mensajería

Agentes: leer este archivo antes de crear o modificar cualquier componente UI.
Última actualización: 2026-10-10

Design system: **Pixiweb**, según DESIGN.md. Piedra, violeta, sidebar negra y acento lima.
Referencias locales: `http://127.0.0.1:3100/ui` y `/ui/preview` (solo desarrollo, ejemplos ficticios).

---

## Regla 1 — Referencia el showcase primero

Antes de crear cualquier componente, abre `/ui`.
Si el componente que necesitas ya existe ahí, usa esa variante exacta.
No crear variantes nuevas sin actualizar el showcase primero.

## Regla 2 — Tokens de color, nunca hex

Correcto: `className="bg-primary text-primary-foreground"`
Incorrecto: `className="bg-[#B5F23D] text-black"`

Tokens (OKLch via CSS vars, soportan opacidad — `bg-primary/10`):
`bg-background, bg-card, bg-muted, bg-primary, bg-secondary, bg-accent,`
`bg-destructive, bg-success, bg-warning, bg-info, bg-border, bg-input`
`text-foreground, text-muted-foreground, text-primary, text-destructive`

Violeta primary para CTA; lima accent/sidebar-active para selección puntual. text-primary usa primary-text (violeta profundo en claro) para conservar contraste sobre piedra. Primary oscuro usa lavanda con texto oscuro. No confundir marca con estado: success/warning/destructive siempre acompañados por texto o icono.

## Regla 3 — Fuentes del proyecto

- Display/headings: **Manrope** → `font-display`
- Body/UI: **Manrope** → `font-body` (default)
- Editorial: **Instrument Serif cursiva** → `font-editorial italic`; solo bienvenida y encabezados editoriales.
- Datos (teléfonos, wamid, IDs, código): monoespaciada del sistema → `font-mono`

Nunca Inter, Roboto ni Arial.

## Regla 4 — Superficies

Paneles y conversaciones usan card estable; lienzo background piedra. Las utilidades heredadas glass/glass-strong conservan superficies legibles sin glow ambiental. No anidar vidrio ni poner blur detrás de mensajes. Inputs 14px, controles 16px, paneles 24px; radios 40px solo en bienvenida.

## Regla 5 — Motion system

Importar de: `@/features/ui-kit/motion`
Duraciones: instant(75ms), sm(150ms), md(200ms), lg/xl(220ms).
Easing default: `cubic-bezier(.22, 1, .36, 1)`. Respetar reduced-motion; globals.css reduce animaciones y transiciones.
Animar solo: transform, opacity, filter, color, background-color, border-color, box-shadow
NUNCA animar: width, height, padding, margin, top, left

## Regla 6 — Los 4 estados obligatorios

Todo componente que carga datos implementa los 4:

1. Loading: skeleton que imita el layout real (no spinner genérico)
2. Error: mensaje + botón retry
3. Empty: ilustración/ícono + heading + CTA
4. Data: el render principal

## Regla 7 — Iconografía

Solo Lucide React (outline). h-4 w-4 (inline), h-5 w-5 (sidebar/nav), h-6 w-6 (standalone).
Nunca mezclar con otras librerías de íconos.

## Regla 8 — Accesibilidad no negociable

- Botones icon-only → `aria-label`
- Inputs → `<Label htmlFor>` ↔ `id`
- Focus visible siempre (nunca `outline-none` sin ring equivalente)
- Botones en loading → `disabled` + `aria-busy`
- CTA e icon buttons: mínimo 44px. Texto normal 4.5:1; controles/foco 3:1.
- Navegación activa con aria-current; salto al contenido. DetailPanel usa drawer con foco atrapado y retorno al disparador en anchos menores a 1440px.

## Regla 9 — Variantes canónicas de Button

Solo: default, secondary, outline, ghost, destructive, link.
Jerarquía por pantalla: máximo 1 default (CTA primario), resto secondary/outline/ghost.

## Regla 10 — Cards

Default (borde): listas, contenido estático.
Elevated (shadow-md, sin borde): elementos destacados.
Accent (border-primary/20 bg-primary/5): KPIs, info de marca.
Glass (.glass): superficies hero/sticky.
No anidar Cards elevadas ni glass dentro de otra del mismo tipo.

## Regla 11 — Theming (claro por defecto)

Claro es el tema inicial (`defaultTheme="light"`). Se conserva la preferencia guardada y el toggle oscuro. Sidebar negra en ambos.
Nunca uses `bg-white`, `text-black`, `bg-gray-*` — rompen el dark mode.
Usa siempre los tokens semánticos (cambian solos con `.dark`).

## Regla 12 — Navegación y ejemplos

AppShell/AppFrame compartidos para app y agencia; permisos y consultas permanecen en layouts de servidor. Sidebar 216px desde 1024px, navegación inferior antes. Inbox una columna debajo de 768px y ficha lateral solo con espacio desde 1440px.

Las cinco vistas omnicanal de /ui/preview son prototipos interactivos, no integraciones. No mover sus datos ficticios ni simulaciones a rutas operativas. El build de producción devuelve 404 para esa ruta. Probar flujos autenticados cuando esté disponible el nuevo Supabase.
