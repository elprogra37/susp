import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateCampaignDto {
  @IsString() @MinLength(2) @MaxLength(120)
  name!: string;

  @IsString()
  targetAppId!: string;

  @IsOptional() @IsString()
  scenarioId?: string;

  /** Cuántos agentes sintéticos poblarán la app. */
  @IsInt() @Min(1) @Max(5000)
  agentCount!: number;

  /** Personas a mezclar. Vacío = se reparten todas las del vertical de la app. */
  @IsOptional() @Type(() => String) @IsString({ each: true })
  personaIds?: string[];

  @IsOptional() @IsDateString()
  startsAt?: string;

  @IsOptional() @IsDateString()
  endsAt?: string;

  /** Calcula el plan completo sin ejecutar una sola escritura contra la app. */
  @IsOptional() @IsBoolean()
  dryRun?: boolean;

  /** 1 = tiempo real; 60 = una hora simulada por minuto real. */
  @IsOptional() @Type(() => Number) @Min(0.1) @Max(3600)
  timeScale?: number;

  @IsOptional() @IsObject()
  config?: Record<string, unknown>;
}

export class UpdateCampaignDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() scenarioId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(5000) agentCount?: number;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsBoolean() dryRun?: boolean;
  @IsOptional() @Type(() => Number) @Min(0.1) @Max(3600) timeScale?: number;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
}

export class StartCampaignDto {
  /**
   * Fuerza modo simulación para esta ejecución, sin tocar la campaña.
   * Es la forma recomendada de estrenar una integración.
   */
  @IsOptional() @IsBoolean()
  dryRun?: boolean;
}

export class PurgeCampaignDto {
  /** Confirmación explícita: hay que escribir el nombre exacto de la campaña. */
  @IsString()
  confirmName!: string;

  /** Solo cuenta lo que borraría, sin borrar. */
  @IsOptional() @IsBoolean()
  dryRun?: boolean;
}
