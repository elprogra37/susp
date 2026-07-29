import { SchedulerService } from './scheduler.service';
import { CONFIG, SuspConfig } from '../config/configuration';
import { PrismaService } from '../common/prisma/prisma.service';
import { JobQueueService } from './job-queue.service';
import { PlannerService } from './planner.service';
import { ExecutorService } from './executor.service';

/**
 * Pruebas del apagado ordenado.
 *
 * El resto del scheduler se ejercita de punta a punta en las e2e, contra una
 * base real. Acá lo único que interesa es el comportamiento ante SIGTERM, que
 * las e2e no pueden cubrir: exige matar el proceso.
 */

function armar(overrides: Partial<SuspConfig['scheduler']> = {}): SchedulerService {
  const config = {
    scheduler: { enabled: true, pollMs: 1000, batchSize: 5, ...overrides },
  } as unknown as SuspConfig;

  return new SchedulerService(
    {} as PrismaService,
    {} as JobQueueService,
    {} as PlannerService,
    {} as ExecutorService,
    config,
  );
}

// Acceso a los privados: la prueba verifica una máquina de estados interna, y
// simular una vuelta real exigiría montar las cuatro dependencias enteras.
type Interno = { running: boolean; stopping: boolean; timer: NodeJS.Timeout | null };
const interno = (s: SchedulerService): Interno => s as unknown as Interno;

describe('SchedulerService — apagado', () => {
  it('vuelve enseguida si no hay lote en curso', async () => {
    const scheduler = armar();
    const desde = Date.now();

    await scheduler.onApplicationShutdown('SIGTERM');

    expect(Date.now() - desde).toBeLessThan(500);
    expect(interno(scheduler).stopping).toBe(true);
  });

  it('espera a que termine el lote en curso antes de devolver', async () => {
    const scheduler = armar();
    interno(scheduler).running = true;

    // El lote "termina" a los 300 ms.
    setTimeout(() => {
      interno(scheduler).running = false;
    }, 300);

    const desde = Date.now();
    await scheduler.onApplicationShutdown('SIGTERM');
    const tardanza = Date.now() - desde;

    expect(tardanza).toBeGreaterThanOrEqual(250);
    expect(tardanza).toBeLessThan(3000);
  });

  it('se rinde si el lote nunca termina, en vez de colgar el apagado', async () => {
    jest.useFakeTimers();
    const scheduler = armar();
    interno(scheduler).running = true; // nunca baja

    const apagado = scheduler.onApplicationShutdown('SIGTERM');
    // Correr el reloj más allá del tope de espera.
    await jest.advanceTimersByTimeAsync(20_000);
    await expect(apagado).resolves.toBeUndefined();

    jest.useRealTimers();
  });

  it('deja de aceptar trabajo nuevo apenas empieza el apagado', async () => {
    const scheduler = armar();
    await scheduler.onApplicationShutdown('SIGTERM');

    expect(interno(scheduler).stopping).toBe(true);
    expect(interno(scheduler).timer).toBeNull();
  });

  it('no espera nada si el scheduler está desactivado', async () => {
    const scheduler = armar({ enabled: false });
    interno(scheduler).running = true; // no debería importar

    const desde = Date.now();
    await scheduler.onApplicationShutdown('SIGTERM');

    expect(Date.now() - desde).toBeLessThan(200);
  });
});
