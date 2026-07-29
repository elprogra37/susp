# Despliegue

## Desarrollo

Todo corre en contenedores; el único requisito es Docker.

```bash
cp .env.example .env     # generá un JWT_SECRET
make install             # ~95 s
make up
make migrate seed
```

### Por qué `node_modules` y `dist` viven en volúmenes

No es una preferencia: es la diferencia entre un entorno usable y uno inservible.
Medido en esta máquina (Windows + Docker Desktop, bind mount):

| Operación | Desde el bind mount | Desde un volumen nativo |
| --- | --- | --- |
| `npm install` | ~40 minutos | **95 segundos** |
| `require('@nestjs/core')` | 43 segundos | **0,3 segundos** |
| `nest build` | 243 segundos | **23 segundos** |

El bind mount de Windows atraviesa una frontera de VM en cada lectura de archivo,
y `node_modules` son decenas de miles de archivos chicos. Los volúmenes viven
dentro del filesystem del VM de Docker, así que las lecturas no salen.

**Consecuencia práctica:** cualquier comando que toque `node_modules` tiene que
montar los mismos volúmenes. El `Makefile` ya lo hace; si escribís un `docker run`
a mano, acordate de `-v susp_susp-node-modules:/app/node_modules`.

### Comandos

```bash
make up / down / restart / logs / ps
make install        # dependencias en el volumen
make build          # compila el motor
make rebuild        # compila y reinicia
make dev            # motor con recarga en caliente (arranca más lento)
make test / test-all / test-e2e
make migrate / migrate-create name=x / seed / sembrar key=x
make psql / shell
make clean          # baja todo y BORRA los volúmenes
make reset          # clean + reinstalar + migrar + sembrar + levantar
```

---

## Producción

```bash
cp .env.example .env.prod    # completar TODOS los secretos
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d --build
```

### Diferencias con desarrollo

| | Desarrollo | Producción |
| --- | --- | --- |
| Código | Bind mount, editable en caliente | Dentro de la imagen, inmutable |
| Postgres | Puerto publicado en 55702 | **Sin puerto publicado** |
| Secretos | Valores por defecto en el compose | Obligatorios; si falta uno, no arranca |
| Dashboard | Servidor de Vite | Estáticos servidos por nginx |
| Usuario | root | `node`, sin privilegios |
| PID 1 | node | `tini`, para que SIGTERM llegue |

Que un secreto faltante impida el arranque es deliberado: un valor por defecto en
producción es peor que un arranque fallido, porque no se nota.

### Variables obligatorias

```bash
POSTGRES_USER=...
POSTGRES_PASSWORD=...              # openssl rand -hex 24
JWT_SECRET=...                     # openssl rand -hex 32
SUSP_ENCRYPTION_KEY=...            # openssl rand -hex 32, DISTINTA de JWT_SECRET
VITE_SUSP_API_URL=https://susp.tu-dominio/api/v1
```

`SUSP_ENCRYPTION_KEY` tiene que ser distinta de `JWT_SECRET` para poder rotar las
credenciales cifradas sin invalidar todas las sesiones, y al revés. El motor se
niega a arrancar en producción si falta.

### La URL de la API se hornea en el bundle

Vite resuelve `import.meta.env` en tiempo de compilación, no de ejecución. Si el
despliegue cambia de dominio, hay que **reconstruir** la imagen del dashboard con
el `VITE_SUSP_API_URL` nuevo. No alcanza con cambiar la variable y reiniciar.

### Apagado ordenado

El motor tiene `stop_grace_period: 30s` y `tini` como PID 1. Sin `tini`, Node no
recibiría la señal y Docker mataría el contenedor a los diez segundos, cortando
trabajos a mitad de camino.

Al recibir SIGTERM, el scheduler deja de tomar trabajo nuevo y **espera hasta 15
segundos** a que termine el lote en curso. La espera importa: Nest cierra los
módulos en orden y `PrismaService` se desconecta en el suyo, así que volver sin
esperar dejaría un lote a mitad de camino sin base de datos.

