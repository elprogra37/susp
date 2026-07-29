# Pendientes — SUSP

Las diez fases del roadmap están cerradas. Lo que sigue es lo que quedó
consciente­mente fuera del alcance, más la deuda técnica que vale la pena
recordar. El estado general está en [ESTADO.md](ESTADO.md).

---

## Verificaciones que no se pudieron hacer

- [ ] **Revisión visual del dashboard en un navegador.** La extensión de Chrome
      no estaba conectada durante el desarrollo. Está verificado que las siete
      vistas renderizan sin romperse (prueba de humo con Vitest) y que el build
      de producción compila, pero **nadie miró el resultado a ojo**: el aspecto,
      el flujo de login y el comportamiento en pantallas chicas están sin
      confirmar.
- [ ] **CI ejecutándose de verdad.** El workflow está escrito y sin
      `upload-artifact`, pero la cuota de storage de Actions de la cuenta está
      agotada (mismo bloqueo que en `amor`), así que puede no disparar runs. La
      verificación real es local con `make test-all`.
- [ ] **Prueba contra una app real del portfolio.** Todo se validó contra la app
      de referencia. Integrar `nocturna` o `vecinal` de verdad es el siguiente
      paso natural y el que va a revelar los huecos del estándar.

---

## Fuera del alcance de la v1 (decisiones, no olvidos)

- **Edición visual de escenarios.** Se cargan como JSON. Un editor gráfico tiene
  sentido recién cuando haya suficientes escenarios como para que armarlos a mano
  moleste.
- **Generación de imágenes por IA para los avatares.** La v1 usa avatares
  procedurales deterministas. Sumar un modelo de imagen agrega costo y una
  dependencia externa para algo secundario.
- **Multi-región / varias réplicas del scheduler.** La cola con `SKIP LOCKED` ya
  soporta varios workers, pero el límite de tasa y los stores de idempotencia del
  helper son en memoria: con varias instancias hay que moverlos a un store
  compartido. Está anotado abajo.
- **Verticales más allá de los cuatro del alcance.** Citas, red social,
  telemedicina y marketplace cubren el portfolio. Agregar uno es escribir un pack.

---

## Deuda técnica

- [ ] **Límite de tasa en memoria.** `RateLimitGuard` usa un token bucket por
      proceso. Alcanza para una instancia; con varias réplicas detrás de un
      balanceador cada una tendría su propio cupo. Mover a Redis si llega ese día.
- [ ] **Idempotencia y nonces del helper, en memoria por defecto.** Para una
      Supabase Edge Function con varias instancias hay que pasar los stores
      respaldados en Postgres — ya están escritos en
      `packages/usi-server/examples/supabase-edge-function/stores-supabase.ts`,
      falta que la plantilla los use por defecto en vez de mencionarlos.
- [ ] **`packages/usi-spec` duplica tipos con `apps/engine/src/usi`.** El motor
      tiene su propia copia de los tipos USI de cuando el paquete no existía.
      Debería importarlos del paquete y borrar la copia.
- [ ] **Cola en Postgres.** Alcanza de sobra para este volumen. La interfaz
      `JobQueueService` permite meter Redis/BullMQ sin tocar el motor de agentes.
- [ ] **Rama `develop`.** El repo tiene solo `main`. Si preferís el flujo de dos
      ramas como en `amor`, se crea `develop` y se cambia la rama por defecto.

---

## Mejoras que valen la pena

- [ ] **Ampliar el corpus del proveedor determinístico.** Con ~10 plantillas por
      vertical, una campaña de 500 agentes repite texto de forma visible. El test
      de variedad mide esto (`>20 textos distintos en 40 semillas`); subir el
      umbral obliga a ampliar el banco.
- [ ] **Conversaciones con hilo.** Hoy los mensajes son independientes: un agente
      escribe y otro puede escribir después, pero no hay respuesta encadenada real.
      La memoria ya guarda con quién habló cada uno; falta que el planificador
      priorice responder a quien te escribió.
- [ ] **Reanudar una campaña pausada sin recrear agentes.** Funciona, pero los
      agentes que ya cumplieron sus objetivos quedan en `EXHAUSTED` para siempre.
      Un "reiniciar objetivos" sería útil para reusar una población.
- [ ] **Exportar una simulación.** Poder llevarse el plan y los resultados de una
      ejecución como JSON, para adjuntarlo a un reporte o reproducirlo después.
- [ ] **Editar personas desde el dashboard.** Hoy el catálogo es de solo lectura.
      Tiene más sentido "duplicar y ajustar" que crear desde cero en un
      formulario, así que conviene hacer eso.
