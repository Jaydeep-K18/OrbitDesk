import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  clean: true,
  // Bundle workspace packages (they ship TypeScript source); keep real npm deps external.
  noExternal: [/^@focusguard\//],
});
