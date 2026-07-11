# Guía para agentes — Books App

## Alcance y arquitectura

- El objetivo de producción incluye **ARM64** (Raspberry Pi de 4 GB) y AMD64. No introduzcas imágenes, binarios ni dependencias que sólo funcionen en x86_64.
- Las imágenes de distribución son `arturoalvarez/books-backend:latest` y `arturoalvarez/books-frontend:latest`, ambas multi-arquitectura.
- En producción el frontend es el único puerto publicado: `8086:80`. El backend no debe publicar ningún puerto de host; nginx del frontend le habla mediante la red interna `books-private`.
- El estado del backend debe vivir bajo `/data`, montado en el volumen Docker persistente `books-data`. No guardes datos de usuario en el filesystem efímero del contenedor.
- Conserva límites razonables para una Raspberry Pi de 4 GB: backend 768 MiB y frontend 256 MiB, salvo que haya una razón medida para cambiarlo.

## Desarrollo y verificación

Antes de entregar cambios de aplicación, ejecuta lo que corresponda:

```bash
make backend-test
make frontend-build
make compose-config
```

`make frontend-test` ejecuta además la suite de frontend si existe. Para probar imágenes ya publicadas localmente, copie `.env.example` a `.env`, asigne valores reales a `BOOKS_JWT_SECRET` y `BOOKS_ADMIN_PASSWORD`, y use `make pull` seguido de `make up`.

## Patrón de despliegue

Dockge gestiona la pila desde `/opt/stacks/books`. La entrega autorizada copia el proyecto allí, crea/actualiza exclusivamente `/opt/stacks/books/.env`, y ejecuta:

```bash
docker compose pull
docker compose up -d --force-recreate
```

No se debe desplegar, publicar imágenes, crear `/opt/stacks/books`, ni alterar el daemon de Docker sin autorización explícita.

## Cloudflare

No realices cambios de DNS, Tunnel, Access ni otras configuraciones de Cloudflare sin confirmación explícita de Arturo. Cloudflare se administra con tokens y configuración remota; sus credenciales no pertenecen al repositorio ni a `.env` de esta pila. Tampoco presupongas un dominio: todavía no hay uno confirmado.
