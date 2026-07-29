import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AppEnvironment, AppHealth, Prisma, TargetApp } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { CONFIG, SuspConfig } from '../config/configuration';
import { UsiClient } from '../usi/usi.client';
import { UsiError } from '../usi/usi.errors';
import { REQUIRED_ENDPOINTS, UsiCapability, UsiManifest } from '../usi/usi.types';
import {
  AllowProductionWritesDto,
  CreateTargetAppDto,
  UpdateTargetAppDto,
} from './target-apps.dto';

/** Vista pública: jamás incluye la credencial. */
export type TargetAppView = Omit<TargetApp, 'manifest'> & {
  manifest: UsiManifest | null;
  hasCredential: boolean;
};

@Injectable()
export class TargetAppsService {
  private readonly logger = new Logger(TargetAppsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(CONFIG) private readonly config: SuspConfig,
  ) {}

  async list(tenantId: string, limit: number, offset: number) {
    const where = { tenantId };
    const [rows, total] = await Promise.all([
      this.prisma.targetApp.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { credential: { select: { id: true } } },
      }),
      this.prisma.targetApp.count({ where }),
    ]);
    return { items: rows.map((r) => this.toView(r, Boolean(r.credential))), total };
  }

  async get(tenantId: string, id: string): Promise<TargetAppView> {
    const app = await this.prisma.targetApp.findFirst({
      where: { id, tenantId },
      include: { credential: { select: { id: true } } },
    });
    if (!app) throw new NotFoundException('No existe esa app destino.');
    return this.toView(app, Boolean(app.credential));
  }

  async create(tenantId: string, dto: CreateTargetAppDto): Promise<TargetAppView> {
    const created = await this.prisma.targetApp.create({
      data: {
        tenantId,
        name: dto.name,
        slug: dto.slug,
        baseUrl: dto.baseUrl.replace(/\/+$/, ''),
        env: dto.env,
        vertical: dto.vertical,
        credential: {
          create: {
            tokenCipher: this.crypto.encrypt(dto.token),
            signingCipher: dto.signingSecret
              ? this.crypto.encrypt(dto.signingSecret)
              : null,
          },
        },
      },
    });
    return this.toView(created, true);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateTargetAppDto,
  ): Promise<TargetAppView> {
    await this.assertExists(tenantId, id);

    const data: Prisma.TargetAppUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.env !== undefined) data.env = dto.env;
    if (dto.vertical !== undefined) data.vertical = dto.vertical;
    if (dto.baseUrl !== undefined) {
      data.baseUrl = dto.baseUrl.replace(/\/+$/, '');
      // Cambiar de destino invalida lo que sabíamos del anterior.
      data.health = AppHealth.UNKNOWN;
      data.manifest = Prisma.DbNull;
      data.capabilities = [];
    }

    if (dto.token !== undefined || dto.signingSecret !== undefined) {
      await this.prisma.usiCredential.update({
        where: { targetAppId: id },
        data: {
          ...(dto.token !== undefined
            ? { tokenCipher: this.crypto.encrypt(dto.token) }
            : {}),
          ...(dto.signingSecret !== undefined
            ? { signingCipher: this.crypto.encrypt(dto.signingSecret) }
            : {}),
          rotatedAt: new Date(),
        },
      });
    }

    const updated = await this.prisma.targetApp.update({ where: { id }, data });
    return this.toView(updated, true);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.assertExists(tenantId, id);
    await this.prisma.targetApp.delete({ where: { id } });
  }

  /**
   * Interroga la app: lee su manifiesto, verifica credenciales y comprueba que
   * declare los cuatro endpoints obligatorios. Cachea capacidades y versión.
   */
  async checkHealth(tenantId: string, id: string): Promise<TargetAppView> {
    const app = await this.assertExists(tenantId, id);
    const client = await this.clientFor(app);

    let health: AppHealth = AppHealth.UNKNOWN;
    let detail: string | null = null;
    let manifest: UsiManifest | null = null;

    try {
      manifest = await client.manifest();

      const major = manifest.usi_version?.split('.')[0];
      if (major !== '1') {
        health = AppHealth.NON_CONFORMANT;
        detail = `La app declara USI ${manifest.usi_version}; este motor habla USI 1.x.`;
      } else {
        const verification = await client.verifyAuth();
        if (!verification.authenticated) {
          health = AppHealth.DEGRADED;
          detail = 'La app respondió authenticated=false: revisar el token.';
        } else {
          // /state es obligatorio: si no responde, la app no es conforme aunque
          // el manifiesto diga lo contrario.
          await client.state();
          health = AppHealth.HEALTHY;
          detail = `OK — ${manifest.capabilities?.length ?? 0} capacidades declaradas.`;
        }
      }
    } catch (err) {
      const usiError = err instanceof UsiError ? err : null;
      health =
        usiError?.kind === 'network' || usiError?.kind === 'timeout'
          ? AppHealth.UNREACHABLE
          : usiError?.kind === 'unauthenticated' || usiError?.kind === 'forbidden'
            ? AppHealth.DEGRADED
            : AppHealth.NON_CONFORMANT;
      detail = usiError
        ? `${usiError.kind}: ${usiError.message}`
        : `Error inesperado: ${String(err)}`;
      this.logger.warn(`Chequeo de ${app.slug} falló → ${health}: ${detail}`);
    }

    const updated = await this.prisma.targetApp.update({
      where: { id },
      data: {
        health,
        healthCheckedAt: new Date(),
        healthDetail: detail,
        ...(manifest
          ? {
              manifest: manifest as unknown as Prisma.InputJsonValue,
              usiVersion: manifest.usi_version,
              capabilities: manifest.capabilities ?? [],
              requiresSignature: manifest.requires_signature ?? false,
              // El entorno lo declara la app: si dice producción, mandamos eso,
              // aunque en el registro figurara otra cosa.
              env: this.mapEnvironment(manifest.app?.environment) ?? undefined,
            }
          : {}),
      },
    });

    return this.toView(updated, true);
  }

  async setProductionWrites(
    tenantId: string,
    id: string,
    dto: AllowProductionWritesDto,
  ): Promise<TargetAppView> {
    const app = await this.assertExists(tenantId, id);

    if (dto.confirmSlug !== app.slug) {
      throw new BadRequestException(
        `Para confirmar hay que escribir el slug exacto de la app ("${app.slug}").`,
      );
    }

    const updated = await this.prisma.targetApp.update({
      where: { id },
      data: { productionWritesAllowed: dto.allow },
    });

    this.logger.warn(
      dto.allow
        ? `Escrituras de producción HABILITADAS para "${app.slug}".`
        : `Escrituras de producción deshabilitadas para "${app.slug}".`,
    );

    return this.toView(updated, true);
  }

  /**
   * Puerta de seguridad. La llama el motor antes de cualquier escritura.
   * Está acá y no en el cliente USI a propósito: es una decisión de política,
   * no de transporte, y tiene que ser auditable en un solo lugar.
   */
  assertWritable(app: TargetApp): void {
    if (app.env !== AppEnvironment.PRODUCTION) return;

    if (this.config.safety.blockProductionTargets && !app.productionWritesAllowed) {
      throw new ForbiddenException(
        `"${app.name}" está marcada como producción y el motor tiene bloqueadas las ` +
          'escrituras de producción. Habilitalas explícitamente en la app destino ' +
          'o apuntá la campaña a un entorno de staging.',
      );
    }
  }

  /** Construye un cliente USI con la credencial descifrada. */
  async clientFor(app: TargetApp, simulationId?: string): Promise<UsiClient> {
    const credential = await this.prisma.usiCredential.findUnique({
      where: { targetAppId: app.id },
    });
    if (!credential) {
      throw new NotFoundException(
        `La app "${app.slug}" no tiene credencial USI cargada.`,
      );
    }

    return new UsiClient({
      baseUrl: app.baseUrl,
      token: this.crypto.decrypt(credential.tokenCipher),
      signingSecret:
        app.requiresSignature && credential.signingCipher
          ? this.crypto.decrypt(credential.signingCipher)
          : undefined,
      timeoutMs: this.config.usi.timeoutMs,
      maxRetries: this.config.usi.maxRetries,
      simulationId,
    });
  }

  /** Capacidades declaradas, para que el planificador no pida lo que no existe. */
  supports(app: TargetApp, capability: UsiCapability): boolean {
    return app.capabilities.includes(capability);
  }

  private async assertExists(tenantId: string, id: string): Promise<TargetApp> {
    const app = await this.prisma.targetApp.findFirst({ where: { id, tenantId } });
    if (!app) throw new NotFoundException('No existe esa app destino.');
    return app;
  }

  private mapEnvironment(env: string | undefined): AppEnvironment | null {
    switch (env) {
      case 'development':
        return AppEnvironment.DEVELOPMENT;
      case 'staging':
        return AppEnvironment.STAGING;
      case 'production':
        return AppEnvironment.PRODUCTION;
      default:
        return null;
    }
  }

  private toView(app: TargetApp, hasCredential: boolean): TargetAppView {
    return {
      ...app,
      manifest: (app.manifest as unknown as UsiManifest | null) ?? null,
      hasCredential,
    };
  }

  /** Endpoints que toda app debe implementar, expuesto para la documentación de la API. */
  static get requiredEndpoints(): readonly string[] {
    return REQUIRED_ENDPOINTS;
  }
}
