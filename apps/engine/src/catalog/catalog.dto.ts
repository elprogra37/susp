import { Vertical } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const SLUG = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

/** Rasgos de personalidad, todos normalizados a 0..1. */
export class TraitsDto {
  @IsOptional() @IsNumber() @Min(0) @Max(1) openness?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) conscientiousness?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) extraversion?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) agreeableness?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) neuroticism?: number;
  /** Cuánto escribe y con qué frecuencia. */
  @IsOptional() @IsNumber() @Min(0) @Max(1) chattiness?: number;
  /** Propensión a acciones poco habituales o de mayor impacto. */
  @IsOptional() @IsNumber() @Min(0) @Max(1) riskTolerance?: number;
  /** 0 = coloquial, 1 = formal. */
  @IsOptional() @IsNumber() @Min(0) @Max(1) formality?: number;
}

export class CreatePersonaDto {
  @IsString() @MinLength(2) @MaxLength(80)
  name!: string;

  @IsString()
  @Matches(SLUG, { message: 'El slug usa minúsculas, números y guiones.' })
  slug!: string;

  @IsOptional() @IsEnum(Vertical)
  vertical: Vertical = Vertical.OTHER;

  @IsOptional() @IsString() @MaxLength(500)
  description?: string;

  @ValidateNested()
  @Type(() => TraitsDto)
  traits!: TraitsDto;

  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(50)
  interests?: string[];

  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(10)
  locales?: string[];

  @IsOptional() @IsArray()
  goals?: unknown[];

  @IsOptional() @IsObject()
  schedule?: Record<string, unknown>;

  @IsOptional() @IsArray()
  rules?: unknown[];
}

export class UpdatePersonaDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsEnum(Vertical) vertical?: Vertical;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @ValidateNested() @Type(() => TraitsDto) traits?: TraitsDto;
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(50) interests?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(10) locales?: string[];
  @IsOptional() @IsArray() goals?: unknown[];
  @IsOptional() @IsObject() schedule?: Record<string, unknown>;
  @IsOptional() @IsArray() rules?: unknown[];
}

export class CreateScenarioDto {
  @IsString() @MinLength(2) @MaxLength(80)
  name!: string;

  @IsString()
  @Matches(SLUG, { message: 'El slug usa minúsculas, números y guiones.' })
  slug!: string;

  @IsOptional() @IsEnum(Vertical)
  vertical: Vertical = Vertical.OTHER;

  @IsOptional() @IsString() @MaxLength(500)
  description?: string;

  /** Peso relativo por operación USI: { "content.create": 3, "interactions.create": 6 } */
  @IsOptional() @IsObject()
  actionMix?: Record<string, number>;

  /** Acciones por agente y por hora, antes de la variación por personalidad. */
  @IsOptional() @IsNumber() @Min(0.01) @Max(1000)
  intensity?: number;

  /** Siembra inicial: { users: 20, contentPerUser: 3 } */
  @IsOptional() @IsObject()
  seed?: Record<string, unknown>;
}

export class UpdateScenarioDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsEnum(Vertical) vertical?: Vertical;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsObject() actionMix?: Record<string, number>;
  @IsOptional() @IsNumber() @Min(0.01) @Max(1000) intensity?: number;
  @IsOptional() @IsObject() seed?: Record<string, unknown>;
}
