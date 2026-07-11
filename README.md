# Books App

Biblioteca personal con frontend React PWA y API FastAPI. Permite gestionar y leer EPUB, PDF, CBZ y TXT conservando los datos persistentes del servidor bajo `/data`.

> **Estado de despliegue:** no hay dominio ni despliegue en producción confirmados. Esta documentación prepara el proyecto, pero no publica imágenes ni crea una pila remota.

## Arquitectura de producción

| Servicio | Imagen Docker Hub | Exposición | Memoria máxima |
| --- | --- | --- | --- |
| Frontend (nginx) | `arturoalvarez/books-frontend:latest` | `8086:80` | 256 MiB |
| Backend (FastAPI) | `arturoalvarez/books-backend:latest` | Sólo red Docker interna | 768 MiB |

Las imágenes se construyen para `linux/amd64` y `linux/arm64`; la segunda es necesaria para la Raspberry Pi ARM64 de 4 GB. El volumen nombrado `books-data` monta `/data` en el backend. La red `books-private` es interna: no se expone el backend al host.

## Desarrollo local

### Requisitos

- Git
- Python 3.11+
- Node.js 20+ y npm
- Docker Engine con Docker Compose v2 (para ejecutar las imágenes de integración)

### API y frontend en modo desarrollo

En dos terminales, desde la raíz del repositorio:

```bash
# Terminal 1: backend
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

```bash
# Terminal 2: frontend
cd frontend
npm ci
npm run dev
```

El frontend de desarrollo debe apuntar a la API indicada por su configuración local. No añada secretos a archivos versionados.

### Pruebas y compilación

```bash
# Pruebas de backend
make backend-test

# Suite de frontend, cuando corresponda
make frontend-test

# Build de producción de frontend
make frontend-build

# Equivalente mínimo de entrega de aplicación
make test
```

El comando `make compose-config` valida el manifiesto Compose sin crear contenedores. Requiere Docker, pero no descarga ni publica imágenes.

### Probar las imágenes ya publicadas

Esto consume las imágenes multi-arquitectura preconstruidas; **no** construye ni publica nada:

```bash
cp .env.example .env
# Sustituya el marcador por un secreto largo y aleatorio.
openssl rand -hex 32
# Pegue el valor resultante como BOOKS_JWT_SECRET=*** en .env
# Cambie también BOOKS_ADMIN_PASSWORD antes de arrancar.

make compose-config
make pull
docker compose up -d --force-recreate
```

Abra `http://localhost:8086`. Para detenerla sin borrar libros ni la base de datos:

```bash
make down
```

Para borrar intencionadamente también los datos persistentes, inspeccione primero el nombre con `docker volume ls` y elimine `books-data` manualmente. Esta operación es destructiva.

## CI: build y publicación multi-arquitectura

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) se ejecuta al hacer `push` a `main` cuando cambian `backend/`, `frontend/` o el workflow, y también admite ejecución manual. Para cada imagen:

1. configura QEMU y Buildx (`docker/setup-buildx-action`);
2. construye para `linux/amd64,linux/arm64`;
3. inicia sesión con los secretos de GitHub `DOCKERHUB_USERNAME` y `DOCKERHUB_TOKEN`;
4. publica la etiqueta `latest` en Docker Hub:
   - `arturoalvarez/books-backend:latest`
   - `arturoalvarez/books-frontend:latest`

Los Dockerfiles de cada aplicación deben estar en `backend/Dockerfile` y `frontend/Dockerfile`, respectivamente. La publicación sólo ocurre dentro de GitHub Actions con secretos configurados; no ejecute un push manual salvo autorización expresa.

## Despliegue mediante Dockge (cuando esté autorizado)

Convenciones de servidor:

- usuario de Docker Hub: `arturoalvarez`;
- directorio de pilas de Dockge: `/opt/stacks`;
- esta aplicación: `/opt/stacks/books`.

Una vez que Arturo autorice expresamente el despliegue y proporcione/valide los secretos, el operador del servidor debe hacer:

```bash
# En el servidor, sólo tras autorización:
sudo mkdir -p /opt/stacks/books
# Copiar el contenido del proyecto a /opt/stacks/books por el mecanismo autorizado.
cd /opt/stacks/books
cp .env.example .env
# Editar .env y definir BOOKS_JWT_SECRET y BOOKS_ADMIN_PASSWORD
# con valores reales; no versionarlo.

docker compose pull
docker compose up -d --force-recreate
```

También puede cargarse el mismo `docker-compose.yml` en Dockge como una pila ubicada en `/opt/stacks/books`. Watchtower existe en el entorno, pero la actualización intencional de esta aplicación usa siempre `pull` seguido de `up -d --force-recreate`; no depende de Watchtower.

No cree `/opt/stacks/books`, no ejecute esos comandos en producción y no cambie la configuración del daemon Docker hasta recibir autorización explícita.

## Verificación posterior al despliegue autorizado

Ejecute desde el servidor:

```bash
cd /opt/stacks/books
docker compose ps
docker compose logs --tail=100 backend frontend
curl --fail --show-error http://127.0.0.1:8086/
docker volume inspect books-data
docker network inspect books-private
```

Confirme además que:

1. `frontend` aparece con el puerto `8086` publicado y `backend` no tiene puertos de host.
2. La interfaz se abre en `http://IP_DEL_SERVIDOR:8086` y puede autenticarse.
3. Una carga de prueba y su progreso sobreviven a `docker compose up -d --force-recreate`.
4. `docker image inspect` informa de la arquitectura correcta para el host; en la Pi debe ser `arm64`.

## Cloudflare y dominio

**No hay un dominio confirmado.** Cualquier cambio en DNS, Tunnel, Access o en otro recurso de Cloudflare requiere confirmación explícita de Arturo antes de actuar. Cloudflare está gestionado remotamente mediante tokens: no se deben incluir tokens en el repositorio, en esta pila ni en ejemplos de configuración. La exposición inicial es únicamente el puerto local `8086` del frontend hasta que exista esa autorización.
