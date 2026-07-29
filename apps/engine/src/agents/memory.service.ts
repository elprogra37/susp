import { Injectable } from '@nestjs/common';
import { AgentMemory, MemoryKind } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

export interface RememberInput {
  agentId: string;
  kind?: MemoryKind;
  content: string;
  /** Con quién o sobre qué: un id externo, un handle, un tema. */
  subject?: string | null;
  tags?: string[];
  /** Importancia inicial 0..1. Lo trivial nace débil y se olvida antes. */
  strength?: number;
  occurredAt?: Date;
}

export interface RecallQuery {
  agentId: string;
  kind?: MemoryKind;
  subject?: string;
  tags?: string[];
  limit?: number;
  /** Descarta lo que ya se desvaneció por debajo de este umbral. */
  minStrength?: number;
}

/**
 * Memoria del agente.
 *
 * Dos tipos: **episódica** (qué hizo y con quién) y **semántica** (lo que sabe o
 * concluyó). Ambas decaen con el tiempo, y recordar algo lo refuerza.
 *
 * El decaimiento importa para que la simulación se sostenga: sin él, un agente
 * con mil recuerdos los pondera todos igual y termina comportándose como una
 * lista de la compra en vez de como alguien con historia. Con decaimiento, lo
 * reciente y lo repetido pesan más, que es como funciona una persona.
 */
@Injectable()
export class MemoryService {
  /**
   * Vida media en horas: a las 72 h un recuerdo no reforzado vale la mitad.
   * Es corto a propósito — las campañas duran horas o días, no meses.
   */
  private static readonly HALF_LIFE_HOURS = 72;

  /** Cuánto refuerza cada evocación. */
  private static readonly RECALL_BOOST = 0.15;

  constructor(private readonly prisma: PrismaService) {}

  async remember(input: RememberInput): Promise<AgentMemory> {
    return this.prisma.agentMemory.create({
      data: {
        agentId: input.agentId,
        kind: input.kind ?? MemoryKind.EPISODIC,
        content: input.content,
        subject: input.subject ?? null,
        tags: input.tags ?? [],
        strength: clamp(input.strength ?? 1),
        occurredAt: input.occurredAt ?? new Date(),
      },
    });
  }

  /**
   * Recupera los recuerdos más relevantes, ordenados por fuerza **efectiva**
   * (la almacenada, decaída por el tiempo transcurrido), y los refuerza.
   *
   * El decaimiento se calcula al leer en vez de con un job que recorra la tabla:
   * es exacto, no necesita mantenimiento y no compite por la base con el
   * scheduler.
   */
  async recall(query: RecallQuery): Promise<Array<AgentMemory & { effectiveStrength: number }>> {
    const limit = query.limit ?? 10;
    const minStrength = query.minStrength ?? 0.05;

    // Se traen más de los pedidos porque el orden final depende del decaimiento,
    // que Postgres no está calculando: el corte real se hace acá.
    const candidates = await this.prisma.agentMemory.findMany({
      where: {
        agentId: query.agentId,
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.subject ? { subject: query.subject } : {}),
        ...(query.tags?.length ? { tags: { hasSome: query.tags } } : {}),
      },
      orderBy: [{ strength: 'desc' }, { occurredAt: 'desc' }],
      take: limit * 5,
    });

    const now = Date.now();
    const scored = candidates
      .map((memory) => ({
        ...memory,
        effectiveStrength: this.decay(memory.strength, memory.occurredAt, now),
      }))
      .filter((memory) => memory.effectiveStrength >= minStrength)
      .sort((a, b) => b.effectiveStrength - a.effectiveStrength)
      .slice(0, limit);

    if (scored.length > 0) {
      await this.reinforce(scored.map((memory) => memory.id));
    }

    return scored;
  }

  /** Refuerza los recuerdos evocados: lo que se usa, se retiene. */
  private async reinforce(ids: string[]): Promise<void> {
    await this.prisma.agentMemory.updateMany({
      where: { id: { in: ids } },
      data: {
        strength: { increment: MemoryService.RECALL_BOOST },
        recallCount: { increment: 1 },
        lastRecalled: new Date(),
      },
    });

    // El incremento puede pasarse de 1: se recorta en una segunda pasada, que
    // es más simple que un CASE WHEN y corre sobre pocas filas.
    await this.prisma.agentMemory.updateMany({
      where: { id: { in: ids }, strength: { gt: 1 } },
      data: { strength: 1 },
    });
  }

  /** Decaimiento exponencial con vida media fija. */
  private decay(strength: number, occurredAt: Date, now: number): number {
    const hours = (now - occurredAt.getTime()) / 3_600_000;
    if (hours <= 0) return strength;
    return strength * Math.pow(0.5, hours / MemoryService.HALF_LIFE_HOURS);
  }

  /** ¿El agente ya interactuó con este sujeto? Evita repetir la misma acción. */
  async hasInteractedWith(agentId: string, subject: string): Promise<boolean> {
    const count = await this.prisma.agentMemory.count({
      where: { agentId, subject },
    });
    return count > 0;
  }

  /** Resumen en texto de lo que el agente recuerda, para armar un prompt. */
  async summarize(agentId: string, limit = 6): Promise<string> {
    const memories = await this.recall({ agentId, limit });
    if (memories.length === 0) return 'Sin recuerdos previos.';
    return memories
      .map((memory) => `- ${memory.content}`)
      .join('\n');
  }

  /**
   * Borra los recuerdos ya desvanecidos. Es mantenimiento opcional: la
   * recuperación ya los filtra, pero en campañas largas conviene no dejar
   * crecer la tabla sin límite.
   */
  async forgetFaded(agentId: string, threshold = 0.02): Promise<number> {
    const cutoffHours = MemoryService.HALF_LIFE_HOURS * Math.log2(1 / threshold);
    const cutoff = new Date(Date.now() - cutoffHours * 3_600_000);

    const result = await this.prisma.agentMemory.deleteMany({
      where: { agentId, occurredAt: { lt: cutoff }, recallCount: 0 },
    });
    return result.count;
  }
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
