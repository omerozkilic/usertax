import { stat, writeFile } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigError } from '@usertax/core';
import type { App, AppConfig, Framework } from '@usertax/core';
import {
  DEFAULT_OUT_DIR,
  FALLBACK_OUT_DIRS,
  LighthouseError,
  LockfileError,
  ServerError,
  createReport,
  detectFramework,
  discoverApps,
  findExpoBundles,
  gitHead,
  gitRoot,
  loadConfig,
  measureNextApp,
  measureRnApp,
  measureWebApp,
  readAppDependencies,
  readPackageJson,
  runLighthouse,
  serveStatic,
  startCommand,
  startNext,
} from '@usertax/measure';
import type {
  AppDependencies,
  ArchiveInput,
  BundleInput,
  LoadedConfig,
  RunningServer,
} from '@usertax/measure';
import { EXIT, UsageError } from '../io.js';
import type { Io } from '../io.js';

export const MEASURE_HELP = `Usage:
  usertax measure [app-dir] [options]

Measures apps that are already built and writes one usertax report (JSON).

Without app-dir, usertax measures the apps listed in usertax.config.(json|ts|mjs|js) at the
repository root, or else every workspace package that uses a supported framework. With
app-dir, it measures that app; a matching entry in the configuration supplies its defaults.

Options:
      --config <file>       Configuration file (default: usertax.config.* at the repository root)
      --out-dir <dir>       Build output directory (default: dist; .next for Next.js; build for SvelteKit,
                            or .svelte-kit/output/client without adapter-static)
      --framework <name>    vite, next, astro, sveltekit, webpack, static, expo or react-native
                            (default: detected from package.json)
      --id <id>             App id in the report (default: package name or folder name)
      --name <name>         Display name (default: the id)
      --sha <sha>           Commit SHA (default: $GITHUB_SHA or git rev-parse HEAD)
      --ref <ref>           Git ref (default: $GITHUB_REF)
  -o, --output <file>       Write the report to a file instead of standard output

React Native and Expo (usertax never builds the app):
      --bundle <p>=<file>   JS or Hermes bundle for android or ios, with <file>.map (repeatable)
                            Expo default: the bundles of expo export in --out-dir (dist)
      --archive [key=]<file>
                            APK, AAB or IPA to break down by category (repeatable)

Lighthouse (web apps; needs the optional packages lighthouse and chrome-launcher):
      --lighthouse <path>   Page to audit, e.g. / or /pricing (repeatable)
      --runs <n>            Runs per page; the report keeps every run (default 5)
      --warmup <n>          Unrecorded runs per page before them (default 1)
      --form-factor <f>     mobile (default) or desktop
      --base-url <url>      Audit a server that is already running at this URL
      --start <command>     Start the server with this shell command; needs --base-url
                            Default: the build output is served statically (Vite, webpack,
                            static) or with next start (Next.js)
  -h, --help                Show this help

Source maps are needed to attribute bytes to packages and modules. For Vite, set
build.sourcemap to 'hidden' (maps are not shipped) and build.manifest to true (entries).
For Next.js, set productionBrowserSourceMaps to true. For Astro, set vite.build.sourcemap to
'hidden' in astro.config; for SvelteKit, set build.sourcemap to 'hidden' in vite.config.
`;

const SUPPORTED: ReadonlySet<Framework> = new Set([
  'vite',
  'next',
  'astro',
  'sveltekit',
  'webpack',
  'static',
  'expo',
  'react-native',
]);
const FRAMEWORKS: ReadonlySet<string> = new Set([
  'vite',
  'astro',
  'sveltekit',
  'webpack',
  'static',
  'next',
  'expo',
  'react-native',
  'other',
]);
const PLATFORMS = new Set(['android', 'ios']);
const SHA = /^[0-9a-f]{40}$/;

function parseBundle(value: string, cwd: string): BundleInput {
  const match = /^(android|ios)=(.+)$/.exec(value);
  if (match?.[1] === undefined || match[2] === undefined || !PLATFORMS.has(match[1])) {
    throw new UsageError(`--bundle expects <android|ios>=<file>, received "${value}"`);
  }
  return { platform: match[1] as 'android' | 'ios', file: resolve(cwd, match[2]) };
}

