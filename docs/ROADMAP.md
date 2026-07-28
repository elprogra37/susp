# Roadmap — SUSP

Desarrollo estrictamente por fases. **No se avanza a la siguiente sin cerrar la
anterior con pruebas y documentación.** El estado real y actualizado vive en
[`../ESTADO.md`](../ESTADO.md); acá está el plan.

---

### Fase 1 — Arquitectura y fundaciones

Definir arquitectura, stack, modelo de datos, seguridad y el borrador del estándar
USI **antes de programar**. Monorepo con npm workspaces, documentación base, repo
en GitHub.

**Entrega:** `docs/ARQUITECTURA.md`, `docs/USI.md`, `docs/ROADMAP.md`, `ESTADO.md`,
`PENDIENTES.md`, `package.json` raíz, `.env.example`, `.gitignore`, repo publicado.

---

### Fase 2 — Backend: motor central, base de datos y API Gateway

NestJS + Prisma + PostgreSQL. Módulos de tenants, apps destino, credenciales,
personas, campañas, escenarios, agentes, ejecuciones y auditoría. Autenticación
por API key y JWT, RBAC, límites de tasa, health checks, migraciones y seeds.

**Entrega:** API que arranca contra Postgres en Docker, migraciones aplicadas,
CRUD completo y `/health` verde.

---

### Fase 3 — Motor de agentes IA

Personalidad (rasgos), memoria (episódica y semántica con decaimiento), objetivos,
intereses, horarios y reglas de comportamiento configurables. Proveedor LLM
pluggable con dos implementaciones: Anthropic y determinístico (sin API key, para
tests). Scheduler durable sobre Postgres con `SKIP LOCKED`.

**Entrega:** un agente decide y ejecuta acciones de forma autónoma según su
personalidad y su horario, de punta a punta.

---

### Fase 4 — Estándar USI

Especificación formal en OpenAPI 3.1, esquemas compartidos con validación, cliente
USI en el motor (reintentos, timeout, circuit breaker, idempotencia) y suite de
conformidad ejecutable contra cualquier implementación.

**Entrega:** `packages/usi-spec` con OpenAPI y tipos, cliente funcionando y
`npx @susp/usi-conformance` operativo.

---

### Fase 5 — SDK oficial

`@susp/sdk` (cliente del motor) y `@susp/usi-server` (helper para implementar USI
en Node y Deno). Plantilla lista para Supabase Edge Functions, que es el camino de
integración de las apps Flutter+Supabase del portfolio.

**Entrega:** paquetes compilando, con tipos y ejemplos ejecutables.

---

### Fase 6 — Dashboard administrativo

React + Vite + TypeScript. Control de campañas, cantidad de agentes, escenarios,
métricas, logs, estado de las APIs USI conectadas y rendimiento. Purga de datos
demo con confirmación explícita.

**Entrega:** panel funcionando contra la API real.

---

### Fase 7 — Adaptadores e integraciones

Packs por vertical —citas, red social, telemedicina y marketplace— con arquetipos
de agente, generadores de contenido y guiones de interacción. App de referencia que
implementa USI en memoria para correr todo sin depender de apps externas.

**Entrega:** los cuatro packs y la app de referencia pasando conformidad.

---

### Fase 8 — Pruebas

Unitarios del motor de agentes y del scheduler, e2e de la API contra Postgres real,
y la suite de conformidad contra la app de referencia. Todo corre sin API key de
Anthropic.

**Entrega:** `npm test` verde de punta a punta.

---

### Fase 9 — Documentación

README, especificación USI legible, guía de integración paso a paso para una app
Flutter+Supabase, referencia del SDK, guía de operación del dashboard y documento
de seguridad y salvaguardas.

**Entrega:** alguien ajeno al proyecto puede integrar su app siguiendo los docs.

---

### Fase 10 — Despliegue

Dockerfiles multi-stage, `docker-compose` completo en el bloque de puertos 557xx,
Makefile con los comandos de uso diario, variables de entorno de ejemplo y CI.

**Entrega:** `make up` levanta la plataforma entera desde cero.

> **Nota sobre CI:** la cuota de storage de GitHub Actions de la cuenta está
> agotada (mismo bloqueo que en `amor`). El workflow se escribe **sin subida de
> artifacts** para no agravarlo, y no se toma como bloqueante: la verificación
> real es local, vía Docker.
