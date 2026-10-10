import { expect, test } from "@playwright/test";

// Public-entry smoke tests only. No real sign-in, messages or password reset requests.
test.beforeEach(async ({ context }) => {
  await context.route("https://supabase.example.invalid/**", (route) => route.abort());
});

test("root sends an anonymous visitor to a usable login form", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Bienvenido de vuelta" })).toBeVisible();
  const email = page.getByRole("textbox", { name: "Email", exact: true });
  await email.fill("smoke@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("local-fixture-only");
  await expect(email).toHaveValue("smoke@example.invalid");
  await expect(page.getByRole("button", { name: "Iniciar sesión", exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("inbox stays behind login when no session exists", async ({ page }) => {
  await page.goto("/inbox");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Bienvenido de vuelta" })).toBeVisible();
});

test("shared test-chat link retains its intended destination", async ({ page }) => {
  await page.goto("/probar");
  await expect(page).toHaveURL(/\/login\?next=(%2F|\/)probar$/);
  await expect(page.locator('input[name="next"]')).toHaveValue("/probar");
});

test("password recovery page can return to login without sending an email", async ({ page }) => {
  await page.goto("/forgot-password");
  await expect(page.getByRole("heading", { name: "Restablecer contraseña" })).toBeVisible();
  await page.getByRole("link", { name: "Volver a iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/login$/);
});
