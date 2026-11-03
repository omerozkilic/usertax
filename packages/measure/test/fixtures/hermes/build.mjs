// Builds index.android.hbc(.map) from src/ the way React Native does: concatenate modules into
// a bundle, compile it with hermesc (whose map points into the bundle), then compose that map
// with the bundle's own map so it points to the original modules.
// Run from this directory: node build.mjs <path to hermesc>
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { decode, encode } = createRequire(import.meta.url)('@jridgewell/sourcemap-codec');
const modules = ['node_modules/tiny-pkg/index.js', 'src/App.js'];
const lines = [];
const mappings = [];
lines.push('var __d = {};');
mappings.push([]);
modules.forEach((path, source) => {
  const body = readFileSync(`src/${path.replace(/^src\//, '')}`, 'utf8').trimEnd().split('\n');
  lines.push(`__d[${JSON.stringify(path)}] = function (exports, require) {`);
  mappings.push([]);
  body.forEach((line, index) => {
    lines.push(line);
    mappings.push([[0, source, index, 0]]);
  });
  lines.push('};');
  mappings.push([]);
});
writeFileSync('bundle.js', `${lines.join('\n')}\n`);
execFileSync(process.argv[2], ['-O', '-emit-binary', '-output-source-map', '-out', 'index.android.hbc', 'bundle.js']);
const hermes = JSON.parse(readFileSync('index.android.hbc.map', 'utf8'));
const composed = decode(hermes.mappings).map((line) =>
  line.flatMap((segment) => {
    const original = mappings[segment[2]]?.[0];
    return original === undefined ? [[segment[0]]] : [[segment[0], original[1], original[2], segment[3]]];
  }),
);
writeFileSync(
  'index.android.hbc.map',
  `${JSON.stringify({ version: 3, sources: modules, mappings: encode(composed), x_hermes_function_offsets: hermes.x_hermes_function_offsets })}\n`,
);
rmSync('bundle.js');
