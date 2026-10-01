import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

/**
 * Single registry every API module registers its routes into. The API build
 * step serializes it to docs/api/openapi.json.
 */
export const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

export function generateOpenApiDocument(version: string) {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'FocusGuard API',
      version,
      description: 'REST API for the FocusGuard dashboard, Chrome extension and network collector.',
    },
    servers: [{ url: '/api/v1' }],
  });
}
