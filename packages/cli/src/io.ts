export interface Io {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

export const defaultIo: Io = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

/** Thrown for invalid usage or input; the CLI prints the message and exits with code 2. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}

export const EXIT = { ok: 0, budgetFailed: 1, usage: 2, internal: 3 } as const;
