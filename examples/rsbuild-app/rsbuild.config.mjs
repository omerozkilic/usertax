import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  // One HTML page per entry: dist/index.html and dist/about.html.
  source: {
    entry: {
      index: './src/index.jsx',
      about: './src/about.jsx',
    },
  },
  html: {
    title: 'usertax example — Rsbuild',
  },
  output: {
    // usertax attributes bytes to modules and packages through source maps. `hidden-source-map`
    // writes the maps next to the files without referencing them from the shipped code.
    sourceMap: { js: 'hidden-source-map' },
  },
});
