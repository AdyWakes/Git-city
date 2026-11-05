import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The viewer is a static bundle. `base: './'` keeps every asset path relative so the
// same build works from the CLI's local server and from a GitHub Pages sub-path.
export default defineConfig({
  root: fileURLToPath(new URL('./viewer', import.meta.url)),
  base: './',
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL('./dist/viewer', import.meta.url)),
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
  server: { fs: { allow: ['..'] } },
});
