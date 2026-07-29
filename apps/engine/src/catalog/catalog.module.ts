import { Module } from '@nestjs/common';
import { PersonasController, ScenariosController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  controllers: [PersonasController, ScenariosController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
