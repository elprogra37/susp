# Arquitectura — SUSP (Synthetic User Simulation Platform)

> Documento de diseño. Se escribe **antes** de programar y manda sobre el código:
> si el código se aparta de acá, se corrige el código o se actualiza este documento
> explicando por qué.

## 1. Qué es SUSP

Una plataforma central que crea **usuarios sintéticos** —agentes de IA con
personalidad, memoria y objetivos— y los usa para poblar aplicaciones con datos e
interacciones realistas, para **pruebas, demos y simulaciones**.

El principio que ordena todo el diseño:

> **El motor nunca toca la base de datos de la aplicación destino.**
> Solo interactúa a través de una API que la aplicación implementa, llamada
> **USI (Universal Simulation Interface)**.

Esto no es un detalle de implementación, es lo que hace viable el producto: cada
app conserva sus reglas de negocio, sus validaciones y su modelo de datos. SUSP no
necesita saber nada de ellos.

## 2. Por qué este stack

El portfolio del usuario (`C:\Dev`) son apps **Flutter + Supabase** (`nocturna`,
`amor`, `vecinal`, `ofertas`, `barato`, `asiscann`, `vivacidad`, `cannabisgram`) y
dos backends **Node** (`telemedicina` con NestJS + Prisma, `orbita`). SUSP es la
herramienta que puebla esas apps, así que el diseño se ajusta a ese mundo real:

| Decisión | Elección | Motivo |
| --- | --- | --- |
| Lenguaje | TypeScript estricto | Es el lenguaje de sus dos backends y el de las Edge Functions de Supabase (Deno). Un SDK en TS sirve a los dos lados. |
| Framework API | **NestJS** | Es exactamente lo que ya usa en `telemedicina`. Módulos, DI, guards e interceptores encajan con una plataforma de muchos subsistemas. |
| ORM | **Prisma** | Ya lo usa en `telemedicina`; migraciones versionadas y tipos generados. |
| Base de datos | **PostgreSQL 16** | Es lo que corre debajo de Supabase; misma familia, cero fricción mental. |
| Cola / scheduler | **Postgres con `FOR UPDATE SKIP LOCKED`** | Evita sumar Redis. Es una cola durable, transaccional y de grado productivo para este volumen. La interfaz `JobQueue` deja la puerta abierta a Redis/BullMQ sin tocar el resto. |
| Dashboard | React + Vite + TS | Panel administrativo web; liviano y autocontenido. |
| Ejecución | **Docker primero** | La máquina de desarrollo **no tiene Node instalado** — todo corre en contenedores, igual que `telemedicina`. Instalar, compilar, testear y ejecutar pasan por Docker. |
| LLM | **Anthropic Claude** | `claude-opus-5` para razonamiento de agentes, `claude-haiku-4-5` para generar contenido en volumen. |

### Puertos

Cada proyecto de `C:\Dev` ocupa un bloque `55X##`. SUSP toma el **557xx**, que
estaba libre:

| Servicio | Puerto |
| --- | --- |
| API del motor | `55701` |
| PostgreSQL | `55702` |
| Dashboard | `55703` |
| App de referencia (USI demo) | `55704` |

## 3. Componentes

```
                        ┌──────────────────────────┐
                        │        Dashboard         │  React + Vite
                        │  campañas · métricas ·   │  :55703
                        │  logs · estado de APIs   │
                        └────────────┬─────────────┘
                                     │ HTTP + API key / JWT
                        ┌────────────▼─────────────┐
                        │       API Gateway        │  NestJS :55701
                        │  authn/authz · rate      │
                        │  limit · validación      │
                        └────────────┬─────────────┘
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
┌───────▼────────┐        ┌──────────▼─────────┐       ┌──────────▼─────────┐
│  Motor central │        │  Motor de agentes  │       │     Auditoría      │
│  campañas ·    │◄──────►│  personalidad ·    │       │  quién hizo qué,   │
│  escenarios ·  │        │  memoria · metas · │       │  cuándo y contra   │
│  orquestación  │        │  horarios · reglas │       │  qué app           │
└───────┬────────┘        └──────────┬─────────┘       └────────────────────┘
        │                            │
        │                   ┌────────▼─────────┐
        │                   │  Proveedor LLM   │  Anthropic | Determinístico
        │                   └──────────────────┘
        │
┌───────▼────────┐        ┌────────────────────┐       ┌────────────────────┐
│    Scheduler   │        │      Métricas      │       │     PostgreSQL     │
│  jobs durables │        │  contadores, p95,  │       │  estado del motor  │
│  SKIP LOCKED   │        │  tasa de error     │       │  :55702            │
└───────┬────────┘        └────────────────────┘       └────────────────────┘
        │
        │  cliente USI (reintentos · timeout · circuit breaker)
        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                         API USI de la app destino                          │
│   la implementa la app · el motor NUNCA toca su base de datos directamente │
└───────────────────────────────────────────────────────────────────────────┘
```

### Responsabilidades

- **API Gateway** — única puerta de entrada. Autenticación, autorización, límites
  de tasa, validación de payloads y versionado.
- **Motor central** — dueño de campañas, escenarios y su ciclo de vida. Decide
  *qué* debe pasar y lo encola.
- **Motor de agentes** — dueño de la conducta. Dado un agente (personalidad,
  memoria, objetivos, intereses, horarios, reglas) decide *qué haría ahora* y con
  qué contenido.
- **Scheduler** — ejecuta lo encolado con garantías: reintento con backoff,
  idempotencia y visibilidad de fallos.
- **Cliente USI** — el único componente que habla con el exterior. Concentra
  timeouts, reintentos, circuit breaker y el marcado de datos sintéticos.
