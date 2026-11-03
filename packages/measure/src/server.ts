import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { dirname, join, resolve } from 'node:path';

export class ServerError extends Error {
  override readonly name = 'ServerError';
}

export interface RunningServer {
  readonly url: string;
  close(): Promise<void>;
}

/** A free TCP port on 127.0.0.1. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

/** Resolves once `url` answers an HTTP request (any status), or rejects after `timeoutMs`. */
export async function waitForUrl(
  url: string,
  timeoutMs: number,
  isAlive: () => boolean = () => true,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive()) throw new ServerError(`the server process exited before ${url} answered`);
    try {
      await fetch(url, { signal: AbortSignal.timeout(2000) });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new ServerError(`${url} did not answer within ${Math.round(timeoutMs / 1000)} s`);
}

function stop(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.pid === undefined) {
      resolve();
      return;
    }
    child.once('exit', () => {
      resolve();
    });
    try {
      process.kill(-child.pid, 'SIGTERM'); // the whole process group (shell and server)
    } catch {
      child.kill('SIGTERM');
    }
  });
}

async function launch(
  command: string,
  args: string[],
  options: { cwd: string; shell: boolean; url: string; timeoutMs: number },
): Promise<RunningServer> {
  const child = spawn(command, args, {
    cwd: options.cwd,
    shell: options.shell,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  try {
    await waitForUrl(options.url, options.timeoutMs, () => !exited);
  } catch (error) {
    await stop(child);
    throw error;
  }
  return { url: options.url, close: () => stop(child) };
}

/** Starts a shell command (e.g. `pnpm start`) and waits until `url` answers. */
export function startCommand(
  command: string,
  cwd: string,
  url: string,
  timeoutMs = 60_000,
): Promise<RunningServer> {
  return launch(command, [], { cwd, shell: true, url, timeoutMs });
}

/** `node_modules/next/dist/bin/next` in `appDir` or the nearest ancestor that has it. */
async function findNextBin(appDir: string): Promise<string | undefined> {
  let dir = resolve(appDir);
  for (;;) {
    const candidate = join(dir, 'node_modules', 'next', 'dist', 'bin', 'next');
    if ((await stat(candidate).catch(() => undefined))?.isFile() === true) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Starts `next start` for the app in `appDir` on a free port. */
export async function startNext(appDir: string, timeoutMs = 60_000): Promise<RunningServer> {
  const bin = await findNextBin(appDir);
  if (bin === undefined) {
    throw new ServerError(
      `cannot find the next package from ${appDir}; install dependencies or pass --start and --base-url`,
    );
  }
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  return launch(
    process.execPath,
    [bin, 'start', '--port', String(port), '--hostname', '127.0.0.1'],
    {
      cwd: appDir,
      shell: false,
      url,
      timeoutMs,
    },
  );
}
