import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import { MemberRole } from '@prisma/client';
import type { RequestPrincipal } from './auth.types';

export const PUBLIC_KEY = 'susp:public';
export const ROLE_KEY = 'susp:role';

/** Marca una ruta como abierta (health, login). */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_KEY, true);

/** Rol mínimo requerido. Sin este decorador, alcanza con estar autenticado. */
export const RequireRole = (role: MemberRole): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLE_KEY, role);

/** Inyecta la identidad ya resuelta en el handler. */
export const Principal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestPrincipal => {
    const request = ctx.switchToHttp().getRequest<Request>();
    if (!request.principal) {
      // No debería pasar: el guard corre antes. Si pasa, es un bug de cableado
      // y es mejor romper fuerte que operar sin identidad.
      throw new Error(
        'Se pidió el Principal en una ruta sin AuthGuard. Revisar el cableado del módulo.',
      );
    }
    return request.principal;
  },
);
