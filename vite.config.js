import { defineConfig } from 'vite';

// Build della LIBRERIA (pacchetto npm): `vite build` -> dist/index.js (ESM).
// three e postprocessing restano ESTERNI (peer dependencies): non finiscono nel bundle, li
// fornisce l'app che consuma il pacchetto. Per il dev/build della DEMO vedi vite.config.demo.js.
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.js',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: ['three', 'postprocessing'],
    },
    sourcemap: true,
    target: 'es2020',
    emptyOutDir: true,
  },
});
