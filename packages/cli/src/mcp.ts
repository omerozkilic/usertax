import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  ALTERNATIVES_SOURCE,
  alternativesFor,
  diffReports,
  explainPackage,
  formatBytes,
  inlineCode,
  parseReport,
  renderMarkdown,
} from '@usertax/core';
import type { PackageInApp } from '@usertax/core';
import { z } from 'zod';
import { diffCommand, readReport } from './commands/diff.js';
import { measureCommand } from './commands/measure.js';
import { EXIT, UsageError } from './io.js';
import type { Io } from './io.js';

/**
 * The usertax MCP server (ADR 0015): the CLI's deterministic measurements as tools for AI
 * assistants. Every tool reads local files only; `measure` writes one report file. No tool
 * calls a network service or a language model (ADR 0013).
 */
export interface McpOptions {
  readonly version: string;
  /** Directory that relative paths are resolved against. */
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

interface ToolResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

function text(value: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text: value }], ...(isError ? { isError } : {}) };
}

function capture(): Io & { out: () => string; err: () => string } {
  let out = '';
  let err = '';
  return {
    stdout: (t) => (out += t),
    stderr: (t) => (err += t),
    out: () => out,
    err: () => err,
  };
}

/** Runs a tool body, turning usage errors into tool errors the assistant can read. */
async function guarded(body: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof UsageError) return text(error.message, true);
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS_'))
      return text((error as Error).message, true);
    throw error;
  }
}

function appLines(apps: readonly PackageInApp[]): string[] {
  return apps.flatMap((app) => {
    const versions = app.dependencies.map((d) => {
      const how = d.direct ? 'direct' : `via ${(d.via ?? ['?']).join(', ')}`;
      return `${d.version} (${how}${d.dev === true ? ', dev only' : ''})`;
    });
    return [
      `- ${inlineCode(app.appId, { table: false })}: ${formatBytes(app.bytes)} in ${String(app.files.length)} file(s)` +
        (versions.length > 0 ? `; lockfile: ${versions.join(', ')}` : '; not in the lockfile'),
      ...app.files.map(
        (f) => `  - ${inlineCode(f.key, { table: false })}: ${formatBytes(f.bytes)}`,
      ),
    ];
  });
}

