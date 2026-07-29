import { CryptoService } from './crypto.service';
import { SuspConfig } from '../../config/configuration';

const config = {
  encryptionKey: 'clave-de-prueba-suficientemente-larga-1234567890',
} as SuspConfig;

describe('CryptoService', () => {
  const crypto = new CryptoService(config);

  describe('cifrado de credenciales', () => {
    it('descifra lo que cifró', () => {
      const secret = 'token-usi-super-secreto';
      expect(crypto.decrypt(crypto.encrypt(secret))).toBe(secret);
    });

    it('produce un ciphertext distinto cada vez (IV aleatorio)', () => {
      const secret = 'mismo-token';
      expect(crypto.encrypt(secret)).not.toBe(crypto.encrypt(secret));
    });

    it('rechaza un ciphertext manipulado', () => {
      const encrypted = crypto.encrypt('token');
      const [iv, tag, data] = encrypted.split('.');
      // Se altera un byte del payload: GCM tiene que detectarlo.
      const tampered = `${iv}.${tag}.${data.slice(0, -2)}XY`;
      expect(() => crypto.decrypt(tampered)).toThrow();
    });

    it('rechaza un formato inválido', () => {
      expect(() => crypto.decrypt('no-tiene-tres-partes')).toThrow(
        /formato inválido/i,
      );
    });
  });

  describe('contraseñas', () => {
    it('verifica la contraseña correcta', () => {
      const hash = crypto.hashPassword('una-contraseña-larga');
      expect(crypto.verifyPassword('una-contraseña-larga', hash)).toBe(true);
    });

    it('rechaza la incorrecta', () => {
      const hash = crypto.hashPassword('una-contraseña-larga');
      expect(crypto.verifyPassword('otra-cosa', hash)).toBe(false);
    });

    it('usa una sal distinta por hash', () => {
      expect(crypto.hashPassword('igual')).not.toBe(crypto.hashPassword('igual'));
    });

    it('no explota con un hash corrupto', () => {
      expect(crypto.verifyPassword('x', 'basura')).toBe(false);
      expect(crypto.verifyPassword('x', 'scrypt$a$b$c$d$e')).toBe(false);
    });
  });

  describe('API keys', () => {
    it('genera una clave con prefijo reconocible y hash estable', () => {
      const { plaintext, prefix, hash } = crypto.generateApiKey();
      expect(plaintext.startsWith(`${prefix}_`)).toBe(true);
      expect(CryptoService.prefixOf(plaintext)).toBe(prefix);
      expect(crypto.hashApiKey(plaintext)).toBe(hash);
    });

    it('devuelve null si el formato del prefijo no es el esperado', () => {
      expect(CryptoService.prefixOf('clave-cualquiera')).toBeNull();
      expect(CryptoService.prefixOf('susp_XYZ_abc')).toBeNull();
    });

    it('compara en tiempo constante sin romperse con longitudes distintas', () => {
      expect(crypto.safeEqual('abc', 'abc')).toBe(true);
      expect(crypto.safeEqual('abc', 'abd')).toBe(false);
      expect(crypto.safeEqual('abc', 'abcd')).toBe(false);
    });
  });
});