function parseArchive(value: string, cwd: string): ArchiveInput {
  const match = /^([\w.-]+)=(.+)$/.exec(value);
  return match?.[1] !== undefined && match[2] !== undefined && !/\.(apk|aab|ipa)$/i.test(match[1])
    ? { key: match[1], file: resolve(cwd, match[2]) }
    : { file: resolve(cwd, value) };
}

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

interface LighthouseSpec {
  readonly pages: readonly string[];
  readonly runs: number;
  readonly warmup: number;
  readonly formFactor: 'mobile' | 'desktop';
  readonly baseUrl?: string | undefined;
  readonly start?: string | undefined;
}

/** Everything needed to measure one app, from flags or from the configuration. */
interface AppSpec {
  readonly dir: string;
  readonly id?: string | undefined;
  readonly name?: string | undefined;
  readonly framework?: Framework | undefined;
  readonly outDir?: string | undefined;
  readonly bundles: readonly BundleInput[];
  readonly archives: readonly ArchiveInput[];
  readonly lighthouse?: LighthouseSpec | undefined;
}

function specFromConfig(entry: AppConfig, root: string): AppSpec {
  const dir = resolve(root, entry.path);
  return {
    dir,
    id: entry.id,
    name: entry.name,
    framework: entry.framework,
    outDir: entry.outDir,
    bundles: (entry.bundles ?? []).map((b) => ({
      platform: b.platform,
      file: resolve(dir, b.file),
      ...(b.map === undefined ? {} : { map: resolve(dir, b.map) }),
    })),
    archives: (entry.archives ?? []).map((a) => ({
      file: resolve(dir, a.file),
      ...(a.key === undefined ? {} : { key: a.key }),
    })),
    ...(entry.lighthouse === undefined
      ? {}
      : {
          lighthouse: {
            pages: entry.lighthouse.pages,
            runs: entry.lighthouse.runs,
            warmup: entry.lighthouse.warmup,
            formFactor: entry.lighthouse.formFactor,
            baseUrl: entry.lighthouse.baseUrl,
            start: entry.lighthouse.startCommand,
          },
        }),
  };
}

