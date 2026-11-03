import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';

/** The parts of the Actions runtime the action uses, injectable for tests. */
export interface Runtime {
  readonly env: NodeJS.ProcessEnv;
  readonly fetch: typeof fetch;
  readonly log: (line: string) => void;
}

export class InputError extends Error {
  override readonly name = 'InputError';
}

/** Reads an action input (`INPUT_<NAME>`), trimmed; empty means unset. */
export function getInput(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

export function requireInput(env: NodeJS.ProcessEnv, name: string): string {
  const value = getInput(env, name);
  if (value === undefined) throw new InputError(`input "${name}" is required`);
  return value;
}

export function booleanInput(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = getInput(env, name);
  if (value === undefined) return fallback;
  if (/^(true|yes|1)$/i.test(value)) return true;
  if (/^(false|no|0)$/i.test(value)) return false;
  throw new InputError(`input "${name}" must be true or false, received "${value}"`);
}

/** Writes a step output with a random heredoc delimiter, so values cannot inject outputs. */
export async function setOutput(
  env: NodeJS.ProcessEnv,
  name: string,
  value: string,
): Promise<void> {
  const file = env['GITHUB_OUTPUT'];
  if (file === undefined || file === '') return;
  const delimiter = `usertax_${randomUUID()}`;
  await appendFile(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

export async function appendSummary(env: NodeJS.ProcessEnv, markdown: string): Promise<void> {
  const file = env['GITHUB_STEP_SUMMARY'];
  if (file === undefined || file === '') return;
  await appendFile(file, `${markdown}\n`);
}

/** Escapes a message for a workflow command (`::warning::…`). */
export function commandMessage(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
