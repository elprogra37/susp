import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../common/prisma/prisma.service';
import { Public } from '../common/auth/auth.decorators';

@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: el proceso está vivo. No toca la base. */
  @Public()
  @Get()
  live(): { status: string; uptimeSeconds: number } {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  /** Readiness: además, la base responde. */
  @Public()
  @Get('ready')
  async ready(@Res() res: Response): Promise<void> {
    const database = await this.prisma.ping();
    const status = database ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
    res.status(status).json({
      status: database ? 'ready' : 'degraded',
      checks: { database },
    });
  }
}
