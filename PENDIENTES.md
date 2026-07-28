# Pendientes — SUSP

Lo que falta, ordenado por fase. El estado general está en [ESTADO.md](ESTADO.md).

## Fase 2 — Backend

- [ ] `apps/engine` con NestJS: `main.ts`, `AppModule`, configuración tipada.
- [ ] `schema.prisma` con el modelo de datos de `docs/ARQUITECTURA.md` §4.
- [ ] Migración inicial + seed del tenant de bootstrap.
- [ ] Módulos: `tenants`, `target-apps`, `credentials`, `personas`, `campaigns`,
      `scenarios`, `agents`, `runs`, `audit`.
- [ ] Autenticación: API key (cabecera `X-Susp-Key`) y JWT para el dashboard.
- [ ] RBAC por rol de tenant (`owner`, `operator`, `viewer`).
- [ ] Límite de tasa por tenant y por app destino.
- [ ] Cifrado en reposo de `UsiCredential` (AES-256-GCM con clave de entorno).
- [ ] `/health` con chequeo de base de datos.

## Fase 3 — Motor de agentes

- [ ] Modelo de personalidad (rasgos, tono, verbosidad, tolerancia al riesgo).
- [ ] Memoria episódica y semántica con decaimiento y recuperación por relevancia.
- [ ] Objetivos con progreso y criterios de finalización.
- [ ] Horarios: franjas activas, ritmo, variación por día de la semana.
- [ ] Motor de reglas de comportamiento (condición → acción).
- [ ] `LlmProvider` con `AnthropicProvider` y `DeterministicProvider`.
- [ ] **El adaptador Anthropic no debe enviar `temperature`/`top_p`/`top_k` con
      `claude-opus-5`** — devuelve `400`. Solo puede mandarlos con `claude-haiku-4-5`.
- [ ] Manejar `stop_reason: "refusal"` **antes** de leer `content`.
- [ ] Scheduler con `FOR UPDATE SKIP LOCKED`, backoff exponencial y `dead letter`.

## Fase 4 — USI

- [ ] OpenAPI 3.1 completo en `packages/usi-spec`.
- [ ] Esquemas de validación compartidos motor ↔ SDK.
- [ ] Cliente USI: timeout, reintentos, circuit breaker, `Idempotency-Key`, firma HMAC.
- [ ] Negociación de capacidades desde el manifiesto.
- [ ] Suite de conformidad con CLI y salida legible.

## Fase 5 — SDK

- [ ] `@susp/sdk`: cliente tipado del motor.
- [ ] `@susp/usi-server`: helper para implementar USI (Node y Deno).
- [ ] Plantilla de Supabase Edge Function.

## Fase 6 — Dashboard

- [ ] Campañas: alta, edición, arranque, pausa.
- [ ] Métricas y gráficos de rendimiento.
- [ ] Visor de logs y auditoría.
- [ ] Semáforo de estado de las APIs USI conectadas.
- [ ] Purga con confirmación escrita.

## Fase 7 — Adaptadores

- [ ] Packs de citas, red social, telemedicina y marketplace.
- [ ] App de referencia con USI en memoria.

## Fase 8 — Pruebas

- [ ] Unitarios: agentes, scheduler, políticas de seguridad, cliente USI.
- [ ] E2E de la API contra Postgres en Docker.
- [ ] Conformidad contra la app de referencia.

## Fase 9 — Documentación

- [ ] README con inicio rápido.
- [ ] Guía de integración para Flutter + Supabase.
- [ ] Referencia del SDK.
- [ ] `docs/SEGURIDAD.md`.

## Fase 10 — Despliegue

- [ ] Dockerfiles multi-stage.
- [ ] `docker-compose` completo.
- [ ] Makefile.
- [ ] Workflow de CI **sin** `upload-artifact` (la cuota de la cuenta está agotada).

---

## Deuda técnica y decisiones a revisar

- **Cola en Postgres.** Alcanza de sobra para este volumen. Si algún día hace falta
  más throughput, la interfaz `JobQueue` permite meter Redis/BullMQ sin tocar el
  motor de agentes.
- **Avatares procedurales.** La v1 no genera imágenes por IA. Si se quiere, se suma
  como capacidad opcional del proveedor de contenido.
- **Rama `develop`.** Arranqué con `main` sola. Si preferís el flujo de dos ramas
  como en `amor`, se crea `develop` y se cambia la rama por defecto en GitHub.
