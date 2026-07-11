import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(() => ({
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_BACKEND_URL ?? "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  // pdfjs-dist 4.x trae su propio worker. Vite lo sirve como static y
  // necesita que no se pre-bundlee, y que copiemos el .mjs al directorio
  // público en build (lo hace `vite-plugin-static-copy` vía include abajo,
  // pero para mantener dependencias mínimas usamos `assetsInclude`).
  optimizeDeps: {
    exclude: ["pdfjs-dist"],
  },
  worker: {
    format: "es" as const,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Mis Libros",
        short_name: "Libros",
        lang: "es",
        display: "standalone",
        theme_color: "#14141d",
        background_color: "#14141d",
        icons: [
          {
            src: "/icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
          {
            src: "/icons/icon-192.svg",
            sizes: "192x192",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /\/api\/books(\?.*)?$/,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "catalogo" },
          },
          {
            urlPattern: /\/api\/books\/\d+\/file$/,
            handler: "CacheFirst",
            options: { cacheName: "books-runtime", expiration: { maxEntries: 100 } },
          },
        ],
      },
    }),
  ],
}));
