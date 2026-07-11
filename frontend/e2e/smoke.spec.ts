import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import { expect, test } from "@playwright/test";

const ADMIN_USER = process.env.BOOKS_ADMIN_USERNAME ?? "admin";
const ADMIN_PASS = process.env.BOOKS_ADMIN_PASSWORD ?? "e2e-test-password";

async function makeSampleTxt(): Promise<string> {
  const tmp = path.join(os.tmpdir(), `books-e2e-${Date.now()}.txt`);
  await fs.writeFile(tmp, "Capítulo 1\n\nEste es un libro de prueba para Playwright.\n\nFin.");
  return tmp;
}

test.describe("Books App – E2E críticos", () => {
  test("login, biblioteca vacía, logout", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /mis libros/i })).toBeVisible();

    await page.locator('input[name="username"]').fill(ADMIN_USER);
    await page.locator('input[name="password"]').fill(ADMIN_PASS);
    await page.getByRole("button", { name: /entrar/i }).click();

    await expect(
      page.getByText(/biblioteca está vacía|sube un epub/i),
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /salir/i }).click();
    await expect(page.getByRole("heading", { name: /mis libros/i })).toBeVisible();
  });

  test("login con credenciales incorrectas muestra error", async ({ page }) => {
    await page.goto("/");
    await page.locator('input[name="username"]').fill(ADMIN_USER);
    await page.locator('input[name="password"]').fill("wrong-password");
    await page.getByRole("button", { name: /entrar/i }).click();
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("subir TXT lo muestra en biblioteca y se puede eliminar", async ({ page }) => {
    const samplePath = await makeSampleTxt();
    try {
      await page.goto("/");
      await page.locator('input[name="username"]').fill(ADMIN_USER);
      await page.locator('input[name="password"]').fill(ADMIN_PASS);
      await page.getByRole("button", { name: /entrar/i }).click();

      // Subir el archivo por el input real (no el botón, que solo abre el picker)
      await page.setInputFiles('input[type="file"]', samplePath);

      // El libro aparece en la biblioteca
      const cover = page.getByRole("button", { name: /leer /i }).first();
      await expect(cover).toBeVisible({ timeout: 15_000 });

      // Diálogo de borrado accesible
      await page.getByRole("button", { name: /eliminar /i }).first().click();
      await expect(
        page.getByRole("heading", { name: /eliminar libro/i }),
      ).toBeVisible();
      await page.getByRole("button", { name: /eliminar definitivamente/i }).click();

      // La biblioteca vuelve a estar vacía
      await expect(
        page.getByText(/biblioteca está vacía/i),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await fs.unlink(samplePath).catch(() => {});
    }
  });
});