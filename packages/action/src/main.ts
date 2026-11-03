import { run } from './run.js';

process.exitCode = await run({
  env: process.env,
  fetch: globalThis.fetch,
  log: (line) => process.stdout.write(`${line}\n`),
});
