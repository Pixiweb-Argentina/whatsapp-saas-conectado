import { expect, test, type Page } from "@playwright/test";

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function tokenContrast(page: Page) {
  return page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    function luminance(token: string) {
      ctx.fillStyle = `oklch(${styles.getPropertyValue("--" + token)})`;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
        .map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
      return .2126 * r + .7152 * g + .0722 * b;
    }
    return [
      ["primary-foreground", "primary"], ["foreground", "background"],
      ["muted-foreground", "card"], ["muted-foreground", "background"],
      ["primary-text", "background"], ["sidebar-muted", "sidebar"],
      ["sidebar", "sidebar-active"], ["destructive", "card"],
    ].map(([fg, bg]) => {
      const a = luminance(fg), b = luminance(bg);
      return { pair: `${fg}/${bg}`, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
  });
}

test("Pixiweb themes preserve AA text pairs and persisted preference", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat|same key/i.test(message.text())) errors.push(message.text());
  });
  await page.goto("/ui/preview");
  await expect(page.getByRole("button", { name: "Activar tema oscuro" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.locator("body").evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Manrope");
  for (const theme of ["light", "dark"]) {
    if (theme === "dark") await page.getByRole("button", { name: "Activar tema oscuro" }).click();
    for (const { pair, ratio } of await tokenContrast(page)) expect(ratio, pair).toBeGreaterThanOrEqual(4.5);
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`inbox-${theme}.png`), fullPage: true });
  }
  await page.reload();
  await expect(page.getByRole("button", { name: "Activar tema claro" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("five design scenarios are usable without external writes", async ({ page }, info) => {
  await page.goto("/ui/preview");
  await page.getByRole("button", { name: "Regla «hola»", exact: true }).click();
  await page.getByLabel("Probá un comentario").fill("hola");
  await page.getByRole("button", { name: "Simular coincidencia" }).click();
  await expect(page.getByRole("status")).toContainText("Coincide.");
  await page.screenshot({ path: info.outputPath("rule.png"), fullPage: true });
  await page.getByRole("button", { name: "Conexión", exact: true }).click();
  await expect(page.getByText("Faltan permisos", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Revisar permisos" })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("connection.png"), fullPage: true });
  await page.getByRole("button", { name: "Conflicto Brevo", exact: true }).click();
  await page.getByRole("radio", { name: /Valor de Brevo/ }).check();
  await expect(page.getByRole("status")).toContainText("No se sincronizó ningún dato.");
  await page.screenshot({ path: info.outputPath("crm.png"), fullPage: true });
  await page.getByRole("button", { name: "Widget", exact: true }).click();
  await page.getByRole("button", { name: "Abrir chat", exact: true }).click();
  await expect(page.getByRole("region", { name: "Chat web de ejemplo" })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath("widget.png"), fullPage: true });
  await page.getByRole("button", { name: "Cerrar chat", exact: true }).click();
  await expect(page.getByRole("region", { name: "Chat web de ejemplo" })).toHaveCount(0);
});

test("inbox selection, empty search and contact drawer support keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/ui/preview");
  const search = page.getByRole("textbox", { name: "Buscar conversaciones de ejemplo" });
  await search.fill("inexistente");
  await expect(page.getByRole("status")).toContainText("Sin resultados");
  await search.fill("");
  await page.getByRole("button", { name: /Martín · ejemplo/ }).click();
  await expect(page.getByRole("region", { name: "Conversación de ejemplo" })).toContainText("WhatsApp");
  const trigger = page.getByRole("button", { name: "Ficha", exact: true });
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "Datos del contacto" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await noOverflow(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole("button", { name: "Volver a conversaciones" }).click();
  await expect(search).toBeVisible();
  await noOverflow(page);
});

test("login layout and visible focus work at phone tablet and desktop widths", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Bienvenido de vuelta" })).toBeVisible();
    await page.getByLabel("Email", { exact: true }).focus();
    expect(await page.getByLabel("Email", { exact: true }).evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`login-${width}.png`), fullPage: true });
  }
});

test("component library remains usable on narrow screens", async ({ page }) => {
  await page.goto("/ui");
  await expect(page.getByRole("heading", { name: "Pixiweb · Mensajería", exact: true })).toBeVisible();
  await noOverflow(page);
  await page.getByRole("button", { name: "Cambiar tema", exact: true }).click();
  await noOverflow(page);
});
