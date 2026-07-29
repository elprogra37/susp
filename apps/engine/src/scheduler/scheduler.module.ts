import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { TargetAppsModule } from '../target-apps/target-apps.module';
import { ExecutorService } from './executor.service';
import { JobQueueService } from './job-queue.service';
import { PlannerService } from './planner.service';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [AgentsModule, TargetAppsModule],
  providers: [JobQueueService, PlannerService, ExecutorService, SchedulerService],
  exports: [SchedulerService, JobQueueService],
})
export class SchedulerModule {}
