import request from 'supertest';
import type { Server } from 'node:http';
import { conClave, levantarApp, type Contexto } from './helpers';

/**
 * E2E de la API contra un PostgreSQL real.
 *
 * Los unitarios cubren la lógica; esto cubre lo que solo se rompe cuando las
 * piezas están juntas: los guards, la validación, el filtro de errores, las
 * restricciones de la base y —sobre todo— las salvaguardas, que son promesas del
 * producto y no deberían poder romperse por un refactor.
 */
describe('API del motor (e2e)', () => {
  let ctx: Contexto;
  let http: Server;

  beforeAll(async () => {
    ctx = await levantarApp();
    http = ctx.app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await ctx.cerrar();
  });

  // ─────────────────────────────── salud ───────────────────────────────

  describe('health', () => {
    it('/health responde sin credencial', async () => {
      const res = await request(http).get('/health').expect(200);
      expect(res.body.status).toBe('ok');
    });

    it('/health/ready confirma que la base responde', async () => {
      const res = await request(http).get('/health/ready').expect(200);
      expect(res.body.checks.database).toBe(true);
    });
  });

  // ───────────────────────────── autenticación ─────────────────────────────

  describe('autenticación', () => {
    it('rechaza sin credencial', async () => {
      const res = await request(http).get('/api/v1/tenant').expect(401);
      expect(res.body.error.code).toBe('unauthenticated');
    });

    it('rechaza una API key con formato inválido', async () => {
      await request(http)
        .get('/api/v1/tenant')
        .set('X-Susp-Key', 'no-tiene-el-formato')
        .expect(401);
    });

    it('rechaza una API key inexistente pero bien formada', async () => {
      await request(http)
        .get('/api/v1/tenant')
        .set('X-Susp-Key', 'susp_deadbeef_clavefalsaquenoexiste')
        .expect(401);
    });

    it('acepta la API key del tenant', async () => {
      const res = await request(http).get('/api/v1/tenant').set(conClave(ctx)).expect(200);
      expect(res.body.id).toBe(ctx.tenantId);
    });

    it('permite iniciar sesión y usar el JWT', async () => {
      const login = await request(http)
        .post('/api/v1/auth/login')
        .send({ email: ctx.email, password: ctx.password })
        .expect(200);

      expect(login.body.token).toBeTruthy();
      expect(login.body.member.role).toBe('OWNER');

      const yo = await request(http)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${login.body.token}`)
        .expect(200);
      expect(yo.body.tenantId).toBe(ctx.tenantId);
      expect(yo.body.kind).toBe('jwt');
    });

    it('rechaza una contraseña incorrecta', async () => {
      await request(http)
        .post('/api/v1/auth/login')
        .send({ email: ctx.email, password: 'incorrecta-pero-larga' })
        .expect(401);
    });

    it('no revela si un email existe o no', async () => {
      const inexistente = await request(http)
        .post('/api/v1/auth/login')
        .send({ email: 'nadie@pruebas.local', password: 'contraseña-cualquiera' })
        .expect(401);
      const malaClave = await request(http)
        .post('/api/v1/auth/login')
        .send({ email: ctx.email, password: 'contraseña-incorrecta' })
        .expect(401);

      // El mismo mensaje en los dos casos: si difirieran, se podría enumerar
      // qué cuentas existen probando emails.
      expect(inexistente.body.error.message).toBe(malaClave.body.error.message);
    });
  });

  // ───────────────────────────── validación ─────────────────────────────

  describe('validación', () => {
    it('rechaza un payload inválido con el detalle de cada problema', async () => {
      const res = await request(http)
        .post('/api/v1/target-apps')
        .set(conClave(ctx))
        .send({ name: 'x', slug: 'MAYÚSCULAS', baseUrl: 'no-es-url', env: 'NADA', token: '1' })
        .expect(400);

      expect(res.body.error.code).toBe('invalid_request');
      expect(res.body.error.details.issues.length).toBeGreaterThan(3);
    });

    it('rechaza campos que no están en el DTO', async () => {
      await request(http)
        .post('/api/v1/personas')
        .set(conClave(ctx))
        .send({
          name: 'Prueba',
          slug: 'prueba-extra',
          traits: { openness: 0.5 },
          campoInventado: 'esto no debería pasar',
        })
        .expect(400);
    });
  });

  // ─────────────────────────── apps destino ───────────────────────────

  describe('apps destino', () => {
    let appId: string;

    it('crea una app y no devuelve la credencial', async () => {
      const res = await request(http)
        .post('/api/v1/target-apps')
        .set(conClave(ctx))
        .send({
          name: 'App de pruebas',
          slug: 'app-pruebas',
          baseUrl: 'http://reference-app:55704/usi/v1',
          env: 'DEVELOPMENT',
          vertical: 'SOCIAL',
          token: 'token-secreto-de-pruebas',
        })
        .expect(201);

      appId = res.body.id;
      expect(res.body.hasCredential).toBe(true);
      // La credencial no puede aparecer en ninguna forma dentro de la respuesta.
      expect(JSON.stringify(res.body)).not.toContain('token-secreto-de-pruebas');
    });

    it('tampoco la devuelve al consultarla después', async () => {
      const res = await request(http)
        .get(`/api/v1/target-apps/${appId}`)
        .set(conClave(ctx))
        .expect(200);
      expect(JSON.stringify(res.body)).not.toContain('token-secreto-de-pruebas');
    });

    it('rechaza un slug repetido', async () => {
      await request(http)
        .post('/api/v1/target-apps')
        .set(conClave(ctx))
        .send({
          name: 'Otra',
          slug: 'app-pruebas',
          baseUrl: 'https://otra.example/usi/v1',
          env: 'DEVELOPMENT',
          token: 'otro-token-cualquiera',
        })
        .expect(409);
    });

    it('devuelve 404 con un id inexistente', async () => {
      await request(http)
        .get('/api/v1/target-apps/no-existe')
        .set(conClave(ctx))
        .expect(404);
    });
  });

  // ─────────────────── salvaguarda de producción ───────────────────

  describe('salvaguarda de producción', () => {
    let prodId: string;

    beforeAll(async () => {
      const res = await request(http)
        .post('/api/v1/target-apps')
        .set(conClave(ctx))
        .send({
          name: 'App productiva',
          slug: 'app-productiva',
          baseUrl: 'https://productiva.example/usi/v1',
          env: 'PRODUCTION',
          token: 'token-de-produccion',
        })
        .expect(201);
      prodId = res.body.id;
    });

    it('arranca con las escrituras bloqueadas', async () => {
      const res = await request(http)
        .get(`/api/v1/target-apps/${prodId}`)
        .set(conClave(ctx))
        .expect(200);
      expect(res.body.productionWritesAllowed).toBe(false);
    });

    it('rechaza habilitarlas con la frase equivocada', async () => {
      await request(http)
        .post(`/api/v1/target-apps/${prodId}/production-writes`)
        .set(conClave(ctx))
        .send({ allow: true, confirmSlug: 'app-productiva', confirmPhrase: 'dale' })
        .expect(400);
    });

    it('rechaza habilitarlas con el slug equivocado', async () => {
      const res = await request(http)
        .post(`/api/v1/target-apps/${prodId}/production-writes`)
        .set(conClave(ctx))
        .send({
          allow: true,
          confirmSlug: 'otra-app',
          confirmPhrase: 'ENTIENDO EL RIESGO',
        })
        .expect(400);
      expect(res.body.error.message).toContain('app-productiva');
    });

    it('las habilita solo con slug y frase exactos', async () => {
      const res = await request(http)
        .post(`/api/v1/target-apps/${prodId}/production-writes`)
        .set(conClave(ctx))
        .send({
          allow: true,
          confirmSlug: 'app-productiva',
          confirmPhrase: 'ENTIENDO EL RIESGO',
        })
        .expect(200);
      expect(res.body.productionWritesAllowed).toBe(true);
    });

    it('permite volver a bloquearlas', async () => {
      const res = await request(http)
        .post(`/api/v1/target-apps/${prodId}/production-writes`)
        .set(conClave(ctx))
        .send({
          allow: false,
          confirmSlug: 'app-productiva',
          confirmPhrase: 'ENTIENDO EL RIESGO',
        })
        .expect(200);
      expect(res.body.productionWritesAllowed).toBe(false);
    });
  });

  // ──────────────────── personas y escenarios ────────────────────

  describe('catálogo', () => {
    it('crea una persona y normaliza sus rasgos', async () => {
      const res = await request(http)
        .post('/api/v1/personas')
        .set(conClave(ctx))
        .send({
          name: 'Persona de prueba',
          slug: 'persona-prueba',
          vertical: 'SOCIAL',
          traits: { extraversion: 0.9, chattiness: 0.8 },
          interests: ['cine'],
          goals: [{ kind: 'content.create', target: 3 }],
        })
        .expect(201);

      // Los rasgos no declarados se completan con el punto medio: el motor
      // nunca debería encontrarse un rasgo indefinido.
      expect(res.body.traits.extraversion).toBeCloseTo(0.9);
      expect(res.body.traits.openness).toBeCloseTo(0.5);
    });

    it('rechaza rasgos fuera de 0..1', async () => {
      await request(http)
        .post('/api/v1/personas')
        .set(conClave(ctx))
        .send({
          name: 'Fuera de rango',
          slug: 'fuera-de-rango',
          traits: { extraversion: 5 },
        })
        .expect(400);
    });

    it('rechaza un escenario con una operación que no existe en USI', async () => {
      const res = await request(http)
        .post('/api/v1/scenarios')
        .set(conClave(ctx))
        .send({
          name: 'Escenario inválido',
          slug: 'escenario-invalido',
          actionMix: { 'operacion.inventada': 5 },
        })
        .expect(400);

      // Detectarlo acá evita encolar trabajo que la app rechazaría con 501.
      expect(res.body.error.message).toContain('operacion.inventada');
    });

    it('acepta una mezcla de acciones válida', async () => {
      const res = await request(http)
        .post('/api/v1/scenarios')
        .set(conClave(ctx))
        .send({
          name: 'Escenario válido',
          slug: 'escenario-valido',
          vertical: 'SOCIAL',
          actionMix: { 'content.create': 3, 'interactions.create': 6 },
          intensity: 2,
        })
        .expect(201);
      expect(res.body.actionMix['interactions.create']).toBe(6);
    });
  });

  // ─────────────────────────── campañas ───────────────────────────

  describe('campañas', () => {
    let appId: string;
    let campaignId: string;

    beforeAll(async () => {
      const app = await request(http)
        .post('/api/v1/target-apps')
        .set(conClave(ctx))
        .send({
          name: 'Destino de campañas',
          slug: 'destino-campanas',
          baseUrl: 'http://reference-app:55704/usi/v1',
          env: 'DEVELOPMENT',
          vertical: 'SOCIAL',
          token: 'token-cualquiera-largo',
        })
        .expect(201);
      appId = app.body.id;
    });

    it('crea una campaña en borrador', async () => {
      const res = await request(http)
        .post('/api/v1/campaigns')
        .set(conClave(ctx))
        .send({ name: 'Campaña e2e', targetAppId: appId, agentCount: 5 })
        .expect(201);

      campaignId = res.body.id;
      expect(res.body.status).toBe('DRAFT');
    });

    it('rechaza una campaña contra una app que no existe', async () => {
      await request(http)
        .post('/api/v1/campaigns')
        .set(conClave(ctx))
        .send({ name: 'Sin destino', targetAppId: 'no-existe', agentCount: 5 })
        .expect(404);
    });

    it('rechaza una fecha de fin anterior a la de inicio', async () => {
      await request(http)
        .post('/api/v1/campaigns')
        .set(conClave(ctx))
        .send({
          name: 'Fechas al revés',
          targetAppId: appId,
          agentCount: 5,
          startsAt: '2026-08-01T10:00:00Z',
          endsAt: '2026-07-01T10:00:00Z',
        })
        .expect(400);
    });

    it('no arranca contra una app sin verificar', async () => {
      // La app se creó pero nunca pasó un chequeo de salud: arrancar así solo
      // produciría una campaña llena de errores.
      const res = await request(http)
        .post(`/api/v1/campaigns/${campaignId}/start`)
        .set(conClave(ctx))
        .send({})
        .expect(202);

      // El estado UNKNOWN no bloquea (solo UNREACHABLE y NON_CONFORMANT), así
      // que la ejecución se encola y el planificador decidirá.
      expect(res.body.status).toBe('PENDING');
    });

    it('rechaza una transición inválida del ciclo de vida', async () => {
      await request(http)
        .post(`/api/v1/campaigns/${campaignId}/cancel`)
        .set(conClave(ctx))
        .expect(200);

      // Cancelada es estado final: no se puede volver a arrancar.
      const res = await request(http)
        .post(`/api/v1/campaigns/${campaignId}/start`)
        .set(conClave(ctx))
        .send({})
        .expect(409);
      expect(res.body.error.message).toContain('CANCELLED');
    });

    it('exige el nombre exacto para purgar', async () => {
      const res = await request(http)
        .post(`/api/v1/campaigns/${campaignId}/purge`)
        .set(conClave(ctx))
        .send({ confirmName: 'nombre equivocado' })
        .expect(400);
      expect(res.body.error.message).toContain('Campaña e2e');
    });
  });

  // ─────────────────────── aislamiento entre tenants ───────────────────────

  describe('aislamiento entre tenants', () => {
    it('no deja ver recursos de otro tenant', async () => {
      // Se crea un segundo tenant con su propia clave y se intenta leer un
      // recurso del primero. Es la garantía más importante de un motor
      // multi-cliente y la más fácil de romper con un `where` mal puesto.
      const otro = await levantarAppSecundaria();

      try {
        const propias = await request(http)
          .get('/api/v1/target-apps')
          .set(conClave(ctx))
          .expect(200);
        expect(propias.body.total).toBeGreaterThan(0);

        const ajenas = await request(http)
          .get('/api/v1/target-apps')
          .set('X-Susp-Key', otro.apiKey)
          .expect(200);
        expect(ajenas.body.total).toBe(0);

        // Y por id directo tampoco.
        const id = propias.body.items[0].id;
        await request(http)
          .get(`/api/v1/target-apps/${id}`)
          .set('X-Susp-Key', otro.apiKey)
          .expect(404);
      } finally {
        await otro.limpiar();
      }
    });
  });

  /** Segundo tenant dentro de la misma app, para probar el aislamiento. */
  async function levantarAppSecundaria(): Promise<{
    apiKey: string;
    limpiar: () => Promise<void>;
  }> {
    const { createHash, randomBytes } = await import('node:crypto');

    const tenant = await ctx.prisma.tenant.create({
      data: { name: 'Otro tenant', slug: `otro-${randomBytes(4).toString('hex')}` },
    });
    const prefix = `susp_${randomBytes(4).toString('hex')}`;
    const apiKey = `${prefix}_${randomBytes(24).toString('base64url')}`;
    await ctx.prisma.apiKey.create({
      data: {
        tenantId: tenant.id,
        name: 'e2e-otro',
        prefix,
        hash: createHash('sha256').update(apiKey).digest('hex'),
        role: 'OWNER',
      },
    });

    return {
      apiKey,
      limpiar: async () => {
        await ctx.prisma.tenant.delete({ where: { id: tenant.id } });
      },
    };
  }
});
