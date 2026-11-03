// Generates packages/core/src/data/alternatives.json from the e18e module-replacements dataset
// (MIT). Run `node scripts/update-alternatives.js` after bumping the module-replacements
// devDependency; `--check` fails if the committed file is out of date.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkgPath = require.resolve('module-replacements/package.json');
const root = dirname(pkgPath);
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const target = new URL('../packages/core/src/data/alternatives.json', import.meta.url);

function docUrl(url) {
  if (url === undefined) return undefined;
  if (typeof url === 'string') return url;
  switch (url.type) {
    case 'mdn':
      return `https://developer.mozilla.org/en-US/docs/${url.id}`;
    case 'node':
      return `https://nodejs.org/${url.id}`;
    case 'e18e':
      return `https://e18e.dev/docs/replacements/${url.id}`;
    default:
      return undefined;
  }
}

function label(replacement, id) {
  if (replacement === undefined) return id;
  switch (replacement.type) {
    case 'documented':
      return replacement.replacementModule;
    case 'native':
      return replacement.id;
    case 'simple':
      return `inline code (${replacement.id.replace(/^snippet::/, '')})`;
    case 'removal':
      return 'native APIs';
    default:
      return replacement.id ?? id;
  }
}

const entries = {};
for (const manifest of ['preferred', 'native', 'micro-utilities']) {
  const data = JSON.parse(readFileSync(join(root, 'manifests', `${manifest}.json`), 'utf8'));
  for (const [name, mapping] of Object.entries(data.mappings)) {
    if (mapping.type !== 'module' || entries[name] !== undefined) continue;
    const replacements = mapping.replacements.map((id) => label(data.replacements[id], id));
    const url =
      docUrl(mapping.url) ??
      mapping.replacements.map((id) => docUrl(data.replacements[id]?.url)).find(Boolean) ??
      `https://github.com/e18e/module-replacements/blob/v${pkg.version}/manifests/${manifest}.json`;
    entries[name] = { category: manifest, replacements, url };
  }
}

const sorted = Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)));
const output = `${JSON.stringify(
  {
    source: {
      name: 'e18e/module-replacements',
      version: pkg.version,
      license: pkg.license,
      url: 'https://github.com/e18e/module-replacements',
    },
    entries: sorted,
  },
  null,
  2,
)}\n`;

if (process.argv.includes('--check')) {
  const current = readFileSync(target, 'utf8');
  if (current !== output) {
    process.stderr.write(
      'alternatives.json is out of date; run node scripts/update-alternatives.js\n',
    );
    process.exit(1);
  }
} else {
  writeFileSync(target, output);
  process.stdout.write(
    `wrote ${Object.keys(sorted).length} entries from module-replacements ${pkg.version}\n`,
  );
}
