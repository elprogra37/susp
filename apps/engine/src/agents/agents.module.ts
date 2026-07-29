import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { AgentFactoryService } from './agent-factory.service';
import { BehaviorService } from './behavior.service';
import { MemoryService } from './memory.service';
import { AgentsController } from './agents.controller';

@Module({
  imports: [LlmModule],
  controllers: [AgentsController],
  providers: [AgentFactoryService, MemoryService, BehaviorService],
  exports: [AgentFactoryService, MemoryService, BehaviorService],
})
export class AgentsModule {}
