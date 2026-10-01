// Serializes the OpenAPI registry (populated by route modules) to docs/api/openapi.json.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateOpenApiDocument } from '@focusguard/contracts/openapi';
import '../src/modules/health/health.routes.js';
import pkg from '../package.json' with { type: 'json' };

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/api');
mkdirSync(outDir, { recursive: true });
const doc = generateOpenApiDocument(pkg.version);
writeFileSync(path.join(outDir, 'openapi.json'), JSON.stringify(doc, null, 2) + '\n');
console.log(`OpenAPI written to ${path.join(outDir, 'openapi.json')}`);