export function createMcpServer(options: McpOptions): McpServer {
  const server = new McpServer(
    { name: 'usertax', version: options.version },
    {
      instructions:
        'usertax measures what a change costs users: JavaScript per route, React Native bundles, APK/AAB/IPA size, and which npm packages cause it. Build the app first, call measure for the base and for the head, then compare. Numbers come from build output and source maps; do not estimate them.',
    },
  );
  const path = (p: string) => resolve(options.cwd, p);

  server.registerTool(
    'measure',
    {
      title: 'Measure built apps',
      description:
        'Measures an already built app or repository (Vite, Next.js, webpack, static, Expo, React Native) and saves a usertax report. Returns the head values and the report path. Does not build anything and does not run Lighthouse.',
      inputSchema: {
        path: z
          .string()
          .describe('App directory, or a repository root with usertax.config.* or workspaces'),
        output: z
          .string()
          .optional()
          .describe('Where to save the report JSON (default: a new temporary file)'),
        config: z.string().optional().describe('Configuration file (default: usertax.config.*)'),
        outDir: z.string().optional().describe('Build output directory of a single app'),
        framework: z
          .enum([
            'vite',
            'next',
            'nuxt',
            'astro',
            'sveltekit',
            'webpack',
            'static',
            'expo',
            'react-native',
          ])
          .optional(),
        bundles: z
          .array(z.string())
          .optional()
          .describe(
            'React Native bundles as platform=file, e.g. android=dist/index.android.bundle',
          ),
        archives: z.array(z.string()).optional().describe('APK, AAB or IPA files'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (input) =>
      guarded(async () => {
        const args = [path(input.path)];
        if (input.config !== undefined) args.push('--config', path(input.config));
        if (input.outDir !== undefined) args.push('--out-dir', input.outDir);
        if (input.framework !== undefined) args.push('--framework', input.framework);
        for (const b of input.bundles ?? []) args.push('--bundle', b);
        for (const a of input.archives ?? []) args.push('--archive', path(a));
        const io = capture();
        const code = await measureCommand(args, io, {
          version: options.version,
          env: options.env,
          cwd: options.cwd,
        });
        if (code !== EXIT.ok)
          return text(io.err() || `measure failed (exit ${String(code)})`, true);
        const report = parseReport(JSON.parse(io.out()));
        const output =
          input.output === undefined
            ? join(await mkdtemp(join(tmpdir(), 'usertax-mcp-')), 'report.json')
            : path(input.output);
        await writeFile(output, io.out());
        const warnings = io.err().trim();
        return text(
          [
            `Report saved to ${output}`,
            ...(warnings === '' ? [] : ['', 'Warnings:', warnings]),
            '',
            renderMarkdown(diffReports(report), { marker: false }),
          ].join('\n'),
        );
      }),
  );

  server.registerTool(
    'compare',
    {
      title: 'Compare two reports',
      description:
        'Compares a head report with a base report: size and Lighthouse changes with the measured noise model, the packages that caused them (from lockfile diffs and source maps), sourced alternatives and budget results.',
      inputSchema: {
        head: z.string().describe('Head report (after the change)'),
        base: z.string().optional().describe('Base report (before the change)'),
        config: z.string().optional().describe('Configuration with budgets'),
        format: z.enum(['markdown', 'json']).optional(),
        compression: z.enum(['gzip', 'brotli', 'raw']).optional(),
        top: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) =>
      guarded(async () => {
        const args = [path(input.head)];
        if (input.base !== undefined) args.push('--base', path(input.base));
        if (input.config !== undefined) args.push('--config', path(input.config));
        if (input.format !== undefined) args.push('--format', input.format);
        if (input.compression !== undefined) args.push('--compression', input.compression);
        if (input.top !== undefined) args.push('--top', String(input.top));
        const io = capture();
        const code = await diffCommand(args, io);
        if (code !== EXIT.ok && code !== EXIT.budgetFailed) return text(io.err(), true);
        return text(io.out());
      }),
  );

  server.registerTool(
    'explain_package',
    {
      title: 'Explain a package',
      description:
        'Shows where an npm package ends up in a report: minified bytes per shipped file, the lockfile versions and the direct dependencies that pull it in, the same for a base report, and curated alternatives.',
      inputSchema: {
        package: z.string().describe('npm package name, e.g. moment'),
        report: z.string().describe('Report to look in (usually the head)'),
        base: z.string().optional().describe('Base report to compare with'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) =>
      guarded(async () => {
        const head = await readReport(path(input.report), 'head');
        const base =
          input.base === undefined ? undefined : await readReport(path(input.base), 'base');
        const result = explainPackage(input.package, head, base);
        const name = inlineCode(result.name, { table: false });
        const lines = [`## ${name}`, ''];
        lines.push(result.head.length > 0 ? 'In the report:' : `${name} is not in the report.`);
        lines.push(...appLines(result.head));
        if (result.base !== undefined) {
          lines.push(
            '',
            result.base.length > 0 ? 'In the base report:' : `${name} is not in the base report.`,
          );
          lines.push(...appLines(result.base));
        }
        lines.push('', alternativesText(result.name));
        return text(lines.join('\n'));
      }),
  );

  server.registerTool(
    'alternatives',
    {
      title: 'Alternatives for a package',
      description: `Curated lighter or native alternatives for an npm package, from ${ALTERNATIVES_SOURCE.name} ${ALTERNATIVES_SOURCE.version}. Only packages in that dataset have suggestions.`,
      inputSchema: { package: z.string().describe('npm package name') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) => Promise.resolve(text(alternativesText(input.package))),
  );

  return server;
}

function alternativesText(name: string): string {
  const found = alternativesFor(name);
  const source = `${ALTERNATIVES_SOURCE.name} ${ALTERNATIVES_SOURCE.version} (${ALTERNATIVES_SOURCE.url})`;
  if (found === undefined)
    return `No curated alternatives for ${inlineCode(name, { table: false })} in ${source}.`;
  return `Alternatives for ${inlineCode(name, { table: false })}: ${found.replacements.join(', ')}. Guide: ${found.url}. Source: ${source}.`;
}

export const MCP_HELP = `Usage:
  usertax mcp

Starts the usertax MCP server on standard input and output, for AI assistants such as Claude
Code. Tools: measure, compare, explain_package, alternatives. Relative paths are resolved against
the directory the server was started in. Example configuration:

  { "mcpServers": { "usertax": { "command": "npx", "args": ["-y", "@usertax/cli", "mcp"] } } }
`;

/**
 * `usertax mcp`: serves until the client closes the connection. With the default stdio
 * transport, the end of standard input is the client disconnecting; the SDK's transport does not
 * report it, so the server is closed then.
 */
export async function mcpCommand(
  argv: readonly string[],
  io: Io,
  options: McpOptions,
  transport?: Transport,
): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    io.stdout(MCP_HELP);
    return EXIT.ok;
  }
  if (argv.length > 0) throw new UsageError(`unexpected argument ${argv[0] ?? ''}`);
  const server = createMcpServer(options);
  const closed = new Promise<void>((done) => {
    server.server.onclose = () => {
      done();
    };
  });
  if (transport === undefined) {
    process.stdin.once('end', () => void server.close());
    await server.connect(new StdioServerTransport());
  } else {
    await server.connect(transport);
  }
  await closed;
  return EXIT.ok;
}
