# Estado de SUSP

> Última actualización: **29/07/2026**
> Repo: **github.com/elprogra37/susp** (rama `main`). Carpeta local: `C:\Dev\clientes`.
> Lo que falta está en [PENDIENTES.md](PENDIENTES.md). El plan, en
> [docs/ROADMAP.md](docs/ROADMAP.md). El diseño, en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

## Resumen en una línea

**Fases 1 y 2 cerradas.** El motor arranca, se conecta a PostgreSQL, autentica
por API key y por JWT, y expone el CRUD completo de apps destino, personas,
escenarios, campañas, ejecuciones y auditoría. Las salvaguardas de producción y
el cifrado de credenciales están implementados y verificados contra la API real.

## Dónde quedé / próximo paso

- **Fase en curso:** Fase 3 — Motor de agentes IA.
- **Ya escrito de la Fase 3:** `src/llm/` con la interfaz `LlmProvider`, el
  `AnthropicProvider`, el `DeterministicProvider` (plantillas sembradas, sin API
  key), el PRNG `SeededRandom` y el corpus rioplatense.
- **Próximo paso concreto:** el `AgentsModule` — generar agentes a partir de
  personas (rasgos con variación individual), memoria con decaimiento, horarios,
  y el planificador que convierte un `Run` en PENDING en una cola de `Job`.
  Después, el scheduler con `FOR UPDATE SKIP LOCKED`.
- **Cómo retomar:** `make up` levanta todo; `curl localhost:55701/health` tiene
  que devolver `{"status":"ok"}`. Después leer `docs/ARQUITECTURA.md` §3 y §4.

## Qué se puede hacer hoy

Con `make up` y la API key del seed:

- **Autenticarse** con `X-Susp-Key` (integraciones) o `POST /api/v1/auth/login`
  (dashboard, devuelve JWT de 12 h). El rol se relee de la base en cada
  petición, así que revocar un permiso surte efecto al instante.
- **Registrar apps destino** con su URL de USI y su token. El token se guarda
  cifrado con AES-256-GCM y **no vuelve a salir** por la API — verificado.
- **Chequear la salud de una app** (`POST /target-apps/:id/health-check`): lee su
  manifiesto, verifica credenciales, comprueba que declare los endpoints
  obligatorios y cachea sus capacidades.
- **Definir personas y escenarios**, con validación de que la mezcla de acciones
  solo use operaciones USI que existan.
- **Crear campañas** y arrancarlas: se encola un `Run` en PENDING (el
  planificador que lo consume llega en la Fase 3).
- **Consultar auditoría** y su resumen por operación y resultado.
- **Purgar** lo generado por una campaña, con doble confirmación.

## Salvaguardas ya implementadas y verificadas

| Salvaguarda | Estado |
| --- | --- |
| Credenciales USI cifradas en reposo, nunca devueltas por la API | ✅ verificado |
| Marcado sintético obligatorio en toda escritura (`X-USI-Synthetic`, ids) | ✅ en el cliente USI |
| Escrituras contra producción bloqueadas por defecto | ✅ verificado |
| Habilitarlas exige slug exacto + frase exacta "ENTIENDO EL RIESGO" | ✅ verificado |
| Reintentos solo ante fallos transitorios, nunca ante `422` | ✅ con test |
| Purga sin reintento (el nonce es de un solo uso) | ✅ con test |
| Auditoría append-only que no puede tumbar la operación auditada | ✅ |
| Borrar una campaña con entidades sin purgar → se rechaza | ✅ |

## Decisiones tomadas (y por qué)

| Decisión | Motivo |
| --- | --- |
| TypeScript + **NestJS 11** + **Prisma 7** + **PostgreSQL 16** | El stack de `C:\Dev\telemedicina`. Consistencia con lo que ya mantiene el usuario. |
| **Docker primero** | La máquina **no tiene Node instalado**. |
| **`node_modules` y `dist` en volúmenes de Docker**, no en el bind mount | Medido: desde el bind mount, `require('@nestjs/core')` tarda **43 s** y `npm install` ~40 min. En volumen nativo: **0,3 s** y **95 s**. El build pasó de 243 s a 23 s. |
| Cola en **Postgres con `SKIP LOCKED`**, no Redis | Una dependencia menos, durable y transaccional. |
| Bloque de puertos **557xx** | Los demás proyectos ocupan 553xx–556xx. |
| Proveedor LLM **pluggable** (Anthropic + determinístico) | Todo tiene que correr y testearse sin API key. |
| Contraseñas con **scrypt** (`node:crypto`), no bcrypt/argon2 | Viene en el runtime: nada de módulos nativos que compilar en Alpine. |
| Emails sintéticos con TLD **`.invalid`** | RFC 2606: imposibles de entregar. |

