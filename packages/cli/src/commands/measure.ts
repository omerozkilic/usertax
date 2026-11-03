import { stat, writeFile } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import type { Framework } from '@usertax/core';
import {
  DEFAULT_OUT_DIR,
  LockfileError,
  createReport,
  detectFramework,
  gitHead,
  gitRoot,
  LighthouseError,
  ServerError,
  measureNextApp,
  measureWebApp,
  readAppDependencies,
  readPackageJson,
  runLighthouse,
  serveStatic,
  startCommand,
  startNext,
} from '@usertax/measure';
import type { AppDependencies, RunningServer } from '@usertax/measure';
import { EXIT, UsageError } from '../io.js';
import type { Io } from '../io.js';

export const MEASURE_HELP = `Usage:
  usertax measure [app-dir] [options]

Measures an app that is already built and writes a usertax report (JSON).

Options:
      --out-dir <dir>       Build output directory (default: dist, or .next for Next.js)
      --framework <name>    vite, next, webpack or static (default: detected from package.json)
      --id <id>             App id in the report (default: package name or folder name)
      --name <name>         Display name (default: the id)
      --sha <sha>           Commit SHA (default: $GITHUB_SHA or git rev-parse HEAD)
      --ref <ref>           Git ref (default: $GITHUB_REF)
  -o, --output <file>       Write the report to a file instead of standard output

Lighthouse (needs the optional packages lighthouse and chrome-launcher):
      --lighthouse <path>   Page to audit, e.g. / or /pricing (repeatable)
      --runs <n>            Runs per page; the report keeps every run (default 5)
      --form-factor <f>     mobile (default) or desktop
      --base-url <url>      Audit a server that is already running at this URL
      --start <command>     Start the server with this shell command; needs --base-url
                            Default: the build output is served statically (Vite, webpack,
                            static) or with next start (Next.js)
  -h, --help                Show this help

Source maps are needed to attribute bytes to packages and modules. For Vite, set
build.sourcemap to 'hidden' (maps are not shipped) and build.manifest to true (entries).
For Next.js, set productionBrowserSourceMaps to true.
`;

const SUPPORTED: ReadonlySet<Framework> = new Set(['vite', 'next', 'webpack', 'static']);
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
      lighthouse: { type: 'string', multiple: true },
      runs: { type: 'string' },
      'form-factor': { type: 'string' },
      'base-url': { type: 'string' },
      start: { type: 'string' },
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

  let lock: AppDependencies | undefined;
  try {
    lock = await readAppDependencies(appDir, repoRoot);
  } catch (error) {
    if (!(error instanceof LockfileError)) throw error;
    io.stderr(`warning: lockfile ignored: ${error.message}\n`);
  }
  if (lock === undefined) {
    io.stderr('warning: no lockfile found; package changes will not be explained\n');
  }

  const measure = framework === 'next' ? measureNextApp : measureWebApp;
  const { app, warnings } = await measure({
    id,
    name: values.name ?? id,
    appDir,
    path,
    outDir,
    framework,
    ...(lock === undefined ? {} : { dependencies: lock.dependencies }),
  });
  for (const warning of warnings) io.stderr(`warning: ${warning.file}: ${warning.message}\n`);

  const pages = values.lighthouse ?? [];
  if (pages.length > 0) {
    const runs = values.runs === undefined ? 5 : Number(values.runs);
    if (!Number.isInteger(runs) || runs < 1 || runs > 100) {
      throw new UsageError('--runs must be an integer between 1 and 100');
    }
    const formFactor = values['form-factor'] ?? 'mobile';
    if (formFactor !== 'mobile' && formFactor !== 'desktop') {
      throw new UsageError(`--form-factor must be mobile or desktop, received "${formFactor}"`);
    }
    if (values.start !== undefined && values['base-url'] === undefined) {
      throw new UsageError('--start needs --base-url, the address the started server listens on');
    }
    for (const page of pages) {
      if (!page.startsWith('/'))
        throw new UsageError(`--lighthouse expects a path starting with /, received "${page}"`);
    }
    let server: RunningServer;
    try {
      if (values.start !== undefined && values['base-url'] !== undefined) {
        server = await startCommand(values.start, appDir, values['base-url']);
      } else if (values['base-url'] !== undefined) {
        server = { url: values['base-url'], close: () => Promise.resolve() };
      } else if (framework === 'next') {
        server = await startNext(appDir);
      } else {
        server = await serveStatic(outDir);
      }
    } catch (error) {
      if (error instanceof ServerError) throw new UsageError(error.message);
      throw error;
    }
    try {
      const base = server.url.replace(/\/$/, '');
      app.lighthouse = await runLighthouse({
        urls: pages.map((page) => `${base}${page}`),
        runs,
        formFactor,
        onRun: (url, run, result) => {
          io.stderr(
            `lighthouse ${new URL(url).pathname} run ${run}/${runs}: performance ${result.performance}, LCP ${Math.round(result.lcp)} ms, TBT ${Math.round(result.tbt)} ms, CLS ${result.cls.toFixed(3)}\n`,
          );
        },
      });
    } catch (error) {
      if (error instanceof LighthouseError) throw new UsageError(error.message);
      throw error;
    } finally {
      await server.close();
    }
  }

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
