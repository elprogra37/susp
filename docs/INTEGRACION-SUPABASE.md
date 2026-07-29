# Integrar una app Flutter + Supabase con SUSP

Guía paso a paso para que SUSP pueda poblar tu app. Al final vas a poder crear
cientos de usuarios sintéticos con actividad realista, y borrarlos todos con un
botón.

**Tiempo estimado:** una hora la primera vez; quince minutos las siguientes.

**Lo que vas a tocar en tu app:**

1. Cuatro columnas nuevas por tabla poblable.
2. Una Edge Function.
3. Excluir lo sintético de tus vistas de negocio. ← *el paso que se olvida*

---

## Antes de empezar

Necesitás:

- Un proyecto de Supabase con el CLI configurado (`supabase link`).
- SUSP corriendo (`make up`) y su API key (sale de `make seed`).
- Un entorno de **desarrollo o staging**. No arranques por producción: SUSP se
  niega a escribir ahí por defecto, y con razón.

---

## Paso 1 — Marcar las entidades sintéticas

Toda entidad creada por SUSP tiene que quedar marcada de forma permanente. No es
un detalle de implementación: es lo que permite distinguir un agente de una
persona, filtrarlo de tus reportes y borrarlo después.

Copiá [`migracion.sql`](../packages/usi-server/examples/supabase-edge-function/migracion.sql)
y ajustá la lista de tablas a las tuyas:

```sql
-- En el bloque `do $$ ... $$`, cambiá esta línea por tus tablas:
foreach tabla in array array['profiles', 'posts', 'reactions', 'messages'] loop
```

Aplicala:

```bash
supabase db push
```

Agrega a cada tabla:

| Columna | Para qué |
| --- | --- |
| `synthetic` | `boolean not null default false`. Lo existente queda marcado como real sin tocar una fila. |
| `simulation_id` | Qué ejecución de SUSP lo creó. Es lo que permite purgar una campaña sin tocar otra. |
| `agent_id` | Qué agente sintético lo hizo. |
| `created_by` | `'susp'`. |

Más un índice **parcial** sobre `simulation_id` que solo indexa lo sintético: en
una tabla con un millón de filas reales y mil sintéticas, un índice completo
ocuparía lugar sin servir de nada.

---

## Paso 2 — Excluir lo sintético del negocio

**Este es el paso que se olvida y el que más duele.**

Si los usuarios sintéticos entran en tus reportes, los números dejan de
significar nada. Si entran en las notificaciones, alguien real recibe un aviso de
una cuenta que no existe. Si entran en el ranking, tu app le muestra a un usuario
de verdad un perfil que nadie va a contestar.

La migración crea vistas para eso:

```sql
create or replace view public.profiles_reales as
  select * from public.profiles where synthetic = false;
```

Y ahora te toca a vos: **revisá cada consulta que alimente una métrica, un
correo, una notificación push o una facturación, y hacela contra la vista, no
contra la tabla.**

Una forma práctica de encontrarlas:

```bash
# Desde la raíz de tu proyecto Flutter
grep -rn "from('profiles')" lib/ | grep -iE "count|stats|metric|report|billing|notif"
```

Si tu app tiene un panel de métricas, andá pantalla por pantalla y preguntate:
*¿este número tendría sentido si la mitad fueran agentes?*

---

## Paso 3 — La Edge Function

Copiá la plantilla:

```bash
mkdir -p supabase/functions/usi
cp packages/usi-server/examples/supabase-edge-function/index.ts supabase/functions/usi/
cp packages/usi-server/examples/supabase-edge-function/stores-supabase.ts supabase/functions/usi/
```

Ajustá los nombres de tabla y columna del `store` a tu esquema. Es lo único que
vas a escribir: todo lo demás —autenticación, validación, marcado, rechazo de
objetivos no sintéticos, idempotencia, nonces de purga, formato de errores— lo
pone `@susp/usi-server`.

Generá el token y desplegá:

```bash
supabase secrets set USI_TOKEN="$(openssl rand -hex 32)"
supabase functions deploy usi --no-verify-jwt
```

> **Sobre `--no-verify-jwt`:** es correcto acá. USI trae su propia autenticación
> por token bearer, que es la que SUSP sabe usar. Si además exigieras un JWT de
> Supabase, el motor no podría entrar.

Tu URL de USI queda:

```
https://<proyecto>.supabase.co/functions/v1/usi/usi/v1
```

(El `/usi` de la ruta es el nombre de la función; el `/usi/v1` es el prefijo del
estándar. Sí, se repite.)

---

## Paso 4 — Verificar la conformidad

**Antes de registrarla en SUSP**, validá que tu implementación cumpla el
contrato:

```bash
npx @susp/usi-conformance \
  --url https://<proyecto>.supabase.co/functions/v1/usi/usi/v1 \
  --token <tu USI_TOKEN>
```

La suite crea datos de prueba, verifica 17 puntos del contrato y los borra al
terminar. Si algo falla, el detalle te dice exactamente qué se esperaba.

Los tres fallos más comunes:

