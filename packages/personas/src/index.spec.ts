import test from 'node:test';
import assert from 'node:assert/strict';
import { PACKS, packDe, repartir, verificarCompatibilidad } from './index.ts';

test('hay un pack por cada vertical del alcance', () => {
  const verticales = PACKS.map((p) => p.vertical).sort();
  assert.deepEqual(verticales, ['DATING', 'MARKETPLACE', 'SOCIAL', 'TELEMEDICINE']);
});

test('los slugs son únicos en todo el catálogo', () => {
  // Un slug repetido entre packs haría fallar la siembra con un conflicto, y
  // sería confuso de diagnosticar desde el dashboard.
  const personas = PACKS.flatMap((p) => p.personas.map((x) => x.slug));
  const escenarios = PACKS.flatMap((p) => p.escenarios.map((x) => x.slug));

  assert.equal(new Set(personas).size, personas.length, 'hay slugs de persona repetidos');
  assert.equal(new Set(escenarios).size, escenarios.length, 'hay slugs de escenario repetidos');
});

test('las proporciones de cada pack suman 1', () => {
  for (const pack of PACKS) {
    const suma = pack.personas.reduce((s, p) => s + p.proporcion, 0);
    assert.ok(
      Math.abs(suma - 1) < 0.001,
      `${pack.vertical}: las proporciones suman ${suma.toFixed(3)}, deberían sumar 1`,
    );
  }
});

test('los rasgos están dentro de 0..1', () => {
  for (const pack of PACKS) {
    for (const persona of pack.personas) {
      for (const [rasgo, valor] of Object.entries(persona.traits)) {
        assert.ok(
          typeof valor === 'number' && valor >= 0 && valor <= 1,
          `${persona.slug}.${rasgo} = ${valor}`,
        );
      }
    }
  }
});

test('los horarios son coherentes', () => {
  for (const pack of PACKS) {
    for (const persona of pack.personas) {
      assert.ok(persona.schedule.slots.length > 0, `${persona.slug} no tiene franjas horarias`);
      for (const franja of persona.schedule.slots) {
        assert.ok(franja.startHour >= 0 && franja.startHour <= 23, `${persona.slug}: hora de inicio inválida`);
        assert.ok(franja.endHour >= 1 && franja.endHour <= 24, `${persona.slug}: hora de fin inválida`);
        assert.ok(
          franja.endHour > franja.startHour,
          `${persona.slug}: franja ${franja.startHour}-${franja.endHour} termina antes de empezar`,
        );
      }
    }
  }
});

test('los escenarios solo usan operaciones USI válidas', () => {
  const validas = new Set([
    'users.create',
    'users.update',
    'users.delete',
    'content.create',
    'interactions.create',
    'messaging.send',
    'audit.read',
  ]);

  for (const pack of PACKS) {
    for (const escenario of pack.escenarios) {
      for (const operacion of Object.keys(escenario.actionMix)) {
        assert.ok(validas.has(operacion), `${escenario.slug} usa "${operacion}", que no existe en USI`);
      }
    }
  }
});

test('los objetivos apuntan a operaciones que el escenario del vertical ejercita', () => {
  for (const pack of PACKS) {
    const operacionesDelPack = new Set(
      pack.escenarios.flatMap((e) => Object.keys(e.actionMix)),
    );
    for (const persona of pack.personas) {
      for (const objetivo of persona.goals) {
        assert.ok(
          operacionesDelPack.has(objetivo.kind),
          `${persona.slug} persigue "${objetivo.kind}", que ningún escenario de ${pack.vertical} ejercita: ` +
            'nunca lo cumpliría y la campaña no terminaría sola',
        );
      }
    }
  }
});

test('telemedicina no define personas de profesional de la salud', () => {
  // Un agente sintético emitiendo indicaciones médicas es contenido que no
  // conviene que exista, aunque sea contra una base de prueba.
  const tele = packDe('TELEMEDICINE');
  assert.ok(tele);
  for (const persona of tele.personas) {
    assert.match(
      persona.slug,
      /paciente/,
      `${persona.slug}: este pack solo debe tener pacientes sintéticos`,
    );
  }
});

describe_repartir();

function describe_repartir(): void {
  test('repartir distribuye exactamente el total pedido', () => {
    for (const pack of PACKS) {
      for (const total of [1, 3, 7, 10, 50, 137, 1000]) {
        const reparto = repartir(pack, total);
        const suma = reparto.reduce((s, r) => s + r.cantidad, 0);
        assert.equal(suma, total, `${pack.vertical} con ${total}: repartió ${suma}`);
      }
    }
  });

  test('repartir nunca deja una persona en cero cuando alcanza el total', () => {
    const pack = PACKS[0];
    const reparto = repartir(pack, pack.personas.length * 2);
    for (const fila of reparto) {
      assert.ok(fila.cantidad >= 1, `${fila.slug} quedó en cero`);
    }
  });

  test('repartir respeta el orden de proporción', () => {
    const pack = packDe('SOCIAL');
    assert.ok(pack);
    const reparto = repartir(pack, 100);
    // El lector silencioso es el 55%: tiene que ser el más numeroso.
    const mayor = reparto.reduce((a, b) => (b.cantidad > a.cantidad ? b : a));
    assert.equal(mayor.slug, 'lector-silencioso');
  });

  test('repartir con total cero devuelve vacío', () => {
    assert.deepEqual(repartir(PACKS[0], 0), []);
  });
}

test('verificarCompatibilidad detecta lo que falta en el manifiesto', () => {
  const pack = packDe('SOCIAL');
  assert.ok(pack);

  const completo = verificarCompatibilidad(pack, {
    capabilities: pack.requiere.capabilities,
    content_types: pack.requiere.contentTypes,
    interaction_types: pack.requiere.interactionTypes,
  });
  assert.equal(completo.compatible, true);

  const incompleto = verificarCompatibilidad(pack, { capabilities: ['users.create'] });
  assert.equal(incompleto.compatible, false);
  assert.ok(incompleto.faltantes.some((f) => f.includes('content.create')));
});
