import { Inject, Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { CONFIG, SuspConfig } from '../../config/configuration';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const SALT = 'susp.usi.credential.v1';

/**
 * Cifrado de credenciales USI en reposo y hashing de API keys.
 *
 * Las credenciales de las apps destino son el activo más sensible del motor:
 * quien las tiene puede escribir en la app del cliente. Se guardan cifradas con
 * AES-256-GCM y nunca se devuelven por la API ni se escriben en logs.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(@Inject(CONFIG) config: SuspConfig) {
    // scrypt normaliza cualquier secreto de entrada a los 32 bytes que exige AES-256.
    this.key = scryptSync(config.encryptionKey, SALT, 32);
  }

  /** Devuelve `iv.tag.ciphertext`, todo en base64url. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      iv.toString('base64url'),
      tag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 3) {
      throw new Error('Credencial cifrada con formato inválido.');
    }
    const [ivB64, tagB64, dataB64] = parts;
    const decipher = createDecipheriv(
      ALGORITHM,
      this.key,
      Buffer.from(ivB64, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /**
   * Genera una API key nueva. El valor en claro se devuelve una única vez;
   * en la base solo queda el hash y el prefijo (para poder buscarla).
   */
  generateApiKey(): { plaintext: string; prefix: string; hash: string } {
    const prefix = `susp_${randomBytes(4).toString('hex')}`;
    const secret = randomBytes(24).toString('base64url');
    const plaintext = `${prefix}_${secret}`;
    return { plaintext, prefix, hash: this.hashApiKey(plaintext) };
  }

  hashApiKey(plaintext: string): string {
    return createHash('sha256').update(plaintext).digest('hex');
  }

  /**
   * Hash de contraseña con scrypt (RFC 7914). Se elige sobre bcrypt/argon2
   * porque viene en el runtime: nada de módulos nativos que compilar en Alpine.
   * Formato: `scrypt$N$r$p$saltB64$hashB64`.
   */
  hashPassword(plaintext: string): string {
    const salt = randomBytes(16);
    const N = 16384;
    const r = 8;
    const p = 1;
    const derived = scryptSync(plaintext, salt, 64, { N, r, p });
    return [
      'scrypt',
      N,
      r,
      p,
      salt.toString('base64'),
      derived.toString('base64'),
    ].join('$');
  }

  verifyPassword(plaintext: string, stored: string): boolean {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
    try {
      const expected = Buffer.from(hashB64, 'base64');
      const derived = scryptSync(plaintext, Buffer.from(saltB64, 'base64'), expected.length, {
        N: Number(nRaw),
        r: Number(rRaw),
        p: Number(pRaw),
      });
      return derived.length === expected.length && timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }

  /** Comparación en tiempo constante: no filtra información por temporización. */
  safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }

  /** Extrae el prefijo de una API key para poder localizarla sin exponerla. */
  static prefixOf(plaintext: string): string | null {
    const match = /^(susp_[0-9a-f]{8})_/.exec(plaintext);
    return match ? match[1] : null;
  }
}
