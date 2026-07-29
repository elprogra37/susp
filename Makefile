# SUSP — comandos de uso diario.
#
# Todo pasa por Docker: la máquina de desarrollo no tiene Node instalado.
#
# `node_modules` y `dist` viven en volúmenes de Docker, no en el bind mount de
# Windows. No es un capricho: leyendo desde el bind mount, un solo
# `require('@nestjs/core')` tarda ~43 segundos y `npm install` ~40 minutos.
# Con volúmenes nativos son 0,3 s y 95 s. Cualquier comando que toque
# node_modules tiene que montar los mismos volúmenes.

COMPOSE  := docker compose -f infra/docker-compose.yml --env-file .env
VOLUMES  := -v "$(CURDIR):/app" -v susp_susp-node-modules:/app/node_modules
ENGINEV  := $(VOLUMES) -v susp_susp-engine-dist:/app/apps/engine/dist
NODE     := docker run --rm $(VOLUMES) -w /app node:22-alpine
ENGINE   := docker run --rm $(ENGINEV) -w /app/apps/engine node:22-alpine
DB_URL   := postgresql://susp:susp_local_dev@postgres:5432/susp?schema=public
ENGINEDB := docker run --rm --network susp_default $(ENGINEV) -w /app/apps/engine -e DATABASE_URL="$(DB_URL)" node:22-alpine

.DEFAULT_GOAL := help
.PHONY: help up down restart logs ps install build rebuild dev test lint \
        migrate migrate-create generate seed psql shell clean reset

help: ## Muestra esta ayuda
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

up: ## Levanta la plataforma entera
	$(COMPOSE) up -d
	@echo ""
	@echo "  API del motor      -> http://localhost:55701/health"
	@echo "  Dashboard          -> http://localhost:55703"
	@echo "  App de referencia  -> http://localhost:55704/usi/v1/manifest"

down: ## Baja todo (los datos de Postgres se conservan)
	$(COMPOSE) down

restart: ## Reinicia los servicios
	$(COMPOSE) restart

logs: ## Sigue los logs de todos los servicios
	$(COMPOSE) logs -f

ps: ## Estado de los servicios
	$(COMPOSE) ps

install: ## Instala dependencias en el volumen (~95 s)
	$(NODE) npm install --no-audit --no-fund

build: ## Compila el motor (~23 s)
	$(ENGINE) npm run build

rebuild: build ## Compila y reinicia el motor
	$(COMPOSE) restart engine

dev: ## Motor con recarga en caliente (más lento de arrancar)
	docker run --rm -it --network susp_default $(ENGINEV) -w /app/apps/engine \
	  -e DATABASE_URL="$(DB_URL)" -p 55701:55701 node:22-alpine npm run start:dev

test: ## Pruebas unitarias del motor
	$(ENGINE) npm test

test-all: ## Batería completa: tipos, unitarios, e2e y conformidad USI
	docker run --rm --network susp_default $(ENGINEV) -w /app node:22-alpine sh scripts/pruebas.sh

test-e2e: ## Solo los e2e (necesita Postgres levantado)
	docker run --rm --network susp_default $(ENGINEV) -w /app/apps/engine  -e DATABASE_URL="postgresql://susp:susp_local_dev@postgres:5432/susp_test"  -e JWT_SECRET="secreto-de-pruebas-suficientemente-largo-1234567890"  node:22-alpine npx jest --config ./test/jest-e2e.json --runInBand --forceExit

conformance: ## Valida una implementación USI:  make conformance url=... token=...
	docker run --rm --network susp_default $(VOLUMES) -w /app/packages/usi-conformance  node:22-alpine node src/cli.ts --url $(url) --token $(token)

lint: ## Chequeo de tipos
	$(ENGINE) npx tsc --noEmit

generate: ## Regenera el cliente de Prisma
	$(ENGINE) npx prisma generate

migrate: ## Aplica las migraciones pendientes
	$(ENGINEDB) npx prisma migrate deploy

migrate-create: ## Crea una migración:  make migrate-create name=agregar_x
	$(ENGINEDB) npx prisma migrate dev --name $(name)

seed: ## Siembra tenant, usuario dueño y API key
	$(ENGINEDB) npm run seed

sembrar: ## Siembra los packs de personas y escenarios:  make sembrar key=<api-key>
	docker run --rm --network susp_default $(VOLUMES) -w /app/packages/personas  -e SUSP_URL="http://engine:55701/api/v1" -e SUSP_API_KEY="$(key)"  node:22-alpine node scripts/sembrar.ts

psql: ## Abre una consola de PostgreSQL
	$(COMPOSE) exec postgres psql -U susp -d susp

shell: ## Abre una shell de Node sobre el repo
	docker run --rm -it $(ENGINEV) -w /app node:22-alpine sh

clean: ## Baja todo y BORRA los volúmenes (datos, node_modules y dist)
	$(COMPOSE) down -v

reset: clean install ## Borra todo y reinstala desde cero
	$(COMPOSE) up -d postgres
	@echo "Esperando a Postgres..."
	@until $(COMPOSE) exec -T postgres pg_isready -U susp -d susp >/dev/null 2>&1; do sleep 1; done
	$(MAKE) migrate seed build up
