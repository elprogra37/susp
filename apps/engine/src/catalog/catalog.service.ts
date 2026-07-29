import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Persona, Prisma, Scenario, Vertical } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { USI_CAPABILITIES } from '../usi/usi.types';
import {
  CreatePersonaDto,
  CreateScenarioDto,
  UpdatePersonaDto,
  UpdateScenarioDto,
} from './catalog.dto';

/** Rasgos por defecto: el punto medio, para que falte un rasgo no rompa nada. */
const DEFAULT_TRAITS = {
  openness: 0.5,
  conscientiousness: 0.5,
  extraversion: 0.5,
  agreeableness: 0.5,
  neuroticism: 0.5,
  chattiness: 0.5,
  riskTolerance: 0.3,
  formality: 0.5,
} as const;

export type Traits = Record<keyof typeof DEFAULT_TRAITS, number>;

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────────── personas ─────────────────────────────

  async listPersonas(tenantId: string, limit: number, offset: number, vertical?: Vertical) {
    const where: Prisma.PersonaWhereInput = { tenantId, ...(vertical ? { vertical } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.persona.findMany({
        where,
        orderBy: [{ builtin: 'desc' }, { name: 'asc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.persona.count({ where }),
    ]);
    return { items, total };
  }

  async getPersona(tenantId: string, id: string): Promise<Persona> {
    const persona = await this.prisma.persona.findFirst({ where: { id, tenantId } });
    if (!persona) throw new NotFoundException('No existe esa persona.');
    return persona;
  }

  createPersona(tenantId: string, dto: CreatePersonaDto): Promise<Persona> {
    return this.prisma.persona.create({
      data: {
        tenantId,
        name: dto.name,
        slug: dto.slug,
        vertical: dto.vertical,
        description: dto.description ?? null,
        traits: this.normalizeTraits(dto.traits) as unknown as Prisma.InputJsonValue,
        interests: dto.interests ?? [],
        locales: dto.locales ?? ['es-AR'],
        goals: (dto.goals ?? []) as unknown as Prisma.InputJsonValue,
        schedule: (dto.schedule ?? {}) as unknown as Prisma.InputJsonValue,
        rules: (dto.rules ?? []) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async updatePersona(
    tenantId: string,
    id: string,
    dto: UpdatePersonaDto,
  ): Promise<Persona> {
    const existing = await this.getPersona(tenantId, id);
    if (existing.builtin) {
      throw new BadRequestException(
        'Las personas incorporadas no se editan. Duplicala y modificá la copia.',
      );
    }

    const data: Prisma.PersonaUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.vertical !== undefined) data.vertical = dto.vertical;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.traits !== undefined) {
      data.traits = this.normalizeTraits(dto.traits) as unknown as Prisma.InputJsonValue;
    }
    if (dto.interests !== undefined) data.interests = dto.interests;
    if (dto.locales !== undefined) data.locales = dto.locales;
    if (dto.goals !== undefined) data.goals = dto.goals as unknown as Prisma.InputJsonValue;
    if (dto.schedule !== undefined) {
      data.schedule = dto.schedule as unknown as Prisma.InputJsonValue;
    }
    if (dto.rules !== undefined) data.rules = dto.rules as unknown as Prisma.InputJsonValue;

    return this.prisma.persona.update({ where: { id }, data });
  }

  async removePersona(tenantId: string, id: string): Promise<void> {
    const persona = await this.getPersona(tenantId, id);
    if (persona.builtin) {
      throw new BadRequestException('Las personas incorporadas no se borran.');
    }
    await this.prisma.persona.delete({ where: { id } });
  }

  // ──────────────────────────── escenarios ────────────────────────────

  async listScenarios(tenantId: string, limit: number, offset: number, vertical?: Vertical) {
    const where: Prisma.ScenarioWhereInput = { tenantId, ...(vertical ? { vertical } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.scenario.findMany({
        where,
        orderBy: [{ builtin: 'desc' }, { name: 'asc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.scenario.count({ where }),
    ]);
    return { items, total };
  }

  async getScenario(tenantId: string, id: string): Promise<Scenario> {
    const scenario = await this.prisma.scenario.findFirst({ where: { id, tenantId } });
    if (!scenario) throw new NotFoundException('No existe ese escenario.');
    return scenario;
  }

  createScenario(tenantId: string, dto: CreateScenarioDto): Promise<Scenario> {
    this.assertActionMix(dto.actionMix);
    return this.prisma.scenario.create({
      data: {
        tenantId,
        name: dto.name,
        slug: dto.slug,
        vertical: dto.vertical,
        description: dto.description ?? null,
        actionMix: (dto.actionMix ?? {}) as unknown as Prisma.InputJsonValue,
        intensity: dto.intensity ?? 1,
        seed: (dto.seed ?? {}) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async updateScenario(
    tenantId: string,
    id: string,
    dto: UpdateScenarioDto,
  ): Promise<Scenario> {
    const existing = await this.getScenario(tenantId, id);
    if (existing.builtin) {
      throw new BadRequestException(
        'Los escenarios incorporados no se editan. Duplicalo y modificá la copia.',
      );
    }
    this.assertActionMix(dto.actionMix);

    const data: Prisma.ScenarioUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.vertical !== undefined) data.vertical = dto.vertical;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.actionMix !== undefined) {
      data.actionMix = dto.actionMix as unknown as Prisma.InputJsonValue;
    }
    if (dto.intensity !== undefined) data.intensity = dto.intensity;
    if (dto.seed !== undefined) data.seed = dto.seed as unknown as Prisma.InputJsonValue;

    return this.prisma.scenario.update({ where: { id }, data });
  }

  async removeScenario(tenantId: string, id: string): Promise<void> {
    const scenario = await this.getScenario(tenantId, id);
    if (scenario.builtin) {
      throw new BadRequestException('Los escenarios incorporados no se borran.');
    }
    await this.prisma.scenario.delete({ where: { id } });
  }

  // ───────────────────────────── helpers ─────────────────────────────

  /** Completa los rasgos faltantes y recorta a 0..1. */
  normalizeTraits(input: Partial<Traits> | null | undefined): Traits {
    const result = { ...DEFAULT_TRAITS } as Traits;
    for (const key of Object.keys(DEFAULT_TRAITS) as Array<keyof Traits>) {
      const value = input?.[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        result[key] = Math.min(1, Math.max(0, value));
      }
    }
    return result;
  }

  /**
   * Un escenario solo puede pedir operaciones que existan en USI. Detectarlo acá
   * evita encolar trabajos que fallarían con `capability_not_supported`.
   */
  private assertActionMix(mix: Record<string, number> | undefined): void {
    if (!mix) return;
    const valid = new Set<string>(USI_CAPABILITIES);
    for (const [operation, weight] of Object.entries(mix)) {
      if (!valid.has(operation)) {
        throw new BadRequestException(
          `"${operation}" no es una operación USI válida. Opciones: ${[...valid].join(', ')}.`,
        );
      }
      if (typeof weight !== 'number' || weight < 0 || !Number.isFinite(weight)) {
        throw new BadRequestException(
          `El peso de "${operation}" debe ser un número mayor o igual a cero.`,
        );
      }
    }
  }
}