| Fallo | Causa |
| --- | --- |
| *"La entidad creada no expone synthetic: true"* | El `select` de tu store no devuelve las columnas del marcado. |
| *"Aceptó una interacción contra un objetivo no sintético"* | Tu `getMarker` devuelve un marcador para entidades reales. Revisá el `.eq('synthetic', true)`. |
| *"Aceptó el mismo purge_token dos veces"* | Estás usando el store de nonces en memoria en una función con varias instancias. Usá `SupabasePurgeTokenStore`. |

No sigas hasta que dé **CONFORME**.

---

## Paso 5 — Registrar la app en SUSP

En el dashboard (`http://localhost:55703`), en **Apps destino → Registrar app**:

| Campo | Valor |
| --- | --- |
| Nombre | El de tu app |
| Slug | `mi-app` |
| URL base | `https://<proyecto>.supabase.co/functions/v1/usi/usi/v1` |
| Entorno | **Desarrollo** (o staging) |
| Vertical | El que corresponda |
| Token | Tu `USI_TOKEN` |

Después tocá **Verificar**. Tiene que quedar en **sana**, con las capacidades
detectadas. Si no, el detalle dice por qué.

El token se guarda cifrado con AES-256-GCM y no vuelve a salir por la API — ni
para vos.

---

## Paso 6 — Sembrar el catálogo

```bash
make sembrar key=<tu API key de SUSP>
```

Carga los packs de arquetipos y escenarios de los cuatro verticales. Podés verlos
en el dashboard, en **Personas y escenarios**.

---

## Paso 7 — La primera campaña

En **Campañas → Nueva campaña**:

- Elegí tu app y un escenario del vertical que corresponda.
- 20 agentes para empezar.
- Aceleración del reloj: **60**. Los agentes tienen horarios; sin acelerar el
  reloj simulado, una campaña arrancada a las 3 de la mañana no hace nada hasta
  que amanezca.
- **Dejá tildado el modo simulación.**

Arrancala. En modo simulación el motor calcula el plan completo —cuántas
acciones, de qué tipo, en qué orden— sin escribir una sola cosa en tu app. Mirá
el detalle de la ejecución: si la mezcla de operaciones tiene sentido, ya podés
correrla de verdad.

Después destildá la simulación y arrancá de nuevo. Vas a ver los agentes
registrándose, publicando e interactuando entre ellos en tiempo real.

---

## Paso 8 — Limpiar

Cuando termines la demo, en el detalle de la campaña: **Purgar datos generados**.

Escribí el nombre exacto de la campaña, tocá **Simular purga** para ver qué se
borraría, y después **Purgar de verdad**.

Borra exactamente lo que esa campaña generó. Otras campañas quedan intactas, y
tus datos reales no están al alcance: tu store solo puede borrar filas con
`synthetic = true`.

---

## Preguntas que suelen aparecer

### ¿Los agentes pueden interactuar con mis usuarios reales?

No, y no es una cuestión de configuración: el estándar lo prohíbe y el helper lo
verifica en cada escritura. `POST /interactions` pregunta si el objetivo es
sintético antes de aceptar, y si no lo es responde `422 target_not_synthetic`.
La suite de conformidad prueba justamente eso.

### ¿Qué pasa si apunto una campaña a producción?

El motor se niega. Para habilitarlo hay que ir a la app en el dashboard, escribir
su slug exacto y la frase `ENTIENDO EL RIESGO`, con rol OWNER. Es incómodo a
propósito.

Aun habilitado, sigue valiendo todo lo demás: los agentes solo interactúan entre
ellos y todo lo creado queda marcado y es purgable.

### ¿Los emails sintéticos pueden recibir correo?

No. Usan el TLD reservado `.invalid` (RFC 2606), que por definición no resuelve.
Aunque tu app le mande un correo de bienvenida a un agente, no puede llegar a
ninguna parte.

### ¿Necesito una API key de Anthropic?

No. El proveedor por defecto es determinístico: genera contenido plausible en
español rioplatense con plantillas sembradas, gratis y reproducible. Con
`SUSP_LLM_PROVIDER=anthropic` y una API key el contenido gana naturalidad, pero
nada del sistema lo requiere.

### ¿Cómo hago que se vea usado en vez de recién instalado?

Usá un escenario de siembra (`social-arranque`, `mkt-catalogo`,
`tele-historial`): crean contenido con fechas pasadas antes de simular actividad
reciente. Una app donde todo se creó hace cinco minutos se nota.

### Mi app tiene tablas que no encajan con users/content/interactions/messages

USI define cuatro tipos de entidad porque cubren la enorme mayoría de las apps
sociales, de citas, de salud y de comercio. Si tu modelo no encaja, mapeá lo más
parecido: un "turno" de telemedicina es contenido de tipo `consultation`, una
"oferta" de marketplace es una interacción de tipo `offer`. Los tipos concretos
los declarás vos en el manifiesto.

---

## Referencia

- [El estándar USI completo](USI.md)
- [Arquitectura de SUSP](ARQUITECTURA.md)
- [Salvaguardas](SEGURIDAD.md)
- [Plantilla de Edge Function](../packages/usi-server/examples/supabase-edge-function/)
- [Ejemplo mínimo en Node](../packages/usi-server/examples/node-memoria/server.ts) — USI conforme en 120 líneas
