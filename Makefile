.DEFAULT_GOAL := help

.PHONY: help test backend-test frontend-test frontend-build compose-config pull up down logs

help: ## Muestra los objetivos disponibles.
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "%-18s %s\n", $$1, $$2}'

test: backend-test frontend-build ## Ejecuta las pruebas backend y el build de frontend.

backend-test: ## Ejecuta pytest desde backend.
	cd backend && python3 -m pytest -q

frontend-test: ## Ejecuta la suite del frontend.
	cd frontend && npm ci && npm test -- --run

frontend-build: ## Instala dependencias limpias y compila el frontend.
	cd frontend && npm ci && npm run build

compose-config: ## Valida la interpolación y estructura de Compose usando .env.example.
	docker compose --env-file .env.example config

pull: ## Descarga las imágenes publicadas para la arquitectura local.
	docker compose pull

up: ## Arranca las imágenes publicadas en segundo plano (requiere .env).
	docker compose up -d --force-recreate

down: ## Detiene el stack sin eliminar el volumen de datos.
	docker compose down

logs: ## Sigue los logs de ambos servicios.
	docker compose logs -f