El apagado siempre deja una línea en el log, y dice cuál de los dos casos fue:

```
LOG  [SchedulerService] Scheduler detenido por SIGTERM tras 0 ms; sin trabajo en curso.
WARN [SchedulerService] Scheduler apagado por SIGTERM con un lote todavía en curso tras 15000 ms.
```

El `WARN` significa que algo se colgó más de quince segundos. Los trabajos que
queden tomados se recuperan solos a los cinco minutos, así que no se pierde nada
—pero es una señal de que conviene mirar qué tardó tanto.

Los quince segundos son holgados contra los treinta del `stop_grace_period`: si
se agotara el plazo de Docker, el proceso moriría por SIGKILL, que es el mismo
resultado pero sin log.

### Migraciones

El contenedor corre `prisma migrate deploy` antes de arrancar. Es idempotente y
no destructivo: aplica lo pendiente y sigue.

Para una migración destructiva —borrar una columna, cambiar un tipo— hay que
pensarla en dos pasos y desplegar dos veces, para que la versión vieja y la nueva
puedan convivir mientras dura el despliegue.

### Detrás de un proxy inverso

Si ponés nginx o Caddy delante:

```
susp.tu-dominio        → dashboard:55703
susp.tu-dominio/api    → engine:55701
```

y ajustá `SUSP_CORS_ORIGIN` con el dominio del dashboard. Si el proxy sirve los
dos bajo el mismo origen, CORS deja de importar.

---

## Integración continua

`.github/workflows/ci.yml` corre en cada push y pull request: chequeo de tipos de
los siete paquetes, unitarias, e2e contra un PostgreSQL de servicio, la
conformidad USI contra la app de referencia, y los dos builds.

**El workflow no sube artifacts, a propósito.** La cuenta tiene agotada la cuota
de storage de Actions, y subir artifacts la agrava hasta el punto de que Actions
deja de disparar runs — le pasó al repositorio `amor`. Todo lo que hay que ver
queda en el log del job.

Por el mismo motivo, **la CI no es la verificación de referencia**: puede no
dispararse. La verificación real es `make test-all`, que corre exactamente lo
mismo en local.

Ninguna prueba necesita una API key de Anthropic: el proveedor determinístico es
el que usan todas, así que la CI no gasta tokens ni depende de un secreto.

---

## Resolución de problemas

**El contenedor del motor está "arriba" pero no responde.**
`docker logs susp-engine`. Si no hay ni una línea de Nest, es un error de
arranque: el bootstrap loguea y sale con código 1, así que el log tiene la causa.

**`nest build` sale bien pero `dist` queda vacío.**
Un `.tsbuildinfo` viejo. El script de build ya lo borra; si lo corrés a mano,
`rm -rf dist/* *.tsbuildinfo` primero.

**El build de la imagen falla con «The installed TypeScript version (7.x) does
not expose the programmatic compiler API that the Nest CLI requires».**
TypeScript 7.0 solo trae el ejecutable `tsc`; la API programática vuelve en 7.1 y
el CLI de Nest la necesita. Por eso `typescript` está fijado en `^6.0.3` **en el
`package.json` de la raíz**, no solo en los workspaces: npm iza una única copia a
`node_modules/` de la raíz y es esa la que encuentra el CLI. Fijarlo únicamente
en `apps/engine` no alcanza —lo aprendimos a los golpes— porque cualquier otro
workspace que pida una versión distinta puede ganar el izado.

Si volviera a pasar, mirar qué versión quedó arriba:

```bash
npm ls typescript
```

**`prisma migrate` dice que falta `DATABASE_URL`.**
Desde Prisma 7 la URL sale de `prisma.config.ts`, que la lee del entorno. Pasala
al comando: los targets del `Makefile` ya lo hacen.

**Todo está lentísimo.**
Casi seguro estás corriendo un `docker run` sin montar los volúmenes de
`node_modules`. Ver la tabla de arriba.

**El dashboard no ve la API.**
Revisá `VITE_SUSP_API_URL` — se hornea en el bundle, así que cambiarla exige
reconstruir la imagen.
