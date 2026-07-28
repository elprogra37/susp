# SUSP — Synthetic User Simulation Platform

Plataforma central para crear **usuarios sintéticos** —agentes de IA con
personalidad, memoria y objetivos— y usarlos para poblar aplicaciones con datos e
interacciones realistas, destinados a **pruebas, demos y simulaciones**.

> **El motor nunca toca la base de datos de tu app.** Se integra a través de un
> estándar abierto, **USI (Universal Simulation Interface)**, que tu aplicación
> implementa. Tus reglas de negocio siguen mandando.

## Por qué

Probar y demostrar una app social, de citas, de salud o un marketplace exige algo
que al principio no existe: **gente usándola**. Sembrar datos a mano da un
resultado plano y poco creíble; escribir directo en la base de datos saltea las
validaciones y termina generando estados imposibles.

SUSP resuelve las dos cosas: los agentes se comportan como usuarios (tienen
horarios, intereses, memoria de lo que hicieron y con quién) y todo lo que hacen
pasa por la API pública de tu app, así que nunca produce un estado que tu app no
habría aceptado por sí sola.

## Datos sintéticos, siempre identificados

Cada entidad creada por SUSP queda marcada de forma permanente y consultable:

```json
{ "synthetic": true, "simulation_id": "run_2f9c", "agent_id": "agt_7f3a", "created_by": "susp" }
```

Esto no es opcional ni desactivable, y la suite de conformidad lo verifica. Además:

- Los agentes **solo** interactúan entre ellos, nunca con usuarios reales.
- Todo lo generado se puede enumerar y borrar por completo (`/purge`).
- Por defecto el motor **se niega** a escribir contra una app marcada como
  `production`.
- El modo `dry-run` calcula el plan completo sin escribir nada.

Es la diferencia entre poblar un entorno de demostración y simular actividad
falsa. SUSP hace lo primero, por diseño.

## Cómo funciona

```
Dashboard  →  API del motor  →  Motor de agentes  →  Cliente USI  →  API USI de tu app
:55703         :55701            personalidad,        reintentos,      la implementás vos
                                 memoria, metas,      idempotencia,
                                 horarios             circuit breaker
```

1. Registrás tu app en SUSP con la URL de su API USI y un token.
2. Definís **personas** (arquetipos) y una **campaña** (cuántos agentes, qué
   escenario, en qué ventana de tiempo).
3. El motor crea los agentes, cada uno decide qué hacer según su personalidad y su
   horario, y lo ejecuta contra tu app vía USI.
4. Mirás métricas y logs en el dashboard. Cuando terminás, purgás todo.

## Estado

**Fase 1 de 10 completada** (arquitectura y fundaciones). Ver
[ESTADO.md](ESTADO.md) para el detalle y [docs/ROADMAP.md](docs/ROADMAP.md) para
el plan.

## Documentación

| Documento | Contenido |
| --- | --- |
| [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) | Componentes, stack justificado, modelo de datos, seguridad |
| [docs/USI.md](docs/USI.md) | El estándar completo: endpoints, ejemplos, errores, conformidad |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Las 10 fases y qué entrega cada una |
| [ESTADO.md](ESTADO.md) | Dónde quedó el desarrollo y cómo retomarlo |
| [PENDIENTES.md](PENDIENTES.md) | Lo que falta, por fase |

## Requisitos

- **Docker** — es el único requisito real. Node y PostgreSQL corren en contenedores.

## Inicio rápido

```bash
git clone https://github.com/elprogra37/susp.git
cd susp
cp .env.example .env     # completar JWT_SECRET
make up                  # levanta Postgres + motor + dashboard
```

- API del motor → http://localhost:55701
- Dashboard → http://localhost:55703

## Integrar tu app

Implementá la API USI (cuatro endpoints obligatorios, el resto por capacidades) y
verificala:

```bash
npx @susp/usi-conformance --url https://mi-app.example/usi/v1 --token <token>
```

Si tu app es **Flutter + Supabase**, el camino es una Edge Function en Deno: hay
plantilla lista en `packages/usi-server`. La guía paso a paso llega en la Fase 9.

## Licencia

UNLICENSED — proyecto privado.
