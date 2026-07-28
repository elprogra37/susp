# Estado de SUSP

> Última actualización: **28/07/2026**
> Repo: **github.com/elprogra37/susp** (rama `main`). Carpeta local: `C:\Dev\clientes`.
> Lo que falta está en [PENDIENTES.md](PENDIENTES.md). El plan, en
> [docs/ROADMAP.md](docs/ROADMAP.md). El diseño, en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

## Resumen en una línea

**Fase 1 cerrada (arquitectura y fundaciones).** Están definidos el stack, el
modelo de datos, las salvaguardas y el estándar USI completo; el monorepo está
armado y publicado. Todavía no hay código ejecutable: eso arranca en la Fase 2.

## Dónde quedé / próximo paso

- **Fase en curso:** Fase 2 — Backend (motor central, base de datos y API Gateway).
- **Próximo paso concreto:** crear `apps/engine` (NestJS + Prisma), definir el
  `schema.prisma` con el modelo de datos de `docs/ARQUITECTURA.md` §4, levantar
  Postgres con `make up` y aplicar la primera migración.
- **Cómo retomar:** leer este archivo, después `docs/ARQUITECTURA.md` y
  `docs/USI.md`. La arquitectura ya está decidida — no rediscutirla, implementarla.

## Decisiones tomadas (y por qué)

| Decisión | Motivo |
| --- | --- |
| TypeScript + **NestJS** + **Prisma** + **PostgreSQL 16** | Es exactamente el stack de `C:\Dev\telemedicina`. Consistencia con lo que ya mantiene el usuario. |
| **Docker primero** para todo | La máquina **no tiene Node instalado**. Instalar, compilar, testear y ejecutar pasan por contenedores. |
| Cola en **Postgres con `SKIP LOCKED`**, no Redis | Una dependencia menos, durable y transaccional. La interfaz `JobQueue` deja lugar a Redis más adelante sin reescribir nada. |
| Bloque de puertos **557xx** | Los demás proyectos ocupan 553xx–556xx; 557xx estaba libre. |
| Proveedor LLM **pluggable** (Anthropic + determinístico) | Todo tiene que correr y testearse sin API key. La CI usa el determinístico. |
| `claude-opus-5` para razonamiento, `claude-haiku-4-5` para contenido masivo | Calidad donde importa, costo bajo donde hay volumen. |
| Emails sintéticos con TLD **`.invalid`** | RFC 2606: imposibles de entregar. Ningún correo real puede salir por accidente. |
| Repo `susp` (≠ carpeta `clientes`) | Ya es su costumbre: `cannabisgram`→`cannapp`, `orbita`→`callme`, `vecinal`→`cuadra`. |

## Supuestos asumidos (no se pudo preguntar)

1. **Nombre del repo: `susp`.** La carpeta se llama `clientes` pero el proyecto es
   SUSP. Si querías otro nombre, se renombra en GitHub y se actualiza el remoto.
2. **Rama principal `main`.** `amor` usa `develop` por defecto; acá arranqué con
   `main` por simplicidad, con `develop` disponible si hace falta el flujo de dos ramas.
3. **Alcance de verticales:** citas, red social, telemedicina y marketplace, que es
   lo que dice la especificación y lo que cubre el portfolio.
4. **Sin generación de imágenes por IA en la v1:** avatares procedurales
   deterministas. Evita costo y dependencia externa para algo secundario.

## Qué se puede hacer hoy

- **Leer el diseño completo.** `docs/ARQUITECTURA.md` tiene componentes, modelo de
  datos, stack justificado y salvaguardas; `docs/USI.md` tiene el estándar entero
  con todos los endpoints, ejemplos de cuerpo y reglas de error.
- **Nada ejecutable todavía.** La Fase 1 es diseño y andamiaje; el primer código
  que corre llega con la Fase 2.

## Fases

| # | Fase | Estado |
| --- | --- | --- |
| 1 | Arquitectura y fundaciones | `[x]` hecha |
| 2 | Backend: motor central, DB y API Gateway | `[ ]` pendiente |
| 3 | Motor de agentes IA | `[ ]` pendiente |
| 4 | Estándar USI (OpenAPI, cliente, conformidad) | `[ ]` pendiente |
| 5 | SDK oficial | `[ ]` pendiente |
| 6 | Dashboard administrativo | `[ ]` pendiente |
| 7 | Adaptadores e integraciones | `[ ]` pendiente |
| 8 | Pruebas | `[ ]` pendiente |
| 9 | Documentación | `[ ]` pendiente |
| 10 | Despliegue | `[ ]` pendiente |

## Comandos

Todo pasa por Docker porque no hay Node en el host.

```bash
make up          # levanta Postgres + motor + dashboard
make down        # baja todo
make logs        # sigue los logs
make install     # npm install dentro del contenedor
make test        # corre la batería completa
make migrate     # aplica migraciones de Prisma
```

## Variables de entorno

Los **nombres** están en `.env.example` (los valores nunca se commitean). Las que
importan: `DATABASE_URL`, `JWT_SECRET`, `SUSP_LLM_PROVIDER`, `ANTHROPIC_API_KEY`
(solo si el proveedor es `anthropic`), `SUSP_BLOCK_PRODUCTION_TARGETS`,
`SUSP_DRY_RUN`.

## Bloqueos conocidos

- **GitHub Actions sin cuota.** La cuenta tiene agotada la cuota de storage de
  artifacts (mismo problema que en `amor`), así que la CI puede no disparar runs.
  El workflow se escribe sin `upload-artifact` para no empeorarlo, y la
  verificación real es local vía Docker. **No es bloqueante para el desarrollo.**
