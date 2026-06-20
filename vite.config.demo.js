import { defineConfig } from 'vite';

// Dev server + build della DEMO (examples/). La demo importa il toolkit dalla sorgente
// (../src/index.js), quindi gira senza dover prima buildare la libreria.
//   npm run dev         -> dev server della demo
//   npm run build:demo  -> demo statica in demo-dist/ (deploy su GitHub Pages)
export default defineConfig({
  root: 'examples',
  base: './', // path relativi: la demo funziona anche servita da una sottocartella
  server: {
    // La demo importa ../src/*: consenti a Vite di servire file fuori dalla root examples/.
    fs: { allow: ['..'] },
  },
  build: {
    outDir: '../demo-dist',
    emptyOutDir: true,
  },
});
