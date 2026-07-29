import { MemberRole } from '@prisma/client';

/** Identidad resuelta por los guards y adosada a la petición. */
export interface RequestPrincipal {
  readonly tenantId: string;
  readonly role: MemberRole;
  /** De dónde vino la credencial, para la auditoría. */
  readonly kind: 'api-key' | 'jwt';
  /** Id de la ApiKey o del Member, según el caso. */
  readonly subjectId: string;
  readonly label: string;
}

declare module 'express' {
  interface Request {
    principal?: RequestPrincipal;
  }
}

/** Orden de privilegio. OWNER incluye lo de OPERATOR, y este lo de VIEWER. */
export const ROLE_RANK: Record<MemberRole, number> = {
  VIEWER: 0,
  OPERATOR: 1,
  OWNER: 2,
};

export function roleSatisfies(actual: MemberRole, required: MemberRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}
