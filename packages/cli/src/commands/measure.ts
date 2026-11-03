import { stat, writeFile } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import type { Framework } from '@usertax/core';
import {
  DEFAULT_OUT_DIR,
  createReport,
  detectFramework,
  gitHead,
  gitRoot,
  measureWebApp,
  readPackageJson,
} from '@usertax/measure';
import { EXIT, UsageError } from '../io.js';
import type { Io } from '../io.js';

export const MEASURE_HELP = `Usage:
  usertax measure [app-dir] [options]

Measures an app that is already built and writes a usertax report (JSON).

Options:
      --out-dir <dir>       Build output directory (default: detected, e.g. dist for Vite)
      --framework <name>    vite, webpack or static (default: detected from package.json)
      --id <id>             App id in the report (default: package name or folder name)
      --name <name>         Display name (default: the id)
      --sha <sha>           Commit SHA (default: $GITHUB_SHA or git rev-parse HEAD)
      --ref <ref>           Git ref (default: $GITHUB_REF)
  -o, --output <file>       Write the report to a file instead of standard output
  -h, --help                Show this help

Source maps are needed to attribute bytes to packages and modules. For Vite, set
build.sourcemap to 'hidden' (maps are not shipped) and build.manifest to true (entries).
`;

const SUPPORTED: ReadonlySet<Framework> = new Set(['vite', 'webpack', 'static']);
const FRAMEWORKS: ReadonlySet<string> = new Set([
  'vite',
  'webpack',
  'static',
  'next',
  'expo',
  'react-native',
  'other',
]);
const SHA = /^[0-9a-f]{40}$/;

function appIdFrom(name: string | undefined, dir: string): string {
  const raw = name ?? basename(dir);
  const id = raw.replace(/[^\w@./-]/g, '-');
  return id === '' ? 'app' : id;
}

export interface MeasureContext {
  readonly version: string;
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
}

export async function measureCommand(
  argv: readonly string[],
  io: Io,
  context: MeasureContext,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      'out-dir': { type: 'string' },
      framework: { type: 'string' },
      id: { type: 'string' },
      name: { type: 'string' },
      sha: { type: 'string' },
      ref: { type: 'string' },
      output: { type: 'string', short: 'o' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help === true) {
    io.stdout(MEASURE_HELP);
    return EXIT.ok;
  }
  if (positionals.length > 1)
    throw new UsageError(`unexpected arguments: ${positionals.slice(1).join(' ')}`);

  const appDir = resolve(context.cwd, positionals[0] ?? '.');
  const pkg = await readPackageJson(appDir);
  if (values.framework !== undefined && !FRAMEWORKS.has(values.framework)) {
    throw new UsageError(`unknown framework "${values.framework}"`);
  }
  const framework = (values.framework as Framework | undefined) ?? detectFramework(pkg);
  if (!SUPPORTED.has(framework)) {
    throw new UsageError(
      `measuring ${framework} apps is not supported yet; supported: ${[...SUPPORTED].join(', ')}`,
    );
  }
  const outDir = resolve(appDir, values['out-dir'] ?? DEFAULT_OUT_DIR[framework] ?? 'dist');
  const outStat = await stat(outDir).catch(() => undefined);
  if (!outStat?.isDirectory()) {
    throw new UsageError(`build output ${outDir} not found; build the app first or pass --out-dir`);
  }

  const repoRoot = (await gitRoot(appDir)) ?? context.cwd;
  const path = relative(repoRoot, appDir).split(sep).join('/') || '.';
  const id = values.id ?? appIdFrom(pkg?.name, appDir);
  const shaCandidate = values.sha ?? context.env['GITHUB_SHA'] ?? (await gitHead(appDir));
  if (values.sha !== undefined && !SHA.test(values.sha)) {
    throw new UsageError('--sha must be a full 40-character commit SHA');
  }
  const sha = shaCandidate !== undefined && SHA.test(shaCandidate) ? shaCandidate : undefined;
  const ref = values.ref ?? context.env['GITHUB_REF'];

  const { app, warnings } = await measureWebApp({
    id,
    name: values.name ?? id,
    appDir,
    path,
    outDir,
    framework,
  });
  for (const warning of warnings) io.stderr(`warning: ${warning.file}: ${warning.message}\n`);

  const report = createReport({
    apps: [app],
    toolVersion: context.version,
    ...(sha === undefined ? {} : { sha }),
    ...(ref === undefined || sha === undefined ? {} : { ref }),
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (values.output === undefined) io.stdout(json);
  else await writeFile(values.output, json);
  return EXIT.ok;
}
