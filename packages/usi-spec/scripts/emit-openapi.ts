/** Vuelca el documento OpenAPI a `openapi.json`, en la raíz del paquete. */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openapi } from '../src/openapi.ts';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'openapi.json');

writeFileSync(target, `${JSON.stringify(openapi, null, 2)}\n`, 'utf8');
console.log(`OpenAPI ${openapi.info.version} escrito en ${target}`);
console.log(`  ${Object.keys(openapi.paths).length} rutas · ${Object.keys(openapi.components.schemas).length} esquemas`);
