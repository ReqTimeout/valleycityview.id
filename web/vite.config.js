import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Build LOKAL → bundle flat di runner/assets (disajikan server zero-dep).
// base /assets/ supaya URL bundle cocok dengan route /assets/* di http.mjs.
// Single file (tanpa code-splitting) supaya cukup app.js + app.css di-commit.
export default defineConfig({
  plugins: [svelte()],
  base: '/assets/',
  build: {
    outDir: '../runner/assets',
    emptyOutDir: false,
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: 'app.js',
        assetFileNames: 'app.css',
        inlineDynamicImports: true,
      },
    },
  },
});