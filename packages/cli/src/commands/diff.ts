import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  ReportValidationError,
  diffReports,
  parseReport,
  renderJson,
  renderMarkdown,
} from '@usertax/core';
import type { Compression, Report } from '@usertax/core';
import { EXIT, UsageError } from '../io.js';
import type { Io } from '../io.js';

export const DIFF_HELP = `Usage:
  usertax diff <head-report.json> [--base <base-report.json>] [options]

Compares two usertax reports and prints the result.

Options:
  -b, --base <file>          Base report. Without it, head values are listed.
  -f, --format <format>      markdown (default) or json
  -c, --compression <name>   Size shown for web assets: gzip (default), brotli or raw
      --top <n>              Files, packages and archive entries listed per app (default 10)
  -o, --output <file>        Write to a file instead of standard output
  -h, --help                 Show this help
`;

const FORMATS = new Set(['markdown', 'json']);
const COMPRESSIONS = new Set<Compression>(['gzip', 'brotli', 'raw']);

async function readReport(path: string, role: string): Promise<Report> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown error';
    throw new UsageError(`cannot read ${role} report ${path}: ${code}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new UsageError(`${role} report ${path} is not valid JSON`);
  }
  try {
    return parseReport(json);
  } catch (error) {
    if (error instanceof ReportValidationError) {
      throw new UsageError(`${role} report ${path}: ${error.message}`);
    }
    throw error;
  }
}

function parseTop(value: string | undefined): number {
  if (value === undefined) return 10;
  const top = Number(value);
  if (!Number.isInteger(top) || top < 0 || top > 1000) {
    throw new UsageError(`--top must be an integer between 0 and 1000, received "${value}"`);
  }
  return top;
}

export async function diffCommand(argv: readonly string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      base: { type: 'string', short: 'b' },
      format: { type: 'string', short: 'f', default: 'markdown' },
      compression: { type: 'string', short: 'c', default: 'gzip' },
      top: { type: 'string' },
      output: { type: 'string', short: 'o' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help === true) {
    io.stdout(DIFF_HELP);
    return EXIT.ok;
  }
  const [headPath, ...extra] = positionals;
  if (headPath === undefined) throw new UsageError('missing <head-report.json>');
  if (extra.length > 0) throw new UsageError(`unexpected arguments: ${extra.join(' ')}`);
  if (!FORMATS.has(values.format)) throw new UsageError(`unknown format "${values.format}"`);
  if (!COMPRESSIONS.has(values.compression as Compression)) {
    throw new UsageError(`unknown compression "${values.compression}"`);
  }
  const compression = values.compression as Compression;
  const top = parseTop(values.top);

  const head = await readReport(headPath, 'head');
  const base = values.base === undefined ? undefined : await readReport(values.base, 'base');
  const diff = diffReports(head, base, { top, rankBy: compression });
  const output =
    values.format === 'json'
      ? renderJson(diff)
      : `${renderMarkdown(diff, { compression, marker: false })}\n`;

  if (values.output === undefined) io.stdout(output);
  else await writeFile(values.output, output);
  return EXIT.ok;
}
