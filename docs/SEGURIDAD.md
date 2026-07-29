# Seguridad y salvaguardas

Una plataforma que crea usuarios y les hace publicar, reaccionar y escribirse
puede usarse para poblar un entorno de demostración o para simular actividad
falsa sobre gente real. La diferencia no es de intención: es de diseño. Este
documento explica qué impide lo segundo, y por qué cada mecanismo está donde
está.

---

## 1. Lo que no se puede desactivar

Estas tres cosas no tienen bandera de configuración. Están en el único camino de
salida del motor y en el contrato que toda app debe implementar.

### Todo lo creado queda marcado

Cada entidad que SUSP crea lleva, de forma persistente y consultable:

```jsonc
{ "synthetic": true, "simulation_id": "run_...", "agent_id": "agt_...", "created_by": "susp" }
```

El marcado lo inyecta el cliente USI, que es el **único** componente del motor
que habla con el exterior. No es un parámetro que se pueda omitir: no hay una
ruta de código que escriba sin pasar por ahí.

Del lado de la app, una implementación que no devuelva `synthetic: true` en las
entidades creadas **no es conforme**, y la suite de conformidad la rechaza. Sin
ese campo, nada del lado del consumidor podría distinguir un agente de una
persona.

### Los agentes solo interactúan entre ellos

`POST /interactions` debe rechazar con `422 target_not_synthetic` cualquier
objetivo que no sea una entidad sintética. Lo mismo `POST /messages` con emisor y
destinatarios.

Es la regla que sostiene todo el modelo. Un agente sintético no puede darle "me
gusta" a la foto de una persona, ni escribirle, ni comentarle. `@susp/usi-server`
lo verifica en cada escritura para que no dependa de que cada integrador se
acuerde de comprobarlo.

**Es el check más importante de la suite de conformidad**, y el único cuyo fallo
se describe como grave: *"permite que agentes generados actúen sobre contenido de
usuarios reales"*.

### Los emails sintéticos no pueden recibir correo

Usan el TLD reservado **`.invalid`** (RFC 2606), que por definición no resuelve.
Aunque la app destino le mande un correo de bienvenida a un agente, no llega a
ninguna parte. El validador del estándar lo exige.

---

## 2. Reversibilidad

### Espejo local

El motor guarda una copia de cada entidad que crea (`SyntheticEntity`: app,
ejecución, agente, id externo). Sin ese espejo no habría forma de enumerar
exactamente lo generado, y la promesa de "todo es reversible" quedaría sin
respaldo.

### Purga acotada

`POST /purge` con `scope: "simulation"` borra lo de **una** ejecución. Verificado:
purgar una campaña deja intacta la anterior contra la misma app.

La app solo puede borrar entidades marcadas como sintéticas. Filtrar por fecha o
por rango de ids sería la diferencia entre limpiar una demo y borrarle datos a un
cliente; la plantilla de integración lo dice explícitamente.

### Nonce de un solo uso

La purga exige un `purge_token` emitido por `GET /state`, de vida corta y un solo
uso. Es un permiso para borrar en masa: no debería poder dispararse por un
reintento accidental ni por una petición repetida.

El cliente USI **nunca reintenta** una purga, justamente porque el token ya se
consumió y un reintento fallaría con un `403` confuso.

### Doble confirmación en el motor

Purgar una campaña exige escribir su nombre exacto y tener rol OWNER. El
dashboard ofrece primero el simulacro, que cuenta sin borrar.

Y no se puede borrar una campaña que dejó entidades sin purgar en la app destino:
quedarían imposibles de rastrear.

---

## 3. Producción

Por defecto (`SUSP_BLOCK_PRODUCTION_TARGETS=true`), el motor **se niega** a
escribir contra una app cuyo manifiesto declare `environment: "production"`.

Habilitarlo exige, con rol OWNER:

1. Escribir el slug exacto de la app.
2. Escribir la frase exacta `ENTIENDO EL RIESGO`.

