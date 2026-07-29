# Estado de SUSP

> Última actualización: **29/07/2026**
> Repo: **github.com/elprogra37/susp** (rama `main`). Carpeta local: `C:\Dev\clientes`.
> Lo que falta está en [PENDIENTES.md](PENDIENTES.md). El plan, en
> [docs/ROADMAP.md](docs/ROADMAP.md). El diseño, en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

## Resumen en una línea

**Fases 1, 2 y 3 cerradas, y el ciclo completo funciona de punta a punta:** una
campaña crea agentes con personalidad, los registra en la app destino vía USI,
los hace publicar, interactuar y mensajearse según su horario y sus rasgos, y
después borra todo lo generado sin tocar nada más.

## Dónde quedé / próximo paso

- **Fase en curso:** Fase 5 — SDK oficial (`@susp/sdk` y `@susp/usi-server`).
- **Próximo paso concreto:** `packages/sdk` con el cliente tipado del motor, y
  `packages/usi-server` con el helper para implementar USI, más la plantilla de
  Supabase Edge Function. Ambos consumen `@susp/usi-spec`, que ya está hecho.
- **Cómo retomar:** `make up` levanta todo; `curl localhost:55701/health` tiene
  que devolver `{"status":"ok"}` y `curl localhost:55704/usi/v1/manifest` con el
  token, el manifiesto de la app de referencia.

## Prueba de punta a punta ya ejecutada

Con la app de referencia (`apps/reference-app`, USI en memoria) como destino:

| Paso | Resultado |
| --- | --- |
| Chequeo de salud de la app destino | `HEALTHY`, 7 capacidades detectadas |
| Campaña de 8 agentes, `timeScale: 180` | 14 usuarios sintéticos creados |
| Actividad autónoma | 8 actualizaciones de perfil, contenido, interacciones y mensajes |
| Rechazo de objetivo no sintético | `422 target_not_synthetic` |
| Purga sin nonce | `403` |
| Purga con nombre de campaña incorrecto | rechazada |
| Purga real de la campaña | borró exactamente lo suyo; **la campaña anterior quedó intacta** |
| Suite de conformidad contra la app de referencia | **17 de 17**, código de salida 0 |
| Suite contra una app a la que se le quitó el marcado a propósito | **falla y sale con 1**, explicando qué falta |

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
- **Crear campañas y correrlas de verdad**: el planificador crea los agentes,
  el scheduler los ejecuta y los agentes pueblan la app destino solos. Con
  `timeScale` se acelera el reloj simulado para no esperar el horario real.
- **Inspeccionar un agente**: sus rasgos, horarios, objetivos y su memoria con
  la fuerza ya decaída. Es la vista que explica por qué hizo lo que hizo.
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
7. **ts-node 10.9 no arranca con TypeScript 6** (`Cannot read properties of
   undefined (reading 'fileExists')`). La app de referencia usa el borrado de
   tipos nativo de Node 22 (`node src/server.ts`), que además le saca una
   dependencia a un ejemplo que quiere ser mínimo.
8. **El borrado de tipos de Node es strip-only:** no admite *parameter
   properties* (`constructor(private readonly x: T)`) ni `import` de algo que
   solo existe en tiempo de compilación — hay que usar `import type`. Afecta a
   todo paquete pensado para correr sin build, como los que van a Deno.
9. **El planificador daba una campaña por terminada apenas nadie tenía una
   acción pendiente.** Arrancar de madrugada la cerraba en el acto: los agentes
   estaban fuera de horario, no habían terminado. Ahora solo cierra cuando todos
   cumplieron sus objetivos y no queda trabajo en vuelo.

## Fases

| # | Fase | Estado |
| --- | --- | --- |
| 1 | Arquitectura y fundaciones | `[x]` hecha |
| 2 | Backend: motor central, DB y API Gateway | `[x]` hecha |
| 3 | Motor de agentes IA | `[x]` hecha |
| 4 | Estándar USI (OpenAPI, cliente, conformidad) | `[x]` hecha |
| 5 | SDK oficial | `[ ]` pendiente |
| 6 | Dashboard administrativo | `[ ]` pendiente |
| 7 | Adaptadores e integraciones | `[~]` app de referencia lista; faltan los packs por vertical |
| 8 | Pruebas | `[~]` 61 unitarios verdes; falta e2e y conformidad |
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
