import { AppEnvironment, Vertical } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTargetAppDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/, {
    message: 'El slug usa minúsculas, números y guiones (2 a 50 caracteres).',
  })
  slug!: string;

  /** URL base de la API USI, por ejemplo https://mi-app.example/usi/v1 */
  @IsUrl({ require_tld: false, require_protocol: true })
  baseUrl!: string;

  @IsEnum(AppEnvironment)
  env!: AppEnvironment;

  @IsOptional()
  @IsEnum(Vertical)
  vertical: Vertical = Vertical.OTHER;

  /** Token bearer que la app espera. Se guarda cifrado y no se devuelve nunca. */
  @IsString()
  @MinLength(8)
  token!: string;

  /** Secreto HMAC, solo si la app declara `requires_signature`. */
  @IsOptional()
  @IsString()
  @MinLength(16)
  signingSecret?: string;
}

export class UpdateTargetAppDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  baseUrl?: string;

  @IsOptional()
  @IsEnum(AppEnvironment)
  env?: AppEnvironment;

  @IsOptional()
  @IsEnum(Vertical)
  vertical?: Vertical;

  @IsOptional()
  @IsString()
  @MinLength(8)
  token?: string;

  @IsOptional()
  @IsString()
  @MinLength(16)
  signingSecret?: string;
}

/**
 * Habilitar escrituras contra producción. Es deliberadamente incómodo: exige
 * escribir el slug de la app y una frase exacta, para que nadie lo active de
 * casualidad haciendo clic en el dashboard.
 */
export class AllowProductionWritesDto {
  @IsBoolean()
  allow!: boolean;

  @IsString()
  confirmSlug!: string;

  @IsString()
  @Matches(/^ENTIENDO EL RIESGO$/, {
    message: 'Para confirmar, el campo debe decir exactamente: ENTIENDO EL RIESGO',
  })
  confirmPhrase!: string;
}