Es deliberadamente incómodo: no debería sentirse como cambiar una preferencia. En
el dashboard vive en un panel aparte, con borde de advertencia.

La comprobación se hace **dos veces**: al arrancar la campaña y otra vez en el
momento exacto de cada escritura. Entre una cosa y la otra alguien pudo haber
marcado la app como productiva.

El entorno lo declara la app en su manifiesto, no el registro en SUSP: si la app
dice que es producción, manda eso.

---

## 4. Modo simulación

`dryRun` calcula el plan completo —cuántas acciones, de qué tipo, en qué orden—
sin ejecutar una sola escritura, y lo registra en la auditoría con resultado
`DRY_RUN`.

Es la forma correcta de estrenar una integración. El dashboard lo deja tildado por
defecto al crear una campaña.

---

## 5. Credenciales

| Qué | Cómo se guarda |
| --- | --- |
| Token USI de cada app destino | Cifrado con **AES-256-GCM**. No vuelve a salir por la API — verificado en los e2e. |
| Secreto HMAC de firma | Igual. |
| Contraseñas de usuarios | **scrypt** (RFC 7914) con sal por contraseña. Del runtime: sin módulos nativos que compilar. |
| API keys | Solo el hash SHA-256 y el prefijo. El valor en claro se muestra **una única vez**, al crearla. |

La comparación de API keys es en tiempo constante y se hace incluso cuando el
prefijo no existe, para que el tiempo de respuesta no revele qué claves están
registradas. El login verifica siempre contra un hash aunque la cuenta no exista,
y devuelve el mismo mensaje en los dos casos: si difirieran, se podrían enumerar
las cuentas probando emails.

---

## 6. Aislamiento entre tenants

Toda consulta filtra por el tenant de la credencial. Un tenant no ve recursos de
otro ni siquiera pidiéndolos por id — está cubierto por un e2e, porque es la
garantía más fácil de romper con un `where` mal puesto en un refactor.

El rol se relee de la base en cada petición, no del token: revocar un permiso
surte efecto al instante en vez de esperar a que venza el JWT.

---

## 7. Comportamiento frente a errores

| Situación | Qué hace el motor |
| --- | --- |
| La app responde `422` | **No reintenta.** La app aplicó sus reglas de negocio; repetir da lo mismo. Se registra como `REJECTED`, no como error. |
| La app responde `429` o `503` | Reintenta con backoff exponencial, respetando `Retry-After`. |
| La app no responde | Reintenta; después marca la app como inalcanzable. |
| El modelo declina generar | Se omite esa acción. La simulación sigue. |
| El worker se cae con trabajos tomados | Se recuperan a los 5 minutos y se reencolan. |
| Falla escribir la auditoría | Se registra en el log y la operación sigue. Perder una línea de auditoría es malo; abortar una purga a mitad de camino por no poder anotarla, peor. |

---

## 8. Qué queda del lado de quien integra

SUSP no puede garantizar solo estas dos cosas:

1. **Que lo sintético quede fuera de tus métricas.** La migración crea las vistas,
   pero cambiar tus consultas de negocio para que las usen es trabajo tuyo. Si
   los agentes entran en tus reportes, en tus notificaciones o en tu facturación,
   los números dejan de significar nada — y alguien real puede recibir un aviso
   de una cuenta que no existe. Está señalado en negrita en la guía de integración
   porque es el paso que más se olvida.

2. **Que tu app muestre que una cuenta es sintética.** El estándar recomienda una
   insignia visible del tipo "cuenta de demostración". Es lo que impide que un
   usuario real confunda un agente con una persona.

---

## 9. Reportar un problema

Si encontrás una forma de que un agente sintético alcance datos reales, o de que
una purga toque algo que no generó SUSP, es un fallo de seguridad y no un error
funcional. Abrí un issue en el repositorio describiendo el camino exacto.
