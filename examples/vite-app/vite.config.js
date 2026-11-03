import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    // usertax attributes bytes to modules and packages through source maps and maps output
    // files to entries through the manifest. `hidden` keeps the maps out of the shipped files.
    sourcemap: 'hidden',
    manifest: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        about: resolve(import.meta.dirname, 'about/index.html'),
      },
    },
  },
});
