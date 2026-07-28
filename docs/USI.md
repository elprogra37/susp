# USI — Universal Simulation Interface v1

> El contrato que una aplicación implementa para que SUSP pueda poblarla con
> usuarios sintéticos, contenido e interacciones.
>
> **Versión:** `1.0.0` · **Base:** `/usi/v1` · **Formato:** JSON (`application/json`)

## Índice

1. [Principios](#1-principios)
2. [Autenticación](#2-autenticación)
3. [Marcado de datos sintéticos](#3-marcado-de-datos-sintéticos-obligatorio)
4. [Cabeceras comunes](#4-cabeceras-comunes)
5. [Errores](#5-errores)
6. [Endpoints](#6-endpoints)
7. [Capacidades](#7-capacidades)
8. [Versionado](#8-versionado)
9. [Conformidad](#9-conformidad)

---

## 1. Principios

1. **La app manda.** SUSP propone, la app dispone: valida, rechaza y aplica sus
   propias reglas de negocio. Un `422` de la app es una respuesta legítima y
   esperada, no un fallo de la integración.
2. **Nunca base de datos directa.** Toda escritura pasa por estos endpoints.
3. **Todo lo sintético está marcado.** Sin excepción y sin opción de desactivarlo.
4. **Todo es reversible.** Lo que se crea vía USI se puede enumerar y borrar.
5. **Idempotencia.** Toda operación de escritura acepta `Idempotency-Key`. Repetir
   una petición con la misma clave devuelve el resultado original sin duplicar.
6. **Implementación mínima viable.** Solo cuatro endpoints son obligatorios
   (`manifest`, `auth/verify`, `state`, `purge`). El resto se declara por
   capacidades.

---

## 2. Autenticación

Bearer token en cada petición:

```http
Authorization: Bearer <token>
```

El token lo emite la aplicación y se registra en SUSP al dar de alta la app. SUSP
lo guarda cifrado y nunca lo devuelve por su API.

Opcionalmente la app puede exigir firma HMAC del cuerpo:

```http
X-USI-Signature: sha256=<hex>
```

calculada como `HMAC-SHA256(secret, timestamp + "." + rawBody)`, con el timestamp
en `X-USI-Timestamp` (epoch en segundos, tolerancia recomendada ±300 s). Si la app
declara `requires_signature: true` en su manifiesto, SUSP firma todas las
peticiones.

---

## 3. Marcado de datos sintéticos (obligatorio)

**Toda** entidad creada mediante USI debe quedar marcada de forma persistente y
consultable. La app debe almacenar y poder devolver estos campos:

```jsonc
{
  "synthetic": true,           // siempre true, sin excepción
  "simulation_id": "run_...",  // ejecución de SUSP que la creó
  "agent_id": "agt_...",       // agente sintético responsable
  "created_by": "susp"
}
```

Requisitos:

- El campo `synthetic` **debe** venir en la representación que la app devuelva de
  la entidad. Una implementación que lo omita **no es conforme**.
- Se recomienda además que la app lo muestre en su interfaz (una insignia
  "cuenta de demostración" o equivalente) para que ningún usuario real pueda
  confundir un agente con una persona.
- Las entidades sintéticas **no deben** aparecer en métricas de negocio,
  facturación, ranking ni notificaciones a usuarios reales.
- `POST /interactions` **debe** rechazar con `422` cualquier interacción cuyo
  objetivo no sea una entidad sintética.

Este apartado no es una recomendación: es la línea que separa "poblar un entorno
de demo" de "simular actividad falsa". La suite de conformidad lo verifica y una
implementación que no lo cumpla es rechazada.

---

## 4. Cabeceras comunes

| Cabecera | Dirección | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `Authorization` | → app | sí | `Bearer <token>` |
| `Content-Type` | → app | en escrituras | `application/json` |
| `X-USI-Synthetic` | → app | sí | Siempre `true`. Redundante con el cuerpo, a propósito: permite filtrar en un proxy o WAF. |
| `X-USI-Simulation-Id` | → app | sí | Ejecución que origina la petición. |
| `Idempotency-Key` | → app | en escrituras | UUID por operación lógica. |
| `X-USI-Signature` | → app | si `requires_signature` | HMAC del cuerpo. |
| `X-USI-Timestamp` | → app | si `requires_signature` | Epoch en segundos. |
| `X-USI-Version` | ← app | sí | Versión implementada, ej. `1.0.0`. |
| `Retry-After` | ← app | en `429`/`503` | Segundos a esperar. |

---

## 5. Errores

Formato único:

```jsonc
{
  "error": {
    "code": "target_not_synthetic",
    "message": "El objetivo usr_123 no es una entidad sintética.",
    "details": { "target_id": "usr_123" }
  }
}
```

| HTTP | `code` sugerido | Significado |
| --- | --- | --- |
| `400` | `invalid_request` | Cuerpo mal formado. |
| `401` | `unauthenticated` | Token ausente o inválido. |
| `403` | `forbidden` | Token válido, sin permiso para la operación. |
| `404` | `not_found` | Entidad inexistente. |
| `409` | `conflict` | Colisión de estado (ej. handle ya en uso). |
| `422` | `unprocessable` · `target_not_synthetic` | Violación de reglas de negocio. **Es una respuesta esperada.** |
| `429` | `rate_limited` | Demasiadas peticiones. El motor respeta `Retry-After`. |
| `501` | `capability_not_supported` | Capacidad no implementada por esta app. |
| `503` | `unavailable` | Temporalmente no disponible; el motor reintenta. |

El motor reintenta con backoff exponencial ante `429`, `503` y errores de red.
**Nunca** reintenta ante `4xx` distintos de `429`.

---

## 6. Endpoints

### 6.1 `GET /usi/v1/manifest` — manifiesto y versionado · **obligatorio**

Punto de partida de toda integración: SUSP lo consulta antes de cualquier otra
cosa y adapta su comportamiento a lo que la app declare.

**Respuesta `200`**

```jsonc
{
  "usi_version": "1.0.0",
  "app": {
    "name": "nocturna",
    "environment": "development",       // development | staging | production
    "vertical": "social"                // dating | social | telemedicine | marketplace | other
  },
  "capabilities": [
    "users.create", "users.update", "users.delete",
    "content.create", "interactions.create",
    "messaging.send", "audit.read"
  ],
  "requires_signature": false,
  "limits": {
    "max_batch_size": 50,
    "requests_per_minute": 600
  },
  "content_types": ["post", "comment", "photo"],
  "interaction_types": ["like", "follow", "comment", "share"]
}
```

`environment: "production"` hace que SUSP **rechace la escritura** salvo
autorización explícita registrada en el motor.

---

### 6.2 `POST /usi/v1/auth/verify` — autenticación · **obligatorio**

Valida las credenciales sin efectos secundarios. Lo usa el dashboard para el
semáforo de "estado de las APIs".

**Respuesta `200`**

```jsonc
{
  "authenticated": true,
  "app_id": "nocturna",
  "scopes": ["users.write", "content.write", "interactions.write", "purge"],
  "token_expires_at": null
}
```

---

### 6.3 `POST /usi/v1/users` — crear usuario sintético · `users.create`

**Petición**

```jsonc
{
  "agent_id": "agt_7f3a",
  "simulation_id": "run_2f9c",
  "profile": {
    "display_name": "Camila Ferreyra",
    "handle": "camifer",
    "email": "camifer@demo.susp.invalid",
    "bio": "Fotógrafa. Café antes que hablar.",
    "birth_date": "1996-04-11",
    "gender": "female",
    "location": { "city": "Rosario", "country": "AR", "lat": -32.95, "lon": -60.66 },
    "interests": ["fotografía", "cine", "ciclismo"],
    "avatar": { "kind": "procedural", "seed": "camifer-7f3a" },
    "locale": "es-AR"
  },
  "attributes": { "plan": "free" }
}
```

Los emails sintéticos usan el TLD reservado **`.invalid`** (RFC 2606): son
inequívocamente falsos e imposibles de entregar, así que ningún correo real puede
salir por accidente.

**Respuesta `201`**

```jsonc
{
  "id": "usr_a91c",
  "external_ref": "auth0|abc",
  "synthetic": true,
  "simulation_id": "run_2f9c",
  "agent_id": "agt_7f3a",
  "created_at": "2026-07-28T19:40:00Z"
}
```

---

### 6.4 `PATCH /usi/v1/users/{id}` — actualizar perfil · `users.update`

Cuerpo: mismo bloque `profile` (parcial). Devuelve `200` con la entidad
actualizada. Debe responder `422` si `{id}` no es sintético.

---

### 6.5 `DELETE /usi/v1/users/{id}` — borrar usuario · `users.delete`

Borra un único usuario sintético. `204` si se borró, `404` si no existía, `422`
si no era sintético. Para el borrado masivo está `/purge`.

---

### 6.6 `POST /usi/v1/content` — crear contenido demo · `content.create`

```jsonc
{
  "agent_id": "agt_7f3a",
  "simulation_id": "run_2f9c",
  "author_id": "usr_a91c",
  "type": "post",                       // debe estar en manifest.content_types
  "body": "Primera salida con la cámara nueva.",
  "media": [{ "kind": "procedural_image", "seed": "post-1", "alt": "Calle al atardecer" }],
  "parent_id": null,                    // para comentarios/respuestas
  "attributes": { "visibility": "public" },
  "created_at": "2026-07-28T19:41:00Z"  // permite sembrar historial con fechas pasadas
}
```

`201` con `{ id, synthetic, simulation_id, agent_id, created_at }`.

---

### 6.7 `POST /usi/v1/interactions` — generar interacciones · `interactions.create`

```jsonc
{
  "agent_id": "agt_7f3a",
  "simulation_id": "run_2f9c",
  "actor_id": "usr_a91c",
  "type": "like",                       // debe estar en manifest.interaction_types
  "target_type": "content",             // user | content | interaction
  "target_id": "cnt_5512",
  "value": null,                        // rating, monto, etc. según el tipo
  "attributes": {}
}
```

**El objetivo debe ser sintético.** Si no lo es, la app responde `422` con
`code: "target_not_synthetic"`. Esta regla es la que garantiza que los agentes
nunca interactúen con usuarios reales.

---

### 6.8 `POST /usi/v1/messages` — mensajería · `messaging.send`

```jsonc
{
  "agent_id": "agt_7f3a",
  "simulation_id": "run_2f9c",
  "conversation_id": null,              // null = abrir conversación nueva
  "from_id": "usr_a91c",
  "to_ids": ["usr_b220"],
  "body": "Hola! Vi que también andás en bici por el centro.",
  "attributes": {}
}
```

Mismas reglas: emisor y destinatarios deben ser sintéticos. `201` con
`{ id, conversation_id, synthetic, ... }`.

---

### 6.9 `GET /usi/v1/state` — consultar estado · **obligatorio**

```jsonc
{
  "healthy": true,
  "usi_version": "1.0.0",
  "counts": {
    "users": 240,
    "content": 1893,
    "interactions": 7712,
    "messages": 664
  },
  "by_simulation": [
    { "simulation_id": "run_2f9c", "users": 120, "content": 940 }
  ],
  "purge_token": "prg_9f2a1c...",       // nonce de un solo uso para /purge
  "purge_token_expires_at": "2026-07-28T20:00:00Z",
  "server_time": "2026-07-28T19:45:00Z"
}
```

Los contadores son **solo de entidades sintéticas**. `purge_token` es un nonce de
un solo uso con vida corta (recomendado: 15 min).

---

### 6.10 `POST /usi/v1/purge` — eliminar datos demo · **obligatorio**

```jsonc
{
  "purge_token": "prg_9f2a1c...",       // obtenido de GET /state
  "scope": "simulation",                // simulation | all
  "simulation_id": "run_2f9c",          // requerido si scope = simulation
  "dry_run": false
}
```

**Respuesta `200`**

```jsonc
{
  "purged": { "users": 120, "content": 940, "interactions": 3100, "messages": 210 },
  "dry_run": false,
  "completed_at": "2026-07-28T19:50:00Z"
}
```

Reglas no negociables:

- Sin `purge_token` válido y no usado → `403`.
- **Solo borra entidades marcadas como sintéticas.** Jamás toca datos reales.
- `dry_run: true` devuelve el conteo de lo que borraría, sin borrar nada.

---

### 6.11 `GET /usi/v1/audit` — auditoría · `audit.read`

`GET /usi/v1/audit?simulation_id=run_2f9c&since=2026-07-28T00:00:00Z&limit=100`

```jsonc
{
  "events": [
    {
      "id": "aud_001",
      "at": "2026-07-28T19:40:00Z",
      "operation": "users.create",
      "entity_type": "user",
      "entity_id": "usr_a91c",
      "simulation_id": "run_2f9c",
      "agent_id": "agt_7f3a",
      "result": "ok"
    }
  ],
  "next_cursor": null
}
```

---

## 7. Capacidades

Solo `manifest`, `auth/verify`, `state` y `purge` son obligatorios. Todo lo demás
se declara:

| Capacidad | Habilita |
| --- | --- |
| `users.create` | `POST /users` |
| `users.update` | `PATCH /users/{id}` |
| `users.delete` | `DELETE /users/{id}` |
| `content.create` | `POST /content` |
| `interactions.create` | `POST /interactions` |
| `messaging.send` | `POST /messages` |
| `audit.read` | `GET /audit` |

Si SUSP llama a un endpoint no declarado, la app responde `501`
`capability_not_supported`. El motor no debería llegar a ese punto: lee el
manifiesto primero y planifica solo con lo disponible.

---

## 8. Versionado

- **Ruta mayor:** `/usi/v1`. Un cambio incompatible estrena `/usi/v2`; ambas
  pueden convivir.
- **Semántica fina:** `usi_version` en el manifiesto (`MAJOR.MINOR.PATCH`).
  - `MINOR` — capacidades o campos opcionales nuevos, retrocompatible.
  - `PATCH` — correcciones sin cambio de contrato.
- El motor exige que el `MAJOR` coincida y avisa si su `MINOR` es mayor que el de
  la app (usará solo el subconjunto compatible).

---

## 9. Conformidad

```bash
npx @susp/usi-conformance --url https://mi-app.example/usi/v1 --token <token>
```

La suite verifica el contrato completo: obligatorios presentes, marcado sintético
en toda entidad creada, rechazo de objetivos no sintéticos, idempotencia,
formato de errores, nonce de purga y limpieza total al final. Una implementación
que no pasa no puede darse de alta en el motor.
