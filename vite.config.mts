import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const RENDERER_DEV_PORT = 5173;
/** Warn earlier than Vite's 500 kB default so chunk growth is noticed in review. */
const CHUNK_SIZE_WARNING_KB = 400;

export default defineConfig({
  // Assets are served from `app://bundle/` in production, so absolute paths resolve.
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    port: RENDERER_DEV_PORT,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // The polyfill is emitted as an inline <script>, which a CSP without
    // 'unsafe-inline' rejects. Electron's Chromium supports modulepreload natively.
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: CHUNK_SIZE_WARNING_KB,
    rollupOptions: {
      output: {
        // Vite 8 bundles with Rolldown, whose chunking is declared as groups.
        advancedChunks: {
          groups: [
            { name: 'react-vendor', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'router-vendor', test: /node_modules[\\/]react-router/ },
            { name: 'validation-vendor', test: /node_modules[\\/]zod[\\/]/ },
          ],
        },
      },
    },
  },
});
