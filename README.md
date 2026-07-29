<div align="center">

# 🧬 SUSP

### Synthetic User Simulation Platform

**Usuarios sintéticos con IA** —personalidad, memoria, objetivos y horarios—
para poblar tus apps con datos e interacciones realistas.

![Fases](https://img.shields.io/badge/roadmap-10%2F10%20fases-brightgreen?style=flat-square)
![Pruebas](https://img.shields.io/badge/pruebas-143%20en%20verde-brightgreen?style=flat-square)
![Requisito](https://img.shields.io/badge/requisito-solo%20Docker-2496ED?style=flat-square&logo=docker&logoColor=white)
![API key](https://img.shields.io/badge/API%20key-opcional-blueviolet?style=flat-square)

![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?style=flat-square&logo=nestjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?style=flat-square&logo=prisma&logoColor=white)

</div>

> ### 🔐 El motor **nunca** toca la base de datos de tu app
>
> Se integra por un estándar abierto, **USI** (Universal Simulation Interface),
> que tu aplicación implementa. Tus reglas de negocio siguen mandando: un `422`
> tuyo es una respuesta legítima y esperada.

---

## ✨ Características principales

### 🧠 Agentes que parecen gente

| | | |
| :-: | --- | --- |
| 🎭 | **Personalidad estable** | Rasgos que no cambian entre acciones, con variación individual dentro del arquetipo. |
| 💭 | **Memoria con decaimiento** | Recuerdan qué hicieron y con quién. Lo viejo pesa menos, calculado al leer. |
| 🎯 | **Objetivos propios** | Cada agente tiene metas; cuando las cumple queda `EXHAUSTED` y deja de actuar. |
| 🕐 | **Horarios creíbles** | Nadie publica a las 4 AM salvo que su perfil lo justifique. Reloj simulado acelerable. |
| 👥 | **Poblaciones proporcionales** | Regla 1-9-90: la mayoría lee, unos pocos publican. No 500 clones haciendo lo mismo. |
| 🔁 | **Reproducible** | PRNG sembrado: la misma semilla da la misma simulación, siempre. |

### 🔌 Integración sin tocar tu base

| | | |
| :-: | --- | --- |
| 📐 | **Estándar USI** | 4 endpoints obligatorios, el resto se declara por capacidades. OpenAPI 3.1 incluido. |
| 🧰 | **~120 líneas** | Con `@susp/usi-server` el helper resuelve lo delicado; vos solo guardás y borrás. |
| ✅ | **Suite de conformidad** | 17 puntos del contrato, ejecutable. Sale con código 1 si algo falla → sirve en CI. |
| 🔷 | **Compatible con Supabase** | Guía paso a paso y plantilla completa para Flutter + Supabase. |

### 🛠️ La plataforma

| | | |
| :-: | --- | --- |
| 📊 | **Dashboard** | Apps, campañas, catálogo de personas, métricas y auditoría. React + Vite. |
| 🎪 | **4 verticales listas** | Citas, red social, telemedicina y marketplace, con arquetipos y escenarios. |
| 🤖 | **LLM opcional** | Por defecto usa un proveedor determinístico: **gratis, sin API key y reproducible**. |
| 📦 | **SDK tipado** | Cliente del motor, en TypeScript. |
| 🐳 | **Solo Docker** | Node y PostgreSQL corren en contenedores. No instalás nada más. |

---

## 🛡️ Seguridad: datos sintéticos, siempre identificados

Cada entidad creada queda marcada de forma **permanente y consultable**:

```json
{ "synthetic": true, "simulation_id": "run_2f9c", "agent_id": "agt_7f3a", "created_by": "susp" }
```

**Esto no es opcional ni desactivable.** Además:

| | |
| :-: | --- |
| 🚫 | **Los agentes solo interactúan entre ellos.** Nunca con usuarios reales: el estándar lo prohíbe y la conformidad lo verifica. |
| 🧹 | **Todo se enumera y se borra** con `/purge`, acotado a una campaña. |
| ⛔ | **Escribir contra producción está bloqueado** por defecto; habilitarlo exige el slug exacto y una frase textual. |
| 👁️ | **Modo simulación**: calcula el plan completo sin escribir nada. |
| 📧 | **Emails con TLD `.invalid`** (RFC 2606): imposibles de entregar. |

Es la diferencia entre **poblar un entorno de demostración** y **simular actividad
falsa**. SUSP hace lo primero, por diseño → [docs/SEGURIDAD.md](docs/SEGURIDAD.md)

---

## 🚀 Inicio rápido

**Único requisito: Docker.**

```bash
git clone https://github.com/elprogra37/susp.git
cd susp
cp .env.example .env          # generá un JWT_SECRET
make install                  # ~95 s
make up                       # levanta todo
make migrate seed             # base + tenant + API key
```

| Servicio | URL |
| --- | --- |
| 🔧 API del motor | http://localhost:55701/health |
| 📊 Dashboard | http://localhost:55703 |
| 🧪 App de referencia (USI de ejemplo) | http://localhost:55704/usi/v1/manifest |

Para verlo funcionando de punta a punta contra la app de referencia:

```bash
make sembrar key=<la API key del seed>   # carga los packs por vertical
```

y desde el dashboard: registrá la app de referencia
(`http://reference-app:55704/usi/v1`, token `reference-token-dev`), verificala,
creá una campaña y arrancala.

---

## ⚙️ Cómo funciona

```
Dashboard  →  API del motor  →  Motor de agentes  →  Cliente USI  →  API USI de tu app
:55703         :55701            personalidad,        reintentos,      la implementás vos
                                 memoria, metas,      idempotencia,    (~120 líneas con
                                 horarios             circuit breaker   @susp/usi-server)
```

1. **Registrás tu app** con la URL de su API USI y un token.
2. **Definís personas** (arquetipos) y una **campaña** (cuántos agentes, qué
   escenario, en qué ventana).
3. **El motor crea los agentes**; cada uno decide qué hacer según su personalidad
   y su horario, y lo ejecuta contra tu app vía USI.
4. **Mirás métricas y logs** en el dashboard. Al terminar, **purgás todo**.

---

## 💡 Por qué

Probar y demostrar una app social, de citas, de salud o un marketplace exige algo
que al principio no existe: **gente usándola**. Sembrar datos a mano da un
resultado plano; escribir directo en la base saltea las validaciones y genera
estados imposibles.

SUSP resuelve las dos cosas. Los agentes se comportan como usuarios y todo lo que
hacen pasa por la API pública de tu app, así que **nunca produce un estado que tu
app no habría aceptado por sí sola**.

La coherencia importa más de lo que parece. Un agente que publica a las cuatro de
la mañana, o cien agentes que publican todos lo mismo con la misma frecuencia,
producen un entorno que se nota falso al primer vistazo.

---

## 🔗 Integrar tu app

Tu app tiene que implementar la API USI. Con `@susp/usi-server` son ~120 líneas:
el helper se queda con lo delicado —marcado sintético, rechazo de objetivos no
sintéticos, idempotencia, nonces de purga, formato de errores— y vos solo escribís
cómo guardar y borrar en tu base.

```bash
npx @susp/usi-conformance --url https://mi-app.example/usi/v1 --token <token>
```

La suite verifica 17 puntos del contrato, crea datos de prueba y los borra al
terminar. Sale con código 1 si algo falla, así que sirve como puerta en CI.

> 🔷 **¿Tu app es Flutter + Supabase?** Guía paso a paso y plantilla completa en
> [docs/INTEGRACION-SUPABASE.md](docs/INTEGRACION-SUPABASE.md).

---

## 📁 Estructura

| Paquete | Qué es |
| --- | --- |
| 🔧 `apps/engine` | Motor central y API Gateway. NestJS + Prisma + PostgreSQL. |
| 📊 `apps/dashboard` | Panel administrativo. React + Vite. |
| 🧪 `apps/reference-app` | Implementación de referencia de USI, en memoria y sin dependencias. |
| 📐 `packages/usi-spec` | El contrato: tipos, validadores y OpenAPI 3.1. Sin dependencias. |
| 🧰 `packages/usi-server` | Helper para implementar USI en Deno, Workers, Bun o Node. |
| ✅ `packages/usi-conformance` | Suite de conformidad ejecutable. |
| 📦 `packages/sdk` | Cliente tipado del motor. |
| 🎭 `packages/personas` | Packs de arquetipos y escenarios por vertical. |

---

## ⌨️ Comandos

```bash
make up          # levanta la plataforma entera
make down        # baja todo
make logs        # sigue los logs
make build       # compila el motor (~23 s)
make rebuild     # compila y reinicia
make test        # unitarias del motor
make test-all    # batería completa: tipos, unitarios, e2e y conformidad
make migrate     # aplica migraciones
make seed        # tenant, usuario dueño y API key
make sembrar key=<clave>   # packs de personas y escenarios
make conformance url=<url> token=<token>
make psql        # consola de PostgreSQL
make reset       # borra todo y reconstruye desde cero
```

---

## 📈 Estado

> ✅ **Las diez fases del roadmap están completadas.**

El ciclo completo funciona de punta a punta: una campaña crea agentes con
personalidad, los registra en la app destino vía USI, los hace publicar,
interactuar y mensajearse según su horario y sus rasgos, y después borra todo lo
generado sin tocar nada más.

`make test-all` corre **143 verificaciones** —tipos, unitarias, e2e contra
PostgreSQL real y conformidad USI— y **ninguna necesita una API key de
Anthropic**: el proveedor por defecto genera contenido con plantillas sembradas,
gratis y reproducible.

Detalle en [ESTADO.md](ESTADO.md); lo que falta, en [PENDIENTES.md](PENDIENTES.md).

---

## 📚 Documentación

| Documento | Contenido |
| --- | --- |
| 🏗️ [ARQUITECTURA.md](docs/ARQUITECTURA.md) | Componentes, stack justificado, modelo de datos |
| 📐 [USI.md](docs/USI.md) | El estándar completo: endpoints, ejemplos, errores, conformidad |
| 🛡️ [SEGURIDAD.md](docs/SEGURIDAD.md) | Las salvaguardas y por qué cada una está donde está |
| 🔷 [INTEGRACION-SUPABASE.md](docs/INTEGRACION-SUPABASE.md) | Integrar una app Flutter + Supabase, paso a paso |
| 📦 [SDK.md](docs/SDK.md) | Referencia del SDK |
| 🚢 [DESPLIEGUE.md](docs/DESPLIEGUE.md) | Desarrollo, producción, CI y resolución de problemas |
| 🗺️ [ROADMAP.md](docs/ROADMAP.md) | Las 10 fases y qué entrega cada una |
| 📍 [ESTADO.md](ESTADO.md) | Dónde quedó el desarrollo y cómo retomarlo |

---

<div align="center">

**UNLICENSED** — proyecto privado

</div>