- **Auditoría** — registro append-only de cada operación contra cada app.
- **Métricas** — throughput, latencias, tasa de error por app y por campaña.

## 4. Modelo de datos (motor)

```
Tenant ──┬── TargetApp ──── UsiCredential
         │        │
         │        └── SyntheticEntity   (espejo local de lo creado en la app)
         │
         ├── Persona            (arquetipo reutilizable: rasgos, intereses, tono)
         │
         └── Campaign ──┬── Agent ──┬── AgentMemory
                        │           └── AgentSchedule
                        │
                        ├── Scenario
                        └── Run ──┬── Job
                                  └── AuditEvent
```

| Entidad | Para qué |
| --- | --- |
| `Tenant` | Aislamiento multi-cliente. Todo cuelga de acá. |
| `TargetApp` | Una app destino: URL base de USI, entorno (`development`/`staging`/`production`), capacidades declaradas en su manifiesto. |
| `UsiCredential` | Secreto para hablar con esa app. Se guarda cifrado, nunca se devuelve por la API. |
| `Persona` | Arquetipo reutilizable (ej. "comprador ansioso de marketplace"). |
| `Agent` | Instancia viva de una persona dentro de una campaña, con su estado. |
| `AgentMemory` | Memoria episódica y semántica del agente, con decaimiento. |
| `AgentSchedule` | Franjas horarias y ritmo de actividad. |
| `Campaign` | Conjunto de agentes + escenario + app destino + ventana temporal. |
| `Scenario` | Guion: mezcla de acciones, intensidad, objetivos de la simulación. |
| `Run` | Una ejecución concreta de una campaña. |
| `Job` | Unidad atómica de trabajo encolada (una acción de un agente). |
| `SyntheticEntity` | Espejo local de cada entidad creada en la app destino. **Es lo que hace posible la purga completa.** |
| `AuditEvent` | Append-only: quién, qué, contra qué app, con qué resultado. |

## 5. Seguridad y salvaguardas

La especificación pide que los datos sintéticos estén **"claramente identificados"**.
Eso es a la vez el requisito funcional y la principal salvaguarda del producto: una
plataforma que puebla apps con usuarios generados podría usarse para inflar
métricas o simular actividad real. El diseño lo impide por construcción:

1. **Marcado obligatorio, no opcional.** Toda entidad creada vía USI lleva
   `synthetic: true` más `simulation_id` y `agent_id`. No hay forma de crear algo
   por USI sin ese marcado: el contrato lo exige y la suite de conformidad lo
   verifica. Una implementación que no lo exponga **no es conforme**.
2. **Reversibilidad total.** El motor guarda un espejo local de cada entidad
   creada, así que siempre puede enumerar y purgar exactamente lo que generó.
3. **Purga con doble confirmación.** `POST /purge` exige un nonce emitido por
   `GET /state`, para que un borrado masivo no pueda dispararse por accidente.
4. **Bloqueo de producción.** Con `SUSP_BLOCK_PRODUCTION_TARGETS=true` (por
   defecto), el motor se niega a escribir contra una app marcada como
   `production`. Destrabarlo requiere marcarlo explícitamente en el registro de
   la app.
5. **Sin interacción con usuarios reales.** Los agentes solo interactúan con
   entidades sintéticas. La app destino nunca recibe una orden de SUSP que apunte
   a un usuario real, y `POST /interactions` rechaza objetivos no sintéticos.
6. **Modo simulación (`dry-run`).** Calcula y registra todo el plan de acciones sin
   ejecutar una sola escritura. Es la forma correcta de estrenar una integración.
7. **Auditoría append-only** de los dos lados: el motor registra lo que envió, la
   app expone `GET /audit` con lo que aplicó.
8. **Secretos.** Las credenciales USI se guardan cifradas y jamás se devuelven por
   la API ni aparecen en logs.

## 6. El estándar USI

Especificación completa en [`USI.md`](USI.md). Resumen:

- Base: `/usi/v1`, JSON, `Authorization: Bearer <token>`.
- Funciones mínimas: manifiesto/versionado, autenticación, crear usuario, actualizar
  perfil, crear contenido, generar interacciones, mensajería, consultar estado,
  purgar datos demo y auditoría.
- Negociación de capacidades: una app declara en su manifiesto qué soporta; el
  motor solo le pide lo que declaró. Un marketplace no necesita implementar
  mensajería si no la tiene.
- Versionado por ruta (`/usi/v1`) más `usi_version` semántica en el manifiesto.

## 7. Estrategia de pruebas

Todo el sistema tiene que poder correr y testearse **sin API key de Anthropic**.
Por eso el proveedor LLM es una interfaz con dos implementaciones: `AnthropicProvider`
y `DeterministicProvider` (plantillas con semilla, reproducible). Los tests usan
siempre el determinístico, así la CI es estable y gratis.

Tres niveles:

1. **Unitarios** — motor de agentes, scheduler, políticas de seguridad.
2. **E2E** — API completa contra un Postgres real en Docker.
3. **Conformidad USI** — la suite corre contra la app de referencia y valida el
   contrato entero, incluido el marcado sintético y la purga.

## 8. Qué queda explícitamente fuera de la v1

- Interfaz gráfica de edición visual de escenarios (se cargan como JSON).
- Multi-región / sharding del scheduler.
- Adaptadores más allá de los cuatro verticales del alcance (citas, red social,
  telemedicina, marketplace).
- Generación de imágenes para los perfiles sintéticos: la v1 usa avatares
  procedurales deterministas, sin llamadas a modelos de imagen.