## Tropiezos resueltos (para no repetirlos)

1. **Prisma 7 sacó `url` del `schema.prisma`.** Ahora la conexión de Migrate va en
   `prisma.config.ts` y el cliente recibe un adaptador (`@prisma/adapter-pg`).
2. **TypeScript 6 exige `rootDir` explícito** y deprecó `baseUrl`.
3. **`bufferLogs: true` en `NestFactory.create` se tragaba el error de arranque.**
   Un contenedor "arriba" pero sin escuchar es peor que uno caído. Ahora el
   bootstrap loguea y sale con código 1.
4. **`CONFIG` provisto en `AppModule` no era visible** para `PrismaModule`: los
   providers de un módulo no llegan a los módulos que ese módulo importa. Se
   resolvió con un `SuspConfigModule` global.
5. **`nest build` salía con código 0 sin emitir un solo archivo:** un
   `.tsbuildinfo` viejo le hacía creer que ya estaba todo compilado, mientras el
   script había vaciado `dist`. Se desactivó `incremental` en el build.
6. **`deleteOutDir: true` da EBUSY** cuando `dist` es un punto de montaje.

## Fases

| # | Fase | Estado |
| --- | --- | --- |
| 1 | Arquitectura y fundaciones | `[x]` hecha |
| 2 | Backend: motor central, DB y API Gateway | `[x]` hecha |
| 3 | Motor de agentes IA | `[~]` en curso (proveedores LLM listos) |
| 4 | Estándar USI (OpenAPI, cliente, conformidad) | `[~]` cliente y tipos listos; falta OpenAPI y conformidad |
| 5 | SDK oficial | `[ ]` pendiente |
| 6 | Dashboard administrativo | `[ ]` pendiente |
| 7 | Adaptadores e integraciones | `[ ]` pendiente |
| 8 | Pruebas | `[~]` 34 unitarios verdes; falta e2e y conformidad |
| 9 | Documentación | `[~]` arquitectura y USI escritos |
| 10 | Despliegue | `[~]` compose y Makefile funcionando; falta Dockerfile y CI |

## Comandos

```bash
make up        # levanta la plataforma entera
make down      # baja todo
make logs      # sigue los logs
make install   # instala dependencias en el volumen (~95 s)
make build     # compila el motor (~23 s)
make rebuild   # compila y reinicia el motor
make test      # corre las pruebas
make migrate   # aplica migraciones
make seed      # siembra tenant, usuario y API key
make psql      # consola de PostgreSQL
make reset     # borra todo y reconstruye desde cero
```

Comprobación rápida de que está vivo:

```bash
curl localhost:55701/health          # {"status":"ok",...}
curl localhost:55701/health/ready    # {"status":"ready","checks":{"database":true}}
curl -H "X-Susp-Key: <clave>" localhost:55701/api/v1/tenant
```

## Variables de entorno

Los **nombres** están en `.env.example`; los valores nunca se commitean. El `.env`
local ya está generado con secretos aleatorios. Las que importan:
`DATABASE_URL`, `JWT_SECRET`, `SUSP_LLM_PROVIDER`, `ANTHROPIC_API_KEY` (solo si
el proveedor es `anthropic`), `SUSP_BLOCK_PRODUCTION_TARGETS`, `SUSP_DRY_RUN`.

Credenciales sembradas en desarrollo: `admin@susp.local` / `susp-admin-2026`.
La API key de bootstrap está en el `.env` local.

## Bloqueos conocidos

- **GitHub Actions sin cuota.** La cuenta tiene agotada la cuota de storage de
  artifacts (mismo problema que en `amor`), así que la CI puede no disparar runs.
  El workflow se escribirá sin `upload-artifact` y la verificación real es local
  vía Docker. **No es bloqueante.**
