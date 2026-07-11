#!/usr/bin/env bash
# Orquestador de E2E:
#  1. Crea un DB y storage temporales en backend/e2e-tmp/
#  2. Arranca el backend en :8765 con credenciales conocidas
#  3. Espera al /health y verifica que el seed del admin sea accesible
#  4. Ejecuta Playwright (que a su vez levanta Vite en :5173 con proxy a :8765)
#  5. Apaga el backend al terminar
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"
E2E_DIR="$BACKEND_DIR/e2e-tmp"

ADMIN_PASS="e2e-test-password"
JWT_SECRET="e2e-test-secret-please-ignore"
BACKEND_PORT=8765

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
  rm -rf "$E2E_DIR"
}
trap cleanup EXIT

rm -rf "$E2E_DIR"
mkdir -p "$E2E_DIR/storage"

export BOOKS_DATABASE_URL="sqlite:///$E2E_DIR/test.db"
export BOOKS_STORAGE_PATH="$E2E_DIR/storage"
export BOOKS_JWT_SECRET="$JWT_SECRET"
export BOOKS_ADMIN_USERNAME="admin"
export BOOKS_ADMIN_PASSWORD="$ADMIN_PASS"

(
  cd "$BACKEND_DIR"
  exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "$BACKEND_PORT"
) &
BACKEND_PID=$!

# Espera a que el backend responda /health
for i in {1..60}; do
  if curl -fsS "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if ! curl -fsS "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null 2>&1; then
  echo "ERROR: el backend no arrancó en :$BACKEND_PORT" >&2
  exit 1
fi

if ! curl -fsS -X POST "http://127.0.0.1:$BACKEND_PORT/api/auth/login" \
    -H 'content-type: application/json' \
    -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASS\"}" >/dev/null; then
  echo "ERROR: el seed del backend no coincide con la contraseña E2E" >&2
  exit 1
fi

(
  cd "$FRONTEND_DIR"
  export VITE_BACKEND_URL="http://127.0.0.1:$BACKEND_PORT"
  export PLAYWRIGHT_BASE_URL="http://127.0.0.1:5173"
  export BOOKS_ADMIN_USERNAME="admin"
  export BOOKS_ADMIN_PASSWORD="$ADMIN_PASS"
  exec npx playwright test --reporter=list
)