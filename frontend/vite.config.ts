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
