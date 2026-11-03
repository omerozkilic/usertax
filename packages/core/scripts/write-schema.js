// Writes the JSON Schema of the report next to the package. Run after `pnpm build`.
import { writeFileSync } from 'node:fs';
import { reportJsonSchema } from '../dist/index.js';

const target = new URL('../schema/report.v1.schema.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(reportJsonSchema(), null, 2)}\n`);
process.stdout.write(`wrote ${target.pathname}\n`);
