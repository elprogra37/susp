import { Module } from '@nestjs/common';
import { TargetAppsController } from './target-apps.controller';
import { TargetAppsService } from './target-apps.service';

@Module({
  controllers: [TargetAppsController],
  providers: [TargetAppsService],
  exports: [TargetAppsService],
})
export class TargetAppsModule {}
