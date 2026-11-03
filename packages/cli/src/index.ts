import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { diffCommand } from './commands/diff.js';
import { measureCommand } from './commands/measure.js';
import { EXIT, UsageError, defaultIo } from './io.js';
import type { Io } from './io.js';

export type { Io } from './io.js';
export { EXIT } from './io.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

export const HELP = `usertax ${version}
What does this pull request cost your users?

Usage:
  usertax <command> [options]

Commands:
  measure   Measure built apps (web, React Native, Expo) and write a report
  diff      Compare a head report with a base report, with budgets (Markdown or JSON)

Options:
  -h, --help     Show this help, or a command's help with <command> --help
  -v, --version  Show the version

Exit codes: 0 success · 1 a budget failed · 2 invalid usage or input · 3 internal error
`;

type Command = (argv: readonly string[], io: Io) => Promise<number>;

const COMMANDS: ReadonlyMap<string, Command> = new Map([
  ['diff', diffCommand],
  [
    'measure',
    (argv, io) => measureCommand(argv, io, { version, env: process.env, cwd: process.cwd() }),
  ],
]);

function isUsageError(error: unknown): boolean {
  if (error instanceof UsageError) return true;
  // node:util parseArgs reports bad flags with ERR_PARSE_ARGS_* codes.
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS_');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs the CLI and resolves to the process exit code. */
export async function main(argv: readonly string[], io: Io = defaultIo): Promise<number> {
  const [first, ...rest] = argv;
  const command = first === undefined ? undefined : COMMANDS.get(first);
  try {
    if (command !== undefined) return await command(rest, io);
    return global(argv, io);
  } catch (error) {
    if (isUsageError(error)) {
      io.stderr(`usertax: ${message(error)}\nRun "usertax ${first ?? ''} --help" for usage.\n`);
      return EXIT.usage;
    }
    io.stderr(`usertax: internal error: ${message(error)}\n`);
    return EXIT.internal;
  }
}

function global(argv: readonly string[], io: Io): number {
  const parsed = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  if (parsed.values.version === true) {
    io.stdout(`${version}\n`);
    return EXIT.ok;
  }
  const [unknown] = parsed.positionals;
  if (unknown !== undefined) throw new UsageError(`unknown command "${unknown}"`);
  io.stdout(HELP);
  return EXIT.ok;
}
