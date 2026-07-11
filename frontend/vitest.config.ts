import { defineConfig } from "vitest/config";

/**
 * Vitest necesita su propio config para que `npm test` no intente levantar
 * los specs de Playwright (`e2e/`), que usan otra API (`@playwright/test`).
 * El build de Vite sigue usando `vite.config.ts`.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "dist", "e2e"],
  },
});