import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';

import { SuspConfigModule } from './config/config.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { AuthGuard } from './common/auth/auth.guard';
import { RateLimitGuard } from './common/http/rate-limit.guard';

import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { TenantsModule } from './tenants/tenants.module';
import { TargetAppsModule } from './target-apps/target-apps.module';
import { CatalogModule } from './catalog/catalog.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { RunsModule } from './runs/runs.module';
import { AgentsModule } from './agents/agents.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { LlmModule } from './llm/llm.module';

@Module({
  imports: [
    // Primero el .env, después la configuración validada: el resto de los
    // módulos globales (Prisma, Crypto) dependen de ella.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    SuspConfigModule,
    PrismaModule,
    CryptoModule,
    AuthModule,
    AuditModule,
    HealthModule,
    TenantsModule,
    TargetAppsModule,
    CatalogModule,
    CampaignsModule,
    RunsModule,
    LlmModule,
    AgentsModule,
    SchedulerModule,
  ],
  providers: [
    // El orden importa: primero se identifica quién es, después se le aplica su cupo.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
