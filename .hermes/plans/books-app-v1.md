# Plan: Books App v1

## Objetivo
Entregar una biblioteca personal React PWA y FastAPI que permita autenticar, subir y leer EPUB/PDF/CBZ/TXT, conservar progreso, notas y marcadores, y descargar libros para uso offline.

## Decisiones confirmadas
- Frontend: React 18 + TypeScript + Vite; no Vue.
- PWA: vite-plugin-pwa/Workbox y Cache API para archivos descargados.
- Backend: FastAPI + SQLAlchemy + SQLite, persistente en volumen.
- Idioma UI: español.
- Límite por archivo: 200 MB.
- Alcance v1: EPUB, PDF, CBZ y TXT. MOBI/AZW/FB2 se rechazan explícitamente en vez de prometer conversión no instalada.
- Producción: ARM64/AMD64; imágenes Docker Hub `arturoalvarez/books-{backend,frontend}:latest`; frontend host 8086, API sólo por nginx interno.

## Tareas
1. Construir API y pruebas: autenticación JWT, biblioteca, carga segura, streaming con Range, progreso, marcadores, resaltados, estanterías.
2. Construir React PWA: login, catálogo, carga, lector por formato, estado offline, descarga/cancelación de libros y UI accesible.
3. Añadir Dockerfiles, nginx proxy, compose, CI multi-arch, AGENTS.md, README y configuración de despliegue Dockge.
4. Ejecutar pruebas, build de producción, levantar stack local y comprobar flujos HTTP y navegador.

## Verificación
- `pytest -q` en backend.
- `npm run build` en frontend.
- `docker compose up -d --build` y healthchecks sanos.
- Login, carga de EPUB de muestra, lectura/progreso/marcador, descarga offline y refresco verificados desde navegador.

## Límite de despliegue
No se toca DNS, Tunnel de Cloudflare, Docker Hub ni `/opt/stacks/books` hasta recibir confirmación explícita del subdominio por Arturo.
