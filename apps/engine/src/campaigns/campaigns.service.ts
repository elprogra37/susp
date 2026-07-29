import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditResult,
  Campaign,
  CampaignStatus,
  Prisma,
  Run,
  RunStatus,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { CONFIG, SuspConfig } from '../config/configuration';
import { TargetAppsService } from '../target-apps/target-apps.service';
import { AuditService } from '../audit/audit.service';
import { UsiError } from '../usi/usi.errors';
import {
  CreateCampaignDto,
  PurgeCampaignDto,
  StartCampaignDto,
  UpdateCampaignDto,
} from './campaigns.dto';

/** Transiciones válidas del ciclo de vida. Todo lo demás se rechaza. */
const ALLOWED_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  DRAFT: ['SCHEDULED', 'RUNNING', 'CANCELLED'],
  SCHEDULED: ['RUNNING', 'PAUSED', 'CANCELLED'],
  RUNNING: ['PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'],
  PAUSED: ['RUNNING', 'CANCELLED', 'COMPLETED'],
  COMPLETED: [],
  FAILED: ['DRAFT'],
  CANCELLED: [],
};

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly targetApps: TargetAppsService,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly config: SuspConfig,
  ) {}

  async list(tenantId: string, limit: number, offset: number, status?: CampaignStatus) {
    const where: Prisma.CampaignWhereInput = { tenantId, ...(status ? { status } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          targetApp: { select: { id: true, name: true, slug: true, env: true, health: true } },
          scenario: { select: { id: true, name: true, slug: true } },
          _count: { select: { agents: true, runs: true } },
        },
      }),
      this.prisma.campaign.count({ where }),
    ]);
    return { items, total };
  }

  async get(tenantId: string, id: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, tenantId },
      include: {
        targetApp: true,
        scenario: true,
        _count: { select: { agents: true, runs: true } },
        runs: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
    if (!campaign) throw new NotFoundException('No existe esa campaña.');
    return campaign;
  }

  async create(tenantId: string, dto: CreateCampaignDto): Promise<Campaign> {
    const app = await this.targetApps.get(tenantId, dto.targetAppId);

    // Se avisa temprano, al crear, en vez de fallar recién al arrancar.
    if (app.health === 'UNKNOWN') {
      this.logger.warn(
        `La campaña apunta a "${app.slug}", que todavía no pasó un chequeo de salud.`,
      );
    }

    if (dto.scenarioId) {
      const scenario = await this.prisma.scenario.findFirst({
        where: { id: dto.scenarioId, tenantId },
      });
      if (!scenario) throw new NotFoundException('No existe ese escenario.');
    }

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (startsAt && endsAt && endsAt <= startsAt) {
      throw new BadRequestException('La fecha de fin tiene que ser posterior a la de inicio.');
    }

    return this.prisma.campaign.create({
      data: {
        tenantId,
        targetAppId: dto.targetAppId,
        scenarioId: dto.scenarioId ?? null,
        name: dto.name,
        agentCount: dto.agentCount,
        startsAt,
        endsAt,
        dryRun: dto.dryRun ?? this.config.safety.dryRun,
        timeScale: dto.timeScale ?? 1,
        config: {
          ...(dto.config ?? {}),
          ...(dto.personaIds ? { personaIds: dto.personaIds } : {}),
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateCampaignDto): Promise<Campaign> {
    const campaign = await this.getRaw(tenantId, id);

    if (campaign.status === CampaignStatus.RUNNING) {
      throw new ConflictException(
        'No se edita una campaña en ejecución. Pausala primero.',
      );
    }
    if (
      campaign.status === CampaignStatus.COMPLETED ||
      campaign.status === CampaignStatus.CANCELLED
    ) {
      throw new ConflictException(
        'Una campaña terminada o cancelada no se edita. Duplicala si querés reusarla.',
      );
    }

    const data: Prisma.CampaignUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.agentCount !== undefined) data.agentCount = dto.agentCount;
    if (dto.dryRun !== undefined) data.dryRun = dto.dryRun;
    if (dto.timeScale !== undefined) data.timeScale = dto.timeScale;
    if (dto.startsAt !== undefined) data.startsAt = new Date(dto.startsAt);
    if (dto.endsAt !== undefined) data.endsAt = new Date(dto.endsAt);
    if (dto.config !== undefined) {
      data.config = dto.config as unknown as Prisma.InputJsonValue;
    }
    if (dto.scenarioId !== undefined) {
      data.scenario = { connect: { id: dto.scenarioId } };
    }

    return this.prisma.campaign.update({ where: { id }, data });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const campaign = await this.getRaw(tenantId, id);
    if (campaign.status === CampaignStatus.RUNNING) {
      throw new ConflictException('No se borra una campaña en ejecución. Cancelala primero.');
    }

    // El espejo de entidades sintéticas se borra en cascada con la campaña, así
    // que si quedaron datos sin purgar en la app destino ya no habría forma de
    // ubicarlos. Mejor frenar acá que dejar huérfanos allá.
    const pending = await this.prisma.syntheticEntity.count({
      where: { run: { campaignId: id }, purgedAt: null },
    });
    if (pending > 0) {
      throw new ConflictException(
        `Quedan ${pending} entidades sintéticas sin purgar en la app destino. ` +
          'Purgá la campaña antes de borrarla, o se vuelven imposibles de rastrear.',
      );
    }

    await this.prisma.campaign.delete({ where: { id } });
  }

  // ────────────────────────── ciclo de vida ──────────────────────────

  /**
   * Arranca la campaña creando un `Run` en PENDING. El planificador de la Fase 3
   * lo toma desde ahí: este servicio no sabe nada de agentes ni de generación.
   */
  async start(tenantId: string, id: string, dto: StartCampaignDto): Promise<Run> {
    const campaign = await this.getRaw(tenantId, id);
    this.assertTransition(campaign.status, CampaignStatus.RUNNING);

    const app = await this.prisma.targetApp.findUniqueOrThrow({
      where: { id: campaign.targetAppId },
    });

    const dryRun = dto.dryRun ?? campaign.dryRun ?? this.config.safety.dryRun;

    // La salvaguarda de producción no aplica en modo simulación: no se escribe nada.
    if (!dryRun) {
      this.targetApps.assertWritable(app);
    }

    if (app.health === 'UNREACHABLE' || app.health === 'NON_CONFORMANT') {
      throw new ConflictException(
        `La app "${app.slug}" está en estado ${app.health}. Corré un chequeo de salud y resolvé el problema antes de arrancar.`,
      );
    }

    const active = await this.prisma.run.findFirst({
      where: {
        campaignId: id,
        status: { in: [RunStatus.PENDING, RunStatus.RUNNING] },
      },
    });
    if (active) {
      throw new ConflictException(
        `Esta campaña ya tiene la ejecución ${active.id} en curso.`,
      );
    }

    const run = await this.prisma.$transaction(async (tx) => {
      const created = await tx.run.create({
        data: { campaignId: id, status: RunStatus.PENDING, dryRun },
      });
      await tx.campaign.update({
        where: { id },
        data: { status: CampaignStatus.RUNNING },
      });
      return created;
    });

    await this.audit.record({
      tenantId,
      runId: run.id,
      actor: 'campaigns.start',
      operation: 'campaign.start',
      result: dryRun ? AuditResult.DRY_RUN : AuditResult.OK,
      targetAppId: app.id,
      message: `Ejecución ${run.id} encolada para "${campaign.name}"${dryRun ? ' (simulación)' : ''}.`,
    });

    this.logger.log(
      `Campaña "${campaign.name}" arrancada → ejecución ${run.id}${dryRun ? ' [SIMULACIÓN]' : ''}`,
    );

    return run;
  }

  async pause(tenantId: string, id: string): Promise<Campaign> {
    const campaign = await this.getRaw(tenantId, id);
    this.assertTransition(campaign.status, CampaignStatus.PAUSED);

    return this.prisma.$transaction(async (tx) => {
      // Los trabajos ya encolados se cancelan; los que están corriendo terminan solos.
      await tx.job.updateMany({
        where: { run: { campaignId: id }, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      await tx.run.updateMany({
        where: { campaignId: id, status: { in: [RunStatus.PENDING, RunStatus.RUNNING] } },
        data: { status: RunStatus.PAUSED },
      });
      return tx.campaign.update({
        where: { id },
        data: { status: CampaignStatus.PAUSED },
      });
    });
  }

  async cancel(tenantId: string, id: string): Promise<Campaign> {
    const campaign = await this.getRaw(tenantId, id);
    this.assertTransition(campaign.status, CampaignStatus.CANCELLED);

    return this.prisma.$transaction(async (tx) => {
      await tx.job.updateMany({
        where: { run: { campaignId: id }, status: { in: ['PENDING', 'FAILED'] } },
        data: { status: 'CANCELLED' },
      });
      await tx.run.updateMany({
        where: {
          campaignId: id,
          status: { in: [RunStatus.PENDING, RunStatus.RUNNING, RunStatus.PAUSED] },
        },
        data: { status: RunStatus.CANCELLED, finishedAt: new Date() },
      });
      return tx.campaign.update({
        where: { id },
        data: { status: CampaignStatus.CANCELLED },
      });
    });
  }

  // ─────────────────────────────── purga ───────────────────────────────

  /**
   * Borra en la app destino todo lo que generó esta campaña.
   *
   * Es la operación más delicada del sistema, así que exige tres cosas: nombre
   * exacto de la campaña, un `purge_token` de un solo uso emitido por la propia
   * app, y que la app solo borre entidades marcadas como sintéticas.
   */
  async purge(
    tenantId: string,
    id: string,
    dto: PurgeCampaignDto,
  ): Promise<{
    purged: Record<string, number>;
    dryRun: boolean;
    mirroredEntities: number;
  }> {
    const campaign = await this.getRaw(tenantId, id);

    if (dto.confirmName !== campaign.name) {
      throw new BadRequestException(
        `Para confirmar hay que escribir el nombre exacto de la campaña ("${campaign.name}").`,
      );
    }
    if (campaign.status === CampaignStatus.RUNNING) {
      throw new ConflictException('Pausá o cancelá la campaña antes de purgar.');
    }

    const app = await this.prisma.targetApp.findUniqueOrThrow({
      where: { id: campaign.targetAppId },
    });
    const runs = await this.prisma.run.findMany({
      where: { campaignId: id },
      select: { id: true },
    });
    if (runs.length === 0) {
      return { purged: {}, dryRun: dto.dryRun ?? false, mirroredEntities: 0 };
    }

    const client = await this.targetApps.clientFor(app);
    const dryRun = dto.dryRun ?? false;
    const totals: Record<string, number> = {};

    for (const run of runs) {
      // El token de purga es de un solo uso: hay que pedir uno por ejecución.
      const state = await client.state();
      if (!state.purge_token) {
        throw new ConflictException(
          `La app "${app.slug}" no emitió purge_token en GET /state. ` +
            'Sin ese nonce no se puede purgar: revisá su implementación de USI.',
        );
      }

      try {
        const result = await client.purge({
          purge_token: state.purge_token,
          scope: 'simulation',
          simulation_id: run.id,
          dry_run: dryRun,
        });

        for (const [kind, count] of Object.entries(result.purged ?? {})) {
          totals[kind] = (totals[kind] ?? 0) + Number(count ?? 0);
        }

        if (!dryRun) {
          await this.prisma.syntheticEntity.updateMany({
            where: { runId: run.id, purgedAt: null },
            data: { purgedAt: new Date() },
          });
        }

        await this.audit.record({
          tenantId,
          runId: run.id,
          actor: 'campaigns.purge',
          operation: 'purge',
          result: dryRun ? AuditResult.DRY_RUN : AuditResult.OK,
          targetAppId: app.id,
          detail: result.purged as unknown as Prisma.InputJsonValue,
        });
      } catch (err) {
        const message = err instanceof UsiError ? err.message : String(err);
        await this.audit.record({
          tenantId,
          runId: run.id,
          actor: 'campaigns.purge',
          operation: 'purge',
          result: AuditResult.ERROR,
          targetAppId: app.id,
          message,
        });
        throw new ConflictException(`Falló la purga de la ejecución ${run.id}: ${message}`);
      }
    }

    const mirroredEntities = await this.prisma.syntheticEntity.count({
      where: { run: { campaignId: id }, purgedAt: null },
    });

    return { purged: totals, dryRun, mirroredEntities };
  }

  // ─────────────────────────────── helpers ───────────────────────────────

  private async getRaw(tenantId: string, id: string): Promise<Campaign> {
    const campaign = await this.prisma.campaign.findFirst({ where: { id, tenantId } });
    if (!campaign) throw new NotFoundException('No existe esa campaña.');
    return campaign;
  }

  private assertTransition(from: CampaignStatus, to: CampaignStatus): void {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new ConflictException(
        `No se puede pasar de ${from} a ${to}. Transiciones válidas desde ${from}: ` +
          `${ALLOWED_TRANSITIONS[from].join(', ') || 'ninguna (estado final)'}.`,
      );
    }
  }
}
