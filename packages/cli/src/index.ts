import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

export interface Io {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

const defaultIo: Io = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

export const HELP = `usertax ${version}
What does this pull request cost your users?

Usage:
  usertax <command> [options]

Commands (in development):
  measure   Measure web bundles, Lighthouse, React Native bundles and app archives
  diff      Compare a head report with a base report
  report    Render a diff as Markdown, a job summary or JSON

Options:
  -h, --help     Show this help
  -v, --version  Show the version
`;

const COMMANDS = new Set(['measure', 'diff', 'report']);

/** Runs the CLI and resolves to the process exit code. */
export function main(argv: readonly string[], io: Io = defaultIo): Promise<number> {
  // Commands become asynchronous as they are implemented; the signature is stable already.
  return Promise.resolve(run(argv, io));
}

function run(argv: readonly string[], io: Io): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${HELP}`);
    return 2;
  }

  if (parsed.values.version === true) {
    io.stdout(`${version}\n`);
    return 0;
  }

  const [command] = parsed.positionals;
  if (parsed.values.help === true || command === undefined) {
    io.stdout(HELP);
    return 0;
  }

  if (COMMANDS.has(command)) {
    io.stderr(`usertax ${command} is not implemented yet.\n`);
    return 2;
  }

  io.stderr(`Unknown command: ${command}\n\n${HELP}`);
  return 2;
}
