/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: Number(process.env.FG_WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      // Same-origin in dev too (ADR-019): the SPA calls /api, Vite forwards to the API.
      '/api': process.env.FG_API_PROXY ?? 'http://localhost:4000',
      '/socket.io': { target: process.env.FG_API_PROXY ?? 'http://localhost:4000', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    css: false,
  },
});