async function runPages(
  spec: LighthouseSpec,
  app: App,
  framework: Framework,
  appDir: string,
  outDir: string,
  io: Io,
) {
  let server: RunningServer;
  try {
    if (spec.start !== undefined && spec.baseUrl !== undefined)
      server = await startCommand(spec.start, appDir, spec.baseUrl);
    else if (spec.baseUrl !== undefined)
      server = { url: spec.baseUrl, close: () => Promise.resolve() };
    else if (framework === 'next') server = await startNext(appDir);
    else server = await serveStatic(outDir);
  } catch (error) {
    if (error instanceof ServerError) throw new UsageError(error.message);
    throw error;
  }
  try {
    const base = server.url.replace(/\/$/, '');
    app.lighthouse = await runLighthouse({
      urls: spec.pages.map((page) => `${base}${page}`),
      runs: spec.runs,
      warmup: spec.warmup,
      formFactor: spec.formFactor,
      onRun: (url, run, result) => {
        io.stderr(
          `lighthouse ${new URL(url).pathname} run ${run}/${spec.runs}: performance ${result.performance}, LCP ${Math.round(result.lcp)} ms, TBT ${Math.round(result.tbt)} ms, CLS ${result.cls.toFixed(3)}${result.contamination === undefined ? '' : ` (browser extensions active: ${result.contamination.origins.join(', ')}; not comparable)`}\n`,
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

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isDirectory() === true;
}

async function measureApp(spec: AppSpec, repoRoot: string, io: Io, prefix: string): Promise<App> {
  const pkg = await readPackageJson(spec.dir);
  const framework = spec.framework ?? detectFramework(pkg);
  if (!SUPPORTED.has(framework)) {
    throw new UsageError(
      `measuring ${framework} apps is not supported yet; supported: ${[...SUPPORTED].join(', ')}`,
    );
  }
  const mobile = framework === 'expo' || framework === 'react-native';
  if (!mobile && (spec.bundles.length > 0 || spec.archives.length > 0)) {
    throw new UsageError('--bundle and --archive are for React Native and Expo apps');
  }
  if (mobile && spec.lighthouse !== undefined) throw new UsageError('--lighthouse is for web apps');
  let outDir = resolve(spec.dir, spec.outDir ?? DEFAULT_OUT_DIR[framework] ?? 'dist');
  if (spec.outDir === undefined && !(await isDirectory(outDir))) {
    for (const fallback of FALLBACK_OUT_DIRS[framework] ?? []) {
      if (await isDirectory(resolve(spec.dir, fallback))) outDir = resolve(spec.dir, fallback);
    }
  }
  const needsOutDir = !mobile || (framework === 'expo' && spec.bundles.length === 0);
  const outStat = needsOutDir ? await stat(outDir).catch(() => undefined) : undefined;
  if (needsOutDir && !outStat?.isDirectory() && !(mobile && spec.archives.length > 0)) {
    throw new UsageError(
      mobile
        ? `${outDir} not found; run expo export --source-maps first, or pass --bundle / --archive`
        : `build output ${outDir} not found; build the app first or pass --out-dir`,
    );
  }
  if (framework === 'react-native' && spec.bundles.length === 0 && spec.archives.length === 0) {
    throw new UsageError(
      'pass --bundle <android|ios>=<file> and/or --archive <file> for a React Native app',
    );
  }

  const path = relative(repoRoot, spec.dir).split(sep).join('/') || '.';
  const id = spec.id ?? appIdFrom(pkg?.name, spec.dir);
  let lock: AppDependencies | undefined;
  try {
    lock = await readAppDependencies(spec.dir, repoRoot);
  } catch (error) {
    if (!(error instanceof LockfileError)) throw error;
    io.stderr(`${prefix}warning: lockfile ignored: ${error.message}\n`);
  }
  if (lock === undefined)
    io.stderr(`${prefix}warning: no lockfile found; package changes will not be explained\n`);

  const common = {
    id,
    name: spec.name ?? id,
    appDir: spec.dir,
    path,
    ...(lock === undefined ? {} : { dependencies: lock.dependencies }),
  };
  const { app, warnings } = mobile
    ? await measureRnApp({
        ...common,
        framework,
        bundles:
          spec.bundles.length > 0 || outStat === undefined
            ? spec.bundles
            : await findExpoBundles(outDir),
        archives: spec.archives,
      })
    : await (framework === 'next' ? measureNextApp : measureWebApp)({
        ...common,
        outDir,
        framework,
      });
  for (const warning of warnings)
    io.stderr(`${prefix}warning: ${warning.file}: ${warning.message}\n`);
  if (spec.lighthouse !== undefined)
    await runPages(spec.lighthouse, app, framework, spec.dir, outDir, io);
  return app;
}

function lighthouseFromFlags(values: Record<string, unknown>): LighthouseSpec | undefined {
  const pages = (values['lighthouse'] as string[] | undefined) ?? [];
  if (pages.length === 0) return undefined;
  const rawRuns = values['runs'] as string | undefined;
  const runs = rawRuns === undefined ? 5 : Number(rawRuns);
  if (!Number.isInteger(runs) || runs < 1 || runs > 100)
    throw new UsageError('--runs must be an integer between 1 and 100');
  const rawWarmup = values['warmup'] as string | undefined;
  const warmup = rawWarmup === undefined ? 1 : Number(rawWarmup);
  if (!Number.isInteger(warmup) || warmup < 0 || warmup > 10)
    throw new UsageError('--warmup must be an integer between 0 and 10');
  const formFactor = (values['form-factor'] as string | undefined) ?? 'mobile';
  if (formFactor !== 'mobile' && formFactor !== 'desktop') {
    throw new UsageError(`--form-factor must be mobile or desktop, received "${formFactor}"`);
  }
  const baseUrl = values['base-url'] as string | undefined;
  const start = values['start'] as string | undefined;
  if (start !== undefined && baseUrl === undefined) {
    throw new UsageError('--start needs --base-url, the address the started server listens on');
  }
  for (const page of pages) {
    if (!page.startsWith('/'))
      throw new UsageError(`--lighthouse expects a path starting with /, received "${page}"`);
  }
  return { pages, runs, warmup, formFactor, baseUrl, start };
}

const APP_FLAGS = [
  'out-dir',
  'framework',
  'id',
  'name',
  'bundle',
  'archive',
  'lighthouse',
  'runs',
  'form-factor',
  'base-url',
  'start',
];

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
      config: { type: 'string' },
      'out-dir': { type: 'string' },
      framework: { type: 'string' },
      id: { type: 'string' },
      name: { type: 'string' },
      sha: { type: 'string' },
      ref: { type: 'string' },
      output: { type: 'string', short: 'o' },
      lighthouse: { type: 'string', multiple: true },
      bundle: { type: 'string', multiple: true },
      archive: { type: 'string', multiple: true },
      runs: { type: 'string' },
      warmup: { type: 'string' },
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
  if (values.framework !== undefined && !FRAMEWORKS.has(values.framework)) {
    throw new UsageError(`unknown framework "${values.framework}"`);
  }
  if (values.sha !== undefined && !SHA.test(values.sha))
    throw new UsageError('--sha must be a full 40-character commit SHA');

  const startDir = resolve(context.cwd, positionals[0] ?? '.');
  const repoRoot =
    (await gitRoot(startDir)) ?? (positionals[0] === undefined ? startDir : context.cwd);
  let loaded: LoadedConfig | undefined;
  try {
    loaded = await loadConfig(
      repoRoot,
      values.config === undefined ? undefined : resolve(context.cwd, values.config),
    );
  } catch (error) {
    if (error instanceof ConfigError) throw new UsageError(error.message);
    throw error;
  }

  const flagSpec = (dir: string, base?: AppSpec): AppSpec => {
    const bundles = (values.bundle ?? []).map((v) => parseBundle(v, context.cwd));
    const archives = (values.archive ?? []).map((v) => parseArchive(v, context.cwd));
    return {
      dir,
      id: values.id ?? base?.id,
      name: values.name ?? base?.name,
      framework: (values.framework as Framework | undefined) ?? base?.framework,
      outDir: values['out-dir'] ?? base?.outDir,
      bundles: bundles.length > 0 ? bundles : (base?.bundles ?? []),
      archives: archives.length > 0 ? archives : (base?.archives ?? []),
      lighthouse: lighthouseFromFlags(values) ?? base?.lighthouse,
    };
  };

  let specs: AppSpec[];
  if (positionals[0] !== undefined) {
    const entry = loaded?.config.apps?.find((app) => resolve(repoRoot, app.path) === startDir);
    specs = [flagSpec(startDir, entry === undefined ? undefined : specFromConfig(entry, repoRoot))];
  } else {
    const used = APP_FLAGS.filter(
      (flag) => (values as Record<string, unknown>)[flag] !== undefined,
    );
    const fromConfig = loaded?.config.apps?.map((entry) => specFromConfig(entry, repoRoot));
    const discovered = fromConfig === undefined ? await discoverApps(repoRoot) : undefined;
    const candidates =
      fromConfig ??
      (discovered ?? [])
        .filter((app) => app.framework !== 'react-native')
        .map((app): AppSpec => ({
          dir: resolve(repoRoot, app.path),
          framework: app.framework,
          bundles: [],
          archives: [],
        }));
    for (const app of discovered ?? []) {
      if (app.framework === 'react-native') {
        io.stderr(
          `skipping ${app.path}: bare React Native apps need bundles or archives in usertax.config.json\n`,
        );
      }
    }
    if (candidates.length > 1 && used.length > 0) {
      throw new UsageError(
        `--${used[0] ?? ''} applies to one app; pass the app directory or use usertax.config.json`,
      );
    }
    specs =
      candidates.length === 1
        ? [flagSpec(candidates[0]?.dir ?? startDir, candidates[0])]
        : candidates;
    if (specs.length === 0) specs = [flagSpec(startDir)];
  }

  const apps: App[] = [];
  const ids = new Set<string>();
  for (const spec of specs) {
    const prefix = specs.length > 1 ? `${relative(repoRoot, spec.dir) || '.'}: ` : '';
    const app = await measureApp(spec, repoRoot, io, prefix);
    if (ids.has(app.id))
      throw new UsageError(
        `two apps have the id "${app.id}"; set distinct ids in usertax.config.json`,
      );
    ids.add(app.id);
    apps.push(app);
  }

  const shaCandidate = values.sha ?? context.env['GITHUB_SHA'] ?? (await gitHead(startDir));
  const sha = shaCandidate !== undefined && SHA.test(shaCandidate) ? shaCandidate : undefined;
  const ref = values.ref ?? context.env['GITHUB_REF'];
  const report = createReport({
    apps,
    toolVersion: context.version,
    ...(sha === undefined ? {} : { sha }),
    ...(ref === undefined || sha === undefined ? {} : { ref }),
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (values.output === undefined) io.stdout(json);
  else await writeFile(values.output, json);
  return EXIT.ok;
}
