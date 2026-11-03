import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await run('git', args, { cwd, timeout: 10_000 });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/** Root of the git repository containing `dir`, if any. */
export function gitRoot(dir: string): Promise<string | undefined> {
  return git(dir, ['rev-parse', '--show-toplevel']);
}

/** Commit SHA of HEAD in `dir`, if it is a git repository. */
export function gitHead(dir: string): Promise<string | undefined> {
  return git(dir, ['rev-parse', 'HEAD']);
}
